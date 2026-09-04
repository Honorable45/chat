"use client";

import { useEffect, useState } from "react";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { AuthenticatedVideo } from "@/components/AuthenticatedVideo";
import { ChevronLeftIcon, XIcon } from "@/components/icons";

export interface GalleryItem {
  url: string;
  type: "IMAGE" | "VIDEO";
}

/** Plein écran, agrandit un album de photos/vidéos avec navigation
 * précédent/suivant (flèches, clavier) — même principe qu'ImageLightbox,
 * étendu à plusieurs éléments. Ferme au clic en dehors ou avec Échap. */
export function MediaGalleryLightbox({
  items,
  startIndex,
  onClose,
}: {
  items: GalleryItem[];
  startIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const current = items[index];

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIndex((i) => Math.min(items.length - 1, i + 1));
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, items.length]);

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6" onClick={onClose}>
      <button
        onClick={onClose}
        className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        aria-label="Fermer"
      >
        <XIcon size={20} />
      </button>

      {items.length > 1 && (
        <span className="absolute top-5 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white">
          {index + 1} / {items.length}
        </span>
      )}

      {index > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIndex((i) => i - 1);
          }}
          className="absolute left-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          aria-label="Média précédent"
        >
          <ChevronLeftIcon size={20} />
        </button>
      )}
      {index < items.length - 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIndex((i) => i + 1);
          }}
          className="absolute right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          aria-label="Média suivant"
        >
          <ChevronLeftIcon size={20} className="-scale-x-100" />
        </button>
      )}

      <div onClick={(e) => e.stopPropagation()}>
        {current.type === "VIDEO" ? (
          <AuthenticatedVideo src={current.url} className="max-h-[90vh] max-w-[90vw] rounded-lg" />
        ) : (
          <AuthenticatedImage src={current.url} alt="" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain" />
        )}
      </div>
    </div>
  );
}
