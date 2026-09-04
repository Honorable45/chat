import { Injectable, Logger } from '@nestjs/common';
import { TranslationProvider, TranslationResult } from '../interfaces/translation.interface';
import { DeepLTranslationProvider } from './providers/deepl-translation.provider';
import { UnconfiguredTranslationProvider } from './providers/unconfigured-translation.provider';

/**
 * Sélectionne le provider actif selon `TRANSLATION_PROVIDER` (section 38).
 * Même principe que SpeechToTextService : ajouter un vrai fournisseur
 * consiste à créer une classe respectant `TranslationProvider` et à
 * l'ajouter au switch de `buildProvider()`.
 */
@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  private readonly provider: TranslationProvider;
  // Reflète le provider réellement construit, pas la variable d'environnement
  // brute — voir le même commentaire dans SpeechToTextService.
  private readonly configured: boolean;

  constructor() {
    const value = process.env.TRANSLATION_PROVIDER ?? 'none';
    const built = this.buildProvider(value);
    this.provider = built.provider;
    this.configured = built.configured;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  translate(
    text: string,
    sourceLanguageCode: string,
    targetLanguageCode: string,
  ): Promise<TranslationResult> {
    return this.provider.translate(text, sourceLanguageCode, targetLanguageCode);
  }

  private buildProvider(value: string): { provider: TranslationProvider; configured: boolean } {
    switch (value) {
      case 'deepl': {
        const apiKey = process.env.TRANSLATION_API_KEY;
        if (!apiKey) {
          this.logger.warn(
            'TRANSLATION_PROVIDER="deepl" sans TRANSLATION_API_KEY : retombe sur le mode non configuré.',
          );
          return { provider: new UnconfiguredTranslationProvider(value), configured: false };
        }
        return { provider: new DeepLTranslationProvider(apiKey), configured: true };
      }
      default:
        return { provider: new UnconfiguredTranslationProvider(value), configured: false };
    }
  }
}
