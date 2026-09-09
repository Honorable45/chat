"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import {
  MicIcon,
  MicOffIcon,
  PersonIcon,
  PhoneIcon,
  PhoneOffIcon,
} from "@/components/icons";
import { displayName } from "@/lib/format";
import type { GroupCallKind, GroupCallPhase } from "@/lib/use-group-call";
import type { ConversationParticipant, GroupCallParticipant } from "@/lib/types";

export function formatGroupCallDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function AudioSink({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

function ParticipantTile({
  participant,
  kind,
  stream,
  isSelf,
}: {
  participant: GroupCallParticipant;
  kind: GroupCallKind;
  stream: MediaStream | undefined;
  isSelf: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hasVideoTrack = kind === "VIDEO" && Boolean(stream?.getVideoTracks().length);

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  const ringing = participant.status === "RINGING";

  return (
    <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl bg-black/40">
      {hasVideoTrack ? (
        <video ref={videoRef} autoPlay playsInline muted={isSelf} className="h-full w-full object-cover" />
      ) : (
        <span className={ringing ? "animate-pulse" : ""}>
          <Avatar
            firstName={participant.firstName}
            lastName={participant.lastName}
            avatarUrl={participant.avatarUrl}
            size={64}
          />
        </span>
      )}
      {stream && !isSelf && <AudioSink stream={stream} />}
      <span className="absolute right-2 bottom-2 left-2 truncate rounded-full bg-black/50 px-2 py-1 text-center text-xs text-white">
        {isSelf ? "Vous" : `${participant.firstName}${ringing ? " · en attente..." : ""}`}
      </span>
    </div>
  );
}

/**
 * Overlay plein écran pour un appel de groupe (maillage direct, voir
 * useGroupCall) — même emplacement/principe que CallOverlay (monté une
 * seule fois au niveau de la page de chat), mais une grille de tuiles
 * (une par participant) plutôt qu'un unique flux distant : un appel de
 * groupe n'a jamais "l'autre", toujours plusieurs.
 */
export function GroupCallOverlay({
  phase,
  kind,
  conversationTitle,
  participants,
  myUserId,
  durationSeconds,
  muted,
  error,
  remoteStreams,
  localVideoStream,
  onAccept,
  onDecline,
  onLeave,
  onToggleMute,
  onInviteMore,
  inviteCandidates,
}: {
  phase: GroupCallPhase;
  kind: GroupCallKind;
  conversationTitle: string;
  participants: GroupCallParticipant[];
  myUserId: string;
  durationSeconds: number;
  muted: boolean;
  error: string | null;
  remoteStreams: Record<string, MediaStream>;
  localVideoStream: MediaStream | null;
  onAccept: () => void;
  onDecline: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  /** Absent tant qu'on n'a pas encore rejoint (voir chat/page.tsx) — inviter suppose d'être soi-même JOINED (voir GroupCallsService.invite). */
  onInviteMore?: (userIds: string[]) => void;
  /** Membres du groupe ni JOINED ni RINGING — jamais déjà dans l'appel. */
  inviteCandidates: ConversationParticipant[];
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const visible = participants.filter((p) => p.status === "RINGING" || p.status === "JOINED");
  const joinedCount = participants.filter((p) => p.status === "JOINED").length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 py-10 text-white backdrop-blur-sm">
      <div className="flex flex-col items-center gap-1 px-4">
        <p className="text-lg font-semibold">{conversationTitle}</p>
        <p className="text-sm text-white/70">
          {phase === "ringing"
            ? kind === "VIDEO"
              ? "Appel vidéo de groupe entrant..."
              : "Appel de groupe entrant..."
            : error
              ? error
              : `${joinedCount} participant${joinedCount > 1 ? "s" : ""} · ${formatGroupCallDuration(durationSeconds)}`}
        </p>
      </div>

      <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto glotta-scroll-hidden p-4 sm:grid-cols-3">
        {phase === "active" && (
          <ParticipantTile
            participant={{
              userId: myUserId,
              firstName: "Vous",
              lastName: "",
              avatarUrl: null,
              status: "JOINED",
            }}
            kind={kind}
            stream={localVideoStream ?? undefined}
            isSelf
          />
        )}
        {visible
          .filter((p) => p.userId !== myUserId)
          .map((p) => (
            <ParticipantTile key={p.userId} participant={p} kind={kind} stream={remoteStreams[p.userId]} isSelf={false} />
          ))}
      </div>

      <div className="relative flex flex-col items-center gap-4 px-4">
        {inviteOpen && onInviteMore && (
          <div className="absolute bottom-full mb-3 w-64 rounded-2xl border border-white/10 bg-surface-raised p-2 text-foreground shadow-2xl">
            <p className="px-2 py-1.5 text-xs font-medium text-muted">Ajouter à l&rsquo;appel</p>
            {inviteCandidates.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-muted">Tout le monde est déjà dans l&rsquo;appel.</p>
            )}
            <div className="max-h-48 overflow-y-auto glotta-scroll-hidden">
              {inviteCandidates.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    onInviteMore([m.id]);
                    setInviteOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-surface"
                >
                  <Avatar firstName={m.firstName} lastName={m.lastName} avatarUrl={m.avatarUrl} size={28} />
                  <span className="truncate">{displayName(m)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-6">
          {phase === "ringing" && (
            <>
              <button
                onClick={onDecline}
                aria-label="Refuser l'appel"
                className="flex h-14 w-14 items-center justify-center rounded-full bg-danger text-white transition hover:opacity-90"
              >
                <PhoneOffIcon size={24} />
              </button>
              <button
                onClick={onAccept}
                aria-label="Rejoindre l'appel"
                className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--online)] text-white transition hover:opacity-90"
              >
                <PhoneIcon size={24} />
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
              {onInviteMore && (
                <button
                  onClick={() => setInviteOpen((v) => !v)}
                  aria-label="Ajouter à l'appel"
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
                >
                  <PersonIcon size={22} />
                </button>
              )}
              <button
                onClick={onLeave}
                aria-label="Quitter l'appel"
                className="flex h-14 w-14 items-center justify-center rounded-full bg-danger text-white transition hover:opacity-90"
              >
                <PhoneOffIcon size={24} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
