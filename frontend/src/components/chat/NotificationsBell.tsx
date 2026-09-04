"use client";

import { BellIcon } from "@/components/icons";

/**
 * Purement présentationnel — le décompte non lu et sa mise à jour en direct
 * (socket "notification:new") vivent dans chat/page.tsx, pas ici : ce
 * bouton doit rester à jour même quand NotificationsPanel (voir le clic ici,
 * qui l'ouvre en 2e colonne) n'est pas monté. Avant, ce composant gérait
 * lui-même un panneau flottant ; voir NotificationsPanel pour la 2e colonne
 * qui l'a remplacé.
 */
export function NotificationsBell({
  unread,
  active,
  onClick,
}: {
  unread: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition ${
        active
          ? "bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[var(--accent-contrast)]"
          : "text-muted hover:bg-surface-raised hover:text-foreground"
      }`}
      aria-label="Notifications"
    >
      <BellIcon size={20} />
      {unread > 0 && (
        <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--unread)] px-1 text-[10px] font-semibold text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
}
