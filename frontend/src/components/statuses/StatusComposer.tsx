"use client";

import { useRef, useState } from "react";
import { ImageIcon, MicIcon, VideoIcon, XIcon } from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import type { Status, StatusType, StatusVisibility } from "@/lib/types";
import { useVoiceRecorder } from "@/lib/use-voice-recorder";

const VISIBILITY_LABELS: Record<StatusVisibility, string> = {
  EVERYONE: "Tout le monde",
  CONTACTS: "Mes contacts",
  NOBODY: "Personne (brouillon privé)",
};

const VIDEO_ACCEPT = "video/mp4,video/webm,video/quicktime";
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

export function StatusComposer({ onCreated, onClose }: { onCreated: (status: Status) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [mediaKind, setMediaKind] = useState<Extract<StatusType, "IMAGE" | "VIDEO"> | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<StatusVisibility>("CONTACTS");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const recorder = useVoiceRecorder();

  function pickFile(kind: Extract<StatusType, "IMAGE" | "VIDEO">, f: File | null) {
    setMediaKind(f ? kind : null);
    setFile(f);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f ? URL.createObjectURL(f) : null;
    });
  }

  async function submit() {
    const recording = recorder.state === "recording" ? await recorder.stop() : null;
    if (!text.trim() && !file && !recording) return;

    setSaving(true);
    setError(null);
    try {
      const status = await api.statuses.create({
        type: recording ? "VOICE" : mediaKind ? mediaKind : "TEXT",
        text: text.trim() || undefined,
        visibility,
        file: recording ? recording.blob : (file ?? undefined),
        filename: recording ? `voice.${recording.mimeType.split("/")[1]?.split(";")[0] ?? "webm"}` : undefined,
      });
      onCreated(status);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de publier ce statut.");
    } finally {
      setSaving(false);
    }
  }

  const hasContent = Boolean(text.trim() || file || recorder.state === "recording");

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-raised p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Nouveau statut</p>
        <button onClick={onClose} className="text-muted hover:text-foreground" aria-label="Fermer">
          <XIcon size={16} />
        </button>
      </div>

      {previewUrl && mediaKind === "IMAGE" && (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- aperçu local d'un fichier choisi par l'utilisateur, jamais optimisé via next/image. */}
          <img src={previewUrl} alt="" className="max-h-48 w-full rounded-xl object-cover" />
          <button
            onClick={() => pickFile("IMAGE", null)}
            className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"
            aria-label="Retirer l'image"
          >
            <XIcon size={14} />
          </button>
        </div>
      )}

      {previewUrl && mediaKind === "VIDEO" && (
        <div className="relative">
          <video src={previewUrl} className="max-h-48 w-full rounded-xl object-cover" controls muted />
          <button
            onClick={() => pickFile("VIDEO", null)}
            className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white"
            aria-label="Retirer la vidéo"
          >
            <XIcon size={14} />
          </button>
        </div>
      )}

      {(recorder.state === "recording" || recorder.state === "requesting") && (
        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 py-2.5">
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-danger" />
          <span className="text-sm text-muted-strong">
            {recorder.state === "requesting" ? "Micro..." : "Enregistrement..."}
          </span>
          <span className="ml-auto text-sm tabular-nums text-muted">{formatDuration(recorder.elapsedSeconds)}</span>
          <button onClick={recorder.cancel} className="text-danger hover:underline" type="button">
            Annuler
          </button>
        </div>
      )}
      {recorder.state === "error" && recorder.error && <p className="text-sm text-danger">{recorder.error}</p>}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={500}
        rows={mediaKind || recorder.state === "recording" ? 2 : 3}
        placeholder={mediaKind ? "Ajouter une légende (optionnel)..." : "Quoi de neuf ?"}
        className="w-full resize-none rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none placeholder:text-muted focus:border-[var(--accent)]"
      />

      {/*
        Deux lignes distinctes plutôt qu'une seule "justify-between" : ce
        composeur s'affiche maintenant à l'intérieur de la 2e colonne large
        de 320px (voir StatusesPanel) — icônes + menu de visibilité + bouton
        "Publier" ne tenaient jamais tous sur une seule ligne à cette largeur,
        ce qui poussait "Publier" hors du cadre visible (jamais coupé
        volontairement, un vrai bug constaté en testant l'interface).
      */}
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          ref={imageInputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          hidden
          onChange={(e) => pickFile("IMAGE", e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          disabled={recorder.state === "recording"}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition hover:bg-surface hover:text-foreground disabled:opacity-40"
          title="Ajouter une image"
        >
          <ImageIcon size={18} />
        </button>

        <input
          ref={videoInputRef}
          type="file"
          accept={VIDEO_ACCEPT}
          hidden
          onChange={(e) => pickFile("VIDEO", e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => videoInputRef.current?.click()}
          disabled={recorder.state === "recording"}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition hover:bg-surface hover:text-foreground disabled:opacity-40"
          title="Ajouter une vidéo"
        >
          <VideoIcon size={18} />
        </button>

        <button
          type="button"
          onClick={() => void recorder.start()}
          disabled={Boolean(file) || recorder.state === "recording"}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition hover:bg-surface hover:text-foreground disabled:opacity-40"
          title="Enregistrer un vocal"
        >
          <MicIcon size={18} />
        </button>

        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as StatusVisibility)}
          className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-muted-strong outline-none"
        >
          {Object.entries(VISIBILITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <button
        onClick={submit}
        disabled={saving || !hasContent}
        className="w-full rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] px-5 py-2 text-sm font-semibold text-[var(--accent-contrast)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Publication..." : "Publier"}
      </button>

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
