import { Injectable, Logger } from '@nestjs/common';
import { LanguagesService } from '../languages/languages.service';
import { PrismaService } from '../prisma/prisma.service';
import { SpeechToTextService } from '../translations/speech-to-text/speech-to-text.service';
import { TextToSpeechService } from '../translations/text-to-speech/text-to-speech.service';
import { TranslationService } from '../translations/translation/translation.service';

export interface CallTranslationResult {
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  /** Base64 de la voix synthétisée, `null` si la synthèse est indisponible (sous-titres seuls). */
  audioBase64: string | null;
  audioMimeType: string | null;
}

// Un fragment d'appel de ~5 s en Opus/WebM pèse quelques dizaines de Ko ;
// au-delà de cette borne large, c'est forcément une erreur (ou un abus) —
// on laisse tomber sans même appeler le fournisseur STT.
const MAX_CHUNK_BYTES = 2 * 1024 * 1024;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Traduction quasi temps réel d'un appel 1:1 (voix synthétisée + sous-titres,
 * bidirectionnelle). L'audio de l'appel continue de passer en pair-à-pair
 * (WebRTC) ; en parallèle, chaque client envoie des fragments de sa propre
 * voix (~5 s) que ce service transcrit → traduit → synthétise pour l'autre
 * participant, dans la langue que celui-ci a choisie à la réception de
 * l'appel (par défaut : la langue d'envoi de l'interlocuteur, donc aucune
 * traduction tant qu'elle n'a pas été explicitement changée — section 16).
 *
 * L'état « qui reçoit dans quelle langue » est purement en mémoire, indexé
 * par appel : un appel qui se termine (ou dont un participant se déconnecte,
 * voir CallsGateway) est de toute façon résolu côté base, la session de
 * traduction n'a aucune raison de lui survivre.
 *
 * Entièrement best-effort (section 35) : un échec à n'importe quelle étape
 * (STT, traduction, synthèse) fait simplement retomber l'autre partie sur
 * l'audio d'origine — jamais d'interruption de l'appel lui-même.
 */
@Injectable()
export class CallTranslationService {
  private readonly logger = new Logger(CallTranslationService.name);
  // callId -> (userId -> code de langue de réception choisi par cet utilisateur)
  private readonly sessions = new Map<string, Map<string, string>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly languages: LanguagesService,
    private readonly speechToText: SpeechToTextService,
    private readonly translation: TranslationService,
    private readonly textToSpeech: TextToSpeechService,
  ) {}

  /**
   * La traduction d'appel n'est possible que si transcription ET traduction
   * sont configurées. La synthèse vocale reste facultative : sans elle, les
   * sous-titres traduits fonctionnent quand même.
   */
  isEnabled(): boolean {
    return this.speechToText.isConfigured() && this.translation.isConfigured();
  }

  /** Langue dans laquelle `userId` veut recevoir l'autre partie pendant `callId` (`null` = pas de traduction). */
  getReceiveLanguage(callId: string, userId: string): string | null {
    return this.sessions.get(callId)?.get(userId) ?? null;
  }

  /**
   * Définit (ou retire, si `languageCode` est vide) la langue de réception de
   * `userId` pour `callId`. Valide le code auprès du registre — lève une
   * `BadRequestException` pour une langue inconnue (voir LanguagesService).
   */
  async setReceiveLanguage(
    callId: string,
    userId: string,
    languageCode: string | null,
  ): Promise<void> {
    if (!languageCode) {
      this.sessions.get(callId)?.delete(userId);
      return;
    }
    await this.languages.findEnabledByCode(languageCode);
    let session = this.sessions.get(callId);
    if (!session) {
      session = new Map();
      this.sessions.set(callId, session);
    }
    session.set(userId, languageCode);
  }

  /** Oublie toute la session de traduction d'un appel (fin d'appel, déconnexion). */
  clear(callId: string): void {
    this.sessions.delete(callId);
  }

  /**
   * Transcrit → traduit → synthétise un fragment de la voix de `speakerId`
   * pour `listenerId`. Renvoie `null` (sans jamais lever) dès qu'il n'y a
   * rien à produire : traduction désactivée, fragment vide/trop gros,
   * `listenerId` n'a pas choisi de langue, langue cible = langue parlée,
   * transcription vide, ou échec d'un fournisseur.
   */
  async processChunk(params: {
    callId: string;
    speakerId: string;
    listenerId: string;
    audio: Buffer;
    mimeType: string;
  }): Promise<CallTranslationResult | null> {
    const { callId, speakerId, listenerId, audio, mimeType } = params;
    if (!this.isEnabled()) return null;
    if (audio.length === 0 || audio.length > MAX_CHUNK_BYTES) return null;

    const targetLanguage = this.getReceiveLanguage(callId, listenerId);
    if (!targetLanguage) return null;

    try {
      const speakerLanguage = await this.resolvePrimaryLanguage(speakerId);

      const stt = await this.speechToText.transcribe(audio, mimeType);
      const text = stt.text.trim();
      if (!text) return null;

      const sourceLanguage = stt.languageCode ?? speakerLanguage ?? targetLanguage;
      if (sourceLanguage === targetLanguage) return null;

      const { translatedText } = await this.translation.translate(
        text,
        sourceLanguage,
        targetLanguage,
      );
      if (!translatedText.trim()) return null;

      let audioBase64: string | null = null;
      let audioMimeType: string | null = null;
      if (this.textToSpeech.isConfigured()) {
        try {
          const tts = await this.textToSpeech.synthesize(translatedText, targetLanguage);
          audioBase64 = tts.audio.toString('base64');
          audioMimeType = tts.mimeType;
        } catch (error) {
          // Sous-titres seuls : la synthèse ratée n'annule pas la traduction texte.
          this.logger.debug(`Synthèse vocale d'appel échouée (${callId}) : ${errorMessage(error)}`);
        }
      }

      return {
        originalText: text,
        translatedText,
        sourceLanguage,
        targetLanguage,
        audioBase64,
        audioMimeType,
      };
    } catch (error) {
      this.logger.debug(
        `Traduction d'un fragment d'appel échouée (${callId}) : ${errorMessage(error)}`,
      );
      return null;
    }
  }

  private async resolvePrimaryLanguage(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { primaryLanguage: { select: { code: true } } },
    });
    return user?.primaryLanguage?.code ?? null;
  }
}
