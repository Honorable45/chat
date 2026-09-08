"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MoreVerticalIcon, PauseIcon, PlayIcon, ShareIcon, TrashIcon } from "@/components/icons";
import { api } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { getAccessToken } from "@/lib/token-store";
import type { VoiceDetails } from "@/lib/types";

// Hauteurs déterministes (par id de message) pour l'habillage visuel des
// barres — décoratif uniquement, ce n'est jamais présenté comme une vraie
// amplitude audio (celle-ci n'est pas exposée par GET /conversations/:id/
// messages, seulement via l'événement socket "message:new" au moment de
// l'envoi — voir VoiceService côté backend). La lecture, elle, est bien
// réelle : streamée et authentifiée depuis /voice/:id/audio.
function decorativeBars(seed: string, count = 28): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const bars: number[] = [];
  for (let i = 0; i < count; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    bars.push(0.25 + (h % 100) / 100);
  }
  return bars;
}

async function fetchAsBlob(url: string): Promise<Blob | null> {
  const token = getAccessToken();
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined }).catch(
    () => null,
  );
  if (!res?.ok) return null;
  return res.blob();
}

function TranslatedAudioButton({ messageId, languageCode }: { messageId: string; languageCode: string }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      audioRef.current?.pause();
    };
  }, []);

  async function toggle() {
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    if (!audioRef.current) {
      const blob = await fetchAsBlob(api.voice.translatedAudioUrl(messageId, languageCode));
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const audio = new Audio(url);
      audio.addEventListener("ended", () => setPlaying(false));
      audioRef.current = audio;
    }
    void audioRef.current.play();
    setPlaying(true);
  }

  return (
    <button
      onClick={toggle}
      className="flex shrink-0 items-center gap-1 rounded-full bg-black/10 px-2 py-1 text-[11px] font-medium"
    >
      {playing ? <PauseIcon size={11} /> : <PlayIcon size={11} />}
      voix
    </button>
  );
}

