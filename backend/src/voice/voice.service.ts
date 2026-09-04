import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ReadStream } from 'node:fs';
import { LanguagesService } from '../languages/languages.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma/prisma.service';
import { VoiceTranslationPipelineService } from '../translations/pipeline/voice-translation-pipeline.service';
import { SpeechToTextService } from '../translations/speech-to-text/speech-to-text.service';
import {
  ALLOWED_AUDIO_MIME_TYPES,
  EXTENSION_TO_MIME_TYPE,
  MAX_AUDIO_SIZE_BYTES,
} from '../uploads/audio-upload.constants';
import { StorageService } from '../uploads/storage.service';
import { EventsGateway } from '../websocket/events.gateway';
import { CreateVoiceMessageDto } from './dto/create-voice-message.dto';

const VOICE_MESSAGE_INCLUDE = {
  voiceMessage: {
    include: {
      detectedLanguage: true,
      translations: { include: { targetLanguage: true } },
    },
  },
} satisfies Prisma.MessageInclude;

type MessageWithVoice = Prisma.MessageGetPayload<{ include: typeof VOICE_MESSAGE_INCLUDE }>;

function toVoiceMessageDto(message: MessageWithVoice) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    type: message.type,
    replyToId: message.replyToId,
    deletedAt: message.deletedAt,
    sentAt: message.sentAt,
    deliveredAt: message.deliveredAt,
    createdAt: message.createdAt,
    voice: message.voiceMessage
      ? {
          durationSeconds: message.voiceMessage.durationSeconds,
          waveform: message.voiceMessage.waveform,
          // URL authentifiée, jamais le chemin de stockage interne.
          audioUrl: `/api/voice/${message.id}/audio`,
          transcript: message.voiceMessage.transcript,
          detectedLanguage: message.voiceMessage.detectedLanguage
            ? {
                code: message.voiceMessage.detectedLanguage.code,
                name: message.voiceMessage.detectedLanguage.name,
                nativeName: message.voiceMessage.detectedLanguage.nativeName,
              }
            : null,
          languageOverridden: message.voiceMessage.languageOverridden,
          // Une entrée par langue cible distincte (section 18 : afficher
          // l'original ET la/les traduction(s) — jamais l'original supprimé).
          translations: message.voiceMessage.translations.map((t) => ({
            targetLanguage: {
              code: t.targetLanguage.code,
              name: t.targetLanguage.name,
              nativeName: t.targetLanguage.nativeName,
            },
            status: t.status,
            translatedText: t.translatedText,
            // URL authentifiée, jamais le chemin de stockage interne — null
            // tant que la synthèse vocale (phase 12) n'a pas abouti.
            audioUrl: t.translatedAudioStorageKey
              ? `/api/voice/${message.id}/translations/${t.targetLanguage.code}/audio`
              : null,
            usedVoiceCloning: t.usedVoiceCloning,
          })),
        }
      : null,
  };
}

export type VoiceMessageDto = ReturnType<typeof toVoiceMessageDto>;

export interface AudioStream {
  stream: ReadStream;
  mimeType: string;
  sizeBytes: number | null;
}

