"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { CameraIcon, ChatIcon, GridIcon, LogOutIcon, PhoneIcon, PlusIcon, SettingsIcon, UsersIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { NotificationsBell } from "./NotificationsBell";

function RailButton({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? `${label} — bientôt disponible` : label}
      className={`flex h-10 w-10 items-center justify-center rounded-xl transition ${
        active
          ? "bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[var(--accent-contrast)]"
          : "text-muted hover:bg-surface-raised hover:text-foreground"
      } ${disabled ? "cursor-default opacity-40 hover:bg-transparent hover:text-muted" : ""}`}
    >
      {children}
    </button>
  );
}

export type RailView = "conversations" | "statuses" | "calls" | "contacts" | "notifications";

export function IconRail({
  unreadNotifications,
  activeView,
  onSelectView,
  onNewConversation,
  onOpenSettings,
  hiddenOnMobile,
}: {
  unreadNotifications: number;
  /** Détermine le contenu affiché en 2e colonne — voir chat/page.tsx. */
  activeView: RailView;
  onSelectView: (view: RailView) => void;
  onNewConversation: () => void;
  onOpenSettings: () => void;
  /** Écrans étroits (< lg) : masqué dès qu'une conversation est ouverte, pour lui laisser tout l'écran — voir chat/page.tsx. */
  hiddenOnMobile?: boolean;
}) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  if (!user) return null;

  return (
    <div
      className={`w-16 shrink-0 flex-col items-center justify-between border-r border-border bg-surface py-4 ${
        hiddenOnMobile ? "hidden lg:flex" : "flex"
      }`}
    >
      <div className="flex flex-col items-center gap-4">
        <div ref={menuRef} className="relative">
          <button onClick={() => setMenuOpen((v) => !v)} aria-label="Menu du compte">
            <Avatar
              firstName={user.firstName}
              lastName={user.lastName}
              avatarUrl={user.profile?.avatarUrl}
              online={user.isOnline}
              size={40}
            />
          </button>
          {menuOpen && (
            <div className="absolute top-0 left-14 z-20 w-52 rounded-2xl border border-border bg-surface-raised p-1.5 shadow-2xl">
              <div className="px-2.5 py-2">
                <p className="truncate text-sm font-medium">{user.firstName} {user.lastName}</p>
                <p className="truncate text-xs text-muted">@{user.username}</p>
              </div>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  onOpenSettings();
                }}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition hover:bg-surface"
              >
                <SettingsIcon size={16} />
                Paramètres
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void logout();
                }}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm text-danger transition hover:bg-danger/10"
              >
                <LogOutIcon size={16} />
                Se déconnecter
              </button>
            </div>
          )}
        </div>

        <div className="h-px w-8 bg-border" />

        <RailButton active={activeView === "conversations"} label="Conversations" onClick={() => onSelectView("conversations")}>
          <GridIcon size={20} />
        </RailButton>
        <RailButton disabled label="Discussions vocales">
          <ChatIcon size={20} />
        </RailButton>
        <RailButton active={activeView === "statuses"} label="Statuts" onClick={() => onSelectView("statuses")}>
          <CameraIcon size={20} />
        </RailButton>
        <RailButton active={activeView === "calls"} label="Appels" onClick={() => onSelectView("calls")}>
          <PhoneIcon size={20} />
        </RailButton>
        <RailButton active={activeView === "contacts"} label="Contacts" onClick={() => onSelectView("contacts")}>
          <UsersIcon size={20} />
        </RailButton>
        <NotificationsBell
          unread={unreadNotifications}
          active={activeView === "notifications"}
          onClick={() => onSelectView("notifications")}
        />
      </div>

      <button
        onClick={onNewConversation}
        aria-label="Nouvelle conversation"
        className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[var(--accent-contrast)] transition hover:opacity-90"
      >
        <PlusIcon size={20} />
      </button>
    </div>
  );
}
