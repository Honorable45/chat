"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeftIcon, PlayIcon, PlusIcon, SendIcon, XIcon } from "@/components/icons";

const MAX_ITEMS = 10; // aligné sur MAX_MEDIA_ALBUM_ITEMS côté backend

interface MediaItem {
  file: File;
  previewUrl: string;
  kind: "IMAGE" | "VIDEO";
}

function toItem(file: File): MediaItem {
  return {
    file,
    previewUrl: URL.createObjectURL(file),
    kind: file.type.startsWith("video/") ? "VIDEO" : "IMAGE",
  };
}

/**
 * Écran de prévisualisation avant l'envoi d'un ou plusieurs médias —
 * sélection groupée (photo(s)/vidéo(s)/mélange), retrait, réordonnancement
 * simple (flèches), légende, puis envoi en une seule action groupée (voir
 * api.messages.sendMedia — jamais un fichier envoyé indépendamment).
 */
export function MediaComposerModal({
  initialFiles,
  onClose,
  onSend,
}: {
  initialFiles: File[];
  onClose: () => void;
  onSend: (files: File[], caption: string) => Promise<void>;
}) {
  const [items, setItems] = useState<MediaItem[]>(() => initialFiles.slice(0, MAX_ITEMS).map(toItem));
  const [caption, setCaption] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const itemsRef = useRef(items);

  // Jamais pendant le rendu (react-hooks/refs) — seulement en effet, après coup.
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Ne révoque qu'au démontage définitif — les retraits individuels
  // révoquent déjà les leurs (voir removeAt), jamais les deux fois.
  useEffect(() => {
    return () => {
      itemsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

  function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setItems((prev) => {
      const combined = [...prev, ...Array.from(fileList).map(toItem)];
      if (combined.length > MAX_ITEMS) {
        setError(`Un album accepte au maximum ${MAX_ITEMS} fichiers.`);
        return combined.slice(0, MAX_ITEMS);
      }
      setError(null);
      return combined;
    });
  }

  function removeAt(index: number) {
    setItems((prev) => {
      URL.revokeObjectURL(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  function move(index: number, direction: -1 | 1) {
    setItems((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function submit() {
    if (items.length === 0 || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(
        items.map((i) => i.file),
        caption.trim(),
      );
    } catch {
      setError("Impossible d'envoyer ces médias. Réessayez.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3 text-white">
        <button onClick={onClose} aria-label="Annuler" className="rounded-lg p-1 hover:bg-white/10">
          <ChevronLeftIcon size={22} />
        </button>
        <p className="text-sm font-medium">
          Envoyer {items.length > 1 ? `${items.length} médias` : "un média"}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((item, index) => (
            <div key={item.previewUrl} className="group relative aspect-square overflow-hidden rounded-xl bg-white/5">
              {item.kind === "IMAGE" ? (
                // eslint-disable-next-line @next/next/no-img-element -- aperçu local (blob URL) d'un fichier pas encore envoyé, jamais un asset à optimiser.
                <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <video src={item.previewUrl} className="h-full w-full object-cover" muted playsInline />
              )}
              {item.kind === "VIDEO" && (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
                  <PlayIcon size={22} className="text-white drop-shadow" />
                </span>
              )}
              <button
                type="button"
                onClick={() => removeAt(index)}
                aria-label="Retirer"
                className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition group-hover:opacity-100"
              >
                <XIcon size={13} />
              </button>
              {items.length > 1 && (
                <div className="absolute bottom-1 left-1 flex gap-1 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label="Déplacer vers la gauche"
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs text-white disabled:opacity-30"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === items.length - 1}
                    aria-label="Déplacer vers la droite"
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs text-white disabled:opacity-30"
                  >
                    ›
                  </button>
                </div>
              )}
            </div>
          ))}
          {items.length < MAX_ITEMS && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Ajouter des médias"
              className="flex aspect-square items-center justify-center rounded-xl border-2 border-dashed border-white/20 text-white/60 transition hover:border-white/40 hover:text-white"
            >
              <PlusIcon size={24} />
            </button>
          )}
        </div>
      </div>

      {error && <p className="px-4 pb-1 text-xs text-danger">{error}</p>}

      <div className="flex items-center gap-2 border-t border-white/10 p-3">
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Ajouter une légende..."
          className="flex-1 rounded-full bg-white/10 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/40 focus:bg-white/15"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={sending || items.length === 0}
          aria-label="Envoyer"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[var(--accent-contrast)] transition disabled:opacity-40"
        >
          <SendIcon size={18} />
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
