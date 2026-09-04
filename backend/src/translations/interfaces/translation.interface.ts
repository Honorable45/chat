export interface TranslationResult {
  translatedText: string;
}

/**
 * Contrat que doit respecter tout fournisseur de traduction (section 38).
 * Implémenter cette interface pour un vrai fournisseur (DeepL, Google
 * Translate, un LLM, etc.) et le brancher dans TranslationService suffit —
 * aucun appelant n'a à changer.
 */
export interface TranslationProvider {
  translate(
    text: string,
    sourceLanguageCode: string,
    targetLanguageCode: string,
  ): Promise<TranslationResult>;
}
