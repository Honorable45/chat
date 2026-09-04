import { Injectable, Logger } from '@nestjs/common';
import { SpeechToTextProvider, SpeechToTextResult } from '../interfaces/speech-to-text.interface';
import { GroqSpeechToTextProvider } from './providers/groq-speech-to-text.provider';
import { UnconfiguredSpeechToTextProvider } from './providers/unconfigured-speech-to-text.provider';

/**
 * Sélectionne le provider actif selon `STT_PROVIDER` (section 38). Ajouter
 * un provider réel consiste à créer une classe qui respecte
 * `SpeechToTextProvider` et à l'ajouter au switch de `buildProvider()`, sans
 * toucher aux appelants.
 */
@Injectable()
export class SpeechToTextService {
  private readonly logger = new Logger(SpeechToTextService.name);
  private readonly provider: SpeechToTextProvider;
  // Reflète le provider réellement construit, pas seulement la variable
  // d'environnement demandée : un `STT_PROVIDER="groq"` sans `STT_API_KEY`
  // retombe sur le mode non configuré, et `isConfigured()` doit le savoir
  // (sinon le pipeline croirait pouvoir transcrire alors que l'appel
  // échouerait à coup sûr).
  private readonly configured: boolean;

  constructor() {
    const value = process.env.STT_PROVIDER ?? 'none';
    const built = this.buildProvider(value);
    this.provider = built.provider;
    this.configured = built.configured;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  transcribe(audio: Buffer, mimeType: string): Promise<SpeechToTextResult> {
    return this.provider.transcribe(audio, mimeType);
  }

  private buildProvider(value: string): { provider: SpeechToTextProvider; configured: boolean } {
    switch (value) {
      case 'groq': {
        const apiKey = process.env.STT_API_KEY;
        if (!apiKey) {
          this.logger.warn(
            'STT_PROVIDER="groq" sans STT_API_KEY : retombe sur le mode non configuré.',
          );
          return { provider: new UnconfiguredSpeechToTextProvider(value), configured: false };
        }
        return { provider: new GroqSpeechToTextProvider(apiKey), configured: true };
      }
      default:
        return { provider: new UnconfiguredSpeechToTextProvider(value), configured: false };
    }
  }
}
