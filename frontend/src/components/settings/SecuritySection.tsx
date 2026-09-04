"use client";

import { useEffect, useState } from "react";
import { inputClassName } from "@/components/auth/AuthShell";
import { api, ApiError } from "@/lib/api";
import { shortRelativeTime } from "@/lib/format";
import type { SessionSummary } from "@/lib/types";
import { saveButtonClassName, sectionLabelClassName } from "./shared";

function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.auth.changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de changer le mot de passe.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-4">
      <p className="text-sm font-medium">Changer le mot de passe</p>
      <div>
        <label className={sectionLabelClassName}>Mot de passe actuel</label>
        <input
          type="password"
          className={inputClassName}
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      <div>
        <label className={sectionLabelClassName}>Nouveau mot de passe</label>
        <input
          type="password"
          className={inputClassName}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className={saveButtonClassName}>
          {saving ? "..." : "Mettre à jour"}
        </button>
        {saved && <span className="text-sm text-[var(--online)]">Mis à jour ✓</span>}
      </div>
    </form>
  );
}

export function SecuritySection() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [loggingOutAll, setLoggingOutAll] = useState(false);

  function load() {
    api.auth
      .sessions()
      .then(setSessions)
      .catch(() => setError("Impossible de charger les sessions."));
  }

  useEffect(load, []);

  async function revoke(id: string) {
    setRevokingId(id);
    try {
      await api.auth.revokeSession(id);
      setSessions((prev) => prev?.filter((s) => s.id !== id) ?? prev);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de révoquer cette session.");
    } finally {
      setRevokingId(null);
    }
  }

  async function logoutAllOthers() {
    setLoggingOutAll(true);
    try {
      await api.auth.logoutAll();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de déconnecter les autres appareils.");
    } finally {
      setLoggingOutAll(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PasswordForm />

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium">Appareils connectés</p>
          {sessions && sessions.length > 1 && (
            <button
              onClick={logoutAllOthers}
              disabled={loggingOutAll}
              className="text-xs text-danger transition hover:underline disabled:opacity-60"
            >
              {loggingOutAll ? "..." : "Déconnecter les autres appareils"}
            </button>
          )}
        </div>

        {error && <p className="mb-2 text-sm text-danger">{error}</p>}

        <div className="flex flex-col gap-2">
          {sessions === null && <p className="text-sm text-muted">Chargement...</p>}
          {sessions?.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm">
                  {s.deviceLabel ?? "Appareil inconnu"}
                  {s.isCurrent && <span className="ml-2 text-xs text-[var(--online)]">cet appareil</span>}
                </p>
                <p className="truncate text-xs text-muted">
                  {s.ipAddress ?? "IP inconnue"} • actif {shortRelativeTime(s.lastUsedAt)}
                </p>
              </div>
              {!s.isCurrent && (
                <button
                  onClick={() => revoke(s.id)}
                  disabled={revokingId === s.id}
                  className="shrink-0 text-xs text-danger transition hover:underline disabled:opacity-60"
                >
                  Révoquer
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
