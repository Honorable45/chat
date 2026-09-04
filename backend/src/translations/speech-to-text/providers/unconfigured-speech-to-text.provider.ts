import { ServiceUnavailableException } from '@nestjs/common';
import {
  SpeechToTextProvider,
  SpeechToTextResult,
} from '../../interfaces/speech-to-text.interface';

/**
 * Provider par défaut tant que `STT_PROVIDER` reste à "none" (ou vaut une
 * valeur non encore implémentée). Échoue toujours, explicitement — jamais de
 * fausse transcription renvoyée (section 40). SpeechToTextService vérifie
 * `isConfigured()` avant d'appeler `transcribe()` pour la plupart des flux
 * (envoi d'un vocal notamment), donc cette exception ne remonte au client
 * que sur une tentative explicite (endpoint de retranscription manuelle).
 */
export class UnconfiguredSpeechToTextProvider implements SpeechToTextProvider {
  constructor(private readonly configuredValue: string) {}

  transcribe(): Promise<SpeechToTextResult> {
    const detail =
      this.configuredValue === 'none'
        ? 'Aucun fournisseur Speech-to-Text n\'est configuré (STT_PROVIDER="none").'
        : `STT_PROVIDER="${this.configuredValue}" n'est pas encore implémenté.`;
    throw new ServiceUnavailableException(
      `La transcription vocale est temporairement indisponible. ${detail}`,
    );
  }
}
