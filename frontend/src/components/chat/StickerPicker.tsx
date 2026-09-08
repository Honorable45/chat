"use client";

import { useEffect, useRef, useState } from "react";
import { StarIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { STICKER_EMOJIS } from "@/lib/types";

/**
 * Sélecteur de stickers façon WhatsApp — un "sticker" est ici un gros emoji
 * envoyé comme bulle à part entière (voir MessageType.STICKER côté backend,
 * aucune vraie image/pack disponible pour ce projet). Cliquer un emoji
 * l'envoie et ferme le panneau ; l'étoile bascule son statut favori
 * (persisté côté serveur, voir StickersService) sans jamais envoyer de
 * message — les deux actions restent bien distinctes.
 */
export function StickerPicker({
  onSelect,
  onClose,
  align = "start",
}: {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  align?: "start" | "end";
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [favorites, setFavorites] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.stickers
      .favorites()
      .then((favs) => {
        if (!cancelled) setFavorites(favs);
      })
      .catch(() => {
        if (!cancelled) setFavorites([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  async function toggleFavorite(emoji: string) {
    const isFavorite = favorites?.includes(emoji) ?? false;
    // Optimiste : le geste doit sembler instantané, jamais attendre l'aller-retour réseau pour une simple préférence personnelle.
    setFavorites((prev) => {
      if (!prev) return prev;
      return isFavorite ? prev.filter((e) => e !== emoji) : [...prev, emoji];
    });
    try {
      if (isFavorite) await api.stickers.removeFavorite(emoji);
      else await api.stickers.addFavorite(emoji);
    } catch {
      // Best-effort : une préférence favorite ratée n'a pas besoin d'une bannière d'erreur, l'utilisateur peut simplement réessayer.
    }
  }

  return (
    <div
      ref={ref}
      className={`absolute bottom-full z-20 mb-1.5 flex h-80 w-72 flex-col rounded-2xl border border-border bg-surface-raised shadow-2xl ${
        align === "end" ? "right-0" : "left-0"
      }`}
    >
      <div className="flex-1 overflow-y-auto glotta-scroll-hidden p-2">
        {favorites && favorites.length > 0 && (
          <>
            <p className="px-1 pt-1 pb-1.5 text-xs font-medium text-muted">Favoris</p>
            <div className="mb-2 grid grid-cols-8 gap-0.5 border-b border-border pb-2">
              {favorites.map((emoji) => (
                <StickerCell
                  key={`fav-${emoji}`}
                  emoji={emoji}
                  isFavorite
                  onSelect={onSelect}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </div>
          </>
        )}

        <div className="grid grid-cols-8 gap-0.5">
          {STICKER_EMOJIS.map((emoji) => (
            <StickerCell
              key={emoji}
              emoji={emoji}
              isFavorite={favorites?.includes(emoji) ?? false}
              onSelect={onSelect}
              onToggleFavorite={toggleFavorite}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function StickerCell({
  emoji,
  isFavorite,
  onSelect,
  onToggleFavorite,
}: {
  emoji: string;
  isFavorite: boolean;
  onSelect: (emoji: string) => void;
  onToggleFavorite: (emoji: string) => void;
}) {
  return (
    <div className="group relative flex items-center justify-center">
      <button
        onClick={() => onSelect(emoji)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-xl transition hover:scale-110 hover:bg-surface"
        aria-label={`Envoyer le sticker ${emoji}`}
      >
        {emoji}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(emoji);
        }}
        aria-label={isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}
        className={`absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface-raised text-[var(--accent-2)] transition ${
          isFavorite ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <StarIcon size={11} filled={isFavorite} />
      </button>
    </div>
  );
}
