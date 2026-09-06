"use client";

import { isOwnBackendUrl } from "@/lib/api";
import { useAuthenticatedBlobUrl } from "@/lib/use-authenticated-blob-url";

/**
 * `<img src>` ne peut pas porter d'en-tête `Authorization` — inutilisable
 * pour un média protégé par JwtAuthGuard (ex. GET /statuses/:id/media).
 * Voir useAuthenticatedBlobUrl pour le détail du mécanisme (partagé avec
 * AuthenticatedVideo).
 *
 * Une pièce jointe hébergée sur Cloudinary échappe à cette contrainte : son
 * URL signée est déjà directement chargeable, sans passer par le backend —
 * jamais besoin du détour par un Blob authentifié dans ce cas (voir
 * CloudinaryProvider.getSignedUrl côté backend). Reconnue via isOwnBackendUrl,
 * jamais via un simple test "URL absolue" : certains appelants construisent
 * une URL backend déjà absolue (ex. api.statuses.mediaUrl), qui a tout autant
 * besoin du Blob authentifié qu'un chemin relatif — bug réel constaté en
 * vérification live (une pièce jointe LOCAL absolutisée chargée sans
 * authentification, bloquée par la Cross-Origin-Resource-Policy du backend).
 */
export function AuthenticatedImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  if (!isOwnBackendUrl(src)) {
    // eslint-disable-next-line @next/next/no-img-element -- URL déjà publique/signée, jamais un asset next/image.
    return <img src={src} alt={alt} className={className} />;
  }
  return <AuthenticatedImageProxy src={src} alt={alt} className={className} />;
}

function AuthenticatedImageProxy({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const { url, failed } = useAuthenticatedBlobUrl(src);

  if (failed) {
    return <span className="flex items-center justify-center text-sm text-white/60">Image indisponible.</span>;
  }
  if (!url) {
    return <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/40 border-t-transparent" />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- objet blob local, jamais un asset next/image.
  return <img src={url} alt={alt} className={className} />;
}
