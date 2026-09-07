import type { MediaStorageProvider } from '@prisma/client';
import { buildCloudinaryPublicUrl } from '../uploads/cloudinary.provider';

/**
 * Résout l'URL de photo de groupe à renvoyer au client — même principe que
 * resolveAvatarUrl (voir profiles/avatar.util.ts) : `LOCAL` → chemin proxy
 * (`GET /conversations/:id/photo`, protégé par appartenance au groupe,
 * contrairement à un avatar d'utilisateur qui est public) ; `CLOUDINARY` →
 * URL directe, jamais signée (une photo de groupe est publique parmi ses
 * membres par nature, comme un avatar, voir CloudinaryProvider.uploadPublic).
 */
export function resolveGroupPhotoUrl(
  conversation: {
    photoStorageKey: string | null;
    photoStorageProvider?: MediaStorageProvider;
  } | null,
  conversationId: string,
): string | null {
  if (!conversation?.photoStorageKey) return null;
  if (conversation.photoStorageProvider === 'CLOUDINARY') {
    return buildCloudinaryPublicUrl(conversation.photoStorageKey);
  }
  return `/api/conversations/${conversationId}/photo`;
}
