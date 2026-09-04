"use client";

import { useState } from "react";
import { Toggle } from "@/components/Toggle";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { saveButtonClassName } from "./shared";

function Row({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface-raised px-4 py-3">
      <div>
        <p className="text-sm">{label}</p>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** Un seul réglage global pour l'instant (section 11 du cahier des charges)
 * — un réglage par catégorie (messages, vocaux, appels...) pourra affiner
 * ceci plus tard sans remettre en cause ce champ, voir Profile.notificationsEnabled. */
export function NotificationsSection() {
  const { user, refreshMe } = useAuth();
  const profile = user?.profile;

  const [notificationsEnabled, setNotificationsEnabled] = useState(profile?.notificationsEnabled ?? true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.users.updateProfile({ notificationsEnabled });
      await refreshMe();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce réglage.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Row label="Notifications" description="Recevoir des notifications pour les nouveaux messages, vocaux et appels.">
        <Toggle checked={notificationsEnabled} onChange={() => setNotificationsEnabled((v) => !v)} />
      </Row>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center gap-3 pt-1">
        <button onClick={save} disabled={saving} className={saveButtonClassName}>
          {saving ? "Enregistrement..." : "Enregistrer"}
        </button>
        {saved && <span className="text-sm text-[var(--online)]">Enregistré ✓</span>}
      </div>
    </div>
  );
}
