"use client";

import { useEffect, useRef, useState } from "react";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { AuthenticatedVideo } from "@/components/AuthenticatedVideo";
import { Avatar } from "@/components/Avatar";
import { UsersIcon, XIcon } from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { avatarGradient, displayName, shortRelativeTime } from "@/lib/format";
import type { Status, StatusView } from "@/lib/types";
import { StatusVoicePlayer } from "./StatusVoicePlayer";

const AUTO_ADVANCE_MS = 6000;
// Vidéo/vocal avancent sur leur propre lecture (onEnded), jamais sur ce
// minuteur — voir la garde dans l'effet de progression ci-dessous.
const TIMED_TYPES = new Set<Status["type"]>(["TEXT", "IMAGE"]);

export function StatusViewer({
  statuses,
  startIndex,
  onClose,
  onDeleted,
}: {
  /** Les statuts d'un seul auteur, dans l'ordre d'affichage (plus ancien d'abord). */
  statuses: Status[];
  startIndex: number;
  onClose: () => void;
  onDeleted: (statusId: string) => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [views, setViews] = useState<StatusView[] | null>(null);
  const viewedRef = useRef<Set<string>>(new Set());

  const current = statuses[index];

  function next() {
    if (index < statuses.length - 1) {
      setIndex((i) => i + 1);
      setProgress(0);
      setViewsOpen(false);
    } else {
      onClose();
    }
  }

  function prev() {
    if (index > 0) {
      setIndex((i) => i - 1);
      setProgress(0);
      setViewsOpen(false);
    }
  }

  // Marque comme vu une seule fois par statut affiché, jamais pour les
  // siens (voir StatusesService.markViewed côté backend, qui les ignore de
  // toute façon — inutile de le lui demander).
  useEffect(() => {
    if (!current || current.isMine || viewedRef.current.has(current.id)) return;
    viewedRef.current.add(current.id);
    api.statuses.markViewed(current.id).catch(() => {});
  }, [current]);

  // Progression + avance automatique — uniquement pour texte/image, qui
  // n'ont pas de durée propre. Vidéo et vocal avancent sur leur lecture
  // réelle (onEnded des composants dédiés, plus bas).
  useEffect(() => {
    if (!current || paused || viewsOpen || !TIMED_TYPES.has(current.type)) return;
    const start = Date.now() - progress * AUTO_ADVANCE_MS;
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      const ratio = Math.min(1, elapsed / AUTO_ADVANCE_MS);
      setProgress(ratio);
      if (ratio >= 1) next();
    }, 50);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ne doit redémarrer que sur un changement de statut ou de pause, pas à chaque tick de `progress`.
  }, [current, paused, viewsOpen]);

  if (!current) return null;

  async function openViews() {
    setPaused(true);
    setViewsOpen(true);
    if (!views) {
      try {
        setViews(await api.statuses.views(current.id));
      } catch {
        setViews([]);
      }
    }
  }

  async function remove() {
    try {
      await api.statuses.remove(current.id);
      onDeleted(current.id);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black">
      <div className="relative flex h-full w-full max-w-md flex-col">
        <div className="absolute top-0 right-0 left-0 z-10 flex gap-1 p-3">
          {statuses.map((s, i) => (
            <div key={s.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
              <div
                className="h-full bg-white transition-none"
                style={{
                  // Pas de progression fine pour vidéo/vocal (pas de suivi
                  // de lecture au niveau de la barre, contrairement à
                  // texte/image) : simplement "plein" une fois en cours.
                  width: `${
                    i < index ? 100 : i === index ? (TIMED_TYPES.has(current.type) ? progress * 100 : 100) : 0
                  }%`,
                }}
              />
            </div>
          ))}
        </div>

        <div className="absolute top-6 right-3 left-3 z-10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Avatar firstName={current.author.firstName} lastName={current.author.lastName} avatarUrl={current.author.avatarUrl} size={36} />
            <div>
              <p className="text-sm font-medium text-white">{displayName(current.author)}</p>
              <p className="text-xs text-white/70">{shortRelativeTime(current.createdAt)}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {current.isMine && (
              <button onClick={remove} className="rounded-full px-2 py-1 text-xs text-white/80 hover:bg-white/10" title="Supprimer">
                Supprimer
              </button>
            )}
            <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-white hover:bg-white/10">
              <XIcon size={20} />
            </button>
          </div>
        </div>

        <div
          className="flex flex-1 items-center justify-center overflow-hidden"
          style={current.type !== "IMAGE" ? { background: avatarGradient(current.id) } : undefined}
          onMouseDown={() => setPaused(true)}
          onMouseUp={() => setPaused(false)}
          onClick={(e) => {
            const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
            const half = e.currentTarget.getBoundingClientRect().width / 2;
            if (x < half) prev();
            else next();
          }}
        >
          {current.type === "IMAGE" && current.mediaUrl ? (
            <AuthenticatedImage
              src={api.statuses.mediaUrl(current.id)}
              alt=""
              className="max-h-full max-w-full object-contain"
            />
          ) : current.type === "TEXT" ? (
            <p className="max-w-[80%] text-center text-2xl font-semibold text-white">{current.text}</p>
          ) : current.type === "VIDEO" && current.mediaUrl ? (
            <div onClick={(e) => e.stopPropagation()} className="flex h-full w-full items-center justify-center">
              <AuthenticatedVideo
                src={api.statuses.mediaUrl(current.id)}
                className="max-h-full max-w-full object-contain"
                onEnded={next}
              />
            </div>
          ) : current.type === "VOICE" && current.mediaUrl ? (
            <div onClick={(e) => e.stopPropagation()}>
              <StatusVoicePlayer src={api.statuses.mediaUrl(current.id)} onEnded={next} />
            </div>
          ) : (
            <p className="text-center text-sm text-white/70">Ce statut n&rsquo;a pas de contenu.</p>
          )}
          {current.type === "IMAGE" && current.text && (
            <span className="absolute right-4 bottom-16 left-4 rounded-xl bg-black/40 px-3 py-2 text-center text-sm text-white">
              {current.text}
            </span>
          )}
          {current.type === "VOICE" && current.text && (
            <span className="absolute right-4 bottom-16 left-4 rounded-xl bg-black/40 px-3 py-2 text-center text-sm text-white">
              {current.text}
            </span>
          )}
        </div>

        {current.isMine && current.viewCount !== null && (
          <button
            onClick={openViews}
            className="absolute right-3 bottom-4 left-3 z-10 flex items-center justify-center gap-1.5 rounded-full bg-black/40 py-2 text-sm text-white"
          >
            <UsersIcon size={15} />
            {current.viewCount} vue{current.viewCount === 1 ? "" : "s"}
          </button>
        )}

        {viewsOpen && (
          <div
            className="absolute inset-x-0 bottom-0 z-20 max-h-[60%] overflow-y-auto rounded-t-2xl bg-surface-raised p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">Vu par</p>
              <button
                onClick={() => {
                  setViewsOpen(false);
                  setPaused(false);
                }}
                className="text-muted hover:text-foreground"
              >
                <XIcon size={16} />
              </button>
            </div>
            {views === null && <p className="py-4 text-center text-sm text-muted">Chargement...</p>}
            {views?.length === 0 && <p className="py-4 text-center text-sm text-muted">Personne pour l&rsquo;instant.</p>}
            {views?.map((v) => (
              <div key={v.viewer.id} className="flex items-center gap-2.5 py-1.5">
                <Avatar firstName={v.viewer.firstName} lastName={v.viewer.lastName} avatarUrl={v.viewer.avatarUrl} size={32} />
                <span className="flex-1 truncate text-sm">{displayName(v.viewer)}</span>
                <span className="text-xs text-muted">{shortRelativeTime(v.viewedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
