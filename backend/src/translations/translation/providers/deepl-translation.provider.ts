import { ServiceUnavailableException } from '@nestjs/common';
import { TranslationProvider, TranslationResult } from '../../interfaces/translation.interface';

// DeepL distingue les clés Free (suffixe ":fx") des clés Pro : l'hôte de
// l'API diffère selon le plan, pas seulement le comportement de facturation.
const FREE_KEY_SUFFIX = ':fx';

interface DeepLResponse {
  translations: { text: string }[];
}

/** DeepL Free — voir https://www.deepl.com/pro-api, gratuit jusqu'à 500 000
 * caractères/mois, considéré comme la meilleure qualité de traduction
 * disponible actuellement. */
export class DeepLTranslationProvider implements TranslationProvider {
  private readonly baseUrl: string;

  constructor(private readonly apiKey: string) {
    this.baseUrl = apiKey.endsWith(FREE_KEY_SUFFIX)
      ? 'https://api-free.deepl.com'
      : 'https://api.deepl.com';
  }

  async translate(
    text: string,
    sourceLanguageCode: string,
    targetLanguageCode: string,
  ): Promise<TranslationResult> {
    const body = new URLSearchParams();
    body.set('text', text);
    body.set('source_lang', sourceLanguageCode.toUpperCase());
    body.set('target_lang', this.toTargetCode(targetLanguageCode));

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v2/translate`, {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${this.apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `Impossible de contacter DeepL : ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ServiceUnavailableException(
        `Traduction DeepL échouée (HTTP ${res.status}) : ${detail.slice(0, 300)}`,
      );
    }

    const data = (await res.json()) as DeepLResponse;
    const translatedText = data.translations[0]?.text;
    if (!translatedText) {
      throw new ServiceUnavailableException('DeepL a renvoyé une réponse vide.');
    }
    return { translatedText };
  }

  // Seules quelques langues cibles exigent une variante régionale chez
  // DeepL (EN → EN-US/EN-GB, PT → PT-PT/PT-BR) ; les autres codes passent
  // tels quels, juste mis en majuscules.
  private toTargetCode(code: string): string {
    const upper = code.toUpperCase();
    if (upper === 'EN') return 'EN-US';
    if (upper === 'PT') return 'PT-PT';
    return upper;
  }
}
