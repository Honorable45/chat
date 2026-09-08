"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LanguagesIcon, MoreVerticalIcon, PauseIcon, PlayIcon, TrashIcon } from "@/components/icons";
import { isOwnBackendUrl, resolveMediaSrc } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { getAccessToken } from "@/lib/token-store";
import type { VoiceDetails } from "@/lib/types";

// Hauteurs déterministes (par id de message) pour l'habillage visuel des
// barres — décoratif uniquement, ce n'est jamais présenté comme une vraie
// amplitude audio (celle-ci n'est pas exposée par GET /conversations/:id/
// messages, seulement via l'événement socket "message:new" au moment de
// l'envoi — voir VoiceService côté backend). La lecture, elle, est bien
// réelle : depuis voice.audioUrl (URL Cloudinary signée, ou proxy backend
// authentifié en LOCAL — voir fetchAsBlob/loadSource plus bas).
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

/**
 * `audioUrl` vient toujours du DTO (voir VoiceDetails/MessageTranslationDetail
 * côté types.ts), jamais reconstruite depuis le seul messageId : selon le
 * fournisseur de stockage, c'est soit une URL Cloudinary déjà signée
 * (publique, jamais besoin d'en-tête d'autorisation — et un fetch direct
 * sans passer par resolveMediaSrc), soit un chemin proxy relatif vers ce
 * backend (`/api/voice/...`, protégé par JwtAuthGuard, qui a besoin des deux)
 * — même distinction que AuthenticatedImage/isOwnBackendUrl pour les autres
 * médias. Bug réel constaté en prod : reconstruire l'URL proxy à partir du
 * seul messageId (ancien code) 404ait pour tout vocal stocké sur Cloudinary,
 * le stream `/voice/:id/audio` ne servant plus que les fichiers LOCAL.
 */
/**
 * Cloudinary n'a pas de resource_type "audio" dédié (voir
 * CloudinaryProvider.upload, appelé avec 'video' même pour un vocal) : il
 * sert donc ce fichier avec un Content-Type "video/webm" même s'il ne
 * contient qu'une piste audio. Un `new Audio()` construit à partir d'un blob
 * ainsi typé "video/..." peut être refusé selon le navigateur, alors qu'un
 * vocal LOCAL (servi avec son vrai type "audio/...", voir
 * VoiceController.streamAudio) n'a jamais ce problème — bug réel constaté en
 * prod, uniquement pour les vocaux migrés vers Cloudinary. On reconstruit le
 * blob avec le même sous-type (webm/mp4/ogg...), juste recatégorisé "audio/".
 */
