"use client";

import { useEffect, useState } from "react";
import { BellIcon, LockIcon, PaletteIcon, PersonIcon, RefreshIcon, ShareIcon, ShieldIcon, XIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { LanguageSummary } from "@/lib/types";
import { AppearanceSection } from "./AppearanceSection";
import { NotificationsSection } from "./NotificationsSection";
import { PrivacySection } from "./PrivacySection";
import { ProfilePreviewPanel, type ProfileDraft } from "./ProfilePreviewPanel";
import { ProfileSection } from "./ProfileSection";
import { ProfileShareSection } from "./ProfileShareSection";
import { SecuritySection } from "./SecuritySection";

const TABS = [
  { key: "profile", label: "Profil", icon: PersonIcon, disabled: false },
  { key: "share", label: "Partager", icon: ShareIcon, disabled: false },
  { key: "appearance", label: "Apparence", icon: PaletteIcon, disabled: false },
  { key: "privacy", label: "Confidentialité", icon: LockIcon, disabled: false },
  { key: "notifications", label: "Notifications", icon: BellIcon, disabled: false },
  { key: "security", label: "Sécurité", icon: ShieldIcon, disabled: false },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function draftFromUser(user: { firstName: string; lastName: string; profile: { statusText: string | null } | null; primaryLanguage: { code: string } | null; preferredReceiveLanguage: { code: string } | null }): ProfileDraft {
  return {
    firstName: user.firstName,
    lastName: user.lastName,
    statusText: user.profile?.statusText ?? "",
    primaryLanguageCode: user.primaryLanguage?.code ?? "",
    preferredReceiveLanguageCode: user.preferredReceiveLanguage?.code ?? "",
  };
}

/**
 * Occupe le même emplacement que ChatWindow (voir chat/page.tsx) plutôt
 * qu'une modale flottante — permet la 4e colonne "Aperçu du profil" à côté,
 * comme dans la maquette de référence fournie par l'utilisateur. `draft`
 * (l'état non enregistré du formulaire Profil) est possédé ici, pas dans
 * ProfileSection, pour être partagé avec ProfilePreviewPanel — voir le
 * commentaire de ProfilePreviewPanel pour pourquoi seuls ces champs-là sont
 * remontés.
 */
export function SettingsPage({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>("profile");
  const [languages, setLanguages] = useState<LanguageSummary[]>([]);
  const [draft, setDraft] = useState<ProfileDraft>(() => (user ? draftFromUser(user) : { firstName: "", lastName: "", statusText: "", primaryLanguageCode: "", preferredReceiveLanguageCode: "" }));
  // Dernier `user` pour lequel `draft` a été (re)synchronisé — voir le
  // if ci-dessous. Motif recommandé par React pour "ajuster un état quand
  // une prop change" (https://react.dev/learn/you-might-not-need-an-effect)
  // : setState pendant le rendu plutôt que dans un effet, pour ne jamais
  // déclencher un rendu intermédiaire inutile (react-hooks/set-state-in-effect).
  const [syncedUser, setSyncedUser] = useState(user);

  useEffect(() => {
    api.languages.list().then(setLanguages).catch(() => {});
  }, []);

  // Resynchronise le brouillon avec les valeurs enregistrées à chaque
  // rafraîchissement de `user` (après un Enregistrer réussi, ou un
  // Réinitialiser) — jamais pendant que l'utilisateur tape, seulement quand
  // la source de vérité change réellement (nouvelle référence `user`).
  if (user !== syncedUser) {
    setSyncedUser(user);
    if (user) setDraft(draftFromUser(user));
  }

  if (!user) return null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <h1 className="text-base font-semibold">Paramètres</h1>
            <p className="hidden truncate text-xs text-muted sm:block">Gérez vos informations personnelles et vos préférences.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {tab === "profile" && (
              <button
                onClick={() => user && setDraft(draftFromUser(user))}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-strong transition hover:bg-surface-raised hover:text-foreground"
              >
                <RefreshIcon size={13} />
                <span className="hidden sm:inline">Réinitialiser</span>
              </button>
            )}
            <button onClick={onClose} className="text-muted hover:text-foreground" aria-label="Fermer les paramètres">
              <XIcon size={20} />
            </button>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-border px-5 pt-3 glotta-scroll-hidden">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => !t.disabled && setTab(t.key)}
              disabled={t.disabled}
              title={t.disabled ? `${t.label} — bientôt disponible` : undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-t-lg px-3.5 py-2 text-sm font-medium transition ${
                t.disabled
                  ? "cursor-default text-muted opacity-50"
                  : tab === t.key
                    ? "border-b-2 border-[var(--accent-2)] text-foreground"
                    : "text-muted hover:text-foreground"
              }`}
            >
              <t.icon size={15} />
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto glotta-scroll-hidden p-5">
          {tab === "profile" && <ProfileSection draft={draft} onDraftChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} languages={languages} />}
          {tab === "share" && <ProfileShareSection />}
          {tab === "appearance" && <AppearanceSection />}
          {tab === "privacy" && <PrivacySection />}
          {tab === "notifications" && <NotificationsSection />}
          {tab === "security" && <SecuritySection />}
        </div>
      </div>

      <ProfilePreviewPanel user={user} draft={draft} languages={languages} />
    </div>
  );
}
