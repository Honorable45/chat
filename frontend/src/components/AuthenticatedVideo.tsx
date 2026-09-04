"use client";

import { useAuthenticatedBlobUrl } from "@/lib/use-authenticated-blob-url";

/** Voir AuthenticatedImage — même contrainte (média protégé par JwtAuthGuard,
 * `<video src>` ne peut pas porter de token), même mécanisme. */
export function AuthenticatedVideo({
  src,
  className,
  onEnded,
  onPlayingChange,
}: {
  src: string;
  className?: string;
  onEnded?: () => void;
  onPlayingChange?: (playing: boolean) => void;
}) {
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
