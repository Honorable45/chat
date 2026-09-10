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
  // Langue principale de l'expéditeur — repli quand le STT ne reconnaît pas
  // la langue parlée (voir resolveSource), pour ne jamais bloquer une
  // traduction demandée sur une simple détection ratée.
  sender: { select: { primaryLanguage: { select: { id: true, code: true } } } },
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
      // Sans transcription exploitable (STT en échec, et aucune langue
      // principale sur le profil expéditeur pour le repli), impossible de
      // traduire : on le signale à la place d'un silence, l'UI affiche alors
      // "traduction indisponible".
      this.logger.warn(
        `Traduction vocale ${messageId} vers "${targetLanguageCode}" abandonnée : transcription ou langue source indéterminable.`,
      );
      this.events.emitToUsers(participantIds, 'translation:failed', {
        messageId,
        stage: 'translation',
        targetLanguageCode,
      });
      return;
    }

    const target = await this.prisma.language.findUnique({ where: { code: targetLanguageCode } });
    if (!target || !target.enabled) return;

    // Langue cible identique à la langue source (possible seulement après le
    // repli sur la langue du profil expéditeur) : rien à traduire, on renvoie
    // le transcript tel quel plutôt que de laisser l'UI tourner dans le vide.
    if (target.id === source.languageId) {
      this.events.emitToUsers(participantIds, 'translation:completed', {
        messageId,
        stage: 'translation',
        targetLanguageCode: target.code,
        translatedText: source.text,
      });
      return;
    }

    await this.translateOne(
      messageId,
      message.senderId,
      source,
      { id: target.id, code: target.code },
      participantIds,
    );
  }

  /**
   * Résout le texte + la langue source d'une traduction à la demande :
   * 1. transcription — réutilisée si déjà calculée à l'envoi, sinon lancée
   *    maintenant ;
   * 2. langue source — celle reconnue par le STT si elle l'est, sinon repli
   *    sur la langue principale du profil de l'expéditeur (même stratégie que
   *    la traduction d'appel, CallTranslationService) : une simple détection
   *    ratée ne doit jamais bloquer une traduction explicitement demandée.
   */
  private async resolveSource(
    message: MessageWithConversation,
    participantIds: string[],
  ): Promise<TranscriptionOutcome | null> {
    const voice = message.voiceMessage!;

    let transcript = voice.transcript;
    let languageId = voice.detectedLanguage?.id ?? null;
    let languageCode = voice.detectedLanguage?.code ?? null;

    if (!transcript) {
      const outcome = await this.runTranscription(
        message.id,
        voice.audioStorageKey,
        voice.audioStorageProvider,
        voice.audioMimeType,
        participantIds,
      );
      if (outcome) return outcome;
      // runTranscription enregistre le transcript même quand il ne reconnaît
      // pas la langue (puis renvoie null) — on le relit pour le repli ci-dessous.
      const refreshed = await this.prisma.voiceMessage.findUnique({
        where: { messageId: message.id },
        select: { transcript: true },
      });
      transcript = refreshed?.transcript ?? null;
    }

    if (!transcript?.trim()) return null;

    if (!languageId || !languageCode) {
      languageId = message.sender.primaryLanguage?.id ?? null;
      languageCode = message.sender.primaryLanguage?.code ?? null;
    }
    if (!languageId || !languageCode) return null;

    return { text: transcript, languageId, languageCode };
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
