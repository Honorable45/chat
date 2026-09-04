import { ServiceUnavailableException } from '@nestjs/common';
import { ALLOWED_AUDIO_MIME_TYPES } from '../../../uploads/audio-upload.constants';
import {
  SpeechToTextProvider,
  SpeechToTextResult,
} from '../../interfaces/speech-to-text.interface';

const GROQ_TRANSCRIPTIONS_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
// large-v3 : le modèle Whisper le plus précis servi par Groq, gratuit sur
// leur offre actuelle (voir instructions de configuration dans .env).
const GROQ_WHISPER_MODEL = 'whisper-large-v3';

// L'API renvoie le nom complet de la langue détectée (ex. "french"), pas un
// code ISO — ne couvre que les langues seedées par ce projet
// (prisma/seed.ts) ; une langue reconnue par Whisper mais absente d'ici
// renvoie `languageCode: null`, ce que le pipeline sait déjà gérer
// honnêtement (transcript conservé, traduction non tentée).
const WHISPER_LANGUAGE_NAME_TO_CODE: Readonly<Record<string, string>> = {
  french: 'fr',
  english: 'en',
  spanish: 'es',
  portuguese: 'pt',
};

interface GroqTranscriptionResponse {
  text: string;
  language?: string;
}

/** Groq sert Whisper large-v3 gratuitement via une API compatible OpenAI —
 * voir https://console.groq.com pour la clé (GROQ_API_KEY, gratuite, aucune
 * carte requise). */
export class GroqSpeechToTextProvider implements SpeechToTextProvider {
  constructor(private readonly apiKey: string) {}

  async transcribe(audio: Buffer, mimeType: string): Promise<SpeechToTextResult> {
    // Jamais déduite en coupant le sous-type du MIME lui-même : "audio/x-wav"
    // (voir ALLOWED_AUDIO_MIME_TYPES, qui distingue ce sous-type de
    // "audio/wav" tout en pointant vers la même extension réelle) donnerait
    // "x-wav", que Groq refuse (liste fermée : flac/mp3/mp4/mpeg/mpga/m4a/
    // ogg/opus/wav/webm) — bug constaté en conditions réelles avec un vrai
    // appel Groq avant d'être corrigé ici.
    const extension = ALLOWED_AUDIO_MIME_TYPES[mimeType] ?? 'webm';
    const form = new FormData();
    form.append('model', GROQ_WHISPER_MODEL);
    form.append('response_format', 'verbose_json');
    form.append(
      'file',
      new Blob([new Uint8Array(audio)], { type: mimeType }),
      `audio.${extension}`,
    );

    let res: Response;
    try {
      res = await fetch(GROQ_TRANSCRIPTIONS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `Impossible de contacter Groq pour la transcription : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ServiceUnavailableException(
        `Transcription Groq échouée (HTTP ${res.status}) : ${detail.slice(0, 300)}`,
      );
    }

    const data = (await res.json()) as GroqTranscriptionResponse;
    const languageName = data.language?.toLowerCase().trim();
    return {
      text: data.text,
      languageCode: languageName ? (WHISPER_LANGUAGE_NAME_TO_CODE[languageName] ?? null) : null,
    };
  }
}
