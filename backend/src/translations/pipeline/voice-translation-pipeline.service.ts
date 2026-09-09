import { Injectable, Logger } from '@nestjs/common';
import type { MediaStorageProvider } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ALLOWED_AUDIO_MIME_TYPES,
  EXTENSION_TO_MIME_TYPE,
} from '../../uploads/audio-upload.constants';
import { CloudinaryProvider } from '../../uploads/cloudinary.provider';
import { StorageService } from '../../uploads/storage.service';
import { EventsGateway } from '../../websocket/events.gateway';
import { SpeechToTextService } from '../speech-to-text/speech-to-text.service';
import { TextToSpeechService } from '../text-to-speech/text-to-speech.service';
import { TranslationService } from '../translation/translation.service';
import { VoiceIdentityService } from '../voice-identity/voice-identity.service';

interface TranscriptionOutcome {
  text: string;
  languageId: string;
  languageCode: string;
}

interface TargetLanguage {
  id: string;
  code: string;
}

const MESSAGE_WITH_CONVERSATION_INCLUDE = {
  voiceMessage: { include: { detectedLanguage: true } },
  conversation: { include: { members: { where: { leftAt: null } } } },
} satisfies Prisma.MessageInclude;

type MessageWithConversation = Prisma.MessageGetPayload<{
  include: typeof MESSAGE_WITH_CONVERSATION_INCLUDE;
}>;

/**
 * Orchestre le pipeline d'un vocal (section 38 : VoiceMessage →
 * SpeechToTextService → TranslationService → TextToSpeechService, avec
 * VoiceIdentityService comme garde-fou de consentement avant tout clonage).
 *
 * Deux points d'entrée, toujours en tâche de fond (le vocal est déjà
 * entièrement envoyé et utilisable avant même que ce pipeline ne démarre —
 * un échec à n'importe quelle étape ne doit jamais affecter le message
 * original, section 35) :
 *
 * - `runInBackground` : transcription seule, déclenchée à l'envoi. Aucune
 *   traduction n'est faite d'office — la langue cible n'est jamais
 *   présupposée à partir des préférences d'un destinataire (section 16 : le
 *   destinataire choisit lui-même, par vocal, la langue vers laquelle
 *   traduire).
 * - `translateInBackground` : traduction + synthèse vers UNE langue précise,
 *   déclenchée à la demande quand un membre de la conversation la réclame
 *   (voir VoiceService.requestTranslation). Transcrit d'abord si besoin.
 */
@Injectable()
export class VoiceTranslationPipelineService {
  private readonly logger = new Logger(VoiceTranslationPipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly speechToText: SpeechToTextService,
    private readonly translation: TranslationService,
    private readonly textToSpeech: TextToSpeechService,
    private readonly voiceIdentity: VoiceIdentityService,
    private readonly events: EventsGateway,
    private readonly cloudinary: CloudinaryProvider,
  ) {}

