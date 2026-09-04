import { ServiceUnavailableException } from '@nestjs/common';
import {
  TextToSpeechProvider,
  TextToSpeechResult,
  VoiceReference,
} from '../../interfaces/text-to-speech.interface';

// Modèle multilingue : nécessaire puisque le texte à synthétiser est déjà
// traduit vers des langues potentiellement différentes de l'anglais.
const ELEVENLABS_MODEL_ID = 'eleven_multilingual_v2';

/** ElevenLabs — seul fournisseur de cette liste à proposer un vrai clonage
 * vocal accessible gratuitement (voir VoiceIdentityService pour
 * l'inscription d'un modèle). Sans référence de voix, utilise une voix
 * premade générique (configurable via `defaultVoiceId`, sinon "Rachel",
 * une voix officielle ElevenLabs). */
export class ElevenLabsTextToSpeechProvider implements TextToSpeechProvider {
  constructor(
    private readonly apiKey: string,
    private readonly defaultVoiceId: string,
  ) {}

  async synthesize(
    text: string,
    _languageCode: string,
    voice?: VoiceReference,
  ): Promise<TextToSpeechResult> {
    const voiceId = voice?.voiceModelId ?? this.defaultVoiceId;

    let res: Response;
    try {
      res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL_ID }),
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `Impossible de contacter ElevenLabs : ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ServiceUnavailableException(
        `Synthèse vocale ElevenLabs échouée (HTTP ${res.status}) : ${detail.slice(0, 300)}`,
      );
    }

    const arrayBuffer = await res.arrayBuffer();
    return { audio: Buffer.from(arrayBuffer), mimeType: 'audio/mpeg' };
  }
}
