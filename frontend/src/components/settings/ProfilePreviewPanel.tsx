import { Avatar } from "@/components/Avatar";
import { CalendarIcon, MicIcon } from "@/components/icons";
import { monthYear } from "@/lib/format";
import type { LanguageSummary, Me } from "@/lib/types";
import { languageFlag } from "./shared";

export interface ProfileDraft {
  firstName: string;
  lastName: string;
  statusText: string;
  primaryLanguageCode: string;
  preferredReceiveLanguageCode: string;
}

function languageLabel(code: string, languages: LanguageSummary[]): string {
  return languages.find((l) => l.code === code)?.nativeName ?? code;
}

/**
 * Aperçu en temps réel de ce que verront les autres utilisateurs — reflète
 * `draft` (l'état non encore enregistré du formulaire Profil), jamais
 * `user` directement pour les champs texte/langues : c'est tout l'intérêt
 * de cet aperçu par rapport à un simple rappel des valeurs déjà en base.
 * L'avatar, lui, vient directement de `user.profile` : son upload est déjà
 * immédiat (pas de brouillon local, voir ProfileSection.uploadAvatar), donc
 * toujours à jour sans détour par `draft`.
 */
export function ProfilePreviewPanel({
  user,
  draft,
  languages,
}: {
  user: Me;
  draft: ProfileDraft;
  languages: LanguageSummary[];
}) {
  const name = `${draft.firstName || user.firstName} ${draft.lastName || user.lastName}`.trim();

  return (
    <div className="hidden w-80 shrink-0 flex-col gap-1.5 overflow-y-auto border-l border-border p-5 glotta-scroll-hidden xl:flex">
      <p className="text-sm font-semibold">Aperçu du profil</p>
      <p className="mb-3 text-xs text-muted">Voici comment les autres vous verront.</p>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-2xl">
        <div className="h-16 bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)]" />
        <div className="flex flex-col items-center px-4 pb-5">
          <span className="-mt-9 rounded-full ring-4 ring-[var(--surface-raised)]">
            <Avatar firstName={draft.firstName || user.firstName} lastName={draft.lastName || user.lastName} avatarUrl={user.profile?.avatarUrl} online={user.isOnline} size={72} />
          </span>
          <p className="mt-2.5 text-base font-semibold">{name || "—"}</p>
          <p className="text-xs text-muted">@{user.username}</p>
          <p className="mt-0.5 text-xs font-medium text-[var(--online)]">{user.isOnline ? "En ligne" : "Hors ligne"}</p>

          <p className={`mt-3 rounded-xl bg-surface px-3 py-2 text-center text-xs ${draft.statusText ? "text-muted-strong" : "text-muted italic"}`}>
            {draft.statusText ? `“${draft.statusText}”` : "Un mot sur vous..."}
          </p>

          <div className="mt-4 flex w-full flex-col gap-2.5 text-xs">
            {draft.primaryLanguageCode && (
              <div className="flex items-center gap-2">
                <span className="text-base leading-none">{languageFlag(draft.primaryLanguageCode) ?? "🌐"}</span>
                <span className="text-muted">Langue principale</span>
                <span className="ml-auto font-medium">{languageLabel(draft.primaryLanguageCode, languages)}</span>
              </div>
            )}
            {draft.preferredReceiveLanguageCode && (
              <div className="flex items-center gap-2">
                <span className="text-base leading-none">{languageFlag(draft.preferredReceiveLanguageCode) ?? "🌐"}</span>
                <span className="text-muted">Langue de réception</span>
                <span className="ml-auto font-medium">{languageLabel(draft.preferredReceiveLanguageCode, languages)}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <CalendarIcon size={14} className="text-muted" />
              <span className="text-muted">Membre depuis</span>
              <span className="ml-auto font-medium capitalize">{monthYear(user.createdAt)}</span>
            </div>
            <div className="flex items-center gap-2">
              <MicIcon size={14} className="text-muted" />
              <span className="text-muted">Utilisation de la voix</span>
              <span className={`ml-auto font-medium ${user.profile?.voiceCloningConsent ? "text-[var(--online)]" : "text-muted"}`}>
                {user.profile?.voiceCloningConsent ? "Activé" : "Désactivé"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-3 text-center text-[11px] text-muted">Aperçu en temps réel du profil</p>
    </div>
  );
}
