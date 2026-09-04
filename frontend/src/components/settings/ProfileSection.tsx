"use client";

import { useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { inputClassName } from "@/components/auth/AuthShell";
import { AtSignIcon, CameraIcon } from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { LanguageSummary } from "@/lib/types";
import type { ProfileDraft } from "./ProfilePreviewPanel";
import { saveButtonClassName, sectionLabelClassName } from "./shared";

const STATUS_MAX_LENGTH = 140;

/**
 * Contrôlé par le parent (`SettingsPage`) pour les champs qui alimentent
 * aussi l'aperçu en temps réel (`draft`/`onDraftChange`, voir
 * ProfilePreviewPanel) — seuls les champs sans effet sur l'aperçu
 * (nom d'utilisateur, URL d'avatar externe, langues parlées, état
 * d'enregistrement) restent en état local. L'avatar téléversé n'a pas
 * besoin de passer par `draft` : son upload est déjà immédiat (refreshMe()
 * met à jour `user` directement).
 */
export function ProfileSection({
  draft,
  onDraftChange,
  languages,
}: {
  draft: ProfileDraft;
  onDraftChange: (patch: Partial<ProfileDraft>) => void;
  languages: LanguageSummary[];
}) {
  const { user, refreshMe } = useAuth();
  const [username, setUsername] = useState(user?.username ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.profile?.avatarUploaded ? "" : (user?.profile?.avatarUrl ?? ""));
  const [spokenLanguageCodes, setSpokenLanguageCodes] = useState<string[]>(
    user?.spokenLanguages.map((l) => l.code) ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  if (!user) return null;

  function toggleSpoken(code: string) {
    setSpokenLanguageCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  function cancelChanges() {
    onDraftChange({
      firstName: user!.firstName,
      lastName: user!.lastName,
      statusText: user!.profile?.statusText ?? "",
      primaryLanguageCode: user!.primaryLanguage?.code ?? "",
      preferredReceiveLanguageCode: user!.preferredReceiveLanguage?.code ?? "",
    });
    setUsername(user!.username);
    setAvatarUrl(user!.profile?.avatarUploaded ? "" : (user!.profile?.avatarUrl ?? ""));
    setSpokenLanguageCodes(user!.spokenLanguages.map((l) => l.code));
  }

  async function uploadAvatar(file: File) {
    setUploadingAvatar(true);
    setError(null);
    try {
      await api.users.setAvatar(file);
      await refreshMe();
      setAvatarUrl(""); // un avatar téléversé remplace toute URL externe (voir backend, ProfilesService.setAvatar)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de téléverser cette image.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function removeUploadedAvatar() {
    setUploadingAvatar(true);
    setError(null);
    try {
      await api.users.removeAvatar();
      await refreshMe();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de supprimer cet avatar.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await Promise.all([
        api.users.updateMe({
          firstName: draft.firstName,
          lastName: draft.lastName,
          username: username || undefined,
          primaryLanguageCode: draft.primaryLanguageCode || undefined,
          preferredReceiveLanguageCode: draft.preferredReceiveLanguageCode || undefined,
          spokenLanguageCodes,
        }),
        api.users.updateProfile({
          avatarUrl: avatarUrl || undefined,
          statusText: draft.statusText,
        }),
      ]);
      await refreshMe();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer le profil.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="mb-2.5 text-sm font-semibold">Photo de profil</p>
        <div className="flex items-center gap-4">
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadAvatar(file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            disabled={uploadingAvatar}
            className="group relative shrink-0 disabled:cursor-default"
            aria-label="Changer la photo de profil"
          >
            <Avatar firstName={draft.firstName || user.firstName} lastName={draft.lastName || user.lastName} avatarUrl={user.profile?.avatarUrl} size={64} />
            <span className="absolute right-0 bottom-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--surface-raised)] bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[var(--accent-contrast)] transition group-hover:opacity-90">
              <CameraIcon size={12} />
            </span>
          </button>
          <div className="flex flex-col items-start gap-1.5">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] px-3.5 py-1.5 text-xs font-semibold text-[var(--accent-contrast)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CameraIcon size={13} />
              {uploadingAvatar ? "..." : "Changer la photo"}
            </button>
            {user.profile?.avatarUploaded && (
              <button
                type="button"
                onClick={() => void removeUploadedAvatar()}
                disabled={uploadingAvatar}
                className="text-xs text-danger hover:underline disabled:opacity-60"
              >
                Supprimer la photo
              </button>
            )}
          </div>
        </div>
        <div className="mt-3">
          <label className={sectionLabelClassName}>Ou une URL externe</label>
          <input
            className={inputClassName}
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://..."
            disabled={user.profile?.avatarUploaded}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={sectionLabelClassName}>Prénom</label>
          <input className={inputClassName} value={draft.firstName} onChange={(e) => onDraftChange({ firstName: e.target.value })} />
        </div>
        <div>
          <label className={sectionLabelClassName}>Nom</label>
          <input className={inputClassName} value={draft.lastName} onChange={(e) => onDraftChange({ lastName: e.target.value })} />
        </div>
      </div>

      <div>
        <label className={sectionLabelClassName}>Nom d&rsquo;utilisateur</label>
        <div className="relative">
          <AtSignIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input
            className={`${inputClassName} pl-8`}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className={sectionLabelClassName}>Statut</label>
          <span className="text-[11px] text-muted">
            {draft.statusText.length}/{STATUS_MAX_LENGTH}
          </span>
        </div>
        <input
          className={inputClassName}
          value={draft.statusText}
          onChange={(e) => onDraftChange({ statusText: e.target.value.slice(0, STATUS_MAX_LENGTH) })}
          maxLength={STATUS_MAX_LENGTH}
          placeholder="Un mot sur vous..."
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={sectionLabelClassName}>Langue principale</label>
          <select
            className={inputClassName}
            value={draft.primaryLanguageCode}
            onChange={(e) => onDraftChange({ primaryLanguageCode: e.target.value })}
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeName}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-muted">Votre langue maternelle.</p>
        </div>
        <div>
          <label className={sectionLabelClassName}>Langue de réception préférée</label>
          <select
            className={inputClassName}
            value={draft.preferredReceiveLanguageCode}
            onChange={(e) => onDraftChange({ preferredReceiveLanguageCode: e.target.value })}
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeName}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-muted">Langue dans laquelle vous souhaitez recevoir les messages.</p>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-strong">Autres langues parlées</label>
        <div className="flex flex-wrap gap-2">
          {languages.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => toggleSpoken(l.code)}
              className={`rounded-full border px-3 py-1.5 text-xs transition ${
                spokenLanguageCodes.includes(l.code)
                  ? "border-transparent bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] text-[var(--accent-contrast)]"
                  : "border-border text-muted-strong hover:bg-surface"
              }`}
            >
              {l.nativeName}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <button onClick={cancelChanges} disabled={saving} className="rounded-xl border border-border px-4 py-2.5 text-sm transition hover:bg-surface-raised disabled:opacity-60">
          Annuler
        </button>
        <button onClick={save} disabled={saving} className={saveButtonClassName}>
          {saving ? "Enregistrement..." : "Enregistrer les modifications"}
        </button>
        {saved && <span className="text-sm text-[var(--online)]">Enregistré ✓</span>}
      </div>
    </div>
  );
}
