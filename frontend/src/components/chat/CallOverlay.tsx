"use client";

import { useState, type RefObject } from "react";
import { Avatar } from "@/components/Avatar";
import { ChevronDownIcon, MicIcon, MicOffIcon, PersonIcon, PhoneIcon, PhoneOffIcon, VideoIcon, VideoOffIcon } from "@/components/icons";
import { displayName } from "@/lib/format";
import type { CallKind, CallPhase } from "@/lib/use-call";
import type { ConversationParticipant, PublicUser } from "@/lib/types";

// Exportées pour MinimizedCallBar.tsx — jamais dupliquées, même format de
// durée/statut affiché réduit ou en plein écran.
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function statusLabel(phase: CallPhase, kind: CallKind, durationSeconds: number, error: string | null): string {
  switch (phase) {
    case "outgoing":
      return kind === "VIDEO" ? "Appel vidéo en cours..." : "Appel en cours...";
    case "incoming":
      return kind === "VIDEO" ? "Appel vidéo entrant..." : "Appel entrant...";
    case "active":
      return formatDuration(durationSeconds);
    case "ended":
      return error ?? "Appel terminé.";
    default:
      return "";
  }
}

/**
 * Overlay plein écran pour tout appel non "idle" — monté une seule fois au
 * niveau de la page de chat (voir useCall), jamais par conversation : peut
 * s'afficher quelle que soit la conversation actuellement ouverte. `peer`
 * peut être `null` très brièvement (le temps que la conversation concernée
 * soit connue côté page) — on affiche alors un espace réservé plutôt que de
 * ne rien monter, pour ne jamais faire disparaître l'overlay pendant un appel
 * entrant.
 *
 * La vidéo distante s'affiche en plein cadre dès que `remoteVideoEnabled` est
 * vrai (peu importe le type d'appel initial — la caméra peut être activée en
 * cours de route, voir useCall.toggleVideo) ; l'avatar reste affiché tant
 * qu'aucune vidéo n'est active, des deux côtés.
 */
