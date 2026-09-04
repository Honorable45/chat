import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ALLOWED_AUDIO_MIME_TYPES,
  EXTENSION_TO_MIME_TYPE,
} from '../../uploads/audio-upload.constants';
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
  voiceMessage: true,
  conversation: { include: { members: { where: { leftAt: null } } } },
} satisfies Prisma.MessageInclude;

/**
 * Orchestre le pipeline complet d'un vocal (section 38 : VoiceMessage →
 * SpeechToTextService → TranslationService → TextToSpeechService, avec
 * VoiceIdentityService comme garde-fou de consentement avant tout clonage).
 * Toujours déclenché en tâche de fond (`runInBackground`) : le vocal est déjà
 * entièrement envoyé et utilisable avant même que ce pipeline ne démarre —
 * un échec à n'importe quelle étape ne doit jamais affecter le message
 * original (section 35).
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
  ) {}

  runInBackground(messageId: string): void {
    this.execute(messageId).catch((error: unknown) => {
      this.logger.error(
        `Pipeline de traduction vocale : échec inattendu pour le message ${messageId} : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  private async execute(messageId: string): Promise<void> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: MESSAGE_WITH_CONVERSATION_INCLUDE,
    });
    if (!message?.voiceMessage) return;

    const participantIds = message.conversation.members.map((member) => member.userId);

    const transcription = await this.runTranscription(
      messageId,
      message.voiceMessage.audioStorageKey,
      participantIds,
    );
    if (!transcription) return;

    await this.runTranslations(messageId, message.senderId, transcription, participantIds);
  }

  private async runTranscription(
    messageId: string,
    storageKey: string,
    participantIds: string[],
  ): Promise<TranscriptionOutcome | null> {
    if (!this.speechToText.isConfigured()) return null;

    this.events.emitToUsers(participantIds, 'translation:started', {
      messageId,
      stage: 'transcription',
    });

    try {
      const audio = await this.storage.readFile(storageKey);
      const extension = storageKey.split('.').pop() ?? '';
      const mimeType = EXTENSION_TO_MIME_TYPE[extension] ?? 'application/octet-stream';

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

  private async runTranslations(
    messageId: string,
    senderId: string,
    source: TranscriptionOutcome,
    participantIds: string[],
  ): Promise<void> {
    if (!this.translation.isConfigured()) return;

    const recipientIds = participantIds.filter((id) => id !== senderId);
    if (recipientIds.length === 0) return;

    const targets = await this.resolveTargetLanguages(recipientIds, source.languageId);
    for (const target of targets) {
      await this.translateOne(messageId, senderId, source, target, participantIds);
    }
  }

  /** Une langue cible par destinataire distinct — inutile de traduire vers la langue déjà parlée. */
  private async resolveTargetLanguages(
    recipientIds: string[],
    sourceLanguageId: string,
  ): Promise<TargetLanguage[]> {
    const recipients = await this.prisma.user.findMany({
      where: { id: { in: recipientIds } },
      include: { preferredReceiveLanguage: true },
    });

    const distinct = new Map<string, TargetLanguage>();
    for (const recipient of recipients) {
      const lang = recipient.preferredReceiveLanguage;
      if (lang && lang.id !== sourceLanguageId) {
        distinct.set(lang.id, { id: lang.id, code: lang.code });
      }
    }
    return [...distinct.values()];
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
      const stored = await this.storage.save(result.audio, 'translated-voice', extension);

      await this.prisma.messageTranslation.update({
        where: { id: translationId },
        data: {
          translatedAudioStorageKey: stored.key,
          usedVoiceCloning: voiceReference !== null,
        },
      });

      this.events.emitToUsers(participantIds, 'translation:completed', {
        messageId,
        stage: 'tts',
        targetLanguageCode: target.code,
        audioUrl: `/api/voice/${messageId}/translations/${target.code}/audio`,
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
}
