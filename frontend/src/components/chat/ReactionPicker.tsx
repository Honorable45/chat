"use client";

import { useEffect, useRef } from "react";
import { ALLOWED_REACTION_EMOJIS } from "@/lib/types";

/** Petit popover à 6 emojis fixes (section 9) — ferme au clic en dehors. */
export function ReactionPicker({
  onSelect,
  onClose,
  align = "start",
}: {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  align?: "start" | "end";
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={`absolute bottom-full z-20 mb-1.5 flex gap-0.5 rounded-full border border-border bg-surface-raised p-1 shadow-lg ${
        align === "end" ? "right-0" : "left-0"
      }`}
    >
      {ALLOWED_REACTION_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => onSelect(emoji)}
          className="flex h-8 w-8 items-center justify-center rounded-full text-base transition hover:scale-110 hover:bg-surface"
          aria-label={`Réagir avec ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
