import { ServiceUnavailableException } from '@nestjs/common';
import {
  TextToSpeechProvider,
  TextToSpeechResult,
} from '../../interfaces/text-to-speech.interface';

/**
 * Provider par défaut tant que `TTS_PROVIDER` reste à "none" (ou vaut une
 * valeur non encore implémentée). Échoue toujours, explicitement — jamais
 * un vocal de synthèse inventé ou silencieux renvoyé comme réel (section 40).
 */
export class UnconfiguredTextToSpeechProvider implements TextToSpeechProvider {
  constructor(private readonly configuredValue: string) {}

  synthesize(): Promise<TextToSpeechResult> {
    const detail =
      this.configuredValue === 'none'
        ? 'Aucun fournisseur Text-to-Speech n\'est configuré (TTS_PROVIDER="none").'
        : `TTS_PROVIDER="${this.configuredValue}" n'est pas encore implémenté.`;
    throw new ServiceUnavailableException(
      `La synthèse vocale est temporairement indisponible. ${detail}`,
    );
  }
}