export function VoiceMessageBubble({
  messageId,
  own,
  voice,
  myLanguageCode,
  onDelete,
}: {
  messageId: string;
  own: boolean;
  voice?: VoiceDetails;
  /** Langue dans laquelle CE viewer veut recevoir les traductions — sert à
   * choisir, parmi les traductions disponibles, celle à afficher. */
  myLanguageCode?: string | null;
  onDelete?: (messageId: string) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused" | "error">("idle");
  const [progress, setProgress] = useState(0); // 0..1
  // Initialisée depuis voice.durationSeconds (mesurée par l'enregistreur au
  // moment de l'envoi, déjà fiable — voir use-voice-recorder.ts) plutôt que
  // `null` : `audio.duration` d'un blob WebM issu de MediaRecorder renvoie
  // très souvent `Infinity` sur Chrome au moment de "loadedmetadata" (durée
  // absente du conteneur), ce qui affichait "0:00" et bloquait la
  // progression de la barre de lecture — bug réel constaté en prod.
  const [duration, setDuration] = useState<number | null>(voice?.durationSeconds ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [sharing, setSharing] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Valeur dérivée pure de `messageId` : useMemo (pas useRef, dont la lecture
  // pendant le rendu casse sous le compilateur React — react-hooks/refs).
  const bars = useMemo(() => decorativeBars(messageId), [messageId]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  async function ensureLoaded() {
    if (audioRef.current) return audioRef.current;

    const token = getAccessToken();
    const res = await fetch(api.voice.audioUrl(messageId), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new Error("Audio introuvable.");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    objectUrlRef.current = url;

    const audio = new Audio(url);
    // Ne remplace jamais une durée déjà connue (voir voice.durationSeconds
    // ci-dessus) par une valeur non finie — seulement si le navigateur
    // fournit une vraie mesure exploitable.
    audio.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    });
    audio.addEventListener("timeupdate", () => {
      // `audio.duration` (Infinity sur un WebM MediaRecorder tant que la
      // lecture n'a pas assez avancé) ne doit jamais servir de diviseur ici
      // — la durée connue par ailleurs (voice.durationSeconds) reste le
      // dénominateur fiable pour faire avancer la barre de progression.
      const total = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
      if (total) setProgress(audio.currentTime / total);
    });
    audio.addEventListener("ended", () => {
      setState("paused");
      setProgress(0);
    });
    audioRef.current = audio;
    return audio;
  }

  async function toggle() {
    if (state === "playing") {
      audioRef.current?.pause();
      setState("paused");
      return;
    }
    try {
      setState("loading");
      const audio = await ensureLoaded();
      await audio.play();
      setState("playing");
    } catch {
      setState("error");
    }
  }

  async function share() {
    setMenuOpen(false);
    setSharing(true);
    try {
      const blob = await fetchAsBlob(api.voice.audioUrl(messageId));
      if (!blob) return;
      const extension = blob.type.split("/")[1]?.split(";")[0] ?? "webm";
      const file = new File([blob], `message-vocal.${extension}`, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Message vocal" });
      } else if (navigator.share) {
        // Certains navigateurs partagent sans fichier (titre/texte seulement) —
        // mieux que rien plutôt que de ne rien proposer du tout.
        await navigator.share({ title: "Message vocal Glotta" });
      }
    } catch {
      // L'utilisateur a annulé le partage, ou l'API n'est pas disponible —
      // jamais bloquant, aucun message d'erreur nécessaire.
    } finally {
      setSharing(false);
    }
  }

  const played = duration ? Math.round(progress * bars.length) : 0;

  // La traduction pertinente pour CE viewer : celle vers sa langue de
  // réception préférée, si elle diffère de la langue détectée (inutile de
  // traduire vers la langue déjà parlée — même règle que le pipeline
  // backend, voir VoiceTranslationPipelineService.resolveTargetLanguages).
  const relevantTranslation =
    myLanguageCode && voice?.detectedLanguage?.code !== myLanguageCode
      ? voice?.translations.find((t) => t.targetLanguage.code === myLanguageCode)
      : undefined;
  const hasTranslationContent = Boolean(voice?.transcript || relevantTranslation);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`flex items-center gap-2 rounded-2xl px-3.5 py-2.5 ${
          own
            ? "bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] text-[var(--accent-contrast)]"
            : "border border-border bg-surface-raised text-foreground"
        }`}
      >
        <button
          onClick={toggle}
          disabled={state === "loading"}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            own ? "bg-black/15" : "bg-white/10"
          }`}
          aria-label={state === "playing" ? "Mettre en pause" : "Écouter"}
        >
          {state === "loading" ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : state === "playing" ? (
            <PauseIcon size={15} />
          ) : (
            <PlayIcon size={15} />
          )}
        </button>

        <div className="flex h-6 flex-1 items-center gap-[2px]">
          {bars.map((h, i) => (
            <span
              key={i}
              className="w-[3px] rounded-full transition-opacity"
              style={{
                height: `${h * 100}%`,
                background: "currentColor",
                opacity: i < played ? 1 : own ? 0.45 : 0.3,
              }}
            />
          ))}
        </div>

        <span className={`shrink-0 text-xs tabular-nums ${own ? "opacity-90" : "text-muted"}`}>
          {state === "error" ? "—" : formatDuration(duration ?? 0)}
        </span>

        <div ref={menuRef} className="relative shrink-0">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className={`flex h-6 w-6 items-center justify-center rounded-full ${own ? "hover:bg-black/15" : "hover:bg-white/10"}`}
            aria-label="Options"
          >
            <MoreVerticalIcon size={14} />
          </button>

          {menuOpen && (
            <div className="absolute top-full right-0 z-10 mt-1 w-52 rounded-xl border border-border bg-surface-raised p-1.5 text-foreground shadow-2xl">
              <button
                onClick={() => {
                  setShowTranslation((v) => !v);
                  setMenuOpen(false);
                }}
                disabled={!hasTranslationContent}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
              >
                {showTranslation ? "Masquer la traduction" : "Afficher la traduction"}
              </button>
              <button
                onClick={() => void share()}
                disabled={sharing}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-surface disabled:opacity-60"
              >
                <ShareIcon size={15} />
                Partager
              </button>
              {own && onDelete && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(messageId);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-danger transition hover:bg-danger/10"
                >
                  <TrashIcon size={15} />
                  Supprimer
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {showTranslation && voice?.transcript && (
        <p className={`px-1 text-xs italic ${own ? "text-muted" : "text-muted-strong"}`}>&laquo; {voice.transcript} &raquo;</p>
      )}

      {showTranslation && relevantTranslation?.status === "COMPLETED" && relevantTranslation.translatedText && (
        <div
          className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${
            own ? "bg-black/10" : "border border-border bg-surface"
          }`}
        >
          <span className="flex-1">
            <span className="mr-1.5 rounded bg-current/10 px-1 py-0.5 text-[10px] font-medium uppercase opacity-70">
              {relevantTranslation.targetLanguage.code}
            </span>
            {relevantTranslation.translatedText}
          </span>
          {relevantTranslation.audioUrl && (
            <TranslatedAudioButton messageId={messageId} languageCode={relevantTranslation.targetLanguage.code} />
          )}
        </div>
      )}

      {showTranslation && relevantTranslation?.status === "PROCESSING" && (
        <p className="px-1 text-xs text-muted">Traduction en cours...</p>
      )}

      {showTranslation && relevantTranslation?.status === "FAILED" && (
        <p className="px-1 text-xs text-muted">Traduction indisponible pour l&rsquo;instant.</p>
      )}
    </div>
  );
}
