import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ALLOWED_AUDIO_MIME_TYPES,
  MAX_AUDIO_SIZE_BYTES,
} from '../../uploads/audio-upload.constants';
import { matchesFileSignature } from '../../uploads/file-signature.util';
import { PrismaService } from '../../prisma/prisma.service';
import { VoiceReference } from '../interfaces/text-to-speech.interface';

interface ElevenLabsAddVoiceResponse {
  voice_id: string;
}

/**
 * Point de passage obligé avant toute synthèse avec la voix d'un
 * utilisateur (section 15) : `resolveVoiceReference` ne renvoie une
 * référence que si le consentement est **actuellement** actif ET qu'un
 * modèle vocal existe déjà.
 *
 * L'inscription (`enroll`) et la suppression (`removeModel`) d'un modèle
 * vocal parlent directement à l'API ElevenLabs — seul fournisseur de ce
 * projet à proposer un vrai clonage vocal (voir
 * ElevenLabsTextToSpeechProvider). Ce couplage spécifique à un fournisseur
 * casse un peu le principe d'interchangeabilité de la section 38, mais
 * `TextToSpeechProvider` lui-même ne définit aucun contrat pour
 * "enregistrer" une voix (seulement pour en synthétiser une déjà connue) —
 * il n'y avait rien de générique à respecter ici. Un futur fournisseur de
 * clonage suivrait le même schéma : une méthode dédiée, gardée par
 * `TTS_PROVIDER === '<son-nom>'`.
 */
@Injectable()
export class VoiceIdentityService {
  private readonly logger = new Logger(VoiceIdentityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolveVoiceReference(userId: string): Promise<VoiceReference | null> {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile?.voiceCloningConsent || !profile.voiceModelId) {
      return null;
    }
    return { voiceModelId: profile.voiceModelId };
  }

  /**
   * Inscrit (ou remplace) le modèle vocal cloné de l'utilisateur à partir
   * d'un échantillon audio. Exige un consentement déjà actif — jamais
   * l'inverse (section 15 : le consentement précède toujours la capture,
   * pas l'occasion).
   */
  async enroll(
    userId: string,
    file: Express.Multer.File | undefined,
  ): Promise<{ voiceModelId: string }> {
    if (process.env.TTS_PROVIDER !== 'elevenlabs') {
      throw new ServiceUnavailableException(
        'Le clonage vocal nécessite TTS_PROVIDER="elevenlabs" (aucun autre fournisseur de ce projet ne le propose).',
      );
    }
    const apiKey = process.env.TTS_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'TTS_API_KEY manquant : impossible de contacter ElevenLabs.',
      );
    }
    if (!file || file.size === 0) {
      throw new BadRequestException('Aucun échantillon audio reçu.');
    }
    const extension = ALLOWED_AUDIO_MIME_TYPES[file.mimetype];
    if (!extension) {
      throw new BadRequestException(
        `Format audio non supporté : "${file.mimetype}". Formats acceptés : ${Object.keys(ALLOWED_AUDIO_MIME_TYPES).join(', ')}.`,
      );
    }
    // Le Content-Type d'un formulaire multipart est choisi par le client et
    // ne garantit rien sur le contenu réel du fichier (audit de sécurité) —
    // on vérifie les octets de signature avant d'aller plus loin.
    if (!matchesFileSignature(file.buffer, file.mimetype)) {
      throw new BadRequestException(
        `Le contenu du fichier ne correspond pas au format déclaré ("${file.mimetype}").`,
      );
    }
    if (file.size > MAX_AUDIO_SIZE_BYTES) {
      throw new BadRequestException(
        `L'échantillon est trop volumineux (${(file.size / (1024 * 1024)).toFixed(1)} Mo, maximum ${
          MAX_AUDIO_SIZE_BYTES / (1024 * 1024)
        } Mo).`,
      );
    }

    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile?.voiceCloningConsent) {
      throw new BadRequestException(
        "Le consentement au clonage vocal doit être activé avant d'inscrire un modèle (paramètres de confidentialité).",
      );
    }

    const newVoiceId = await this.addVoiceToProvider(userId, file, apiKey);

    // L'ancien modèle (s'il existe) est retiré du fournisseur après coup,
    // en best-effort : un échec ici ne doit jamais annuler l'inscription du
    // nouveau modèle, déjà acquise.
    if (profile.voiceModelId && profile.voiceModelId !== newVoiceId) {
      await this.deleteFromProvider(profile.voiceModelId, apiKey);
    }

    await this.prisma.profile.update({ where: { userId }, data: { voiceModelId: newVoiceId } });
    return { voiceModelId: newVoiceId };
  }

  /** Supprime le modèle vocal de l'utilisateur, chez le fournisseur puis en base. */
  async removeModel(userId: string): Promise<void> {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile?.voiceModelId) return; // rien à faire : idempotent

    const apiKey = process.env.TTS_API_KEY;
    if (apiKey) {
      await this.deleteFromProvider(profile.voiceModelId, apiKey);
    }
    await this.prisma.profile.update({ where: { userId }, data: { voiceModelId: null } });
  }

  private async addVoiceToProvider(
    userId: string,
    file: Express.Multer.File,
    apiKey: string,
  ): Promise<string> {
    const form = new FormData();
    form.append('name', `glotta-${userId}`);
    form.append(
      'files',
      new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }),
      file.originalname,
    );

    let res: Response;
    try {
      res = await fetch('https://api.elevenlabs.io/v1/voices/add', {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        body: form,
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `Impossible de contacter ElevenLabs pour inscrire la voix : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ServiceUnavailableException(
        `Inscription de la voix ElevenLabs échouée (HTTP ${res.status}) : ${detail.slice(0, 300)}`,
      );
    }

    const data = (await res.json()) as ElevenLabsAddVoiceResponse;
    return data.voice_id;
  }

  /** Best-effort : un fournisseur externe indisponible ne doit jamais bloquer une opération locale. */
  private async deleteFromProvider(voiceId: string, apiKey: string): Promise<void> {
    try {
      await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
        method: 'DELETE',
        headers: { 'xi-api-key': apiKey },
      });
    } catch (error) {
      this.logger.warn(
        `Échec de suppression de la voix ElevenLabs ${voiceId} : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
