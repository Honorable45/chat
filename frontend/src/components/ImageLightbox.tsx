"use client";

import { useEffect } from "react";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { XIcon } from "@/components/icons";

/** Plein écran, agrandit une image de vignette (message, statut...) —
 * ferme au clic en dehors ou avec Échap. */
export function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        aria-label="Fermer"
      >
        <XIcon size={20} />
      </button>
      <div onClick={(e) => e.stopPropagation()}>
        <AuthenticatedImage src={src} alt="" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain" />
      </div>
    </div>
  );
}