export function CallOverlay({
  phase,
  kind,
  peer,
  durationSeconds,
  muted,
  videoEnabled,
  remoteVideoEnabled,
  error,
  remoteVideoRef,
  localVideoRef,
  onAccept,
  onReject,
  onHangUp,
  onToggleMute,
  onToggleVideo,
  onMinimize,
  onEscalate,
  escalateCandidates,
}: {
  phase: CallPhase;
  kind: CallKind;
  peer: ConversationParticipant | null;
  durationSeconds: number;
  muted: boolean;
  videoEnabled: boolean;
  remoteVideoEnabled: boolean;
  error: string | null;
  remoteVideoRef: RefObject<HTMLVideoElement | null>;
  localVideoRef: RefObject<HTMLVideoElement | null>;
  onAccept: () => void;
  onReject: () => void;
  onHangUp: () => void;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  /** Réduit l'appel en une pastille flottante (voir MinimizedCallBar) —
   * jamais proposé en phase "incoming" : répondre/refuser doit rester la
   * seule action possible tant que l'appel n'a pas été décidé. */
  onMinimize: () => void;
  /** "Inviter une personne à rejoindre l'appel" (appel simple → appel de
   * groupe, voir useCall.escalate) — absent tant qu'aucun contact n'a pu
   * être chargé (voir chat/page.tsx), jamais proposé hors de la phase
   * "active" : inviter suppose une connexion déjà établie. */
  onEscalate?: (userId: string) => void;
  escalateCandidates: PublicUser[];
}) {
  const [escalateOpen, setEscalateOpen] = useState(false);
  const name = peer ? displayName(peer) : "Appel";
  const showRemoteVideo = phase === "active" && remoteVideoEnabled;
  const showLocalPreview = (phase === "active" || phase === "outgoing") && videoEnabled;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-black/90 py-14 text-white backdrop-blur-sm">
      {/* Toujours monté (même sans piste vidéo) : c'est aussi la source du flux audio distant. */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className={`absolute inset-0 h-full w-full object-cover ${showRemoteVideo ? "opacity-100" : "opacity-0"}`}
      />

      {showLocalPreview && (
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute top-14 right-4 h-32 w-24 rounded-xl border border-white/20 object-cover shadow-2xl sm:h-40 sm:w-28"
        />
      )}

      <div className={`relative flex flex-1 flex-col items-center justify-center gap-4 ${showRemoteVideo ? "mt-auto mb-auto" : ""}`}>
        {!showRemoteVideo && (
          <span className={phase === "incoming" || phase === "outgoing" ? "animate-pulse" : ""}>
            <Avatar firstName={peer?.firstName ?? name} lastName={peer?.lastName ?? ""} avatarUrl={peer?.avatarUrl} size={112} />
          </span>
        )}
        <p className={`text-xl font-semibold ${showRemoteVideo ? "drop-shadow-lg" : ""}`}>{name}</p>
        <p className={`text-sm ${showRemoteVideo ? "text-white drop-shadow-lg" : "text-white/70"}`}>
          {statusLabel(phase, kind, durationSeconds, error)}
        </p>
      </div>

      <div className="relative flex items-center gap-6">
        {phase === "active" && escalateOpen && onEscalate && (
          <div className="absolute bottom-full mb-3 w-64 rounded-2xl border border-white/10 bg-surface-raised p-2 text-foreground shadow-2xl">
            <p className="px-2 py-1.5 text-xs font-medium text-muted">Ajouter à l&rsquo;appel</p>
            {escalateCandidates.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-muted">Aucun contact disponible.</p>
            )}
            <div className="max-h-48 overflow-y-auto glotta-scroll-hidden">
              {escalateCandidates.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    onEscalate(c.id);
                    setEscalateOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-surface"
                >
                  <Avatar firstName={c.firstName} lastName={c.lastName} avatarUrl={c.avatarUrl} size={28} />
                  <span className="truncate">{displayName(c)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === "incoming" && (
          <>
            <button
              onClick={onReject}
              aria-label="Refuser l'appel"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-danger text-white transition hover:opacity-90"
            >
              <PhoneOffIcon size={24} />
            </button>
            <button
              onClick={onAccept}
              aria-label="Accepter l'appel"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--online)] text-white transition hover:opacity-90"
            >
              <PhoneIcon size={24} />
            </button>
          </>
        )}

        {phase === "outgoing" && (
          <>
            <button
              onClick={onMinimize}
              aria-label="Réduire l'appel"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
            >
              <ChevronDownIcon size={22} />
            </button>
            <button
              onClick={onHangUp}
              aria-label="Annuler l'appel"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-danger text-white transition hover:opacity-90"
            >
              <PhoneOffIcon size={24} />
            </button>
          </>
        )}

        {phase === "active" && (
          <>
            <button
              onClick={onToggleMute}
              aria-label={muted ? "Réactiver le micro" : "Couper le micro"}
              className={`flex h-14 w-14 items-center justify-center rounded-full transition ${
                muted ? "bg-white text-black" : "bg-white/15 text-white hover:bg-white/25"
              }`}
            >
              {muted ? <MicOffIcon size={22} /> : <MicIcon size={22} />}
            </button>
            <button
              onClick={onToggleVideo}
              aria-label={videoEnabled ? "Couper la caméra" : "Activer la caméra"}
              className={`flex h-14 w-14 items-center justify-center rounded-full transition ${
                videoEnabled ? "bg-white/15 text-white hover:bg-white/25" : "bg-white text-black"
              }`}
            >
              {videoEnabled ? <VideoIcon size={22} /> : <VideoOffIcon size={22} />}
            </button>
            {onEscalate && (
              <button
                onClick={() => setEscalateOpen((v) => !v)}
                aria-label="Ajouter une personne à l'appel"
                className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
              >
                <PersonIcon size={22} />
              </button>
            )}
            <button
              onClick={onMinimize}
              aria-label="Réduire l'appel"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
            >
              <ChevronDownIcon size={22} />
            </button>
            <button
              onClick={onHangUp}
              aria-label="Raccrocher"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-danger text-white transition hover:opacity-90"
            >
              <PhoneOffIcon size={24} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
