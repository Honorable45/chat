"use client";

import { Avatar } from "@/components/Avatar";
import { ExpandIcon, PhoneOffIcon } from "@/components/icons";
import { statusLabel } from "@/components/chat/CallOverlay";
import { displayName } from "@/lib/format";
import type { CallKind, CallPhase } from "@/lib/use-call";
import type { ConversationParticipant } from "@/lib/types";

/**
 * Pastille flottante affichée à la place de CallOverlay quand l'appel est
 * réduit — permet de continuer à naviguer/écrire des messages sans
 * raccrocher (voir chat/page.tsx, état `callMinimized`). Réutilise
 * `formatDuration`/`statusLabel` exportées de CallOverlay pour ne jamais
 * dupliquer ce format une 4ème fois dans le projet.
 */
export function MinimizedCallBar({
  peer,
  phase,
  kind,
  durationSeconds,
  onExpand,
  onHangUp,
}: {
  peer: ConversationParticipant | null;
  phase: CallPhase;
  kind: CallKind;
  durationSeconds: number;
  onExpand: () => void;
  onHangUp: () => void;
}) {
  const name = peer ? displayName(peer) : "Appel";

  return (
    <div className="fixed bottom-20 right-4 z-50 flex items-center gap-3 rounded-full border border-border bg-surface-raised py-2 pl-2 pr-3 shadow-2xl sm:bottom-4">
      <button
        onClick={onExpand}
        aria-label="Agrandir l'appel"
        className="flex items-center gap-2 rounded-full text-left"
      >
        <Avatar firstName={peer?.firstName ?? name} lastName={peer?.lastName ?? ""} avatarUrl={peer?.avatarUrl} size={36} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="block truncate text-xs text-muted">{statusLabel(phase, kind, durationSeconds, null)}</span>
        </span>
        <ExpandIcon size={16} className="shrink-0 text-muted" />
      </button>
      <button
        onClick={onHangUp}
        aria-label="Raccrocher"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger text-white transition hover:opacity-90"
      >
        <PhoneOffIcon size={18} />
      </button>
    </div>
  );
}
