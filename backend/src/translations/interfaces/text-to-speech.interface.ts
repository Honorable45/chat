/** Référence vers un modèle vocal cloné — jamais utilisée sans consentement (section 15). */
export interface VoiceReference {
  voiceModelId: string;
}

export interface TextToSpeechResult {
  audio: Buffer;
  /** Type MIME réel du flux audio produit (ex. "audio/mpeg"). */
  mimeType: string;
}

/**
 * Contrat que doit respecter tout fournisseur de synthèse vocale
 * (section 38). `voice`, si fourni, demande une synthèse avec la voix
 * clonée de l'expéditeur — un fournisseur qui ne sait pas cloner peut
 * l'ignorer et utiliser une voix générique pour la langue cible.
 */
export interface TextToSpeechProvider {
  synthesize(
    text: string,
    languageCode: string,
    voice?: VoiceReference,
  ): Promise<TextToSpeechResult>;
}
