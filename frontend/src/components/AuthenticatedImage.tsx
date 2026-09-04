"use client";

import { useAuthenticatedBlobUrl } from "@/lib/use-authenticated-blob-url";

/**
 * `<img src>` ne peut pas porter d'en-tête `Authorization` — inutilisable
 * pour un média protégé par JwtAuthGuard (ex. GET /statuses/:id/media).
 * Voir useAuthenticatedBlobUrl pour le détail du mécanisme (partagé avec
 * AuthenticatedVideo).
 */
export function AuthenticatedImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
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