function normalizeAudioBlob(blob: Blob): Blob {
  return blob.type.startsWith("video/")
    ? new Blob([blob], { type: blob.type.replace(/^video\//, "audio/") })
    : blob;
}

async function fetchAsBlob(audioUrl: string): Promise<Blob | null> {
  const needsAuth = isOwnBackendUrl(audioUrl);
  const token = needsAuth ? getAccessToken() : null;
  const res = await fetch(resolveMediaSrc(audioUrl) ?? audioUrl, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  }).catch(() => null);
  if (!res?.ok) return null;
  return normalizeAudioBlob(await res.blob());
}

function TranslatedAudioButton({ audioUrl }: { audioUrl: string }) {
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
      const blob = await fetchAsBlob(audioUrl);
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
  // Deux pistes indépendantes (jamais une seule réutilisée) : garder chacune
  // chargée une fois récupérée évite de retélécharger l'audio à chaque
  // aller-retour "original ↔ traduit" déclenché depuis le menu ci-dessous.
  const originalAudioRef = useRef<HTMLAudioElement | null>(null);
  const originalUrlRef = useRef<string | null>(null);
  const translatedAudioRef = useRef<HTMLAudioElement | null>(null);
  const translatedUrlRef = useRef<string | null>(null);
  const [audioSource, setAudioSource] = useState<"original" | "translated">("original");
  // Lu depuis les gestionnaires d'événements audio (voir loadSource) pour
  // ignorer un événement d'une piste qu'on vient de quitter — sans ça, un
  // "timeupdate" en retard de la piste traduite pourrait écraser la barre
  // de progression de l'original juste rebasculé dessus.
  const audioSourceRef = useRef(audioSource);
  useEffect(() => {
    audioSourceRef.current = audioSource;
  }, [audioSource]);

  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused" | "error">("idle");
  const [progress, setProgress] = useState(0); // 0..1
  // Initialisée depuis voice.durationSeconds (mesurée par l'enregistreur au
  // moment de l'envoi, déjà fiable — voir use-voice-recorder.ts) plutôt que
  // `null` : `audio.duration` d'un blob WebM issu de MediaRecorder renvoie
  // très souvent `Infinity` sur Chrome au moment de "loadedmetadata" (durée
  // absente du conteneur), ce qui affichait "0:00" et bloquait la
  // progression de la barre de lecture — bug réel constaté en prod. L'audio
  // traduit (synthèse vocale, jamais un enregistrement MediaRecorder) n'a
  // pas ce problème, mais sa durée n'est connue d'aucune autre source :
  // `null` le temps que "loadedmetadata" la fournisse (voir toggleSource).
  const [duration, setDuration] = useState<number | null>(voice?.durationSeconds ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Valeur dérivée pure de `messageId` : useMemo (pas useRef, dont la lecture
  // pendant le rendu casse sous le compilateur React — react-hooks/refs).
  const bars = useMemo(() => decorativeBars(messageId), [messageId]);

  useEffect(() => {
    return () => {
      if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current);
      if (translatedUrlRef.current) URL.revokeObjectURL(translatedUrlRef.current);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- ces refs ne pointent jamais un nœud rendu par React (juste un `new Audio(...)` créé à la volée, voir loadSource) : lire `.current` au démontage, plutôt qu'au moment où cet effet s'est déclenché, est justement le comportement voulu.
      originalAudioRef.current?.pause();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- même raison que ci-dessus.
      translatedAudioRef.current?.pause();
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

  /**
   * Charge (une seule fois par piste, voir les refs dédiées) l'audio
   * original ou traduit, selon `source` — toujours depuis l'URL déjà
   * résolue par le DTO (`voice.audioUrl`/`relevantTranslation.audioUrl`),
   * jamais reconstruite depuis le seul messageId (voir le commentaire sur
   * fetchAsBlob) : cette dernière 404ait pour tout vocal stocké sur
   * Cloudinary, un bug réel qui rendait TOUT vocal illisible depuis la
   * migration du stockage.
   */
  async function loadSource(source: "original" | "translated"): Promise<HTMLAudioElement> {
    const audioRef = source === "translated" ? translatedAudioRef : originalAudioRef;
    if (audioRef.current) return audioRef.current;

    const rawUrl = source === "translated" ? relevantTranslation?.audioUrl : voice?.audioUrl;
    if (!rawUrl) {
      throw new Error(source === "translated" ? "Audio traduit indisponible." : "Audio introuvable.");
    }

    const needsAuth = isOwnBackendUrl(rawUrl);
    const token = needsAuth ? getAccessToken() : null;
    const res = await fetch(resolveMediaSrc(rawUrl) ?? rawUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new Error("Audio introuvable.");
    const blob = normalizeAudioBlob(await res.blob());
    const url = URL.createObjectURL(blob);
    if (source === "translated") translatedUrlRef.current = url;
    else originalUrlRef.current = url;

    const audio = new Audio(url);
    // Ne remplace jamais une durée déjà connue (voir voice.durationSeconds
    // ci-dessus) par une valeur non finie — seulement si le navigateur
    // fournit une vraie mesure exploitable. Ignore l'événement si la piste
    // active a changé entretemps (voir audioSourceRef) : une piste chargée
    // en arrière-plan ne doit jamais mettre à jour l'affichage de l'autre.
    audio.addEventListener("loadedmetadata", () => {
      if (audioSourceRef.current !== source) return;
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
    });
    audio.addEventListener("timeupdate", () => {
      if (audioSourceRef.current !== source) return;
      // `audio.duration` (Infinity sur un WebM MediaRecorder tant que la
      // lecture n'a pas assez avancé) ne doit jamais servir de diviseur ici
      // — la durée connue par ailleurs (voice.durationSeconds) reste le
      // dénominateur fiable pour faire avancer la barre de progression.
      const total = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration;
      if (total) setProgress(audio.currentTime / total);
    });
    audio.addEventListener("ended", () => {
      if (audioSourceRef.current !== source) return;
      setState("paused");
      setProgress(0);
    });
    audioRef.current = audio;
    return audio;
  }

  async function toggle() {
    if (state === "playing") {
      (audioSource === "translated" ? translatedAudioRef : originalAudioRef).current?.pause();
      setState("paused");
      return;
    }
    try {
      setState("loading");
      const audio = await loadSource(audioSource);
      await audio.play();
      setState("playing");
    } catch {
      setState("error");
    }
  }

  /**
   * Bascule la lecture entre l'audio original et sa traduction (voir
   * relevantTranslation) — remplace l'ancien bouton "Partager" du menu :
   * lance tout de suite la lecture de la piste choisie, depuis le début (un
   * second passage par le menu revient à l'original, et ainsi de suite).
   */
  async function toggleSource() {
    setMenuOpen(false);
    const current = audioSource === "translated" ? translatedAudioRef : originalAudioRef;
    current.current?.pause();

    const next = audioSource === "translated" ? "original" : "translated";
    setAudioSource(next);
    audioSourceRef.current = next;
    setProgress(0);
    setDuration(next === "original" ? (voice?.durationSeconds ?? null) : null);

    try {
      setState("loading");
      const audio = await loadSource(next);
      audio.currentTime = 0;
      await audio.play();
      setState("playing");
    } catch {
      setState("error");
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
  const hasTranslatedAudio = Boolean(
    relevantTranslation?.status === "COMPLETED" && relevantTranslation.audioUrl,
  );

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
          aria-label={state === "error" ? "Réessayer" : state === "playing" ? "Mettre en pause" : "Écouter"}
          title={state === "error" ? "Ce fichier audio n'est plus disponible. Cliquez pour réessayer." : undefined}
        >
          {state === "loading" ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : state === "playing" ? (
            <PauseIcon size={15} />
          ) : (
            <PlayIcon size={15} />
          )}
        </button>

        {state === "error" ? (
          // Cas le plus fréquent : un vocal enregistré avant la migration
          // du stockage vers Cloudinary (voir CloudinaryProvider), dont le
          // fichier vivait sur le disque local de Render — effacé sans
          // retour possible à chaque redéploiement (disque éphémère). Rien
          // à retenter en pratique, mais on laisse le bouton actif plutôt
          // que de supposer à tort une panne réseau simplement transitoire.
          <span className="flex-1 truncate text-xs italic text-muted">Audio indisponible</span>
        ) : (
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
        )}

        {state !== "error" && (
          <span className={`shrink-0 text-xs tabular-nums ${own ? "opacity-90" : "text-muted"}`}>
            {formatDuration(duration ?? 0)}
          </span>
        )}

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
                onClick={() => void toggleSource()}
                disabled={!hasTranslatedAudio && audioSource === "original"}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
              >
                <LanguagesIcon size={15} />
                {audioSource === "translated" ? "Écouter l'original" : "Écouter la traduction"}
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
          {relevantTranslation.audioUrl && <TranslatedAudioButton audioUrl={relevantTranslation.audioUrl} />}
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
