"use client";

import { useState } from "react";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { ExpandIcon, PlayIcon } from "@/components/icons";
import { MediaGalleryLightbox, type GalleryItem } from "@/components/MediaGalleryLightbox";
import { formatDuration } from "@/lib/format";
import { useAuthenticatedBlobUrl } from "@/lib/use-authenticated-blob-url";
import type { MessageAttachment } from "@/lib/types";

// Même taille que la vignette d'une image seule (voir MessageBubble) pour
// qu'un album d'un seul média reste visuellement identique à un ancien
// message IMAGE — seuls les albums de 2+ médias sont un peu plus larges.
const SINGLE_SIZE = 220;
const GRID_WIDTH = 260;
const MAX_VISIBLE = 4;

/** Vignette vidéo : un `<video>` sans lecture (juste assez de données
 * chargées pour afficher une image réelle de la première image du fichier,
 * jamais une miniature générée côté serveur — voir MessagesService.sendMedia,
 * aucun ffmpeg disponible) plus une icône lecture et la durée réelle. */
function VideoThumbnail({ attachment, className }: { attachment: MessageAttachment; className: string }) {
  const { url, failed } = useAuthenticatedBlobUrl(attachment.url);
  return (
    <div className={`relative ${className}`}>
      {failed ? (
        <span className="flex h-full w-full items-center justify-center bg-surface text-xs text-muted">
          Vidéo indisponible
        </span>
      ) : !url ? (
        <span className="flex h-full w-full items-center justify-center bg-surface">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-transparent" />
        </span>
      ) : (
         
        <video src={url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
      )}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/15">
        <PlayIcon size={20} className="text-white drop-shadow" />
      </span>
      {attachment.durationSeconds != null && (
        <span className="absolute right-1 bottom-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
          {formatDuration(attachment.durationSeconds)}
        </span>
      )}
    </div>
  );
}

function Tile({
  attachment,
  className,
  style,
  overlayCount,
  onClick,
}: {
  attachment: MessageAttachment;
  className: string;
  style?: React.CSSProperties;
  overlayCount?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={style}
      className={`group relative overflow-hidden bg-surface ${className}`}
      aria-label="Agrandir"
    >
      {attachment.type === "VIDEO" ? (
        <VideoThumbnail attachment={attachment} className="h-full w-full" />
      ) : (
        <AuthenticatedImage src={attachment.url} alt="" className="h-full w-full object-cover" />
      )}
      {overlayCount != null && overlayCount > 0 && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-lg font-semibold text-white">
          +{overlayCount}
        </span>
      )}
      {attachment.type === "IMAGE" && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
          <ExpandIcon size={18} className="text-white" />
        </span>
      )}
    </button>
  );
}

/** Rend un message MEDIA_ALBUM en grille (1/2/3/4/N+ médias, WhatsApp-style)
 * — un seul média se comporte comme l'ancien rendu IMAGE, plusieurs médias
 * s'organisent en grille avec un badge "+N" au-delà de 4 vignettes visibles.
 * Cliquer n'importe laquelle ouvre la visionneuse plein écran sur TOUS les
 * médias de l'album (y compris ceux au-delà de la 4e), navigables. */
export function MediaAlbumGrid({ attachments, caption }: { attachments: MessageAttachment[]; caption: string | null }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  if (attachments.length === 0) return null;

  const galleryItems: GalleryItem[] = attachments.map((a) => ({ url: a.url, type: a.type }));

  const wrapperClass = "flex flex-col gap-1.5 overflow-hidden rounded-2xl border border-border bg-surface-raised p-1.5";

  if (attachments.length === 1) {
    return (
      <div className={wrapperClass}>
        <Tile
          attachment={attachments[0]}
          className="rounded-xl"
          style={{ width: SINGLE_SIZE, height: SINGLE_SIZE }}
          onClick={() => setLightboxIndex(0)}
        />
        {caption && <p className="px-1.5 pb-1 text-sm text-foreground">{caption}</p>}
        {lightboxIndex !== null && (
          <MediaGalleryLightbox items={galleryItems} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
        )}
      </div>
    );
  }

  const visible = attachments.slice(0, MAX_VISIBLE);
  const overflow = attachments.length - MAX_VISIBLE;

  return (
    <div className={wrapperClass} style={{ width: GRID_WIDTH }}>
      {attachments.length === 2 && (
        <div className="grid grid-cols-2 gap-1" style={{ height: GRID_WIDTH / 2 }}>
          {visible.map((a, i) => (
            <Tile key={a.id} attachment={a} className="rounded-lg" onClick={() => setLightboxIndex(i)} />
          ))}
        </div>
      )}

      {attachments.length === 3 && (
        <div className="grid grid-cols-2 gap-1" style={{ height: GRID_WIDTH }}>
          <Tile attachment={visible[0]} className="row-span-2 rounded-lg" onClick={() => setLightboxIndex(0)} />
          <Tile attachment={visible[1]} className="rounded-lg" onClick={() => setLightboxIndex(1)} />
          <Tile attachment={visible[2]} className="rounded-lg" onClick={() => setLightboxIndex(2)} />
        </div>
      )}

      {attachments.length >= 4 && (
        <div className="grid grid-cols-2 grid-rows-2 gap-1" style={{ height: GRID_WIDTH }}>
          {visible.map((a, i) => (
            <Tile
              key={a.id}
              attachment={a}
              className="rounded-lg"
              overlayCount={i === MAX_VISIBLE - 1 && overflow > 0 ? overflow : undefined}
              onClick={() => setLightboxIndex(i)}
            />
          ))}
        </div>
      )}

      {caption && <p className="px-1.5 pb-1 text-sm text-foreground">{caption}</p>}

      {lightboxIndex !== null && (
        <MediaGalleryLightbox items={galleryItems} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      )}
    </div>
  );
}
