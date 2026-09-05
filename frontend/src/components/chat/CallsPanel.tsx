"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { PhoneIcon, VideoIcon } from "@/components/icons";
import { api, ApiError, type CallHistoryEntry } from "@/lib/api";
import { displayName, shortRelativeTime } from "@/lib/format";

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function entryLabel(entry: CallHistoryEntry): string {
  switch (entry.status) {
    case "MISSED":
      return entry.direction === "outgoing" ? "Sans réponse" : "Manqué";
    case "DECLINED":
      return "Refusé";
    case "RINGING":
    case "ACTIVE":
      return "En cours";
    case "ENDED":
      return entry.durationSeconds != null ? formatDuration(entry.durationSeconds) : "Terminé";
    default:
      return "";
  }
}

/**
 * Occupe la 2e colonne (même emplacement que ConversationList) quand
 * "Appels" est sélectionné dans le rail d'icônes — plus une modale
 * flottante, pour un comportement de navigation cohérent avec les autres
 * entrées (voir IconRail/chat/page.tsx). Cliquer une entrée ouvre la
 * conversation correspondante (qui bascule la navigation sur "Discussions",
 * voir onOpenConversation côté appelant).
 */
export function CallsPanel({
  onOpenConversation,
  hiddenOnMobile,
}: {
  onOpenConversation: (conversationId: string) => void;
  hiddenOnMobile?: boolean;
}) {
  const [entries, setEntries] = useState<CallHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.calls
      .history()
      .then((page) => setEntries(page.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les appels."));
  }, []);

  return (
    <div
      className={`min-h-0 min-w-0 flex-1 flex-col border-r border-border lg:flex lg:w-80 lg:flex-none lg:shrink-0 ${
        hiddenOnMobile ? "hidden" : "flex"
      }`}
    >
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-lg font-semibold">Appels</h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto glotta-scroll-hidden p-2">
        {error && <p className="px-3 py-6 text-center text-sm text-danger">{error}</p>}
        {!error && entries === null && <p className="px-3 py-6 text-center text-sm text-muted">Chargement...</p>}
        {entries?.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted">Aucun appel pour l&rsquo;instant.</p>
        )}
        {entries?.map((entry) => {
          const missed = entry.direction === "incoming" && entry.status === "MISSED";
          return (
            <button
              key={entry.id}
              onClick={() => onOpenConversation(entry.conversationId)}
              className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-surface-raised"
            >
              <Avatar
                firstName={entry.otherUser.firstName}
                lastName={entry.otherUser.lastName}
                avatarUrl={entry.otherUser.avatarUrl}
                size={44}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{displayName(entry.otherUser)}</span>
                <span className={`flex items-center gap-1 text-xs ${missed ? "text-danger" : "text-muted"}`}>
                  {entry.type === "VIDEO" ? (
                    <VideoIcon size={11} />
                  ) : (
                    <PhoneIcon size={11} className={entry.direction === "outgoing" ? "-scale-x-100" : ""} />
                  )}
                  {entryLabel(entry)} · {shortRelativeTime(entry.startedAt)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
