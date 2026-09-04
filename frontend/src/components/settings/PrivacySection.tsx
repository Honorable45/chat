"use client";

import { useState } from "react";
import { inputClassName } from "@/components/auth/AuthShell";
import { MicIcon } from "@/components/icons";
import { Toggle } from "@/components/Toggle";
import { api, ApiError, type UpdateProfileInput } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDuration } from "@/lib/format";
import type { WhoCanInteract } from "@/lib/types";
import { useVoiceRecorder } from "@/lib/use-voice-recorder";
import { saveButtonClassName, sectionLabelClassName } from "./shared";

const WHO_CAN_LABELS: Record<WhoCanInteract, string> = {
  EVERYONE: "Tout le monde",
  CONTACTS: "Mes contacts uniquement",
  NOBODY: "Personne",
};

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

/** Inscription/suppression du modèle vocal cloné — n'a de sens que si le
 * consentement est actif (même garde-fou que côté backend, VoiceIdentityService.enroll). */
function VoiceModelSection({ enabled }: { enabled: boolean }) {
  const { user, refreshMe } = useAuth();
  const recorder = useVoiceRecorder();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileToSend, setFileToSend] = useState<File | null>(null);

  const registered = user?.profile?.voiceModelRegistered ?? false;

  async function submit(sample: Blob, filename: string) {
    setUploading(true);
    setError(null);
    try {
      await api.users.enrollVoiceModel(sample, filename);
      await refreshMe();
      setFileToSend(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'inscrire ce modèle vocal.");
    } finally {
      setUploading(false);
    }
  }

  async function finishRecordingAndSubmit() {
    const recording = await recorder.stop();
    if (!recording) return;
    const extension = recording.mimeType.split("/")[1]?.split(";")[0] ?? "webm";
    await submit(recording.blob, `sample.${extension}`);
  }

  async function remove() {
    setUploading(true);
    setError(null);
    try {
      await api.users.removeVoiceModel();
      await refreshMe();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de supprimer ce modèle vocal.");
    } finally {
      setUploading(false);
    }
  }

  if (!enabled) return null;

  return (
    <div className="rounded-xl border border-border bg-surface-raised px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-sm">Modèle vocal</p>
          <p className="text-xs text-muted">
            {registered
              ? "Un modèle vocal est inscrit — vos traductions vocales peuvent utiliser votre propre voix."
              : "Aucun modèle inscrit pour l'instant. Enregistrez un échantillon d'au moins 30 secondes pour de meilleurs résultats."}
          </p>
        </div>
        {registered && (
          <button onClick={remove} disabled={uploading} className="shrink-0 text-xs text-danger hover:underline disabled:opacity-60">
            Supprimer
          </button>
        )}
      </div>

      {recorder.state === "recording" || recorder.state === "requesting" ? (
        <div className="flex items-center gap-2.5 rounded-lg bg-surface px-3 py-2">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-danger" />
          <span className="text-xs text-muted-strong">
            {recorder.state === "requesting" ? "Micro..." : "Enregistrement..."}
          </span>
          <span className="ml-auto text-xs tabular-nums text-muted">{formatDuration(recorder.elapsedSeconds)}</span>
          <button onClick={recorder.cancel} className="text-xs text-danger hover:underline">
            Annuler
          </button>
          <button
            onClick={finishRecordingAndSubmit}
            disabled={recorder.state !== "recording"}
            className="text-xs font-medium text-[var(--accent-2)] hover:underline disabled:opacity-50"
          >
            Terminer
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void recorder.start()}
            disabled={uploading}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs transition hover:bg-surface disabled:opacity-60"
          >
            <MicIcon size={14} />
            Enregistrer un échantillon
          </button>
          <label className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-xs transition hover:bg-surface">
            Choisir un fichier audio
            <input
              type="file"
              accept="audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav"
              hidden
              onChange={(e) => setFileToSend(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
      )}

      {fileToSend && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2">
          <span className="truncate text-xs text-muted-strong">{fileToSend.name}</span>
          <div className="flex shrink-0 gap-2">
            <button onClick={() => setFileToSend(null)} className="text-xs text-muted hover:underline">
              Annuler
            </button>
            <button
              onClick={() => void submit(fileToSend, fileToSend.name)}
              disabled={uploading}
              className="text-xs font-medium text-[var(--accent-2)] hover:underline disabled:opacity-50"
            >
              {uploading ? "Envoi..." : "Inscrire"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function PrivacySection() {
  const { user, refreshMe } = useAuth();
  const profile = user?.profile;

  const [showLastSeen, setShowLastSeen] = useState(profile?.showLastSeen ?? true);
  const [showOnlineStatus, setShowOnlineStatus] = useState(profile?.showOnlineStatus ?? true);
  const [showReadReceipts, setShowReadReceipts] = useState(profile?.showReadReceipts ?? true);
  const [voiceCloningConsent, setVoiceCloningConsent] = useState(profile?.voiceCloningConsent ?? false);
  const [whoCanMessageMe, setWhoCanMessageMe] = useState<WhoCanInteract>(
    (profile?.whoCanMessageMe as WhoCanInteract) ?? "EVERYONE",
  );
  const [whoCanSeeMyStatus, setWhoCanSeeMyStatus] = useState<WhoCanInteract>(
    (profile?.whoCanSeeMyStatus as WhoCanInteract) ?? "EVERYONE",
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const dto: UpdateProfileInput = {
      showLastSeen,
      showOnlineStatus,
      showReadReceipts,
      voiceCloningConsent,
      whoCanMessageMe,
      whoCanSeeMyStatus,
    };
    try {
      await api.users.updateProfile(dto);
      await refreshMe();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer les préférences.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Row label="Afficher ma dernière connexion" description="Les autres voient quand vous étiez en ligne pour la dernière fois.">
        <Toggle checked={showLastSeen} onChange={() => setShowLastSeen((v) => !v)} />
      </Row>
      <Row label="Afficher mon statut en ligne" description="Un point vert apparaît quand vous êtes connecté(e).">
        <Toggle checked={showOnlineStatus} onChange={() => setShowOnlineStatus((v) => !v)} />
      </Row>
      <Row label="Accusés de lecture" description="Les autres voient quand vous avez lu leurs messages.">
        <Toggle checked={showReadReceipts} onChange={() => setShowReadReceipts((v) => !v)} />
      </Row>
      <Row
        label="Clonage de ma voix pour les traductions"
        description="Autorise Glotta à reproduire votre voix quand un message vocal est traduit. Désactivé par défaut."
      >
        <Toggle checked={voiceCloningConsent} onChange={() => setVoiceCloningConsent((v) => !v)} />
      </Row>

      {voiceCloningConsent && !profile?.voiceCloningConsent && (
        <p className="px-1 text-xs text-muted">Enregistrez d&rsquo;abord ce réglage pour pouvoir inscrire un modèle vocal.</p>
      )}
      <VoiceModelSection enabled={profile?.voiceCloningConsent ?? false} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-2">
        <div>
          <label className={sectionLabelClassName}>Qui peut m&rsquo;écrire</label>
          <select
            className={inputClassName}
            value={whoCanMessageMe}
            onChange={(e) => setWhoCanMessageMe(e.target.value as WhoCanInteract)}
          >
            {Object.entries(WHO_CAN_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={sectionLabelClassName}>Qui voit mes statuts</label>
          <select
            className={inputClassName}
            value={whoCanSeeMyStatus}
            onChange={(e) => setWhoCanSeeMyStatus(e.target.value as WhoCanInteract)}
          >
            {Object.entries(WHO_CAN_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

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
