"use client";

import { isOwnBackendUrl } from "@/lib/api";
import { useAuthenticatedBlobUrl } from "@/lib/use-authenticated-blob-url";

interface AuthenticatedVideoProps {
  src: string;
  className?: string;
  onEnded?: () => void;
  onPlayingChange?: (playing: boolean) => void;
}

/**
 * Voir AuthenticatedImage — même contrainte (média protégé par
 * JwtAuthGuard, `<video src>` ne peut pas porter de token), même mécanisme
 * et même exception pour une URL déjà publique (Cloudinary), reconnue via
 * isOwnBackendUrl (jamais un simple test "URL absolue" — voir son
 * commentaire).
 */
export function AuthenticatedVideo({ src, className, onEnded, onPlayingChange }: AuthenticatedVideoProps) {
  if (!isOwnBackendUrl(src)) {
    return (
      <video
        src={src}
        className={className}
        autoPlay
        playsInline
        controls
        onEnded={onEnded}
        onPlay={() => onPlayingChange?.(true)}
        onPause={() => onPlayingChange?.(false)}
      />
    );
  }
  return (
    <AuthenticatedVideoProxy src={src} className={className} onEnded={onEnded} onPlayingChange={onPlayingChange} />
  );
}

function AuthenticatedVideoProxy({ src, className, onEnded, onPlayingChange }: AuthenticatedVideoProps) {
  const { url, failed } = useAuthenticatedBlobUrl(src);

  if (failed) {
    return <span className="flex items-center justify-center text-sm text-white/60">Vidéo indisponible.</span>;
  }
  if (!url) {
    return <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/40 border-t-transparent" />;
  }
  return (
    <video
      src={url}
      className={className}
      autoPlay
      playsInline
      controls
      onEnded={onEnded}
      onPlay={() => onPlayingChange?.(true)}
      onPause={() => onPlayingChange?.(false)}
    />
  );
}
