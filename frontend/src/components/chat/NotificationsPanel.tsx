"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { shortRelativeTime } from "@/lib/format";
import type { AppNotification } from "@/lib/types";

function describe(n: AppNotification): string {
  switch (n.type) {
    case "NEW_MESSAGE":
      return n.payload?.preview ? String(n.payload.preview) : "Nouveau message";
    case "NEW_VOICE_MESSAGE":
      return "🎤 Nouveau message vocal";
    case "INCOMING_CALL":
      return "📞 Appel entrant";
    case "MISSED_CALL":
      return "📞 Appel manqué";
    case "TRANSLATION_COMPLETED":
      return "Traduction terminée";
    case "CONTACT_REQUEST":
      return "Nouvelle demande de contact";
    case "REACTION":
      return "Nouvelle réaction à votre message";
    default:
      return "Nouvelle notification";
  }
}

/**
 * Occupe la 2e colonne (même emplacement que ConversationList) quand
 * "Notifications" est sélectionné dans le rail d'icônes — plus le
 * recouvrement flottant qu'était NotificationsBell (voir IconRail, qui n'en
 * garde que l'icône/le badge, dont le décompte vit maintenant dans
 * chat/page.tsx pour rester à jour même quand ce panneau n'est pas monté).
 * Cliquer une notification liée à une conversation l'ouvre (et la marque
 * lue au passage) — jamais possible avec l'ancien recouvrement, qui n'était
 * qu'informatif.
 */
export function NotificationsPanel({
  onOpenConversation,
  onUnreadCountChange,
  hiddenOnMobile,
}: {
  onOpenConversation: (conversationId: string) => void;
  /** Reçoit soit un nombre, soit une fonction de mise à jour — même
   * signature qu'un setState React, pour rester en phase avec le badge
   * affiché sur l'icône du rail (voir chat/page.tsx). */
  onUnreadCountChange: (updater: number | ((prev: number) => number)) => void;
  hiddenOnMobile?: boolean;
}) {
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.notifications
      .list()
      .then((page) => setItems(page.items))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les notifications."));
  }, []);

  const hasUnread = items?.some((n) => !n.readAt) ?? false;

  async function markAllRead() {
    try {
      await api.notifications.markAllRead();
      setItems((prev) => prev?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? prev);
      onUnreadCountChange(0);
    } catch {
      // Silencieux : l'utilisateur peut réessayer, ce n'est pas bloquant.
    }
  }

  async function open(n: AppNotification) {
    if (!n.readAt) {
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? prev);
      onUnreadCountChange((prev) => Math.max(0, prev - 1));
      api.notifications.markRead(n.id).catch(() => {});
    }
    if (n.payload?.conversationId) onOpenConversation(n.payload.conversationId);
  }

  return (
    <div
      className={`min-h-0 min-w-0 flex-1 flex-col border-r border-border lg:flex lg:w-80 lg:flex-none lg:shrink-0 ${
        hiddenOnMobile ? "hidden" : "flex"
      }`}
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <h1 className="text-lg font-semibold">Notifications</h1>
        {hasUnread && (
          <button onClick={() => void markAllRead()} className="text-xs text-[var(--accent-2)] hover:underline">
            Tout marquer lu
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto glotta-scroll-hidden p-2">
        {error && <p className="px-3 py-6 text-center text-sm text-danger">{error}</p>}
        {!error && items === null && <p className="px-3 py-6 text-center text-sm text-muted">Chargement...</p>}
        {items?.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted">Aucune notification pour l&rsquo;instant.</p>
        )}
        {items?.map((n) => (
          <button
            key={n.id}
            onClick={() => void open(n)}
            className={`flex w-full flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left transition hover:bg-surface-raised ${
              n.readAt ? "text-muted" : "text-foreground"
            }`}
          >
            <span className="flex items-center gap-2">
              {!n.readAt && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--unread)]" />}
              <span className="truncate text-sm">{describe(n)}</span>
            </span>
            <span className="text-[11px] text-muted">{shortRelativeTime(n.createdAt)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