@Injectable()
export class VoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly events: EventsGateway,
    private readonly presence: PresenceService,
    private readonly notifications: NotificationsService,
    private readonly speechToText: SpeechToTextService,
    private readonly languages: LanguagesService,
    private readonly pipeline: VoiceTranslationPipelineService,
  ) {}

  async send(
    userId: string,
    dto: CreateVoiceMessageDto,
    file: Express.Multer.File | undefined,
  ): Promise<VoiceMessageDto> {
    if (!file || file.size === 0) {
      throw new BadRequestException('Aucun fichier audio reçu.');
    }

    const extension = ALLOWED_AUDIO_MIME_TYPES[file.mimetype];
    if (!extension) {
      throw new BadRequestException(
        `Format audio non supporté : "${file.mimetype}". Formats acceptés : ${Object.keys(ALLOWED_AUDIO_MIME_TYPES).join(', ')}.`,
      );
    }
    if (file.size > MAX_AUDIO_SIZE_BYTES) {
      throw new BadRequestException(
        `Le fichier audio est trop volumineux (${(file.size / (1024 * 1024)).toFixed(1)} Mo, maximum ${
          MAX_AUDIO_SIZE_BYTES / (1024 * 1024)
        } Mo).`,
      );
    }

    await this.assertMembership(userId, dto.conversationId);

    if (dto.replyToId) {
      const replyTarget = await this.prisma.message.findUnique({ where: { id: dto.replyToId } });
      if (!replyTarget || replyTarget.conversationId !== dto.conversationId) {
        throw new BadRequestException(
          'Le message auquel vous répondez est introuvable dans cette conversation.',
        );
      }
    }

    const waveform = this.parseWaveform(dto.waveform);
    const stored = await this.storage.save(file.buffer, 'voice', extension);

    const recipients = await this.otherMemberIds(dto.conversationId, userId);
    // Même logique que MessagesService.send : "livré" dès la création si un
    // destinataire est actuellement en ligne (voir la note sur l'absence de
    // rattrapage rétroactif dans messages.service.ts).
    const deliveredAt = recipients.some((id) => this.presence.isOnline(id)) ? new Date() : null;

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId: dto.conversationId,
          senderId: userId,
          type: 'VOICE',
          replyToId: dto.replyToId,
          deliveredAt,
          voiceMessage: {
            create: {
              audioStorageKey: stored.key,
              durationSeconds: dto.durationSeconds,
              waveform: waveform ?? undefined,
            },
          },
        },
        include: VOICE_MESSAGE_INCLUDE,
      }),
      this.prisma.conversation.update({
        where: { id: dto.conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);

    const dtoOut = toVoiceMessageDto(message);
    this.events.emitToUsers(recipients, 'message:new', dtoOut);

    await Promise.all(
      recipients.map((recipientId) =>
        this.notifications.create(recipientId, 'NEW_VOICE_MESSAGE', {
          conversationId: dto.conversationId,
          messageId: message.id,
          senderId: userId,
        }),
      ),
    );

    // Pipeline STT → traduction, en tâche de fond (section 38). Ne bloque
    // jamais l'envoi et ne fait rien si aucun fournisseur n'est configuré
    // (mode dégradé — section 35) : le vocal ci-dessus est déjà pleinement
    // envoyé et utilisable.
    this.pipeline.runInBackground(message.id);

    return dtoOut;
  }

  /** Vérifie l'appartenance à la conversation avant de streamer le fichier (section 23). */
  async streamAudio(userId: string, messageId: string): Promise<AudioStream> {
    const message = await this.findVoiceMessage(messageId);
    await this.assertMembership(userId, message.conversationId);

    const key = message.voiceMessage!.audioStorageKey;
    if (!(await this.storage.exists(key))) {
      throw new NotFoundException('Fichier audio introuvable.');
    }

    const extension = key.split('.').pop() ?? '';
    return {
      stream: this.storage.createReadStream(key),
      mimeType: EXTENSION_TO_MIME_TYPE[extension] ?? 'application/octet-stream',
      sizeBytes: null,
    };
  }

  /** Même contrat que streamAudio, pour l'audio traduit par TTS (section 12/18). */
  async streamTranslatedAudio(
    userId: string,
    messageId: string,
    languageCode: string,
  ): Promise<AudioStream> {
    const message = await this.findVoiceMessage(messageId);
    await this.assertMembership(userId, message.conversationId);

    const translation = message.voiceMessage!.translations.find(
      (t) => t.targetLanguage.code === languageCode,
    );
    if (!translation || !translation.translatedAudioStorageKey) {
      throw new NotFoundException('Audio traduit introuvable.');
    }

    const key = translation.translatedAudioStorageKey;
    if (!(await this.storage.exists(key))) {
      throw new NotFoundException('Fichier audio introuvable.');
    }

    const extension = key.split('.').pop() ?? '';
    return {
      stream: this.storage.createReadStream(key),
      mimeType: EXTENSION_TO_MIME_TYPE[extension] ?? 'application/octet-stream',
      sizeBytes: null,
    };
  }

  /** Relance le pipeline STT → traduction à la demande (n'importe quel membre peut la déclencher). */
  async retranscribe(userId: string, messageId: string): Promise<{ started: boolean }> {
    const message = await this.findVoiceMessage(messageId);
    await this.assertMembership(userId, message.conversationId);

    // Vérifié ici (et pas seulement dans le pipeline) pour renvoyer une
    // erreur explicite immédiate plutôt qu'un 202 trompeur suivi de rien.
    if (!this.speechToText.isConfigured()) {
      throw new ServiceUnavailableException(
        "La transcription vocale n'est pas disponible pour l'instant (aucun fournisseur configuré).",
      );
    }

    this.pipeline.runInBackground(messageId);
    return { started: true };
  }

  /** Suppression douce, réservée à l'auteur — même contrat que MessagesService.remove. */
  async remove(userId: string, messageId: string): Promise<VoiceMessageDto> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: VOICE_MESSAGE_INCLUDE,
    });
    if (!message || message.type !== 'VOICE' || !message.voiceMessage) {
      throw new NotFoundException('Message vocal introuvable.');
    }
    await this.assertMembership(userId, message.conversationId);
    if (message.senderId !== userId) {
      throw new ForbiddenException('Vous ne pouvez supprimer que vos propres messages.');
    }

    if (message.deletedAt) {
      return toVoiceMessageDto(message); // déjà supprimé : idempotent
    }

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
      include: VOICE_MESSAGE_INCLUDE,
    });

    // La ligne base fait foi (déjà marquée supprimée) même si l'effacement
    // physique échoue — StorageService.delete ne lève jamais (best-effort).
    await this.storage.delete(message.voiceMessage.audioStorageKey);

    const recipients = await this.otherMemberIds(message.conversationId, userId);
    this.events.emitToUsers(recipients, 'message:deleted', {
      id: updated.id,
      conversationId: updated.conversationId,
    });

    return toVoiceMessageDto(updated);
  }

  /** Corrige manuellement la langue détectée (section 19) — réservé à l'auteur du vocal. */
  async overrideLanguage(
    userId: string,
    messageId: string,
    languageCode: string,
  ): Promise<VoiceMessageDto> {
    const message = await this.findVoiceMessage(messageId);
    await this.assertMembership(userId, message.conversationId);
    if (message.senderId !== userId) {
      throw new ForbiddenException("Seul l'auteur du vocal peut corriger la langue détectée.");
    }

    const language = await this.languages.findEnabledByCode(languageCode);

    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        voiceMessage: {
          update: { detectedLanguageId: language.id, languageOverridden: true },
        },
      },
      include: VOICE_MESSAGE_INCLUDE,
    });

    const dtoOut = toVoiceMessageDto(updated);
    const allMembers = await this.allMemberIds(message.conversationId);
    this.events.emitToUsers(allMembers, 'message:updated', dtoOut);
    return dtoOut;
  }

  /**
   * Transcription + traductions d'un vocal déjà envoyé — nécessaire pour un
   * message chargé depuis l'historique (`GET /conversations/:id/messages`
   * ne connaît que la table `Message` de base, jamais ces détails, qui
   * n'arrivent sinon que via l'événement socket "message:new"/"message:
   * updated" au moment de l'envoi ou de la mise à jour du pipeline).
   */
  async getDetails(userId: string, messageId: string): Promise<VoiceMessageDto> {
    const message = await this.findVoiceMessage(messageId);
    await this.assertMembership(userId, message.conversationId);
    return toVoiceMessageDto(message);
  }

  private async findVoiceMessage(messageId: string): Promise<MessageWithVoice> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: VOICE_MESSAGE_INCLUDE,
    });
    if (!message || message.type !== 'VOICE' || !message.voiceMessage || message.deletedAt) {
      throw new NotFoundException('Message vocal introuvable.');
    }
    return message;
  }

  private parseWaveform(raw: string | undefined): number[] | null {
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === 'number')) {
        throw new Error('not a number array');
      }
      return parsed;
    } catch {
      throw new BadRequestException('Le champ "waveform" doit être un tableau JSON de nombres.');
    }
  }

  private async assertMembership(userId: string, conversationId: string): Promise<void> {
    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!membership || membership.leftAt) {
      throw new NotFoundException('Conversation introuvable.');
    }
  }

  private async otherMemberIds(conversationId: string, excludeUserId: string): Promise<string[]> {
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId, leftAt: null, userId: { not: excludeUserId } },
      select: { userId: true },
    });
    return members.map((member) => member.userId);
  }

  private async allMemberIds(conversationId: string): Promise<string[]> {
    const members = await this.prisma.conversationMember.findMany({
      where: { conversationId, leftAt: null },
      select: { userId: true },
    });
    return members.map((member) => member.userId);
  }
}
