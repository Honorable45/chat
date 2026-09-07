import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';

export type CloudinaryResourceType = 'image' | 'video';

export interface CloudinaryUploadResult {
  /** Référence stockée à la place d'une clé de fichier local (voir Attachment.url / Status.mediaStorageKey / Profile.avatarStorageKey). */
  publicId: string;
}

/**
 * Pure, sans injection — une URL Cloudinary publique ne dépend que du
 * `cloud_name` (jamais un secret), contrairement à une URL signée. Utilisée
 * directement par `avatar.util.ts::resolveAvatarUrl`, qui n'a accès à
 * aucune instance de service (fonction pure appelée depuis de nombreux
 * endroits — calls/conversations/statuses/users — sans vouloir y injecter
 * CloudinaryProvider partout pour un simple avatar, déjà public par nature).
 * Retourne `null` si `CLOUDINARY_CLOUD_NAME` est absent (ne devrait jamais
 * arriver pour un avatar déjà marqué CLOUDINARY en base, mais jamais une
 * URL cassée plutôt qu'un avatar manquant).
 */
export function buildCloudinaryPublicUrl(publicId: string): string | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName) return null;
  return `https://res.cloudinary.com/${cloudName}/image/upload/${publicId}`;
}

/**
 * Stockage image/vidéo/avatar sur Cloudinary — jamais les messages vocaux,
 * qui restent sur StorageService (disque local) quel que soit l'état de ce
 * provider. Optionnel comme les fournisseurs IA (STT/Traduction/TTS,
 * section 38) : sans les 3 variables requises, chaque appelant retombe sur
 * StorageService plutôt que d'échouer — voir MessagesService.sendImage/
 * StatusesService.create/ProfilesService.setAvatar, qui vérifient
 * `isConfigured()` avant de choisir ce provider.
 *
 * `getSignedUrl`/`getPublicUrl` sont synchrones : une URL Cloudinary
 * signée se calcule localement avec la clé API, aucun appel réseau —
 * contrairement à `upload`/`delete`, qui en font un.
 */
@Injectable()
export class CloudinaryProvider {
  private readonly logger = new Logger(CloudinaryProvider.name);
  private readonly configured: boolean;

  constructor() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    this.configured = Boolean(cloudName && apiKey && apiSecret);
    if (this.configured) {
      cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
    } else {
      this.logger.warn(
        'CLOUDINARY_CLOUD_NAME/CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET absents : images/vidéos/avatars restent sur le disque local (StorageService).',
      );
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async upload(
    buffer: Buffer,
    folder: string,
    resourceType: CloudinaryResourceType,
  ): Promise<CloudinaryUploadResult> {
    this.assertConfigured();
    const dataUri = `data:application/octet-stream;base64,${buffer.toString('base64')}`;
    const result: UploadApiResponse = await cloudinary.uploader.upload(dataUri, {
      folder: `glotta/${folder}`,
      resource_type: resourceType,
      // "authenticated" : seule une URL correctement signée (voir
      // getSignedUrl) peut charger le fichier — jamais un accès public par
      // simple devinette du public_id. Les avatars, volontairement publics,
      // passent par uploadPublic ci-dessous à la place.
      type: 'authenticated',
    });
    return { publicId: result.public_id };
  }

  /** Réservé aux avatars (déjà publics aujourd'hui, voir user-avatar.controller.ts) — jamais pour un média de message/statut. */
  async uploadPublic(buffer: Buffer, folder: string): Promise<CloudinaryUploadResult> {
    this.assertConfigured();
    const dataUri = `data:application/octet-stream;base64,${buffer.toString('base64')}`;
    const result: UploadApiResponse = await cloudinary.uploader.upload(dataUri, {
      folder: `glotta/${folder}`,
      resource_type: 'image',
      type: 'upload',
    });
    return { publicId: result.public_id };
  }

  /**
   * URL signée (paramètre `s--...--` calculé avec l'API secret, sans appel
   * réseau) — n'expire pas dans le temps, contrairement à un `auth_token`
   * Cloudinary (fonctionnalité "Token-based authentication", qui nécessite
   * un Private CDN payant, indisponible sur le plan gratuit). Le `public_id`
   * généré par Cloudinary à l'upload est un identifiant aléatoire non listé
   * publiquement : la protection réelle vient de ne jamais exposer cet
   * identifiant en dehors d'une réponse API authentifiée (toAttachmentDto/
   * toStatusDto), pas d'une expiration de l'URL elle-même.
   */
  getSignedUrl(publicId: string, resourceType: CloudinaryResourceType): string {
    this.assertConfigured();
    return cloudinary.url(publicId, {
      resource_type: resourceType,
      type: 'authenticated',
      sign_url: true,
    });
  }

  /** Avatar uniquement — jamais signée, cohérent avec sa route de service actuelle (publique, sans JwtAuthGuard). */
  getPublicUrl(publicId: string): string {
    this.assertConfigured();
    // this.configured === true garantit CLOUDINARY_CLOUD_NAME présent (voir
    // le constructeur) : buildCloudinaryPublicUrl ne renvoie jamais null ici.
    return buildCloudinaryPublicUrl(publicId) as string;
  }

  async delete(
    publicId: string,
    resourceType: CloudinaryResourceType,
    uploadType: 'authenticated' | 'upload',
  ): Promise<void> {
    if (!this.configured) return;
    try {
      await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        type: uploadType,
      });
    } catch (error) {
      // Best-effort, même principe que StorageService.delete : un fichier
      // déjà absent ne doit jamais faire échouer l'opération métier.
      this.logger.warn(
        `Échec de suppression Cloudinary "${publicId}" : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new ServiceUnavailableException("Cloudinary n'est pas configuré.");
    }
  }
}
