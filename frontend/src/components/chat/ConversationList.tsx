"use client";

import { useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { SearchIcon } from "@/components/icons";
import { displayName, shortRelativeTime } from "@/lib/format";
import type { Conversation, ConversationLastMessage } from "@/lib/types";

function formatCallDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function callPreview(last: ConversationLastMessage, myUserId: string): string {
  const iAmCaller = last.senderId === myUserId;
  const emoji = last.callType === "VIDEO" ? "🎥" : "📞";
  const label = last.callType === "VIDEO" ? "Appel vidéo" : "Appel";
  switch (last.callStatus) {
    case "RINGING":
      return iAmCaller ? `${emoji} ${label} en cours...` : `${emoji} ${label} entrant...`;
    case "ACTIVE":
      return `${emoji} ${label} en cours`;
    case "DECLINED":
      return `${emoji} ${label} refusé`;
    case "MISSED":
      return iAmCaller ? `${emoji} ${label} sans réponse` : `${emoji} ${label} manqué`;
    case "ENDED":
      return `${emoji} ${label}${last.callDurationSeconds != null ? ` · ${formatCallDuration(last.callDurationSeconds)}` : ""}`;
    default:
      return `${emoji} ${label}`;
  }
}

/** Un appel manqué s'affiche en rouge, comme un message non lu — jamais du
 * point de vue de l'appelant, et jamais une fois la conversation rouverte
 * (le message CALL de l'appelant compte comme les autres dans unreadCount,
 * remis à zéro par markConversationRead — voir ConversationsService). */
function isMissedCallForMe(last: ConversationLastMessage, myUserId: string): boolean {
  return last.type === "CALL" && last.callStatus === "MISSED" && last.senderId !== myUserId;
}

function preview(conversation: Conversation, myUserId: string): string {
  const last = conversation.lastMessage;
  if (!last) return "Démarrez la conversation !";
  const prefix = last.senderId === myUserId ? "Vous : " : "";
  if (last.type === "VOICE") return `${prefix}🎤 Message vocal`;
  if (last.type === "IMAGE") return `${prefix}📷 Photo${last.text ? ` — ${last.text}` : ""}`;
  if (last.type === "MEDIA_ALBUM") {
    const emoji = last.mediaHasVideo ? "🎥" : "📷";
    const count = last.mediaCount ?? 1;
    const label = count > 1 ? `${count} médias` : last.mediaHasVideo ? "Vidéo" : "Photo";
    return `${prefix}${emoji} ${label}${last.text ? ` — ${last.text}` : ""}`;
  }
  if (last.type === "CALL") return callPreview(last, myUserId);
  if (last.type === "CONTACT_SHARE") return `${prefix}👤 Contact partagé`;
  return `${prefix}${last.text ?? ""}`;
}

export function ConversationList({
  conversations,
  loading,
  selectedId,
  myUserId,
  typingConversationIds,
  onSelect,
  hiddenOnMobile,
}: {
  conversations: Conversation[];
  loading: boolean;
  selectedId: string | null;
  myUserId: string;
  typingConversationIds: Set<string>;
  onSelect: (conversation: Conversation) => void;
  /** Écrans étroits (< lg) : masqué dès qu'une conversation est ouverte, pour lui laisser tout l'écran — voir chat/page.tsx. */
  hiddenOnMobile?: boolean;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const name = c.otherParticipant ? displayName(c.otherParticipant).toLowerCase() : (c.title ?? "").toLowerCase();
      return name.includes(q) || c.otherParticipant?.username.toLowerCase().includes(q);
    });
  }, [conversations, query]);

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);
  const quickAccess = conversations.filter((c) => c.otherParticipant).slice(0, 6);

  return (
    <div
      className={`min-h-0 min-w-0 flex-1 flex-col border-r border-border lg:flex lg:w-80 lg:flex-none lg:shrink-0 ${
        hiddenOnMobile ? "hidden" : "flex"
      }`}
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          Messages
          {totalUnread > 0 && (
            <span className="rounded-full bg-[var(--unread)]/15 px-2 py-0.5 text-xs font-medium text-[var(--unread)]">
              {totalUnread} nouveau{totalUnread > 1 ? "x" : ""}
            </span>
          )}
        </h1>
      </div>

      {quickAccess.length > 0 && (
        <div className="flex gap-3 overflow-x-auto px-4 pb-3 glotta-scroll-hidden">
          {quickAccess.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c)}
              className="flex shrink-0 flex-col items-center gap-1"
              title={c.otherParticipant ? displayName(c.otherParticipant) : ""}
            >
              <span className={`rounded-full p-0.5 ${selectedId === c.id ? "ring-2 ring-[var(--accent)]" : ""}`}>
                <Avatar
                  firstName={c.otherParticipant!.firstName}
                  lastName={c.otherParticipant!.lastName}
                  avatarUrl={c.otherParticipant!.avatarUrl}
                  online={c.otherParticipant!.isOnline}
                  size={44}
                />
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="relative px-4 pb-3">
        <SearchIcon size={16} className="absolute top-1/2 left-7 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Chercher un nom..."
          className="w-full rounded-xl border border-border bg-surface-raised py-2 pr-3 pl-9 text-sm outline-none placeholder:text-muted focus:border-[var(--accent)]"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto glotta-scroll-hidden px-2 pb-4">
        {loading && (
          <p className="px-3 py-6 text-center text-sm text-muted">Chargement des conversations...</p>
        )}
        {!loading && filtered.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted">
            {conversations.length === 0
              ? "Aucune conversation. Lancez-en une avec le bouton + ."
              : "Aucun résultat."}
          </p>
        )}

        {filtered.length > 0 && (
          <p className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">
            Toutes les conversations
          </p>
        )}

        {filtered.map((c) => {
          const other = c.otherParticipant;
          const name = other ? displayName(other) : (c.title ?? "Conversation");
          const isTyping = typingConversationIds.has(c.id);
          const missedCall = c.unreadCount > 0 && c.lastMessage ? isMissedCallForMe(c.lastMessage, myUserId) : false;
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c)}
              className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition ${
                selectedId === c.id ? "bg-surface-raised" : "hover:bg-surface-raised/60"
              }`}
            >
              {other ? (
                <Avatar firstName={other.firstName} lastName={other.lastName} avatarUrl={other.avatarUrl} online={other.isOnline} size={44} />
              ) : (
                <Avatar firstName={name} lastName="" size={44} />
              )}
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{name}</span>
                  {c.lastMessage && (
                    <span className="shrink-0 text-[11px] text-muted">{shortRelativeTime(c.lastMessage.sentAt)}</span>
                  )}
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span
                    className={`truncate text-xs ${isTyping ? "text-[var(--accent-2)]" : missedCall ? "text-danger" : "text-muted"}`}
                  >
                    {isTyping ? "en train d'écrire..." : preview(c, myUserId)}
                  </span>
                  {c.unreadCount > 0 && (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--unread)] px-1.5 text-[11px] font-semibold text-white">
                      {c.unreadCount}
                    </span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
