import { ServiceUnavailableException } from '@nestjs/common';
import { TranslationProvider, TranslationResult } from '../../interfaces/translation.interface';

/**
 * Provider par défaut tant que `TRANSLATION_PROVIDER` reste à "none" (ou
 * vaut une valeur non encore implémentée). Échoue toujours, explicitement —
 * jamais de traduction inventée (section 40).
 */
export class UnconfiguredTranslationProvider implements TranslationProvider {
  constructor(private readonly configuredValue: string) {}

  translate(): Promise<TranslationResult> {
    const detail =
      this.configuredValue === 'none'
        ? 'Aucun fournisseur de traduction n\'est configuré (TRANSLATION_PROVIDER="none").'
        : `TRANSLATION_PROVIDER="${this.configuredValue}" n'est pas encore implémenté.`;
    throw new ServiceUnavailableException(
      `La traduction est temporairement indisponible. ${detail}`,
    );
  }
}
