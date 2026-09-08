"use client";

import { useRef, useState } from "react";
import { ReplyIcon } from "@/components/icons";

const TRIGGER_THRESHOLD_PX = 64;
const MAX_DRAG_PX = 80;
// En-deçà, on laisse passer un tap normal (clic sur une image, une carte de
// contact...) plutôt que de l'interpréter comme le début d'un glissement.
const DRAG_START_THRESHOLD_PX = 10;

/**
 * Geste "glisser pour répondre" façon WhatsApp — Pointer Events (couvre
 * souris ET tactile sans code séparé, aucune dépendance ajoutée). N'entre en
 * mode glissement qu'après un déplacement horizontal net (voir
 * DRAG_START_THRESHOLD_PX) : un tap sur un bouton/lien à l'intérieur de la
 * bulle, ou un scroll vertical de la liste, ne sont jamais capturés à tort.
 */
export function SwipeToReply({ onReply, children }: { onReply: () => void; children: React.ReactNode }) {
  const [dragX, setDragX] = useState(0);
  const stateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    // Bouton secondaire/tertiaire de souris : jamais un début de glissement.
    if (e.button !== undefined && e.button !== 0) return;
    stateRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, dragging: false };
  }

  function onPointerMove(e: React.PointerEvent) {
    const state = stateRef.current;
    if (!state || state.pointerId !== e.pointerId) return;
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;

    if (!state.dragging) {
      if (Math.abs(dx) < DRAG_START_THRESHOLD_PX) return;
      // Mouvement majoritairement vertical (scroll) : jamais intercepté.
      if (Math.abs(dy) > Math.abs(dx)) {
        stateRef.current = null;
        return;
      }
      state.dragging = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }

    // Glissement vers la droite uniquement (comme WhatsApp) — un mouvement
    // vers la gauche est ignoré plutôt que de traduire la bulle hors écran.
    setDragX(Math.max(0, Math.min(dx, MAX_DRAG_PX)));
  }

  function endDrag(e: React.PointerEvent) {
    const state = stateRef.current;
    if (!state || state.pointerId !== e.pointerId) return;
    if (state.dragging && dragX >= TRIGGER_THRESHOLD_PX) onReply();
    stateRef.current = null;
    setDragX(0);
  }

  const progress = Math.min(dragX / TRIGGER_THRESHOLD_PX, 1);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className="relative"
      style={{ touchAction: "pan-y" }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-0 -translate-y-1/2 text-[var(--accent-2)]"
        style={{ opacity: progress, transform: `translateY(-50%) scale(${0.6 + progress * 0.4})` }}
      >
        <ReplyIcon size={18} />
      </span>
      <div
        style={{
          transform: `translateX(${dragX}px)`,
          transition: dragX === 0 ? "transform 200ms ease-out" : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