  runInBackground(messageId: string): void {
    this.executeTranscription(messageId).catch((error: unknown) => {
      this.logger.error(
        `Pipeline de traduction vocale : échec inattendu pour le message ${messageId} : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  /** Traduit (+ synthétise) un vocal déjà envoyé vers UNE langue cible précise, à la demande. */
  translateInBackground(messageId: string, targetLanguageCode: string): void {
    this.executeTranslation(messageId, targetLanguageCode).catch((error: unknown) => {
      this.logger.error(
        `Pipeline de traduction vocale : échec inattendu pour le message ${messageId} (cible ${targetLanguageCode}) : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  private async executeTranscription(messageId: string): Promise<void> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: MESSAGE_WITH_CONVERSATION_INCLUDE,
    });
    if (!message?.voiceMessage) return;

    const participantIds = message.conversation.members.map((member) => member.userId);

    await this.runTranscription(
      messageId,
      message.voiceMessage.audioStorageKey,
      message.voiceMessage.audioStorageProvider,
      message.voiceMessage.audioMimeType,
      participantIds,
    );
  }

  private async executeTranslation(messageId: string, targetLanguageCode: string): Promise<void> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: MESSAGE_WITH_CONVERSATION_INCLUDE,
    });
    if (!message?.voiceMessage) return;

    if (!this.translation.isConfigured()) return;

    const participantIds = message.conversation.members.map((member) => member.userId);

    const source = await this.resolveSource(message, participantIds);
    if (!source) {
      // Sans transcription exploitable (STT indisponible, langue source non
      // reconnue par le registre...), impossible de traduire : on le signale
      // à la place d'un silence, l'UI affiche alors "traduction indisponible".
      this.events.emitToUsers(participantIds, 'translation:failed', {
        messageId,
        stage: 'translation',
        targetLanguageCode,
      });
      return;
    }

    const target = await this.prisma.language.findUnique({ where: { code: targetLanguageCode } });
    // Cible inconnue/désactivée, ou identique à la langue déjà parlée : rien à
    // faire (VoiceService a normalement déjà écarté ces cas).
    if (!target || !target.enabled || target.id === source.languageId) return;

    await this.translateOne(
      messageId,
      message.senderId,
      source,
      { id: target.id, code: target.code },
      participantIds,
    );
  }

  /**
   * Transcription source d'une traduction à la demande : réutilise celle déjà
   * calculée à l'envoi si elle existe (le cas courant), sinon lance le STT
   * maintenant.
   */
  private async resolveSource(
    message: MessageWithConversation,
    participantIds: string[],
  ): Promise<TranscriptionOutcome | null> {
    const voice = message.voiceMessage!;
    if (voice.transcript && voice.detectedLanguage) {
      return {
        text: voice.transcript,
        languageId: voice.detectedLanguage.id,
        languageCode: voice.detectedLanguage.code,
      };
    }
    return this.runTranscription(
      message.id,
      voice.audioStorageKey,
      voice.audioStorageProvider,
      voice.audioMimeType,
      participantIds,
    );
  }

  private async runTranscription(
    messageId: string,
    storageKey: string,
    storageProvider: MediaStorageProvider,
    audioMimeType: string | null,
    participantIds: string[],
  ): Promise<TranscriptionOutcome | null> {
    if (!this.speechToText.isConfigured()) return null;

    this.events.emitToUsers(participantIds, 'translation:started', {
      messageId,
      stage: 'transcription',
    });

    try {
      const audio = await this.readAudioFile(storageKey, storageProvider);
      // audioMimeType (renseigné à l'envoi, voir VoiceService.send) fait foi
      // quand présent — un public_id Cloudinary ne porte pas d'extension
      // exploitable, contrairement à une clé LOCAL. Repli sur l'extension
      // uniquement pour les vocaux LOCAL envoyés avant l'ajout de ce champ.
      const extension = storageKey.split('.').pop() ?? '';
      const mimeType =
        audioMimeType ?? EXTENSION_TO_MIME_TYPE[extension] ?? 'application/octet-stream';

      const result = await this.speechToText.transcribe(audio, mimeType);
      const language = result.languageCode
        ? await this.prisma.language.findUnique({ where: { code: result.languageCode } })
        : null;

      await this.prisma.voiceMessage.update({
        where: { messageId },
        data: {
          transcript: result.text,
          ...(language ? { detectedLanguageId: language.id } : {}),
        },
      });

      this.events.emitToUsers(participantIds, 'translation:completed', {
        messageId,
        stage: 'transcription',
        transcript: result.text,
        detectedLanguageCode: language?.code ?? null,
      });

      // Sans langue reconnue par notre registre (section 16), impossible de
      // savoir depuis quelle langue traduire — le transcript reste
      // disponible, mais le pipeline s'arrête honnêtement ici.
      return language
        ? { text: result.text, languageId: language.id, languageCode: language.code }
        : null;
    } catch (error) {
      this.logger.warn(
        `Transcription échouée pour le message vocal ${messageId} : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.events.emitToUsers(participantIds, 'translation:failed', {
        messageId,
        stage: 'transcription',
      });
      return null;
    }
  }

  private async translateOne(
    messageId: string,
    senderId: string,
    source: TranscriptionOutcome,
    target: TargetLanguage,
    participantIds: string[],
  ): Promise<void> {
    const voiceMessage = await this.prisma.voiceMessage.findUnique({ where: { messageId } });
    if (!voiceMessage) return;

    const translation = await this.prisma.messageTranslation.upsert({
      where: {
        voiceMessageId_targetLanguageId: {
          voiceMessageId: voiceMessage.id,
          targetLanguageId: target.id,
        },
      },
      create: {
        voiceMessageId: voiceMessage.id,
        sourceLanguageId: source.languageId,
        targetLanguageId: target.id,
        status: 'PROCESSING',
        startedAt: new Date(),
      },
      update: { status: 'PROCESSING', startedAt: new Date(), errorMessage: null },
    });

    this.events.emitToUsers(participantIds, 'translation:started', {
      messageId,
      stage: 'translation',
      targetLanguageCode: target.code,
    });

    try {
      const result = await this.translation.translate(
        source.text,
        source.languageCode,
        target.code,
      );

      await this.prisma.messageTranslation.update({
        where: { id: translation.id },
        data: {
          translatedText: result.translatedText,
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      this.events.emitToUsers(participantIds, 'translation:completed', {
        messageId,
        stage: 'translation',
        targetLanguageCode: target.code,
        translatedText: result.translatedText,
      });

      // Étape suivante du pipeline, elle aussi best-effort : le texte
      // traduit ci-dessus reste acquis même si la synthèse vocale échoue.
      await this.runTextToSpeech(
        messageId,
        translation.id,
        senderId,
        result.translatedText,
        target,
        participantIds,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.messageTranslation.update({
        where: { id: translation.id },
        data: { status: 'FAILED', errorMessage: message, completedAt: new Date() },
      });

      this.logger.warn(
        `Traduction vers "${target.code}" échouée pour le message vocal ${messageId} : ${message}`,
      );
      this.events.emitToUsers(participantIds, 'translation:failed', {
        messageId,
        stage: 'translation',
        targetLanguageCode: target.code,
      });
    }
  }

  private async runTextToSpeech(
    messageId: string,
    translationId: string,
    senderId: string,
    translatedText: string,
    target: TargetLanguage,
    participantIds: string[],
  ): Promise<void> {
    if (!this.textToSpeech.isConfigured()) return;

    // Résolu à chaque appel plutôt que mis en cache : le consentement peut
    // avoir été désactivé entre l'envoi du vocal et l'exécution de cette
    // étape (section 15 — jamais de clonage sur la base d'un état périmé).
    const voiceReference = await this.voiceIdentity.resolveVoiceReference(senderId);

    this.events.emitToUsers(participantIds, 'translation:started', {
      messageId,
      stage: 'tts',
      targetLanguageCode: target.code,
    });

    try {
      const result = await this.textToSpeech.synthesize(
        translatedText,
        target.code,
        voiceReference ?? undefined,
      );
      const extension = ALLOWED_AUDIO_MIME_TYPES[result.mimeType] ?? 'bin';
      const stored = await this.saveAudioFile(result.audio, extension);

      await this.prisma.messageTranslation.update({
        where: { id: translationId },
        data: {
          translatedAudioStorageKey: stored.key,
          translatedAudioStorageProvider: stored.provider,
          usedVoiceCloning: voiceReference !== null,
        },
      });

      this.events.emitToUsers(participantIds, 'translation:completed', {
        messageId,
        stage: 'tts',
        targetLanguageCode: target.code,
        audioUrl:
          stored.provider === 'CLOUDINARY'
            ? this.cloudinary.getSignedUrl(stored.key, 'video')
            : `/api/voice/${messageId}/translations/${target.code}/audio`,
        usedVoiceCloning: voiceReference !== null,
      });
    } catch (error) {
      this.logger.warn(
        `Synthèse vocale vers "${target.code}" échouée pour le message vocal ${messageId} : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      this.events.emitToUsers(participantIds, 'translation:failed', {
        messageId,
        stage: 'tts',
        targetLanguageCode: target.code,
      });
    }
  }

  /**
   * Lit les octets d'un vocal quel que soit son fournisseur — LOCAL directement
   * depuis le disque, CLOUDINARY via un téléchargement HTTP de l'URL signée
   * (aucun accès disque possible sur un public_id Cloudinary). Nécessaire pour
   * la transcription (STT), qui a besoin du buffer complet, jamais d'une URL.
   */
  private async readAudioFile(key: string, provider: MediaStorageProvider): Promise<Buffer> {
    if (provider === 'LOCAL') return this.storage.readFile(key);

    const url = this.cloudinary.getSignedUrl(key, 'video');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Téléchargement Cloudinary du vocal échoué (HTTP ${response.status}).`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /** Upload de l'audio traduit (TTS) — même principe que VoiceService.saveAudioFile. */
  private async saveAudioFile(
    buffer: Buffer,
    extension: string,
  ): Promise<{ key: string; provider: MediaStorageProvider }> {
    if (this.cloudinary.isConfigured()) {
      const uploaded = await this.cloudinary.upload(buffer, 'translated-voice', 'video');
      return { key: uploaded.publicId, provider: 'CLOUDINARY' };
    }
    const stored = await this.storage.save(buffer, 'translated-voice', extension);
    return { key: stored.key, provider: 'LOCAL' };
  }
}
