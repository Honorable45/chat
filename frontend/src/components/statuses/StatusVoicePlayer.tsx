"use client";

import { useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon } from "@/components/icons";
import { formatDuration } from "@/lib/format";
import { getAccessToken } from "@/lib/token-store";

/** Lecteur vocal pour un statut, plein écran — mêmes principes que
 * VoiceMessageBubble (blob authentifié, lecture réelle) mais habillé pour un
 * fond sombre plutôt qu'une bulle de conversation, et avec démarrage
 * automatique (comme la vidéo) puisqu'un statut se consulte passivement. */
export function StatusVoicePlayer({ src, onEnded }: { src: string; onEnded?: () => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [state, setState] = useState<"loading" | "playing" | "paused" | "error">("loading");
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const token = getAccessToken();

    fetch(src, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        const audio = new Audio(url);
        audio.addEventListener("loadedmetadata", () => setDuration(audio.duration));
        audio.addEventListener("timeupdate", () => {
          if (audio.duration) setProgress(audio.currentTime / audio.duration);
        });
        audio.addEventListener("ended", () => {
          setState("paused");
          onEnded?.();
        });
        audioRef.current = audio;
        void audio.play().then(() => setState("playing"));
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });

    return () => {
      cancelled = true;
      audioRef.current?.pause();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ne doit se relancer que si la source change, pas sur `onEnded` (nouvelle référence à chaque rendu du parent).
  }, [src]);

  function toggle() {
    if (!audioRef.current) return;
    if (state === "playing") {
      audioRef.current.pause();
      setState("paused");
    } else if (state === "paused") {
      void audioRef.current.play();
      setState("playing");
    }
  }

  return (
    <div className="flex w-64 flex-col items-center gap-4 text-white">
      <button
        onClick={toggle}
        disabled={state === "loading" || state === "error"}
        className="flex h-16 w-16 items-center justify-center rounded-full bg-white/15"
      >
        {state === "loading" ? (
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : state === "playing" ? (
          <PauseIcon size={26} />
        ) : (
          <PlayIcon size={26} />
        )}
      </button>
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/20">
        <div className="h-full bg-white" style={{ width: `${progress * 100}%` }} />
      </div>
      <span className="text-xs text-white/70">{state === "error" ? "Audio indisponible." : formatDuration(duration ?? 0)}</span>
    </div>
  );
}
