import type { MediaStorageProvider } from '@prisma/client';
import { buildCloudinaryPublicUrl } from '../uploads/cloudinary.provider';

/**
 * Résout l'URL d'avatar à renvoyer au client : un avatar téléversé
 * (`avatarStorageKey`) prime toujours sur une URL externe saisie à la main
 * (`avatarUrl`) — jamais les deux en même temps, voir ProfilesService.
 * setAvatar/removeAvatar qui maintiennent cette exclusivité à l'écriture.
 *
 * Un avatar téléversé se résout différemment selon `avatarStorageProvider` :
 * `LOCAL` → chemin proxy (`GET /users/:id/avatar`, déjà public — voir
 * user-avatar.controller.ts) ; `CLOUDINARY` → URL Cloudinary directe,
 * jamais signée (un avatar est déjà public par nature, contrairement à un
 * média de message/statut). Fonction pure, sans injection de
 * CloudinaryProvider : une URL publique ne dépend que de
 * CLOUDINARY_CLOUD_NAME, jamais d'un secret — voir buildCloudinaryPublicUrl.
 */
export function resolveAvatarUrl(
  profile:
    | {
        avatarUrl: string | null;
        avatarStorageKey: string | null;
        avatarStorageProvider?: MediaStorageProvider;
      }
    | null
    | undefined,
  userId: string,
): string | null {
  if (!profile) return null;
  if (profile.avatarStorageKey) {
    if (profile.avatarStorageProvider === 'CLOUDINARY') {
      return buildCloudinaryPublicUrl(profile.avatarStorageKey);
    }
    return `/api/users/${userId}/avatar`;
  }
  return profile.avatarUrl;
}
