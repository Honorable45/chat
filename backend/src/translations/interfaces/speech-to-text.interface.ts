export interface SpeechToTextResult {
  text: string;
  /** Code de langue détecté (ex. "fr"), ou null si le fournisseur ne le donne pas. */
  languageCode: string | null;
}

/**
 * Contrat que doit respecter tout fournisseur de transcription (section 38 :
 * "les fournisseurs IA doivent être interchangeables"). Implémenter cette
 * interface pour un vrai fournisseur (OpenAI Whisper, Google Speech-to-Text,
 * etc.) et le brancher dans SpeechToTextService.buildProvider() suffit —
 * aucun appelant (VoiceService, VoiceController) n'a à changer.
 */
export interface SpeechToTextProvider {
  transcribe(audio: Buffer, mimeType: string): Promise<SpeechToTextResult>;
}
