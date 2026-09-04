import { Injectable, Logger } from '@nestjs/common';
import {
  TextToSpeechProvider,
  TextToSpeechResult,
  VoiceReference,
} from '../interfaces/text-to-speech.interface';
import { ElevenLabsTextToSpeechProvider } from './providers/elevenlabs-text-to-speech.provider';
import { UnconfiguredTextToSpeechProvider } from './providers/unconfigured-text-to-speech.provider';

// Voix premade officielle ElevenLabs ("Rachel") — utilisée uniquement en
// l'absence de voix clonée pour l'expéditeur (pas de consentement, ou pas
// encore de modèle inscrit). Peut être remplacée via `TTS_DEFAULT_VOICE_ID`.
const DEFAULT_ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

/**
 * Sélectionne le provider actif selon `TTS_PROVIDER` (section 38). Même
 * principe que SpeechToTextService/TranslationService.
 */
@Injectable()
export class TextToSpeechService {
  private readonly logger = new Logger(TextToSpeechService.name);
  private readonly provider: TextToSpeechProvider;
  // Reflète le provider réellement construit, pas la variable d'environnement
  // brute — voir le même commentaire dans SpeechToTextService.
  private readonly configured: boolean;

  constructor() {
    const value = process.env.TTS_PROVIDER ?? 'none';
    const built = this.buildProvider(value);
    this.provider = built.provider;
    this.configured = built.configured;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  synthesize(
    text: string,
    languageCode: string,
    voice?: VoiceReference,
  ): Promise<TextToSpeechResult> {
    return this.provider.synthesize(text, languageCode, voice);
  }

  private buildProvider(value: string): { provider: TextToSpeechProvider; configured: boolean } {
    switch (value) {
      case 'elevenlabs': {
        const apiKey = process.env.TTS_API_KEY;
        if (!apiKey) {
          this.logger.warn(
            'TTS_PROVIDER="elevenlabs" sans TTS_API_KEY : retombe sur le mode non configuré.',
          );
          return { provider: new UnconfiguredTextToSpeechProvider(value), configured: false };
        }
        const defaultVoiceId = process.env.TTS_DEFAULT_VOICE_ID ?? DEFAULT_ELEVENLABS_VOICE_ID;
        return {
          provider: new ElevenLabsTextToSpeechProvider(apiKey, defaultVoiceId),
          configured: true,
        };
      }
      default:
        return { provider: new UnconfiguredTextToSpeechProvider(value), configured: false };
    }
  }
}
