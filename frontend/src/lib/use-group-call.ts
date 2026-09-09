"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api, handleUnauthorized, refreshSession } from "./api";
import { getAccessToken } from "./token-store";
import type { GroupCallDetail, GroupCallMessagePayload, GroupCallParticipant } from "./types";
import { useRingTone } from "./use-ring-tone";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4000";

export type GroupCallPhase = "idle" | "ringing" | "active";
export type GroupCallKind = "AUDIO" | "VIDEO";

interface AckResult {
  ok: boolean;
  error?: string;
  groupCallMessage?: GroupCallMessagePayload;
  call?: GroupCallDetail;
  peerUserIds?: string[];
}

function ack(socket: Socket, event: string, payload: unknown): Promise<AckResult> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

interface GroupCallSnapshot {
  phase: GroupCallPhase;
  groupCallId: string | null;
  conversationId: string | null;
  kind: GroupCallKind;
  participants: GroupCallParticipant[];
  durationSeconds: number;
  muted: boolean;
  videoEnabled: boolean;
  error: string | null;
}

const IDLE_SNAPSHOT: GroupCallSnapshot = {
  phase: "idle",
  groupCallId: null,
  conversationId: null,
  kind: "AUDIO",
  participants: [],
  durationSeconds: 0,
  muted: false,
  videoEnabled: false,
  error: null,
};

/**
 * Appels de groupe — maillage direct WebRTC (jusqu'à 4-5 personnes, voir
 * GroupCallsGateway côté backend) : chaque participant JOINED maintient une
 * connexion RTCPeerConnection distincte vers chaque AUTRE participant
 * JOINED, jamais relayée par le serveur au-delà de la signalisation.
 *
 * Hook volontairement séparé de useCall (appel 1:1) plutôt qu'une
 * généralisation : la gestion d'UNE SEULE connexion (useCall) et celle de N
 * connexions simultanées (ici, une Map plutôt qu'une seule réf) sont assez
 * différentes pour qu'un hook unique complexifie les deux cas sans vrai
 * bénéfice. Vidéo : décidée une fois pour toutes à l'entrée dans l'appel
 * (`kind`), jamais de bascule caméra en cours d'appel comme useCall.toggleVideo
 * — éviterait une renégociation par pair à chaque bascule, hors périmètre de
 * cette première passe.
 */
export function useGroupCall(enabled: boolean, onCallMessage: (message: GroupCallMessagePayload) => void) {
  const [state, setState] = useState<GroupCallSnapshot>(IDLE_SNAPSHOT);
  const stateRef = useRef(state);
  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef(new Map<string, RTCPeerConnection>());
  const answeredAtRef = useRef<number | null>(null);
  const onCallMessageRef = useRef(onCallMessage);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [localVideoStream, setLocalVideoStream] = useState<MediaStream | null>(null);
  // Exposent ensurePeerConnection/connectToPeers (définies dans l'effet
  // socket ci-dessous) au reste du hook — même motif que useCall.
  const ensurePeerConnectionRef = useRef<(userId: string, iceServers: RTCIceServer[]) => RTCPeerConnection>(null!);
  const connectToPeersRef = useRef<(peerUserIds: string[]) => Promise<void>>(async () => {});

  useEffect(() => {
    onCallMessageRef.current = onCallMessage;
  }, [onCallMessage]);

  const update = useCallback((patch: Partial<GroupCallSnapshot>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    setState(stateRef.current);
  }, []);

  const closePeer = useCallback((userId: string) => {
    peerConnectionsRef.current.get(userId)?.close();
    peerConnectionsRef.current.delete(userId);
    setRemoteStreams((prev) => {
      if (!(userId in prev)) return prev;
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }, []);

  const cleanupMedia = useCallback(() => {
    for (const userId of [...peerConnectionsRef.current.keys()]) closePeer(userId);
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    answeredAtRef.current = null;
    setLocalVideoStream(null);
  }, [closePeer]);

  const reset = useCallback(() => {
    cleanupMedia();
    update(IDLE_SNAPSHOT);
  }, [cleanupMedia, update]);

  // Connexion socket dédiée ("/group-calls") — montée une seule fois tant
  // que `enabled`, même principe que useCall (voir son commentaire détaillé).
  useEffect(() => {
    if (!enabled) return;
    const token = getAccessToken();
    if (!token) return;

    const socket = io(`${WS_URL}/group-calls`, {
      auth: (cb) => cb({ token: getAccessToken() }),
      reconnection: true,
      transports: ["websocket"],
    });
    socketRef.current = socket;

    // Voir le commentaire détaillé équivalent dans socket.ts/use-call.ts :
    // un access token expiré se traduit par un `disconnect` côté client
    // ("io server disconnect"), jamais `connect_error` — Socket.IO
    // n'enclenche alors aucune reconnexion automatique de lui-même.
    socket.on("disconnect", (reason) => {
      if (reason !== "io server disconnect") return;
      void refreshSession().then((refreshed) => {
        if (refreshed) socket.connect();
        else handleUnauthorized();
      });
    });

    function ensurePeerConnection(userId: string, iceServers: RTCIceServer[]): RTCPeerConnection {
      const existing = peerConnectionsRef.current.get(userId);
      if (existing) return existing;
      const pc = new RTCPeerConnection({ iceServers });
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("group-call:ice-candidate", {
            groupCallId: stateRef.current.groupCallId,
            targetUserId: userId,
            data: event.candidate.toJSON(),
          });
        }
      };
      pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (!stream) return;
        setRemoteStreams((prev) => ({ ...prev, [userId]: stream }));
      };
      peerConnectionsRef.current.set(userId, pc);
      return pc;
    }

    /** Celui qui rejoint (ou qui vient d'inviter quelqu'un d'autre à le faire) initie toujours l'offre — voir le commentaire de convention dans GroupCallsGateway. */
    async function connectToPeers(peerUserIds: string[]) {
      const iceServers = await api.calls.iceServers().catch(() => []);
      const stream = localStreamRef.current;
      if (!stream) return;
      for (const userId of peerUserIds) {
        if (peerConnectionsRef.current.has(userId)) continue;
        const pc = ensurePeerConnection(userId, iceServers);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("group-call:offer", {
            groupCallId: stateRef.current.groupCallId,
            targetUserId: userId,
            data: offer,
          });
        } catch {
          closePeer(userId);
        }
      }
    }

    socket.on("group-call:incoming", (message: GroupCallMessagePayload) => {
      if (stateRef.current.phase !== "idle") return;
      update({
        phase: "ringing",
        groupCallId: message.groupCall.id,
        conversationId: message.conversationId,
        kind: message.groupCall.type,
        participants: message.groupCall.participants,
        error: null,
      });
      onCallMessageRef.current(message);
    });

    socket.on(
      "group-call:updated",
      (payload: { groupCallId: string; call: GroupCallDetail }) => {
        if (stateRef.current.groupCallId !== payload.groupCallId) return;
        update({ participants: payload.call.participants });
      },
    );

    socket.on(
      "group-call:participant-joined",
      (payload: { groupCallId: string; userId: string; call: GroupCallDetail }) => {
        if (stateRef.current.groupCallId !== payload.groupCallId) return;
        update({ participants: payload.call.participants });
      },
    );

    socket.on(
      "group-call:participant-declined",
      (payload: { groupCallId: string; userId: string; call: GroupCallDetail }) => {
        if (stateRef.current.groupCallId !== payload.groupCallId) return;
        update({ participants: payload.call.participants });
      },
    );

    socket.on(
      "group-call:participant-left",
      (payload: { groupCallId: string; userId: string; call: GroupCallDetail }) => {
        if (stateRef.current.groupCallId !== payload.groupCallId) return;
        closePeer(payload.userId);
        update({ participants: payload.call.participants });
        // Terminé côté serveur (voir GroupCallsService.leave, ≤1 JOINED
        // restant) : tout le monde raccroche, y compris si c'est nous qui
        // n'avons pas explicitement quitté (ex. dernier autre participant parti).
        if (payload.call.status === 'ENDED') {
          reset();
        }
      },
    );

    socket.on(
      "group-call:offer",
      (payload: { groupCallId: string; senderUserId: string; data: RTCSessionDescriptionInit }) => {
        if (stateRef.current.groupCallId !== payload.groupCallId || stateRef.current.phase !== "active") return;
        void (async () => {
          const iceServers = await api.calls.iceServers().catch(() => []);
          const pc = ensurePeerConnection(payload.senderUserId, iceServers);
          const stream = localStreamRef.current;
          await pc.setRemoteDescription(payload.data);
          if (stream && pc.getSenders().length === 0) {
            stream.getTracks().forEach((track) => pc.addTrack(track, stream));
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("group-call:answer", {
            groupCallId: payload.groupCallId,
            targetUserId: payload.senderUserId,
            data: answer,
          });
        })();
      },
    );

    socket.on(
      "group-call:answer",
      (payload: { groupCallId: string; senderUserId: string; data: RTCSessionDescriptionInit }) => {
        if (stateRef.current.groupCallId !== payload.groupCallId) return;
        const pc = peerConnectionsRef.current.get(payload.senderUserId);
        void pc?.setRemoteDescription(payload.data).catch(() => {});
      },
    );

    socket.on(
      "group-call:ice-candidate",
      (payload: { groupCallId: string; senderUserId: string; data: RTCIceCandidateInit }) => {
        if (stateRef.current.groupCallId !== payload.groupCallId) return;
        const pc = peerConnectionsRef.current.get(payload.senderUserId);
        void pc?.addIceCandidate(payload.data).catch(() => {});
      },
    );

    // Exposées au reste du hook via des réfs de fonction, même principe que useCall.
    ensurePeerConnectionRef.current = ensurePeerConnection;
    connectToPeersRef.current = connectToPeers;

    return () => {
      socket.close();
      socketRef.current = null;
      cleanupMedia();
      update(IDLE_SNAPSHOT);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- s'abonne une seule fois par montage (voir le commentaire détaillé équivalent dans useCall) ; cleanupMedia/closePeer/update/reset sont stables (useCallback).
  }, [enabled]);

  // Minuteur de durée, identique à useCall.
  useEffect(() => {
    if (state.phase !== "active" || !answeredAtRef.current) return;
    const start = answeredAtRef.current;
    const tick = setInterval(() => {
      update({ durationSeconds: Math.floor((Date.now() - start) / 1000) });
    }, 1000);
    return () => clearInterval(tick);
  }, [state.phase, update]);

  const acquireMedia = useCallback(async (kind: GroupCallKind) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === "VIDEO" });
    localStreamRef.current = stream;
    setLocalVideoStream(stream);
    return stream;
  }, []);

  const start = useCallback(
    async (conversationId: string, kind: GroupCallKind = "AUDIO") => {
      const socket = socketRef.current;
      if (!socket || stateRef.current.phase !== "idle") return;
      update({ error: null });
      try {
        await acquireMedia(kind);
      } catch {
        update({
          error:
            kind === "VIDEO"
              ? "Caméra/micro inaccessibles — vérifiez les autorisations du navigateur."
              : "Micro inaccessible — vérifiez les autorisations du navigateur.",
        });
        return;
      }

      const res = await ack(socket, "group-call:start", { conversationId, type: kind });
      if (!res.ok || !res.groupCallMessage) {
        cleanupMedia();
        update({ error: res.error ?? "Impossible de démarrer cet appel de groupe." });
        return;
      }
      answeredAtRef.current = Date.now();
      update({
        phase: "active",
        groupCallId: res.groupCallMessage.groupCall.id,
        conversationId,
        kind,
        participants: res.groupCallMessage.groupCall.participants,
        videoEnabled: kind === "VIDEO",
        durationSeconds: 0,
      });
      onCallMessageRef.current(res.groupCallMessage);
    },
    [acquireMedia, cleanupMedia, update],
  );

  /**
   * Entrée dans un appel de groupe né de la bascule d'un appel 1:1 (voir
   * useCall.escalate/onUpgradedToGroup, CallsService.escalateToGroup) —
   * jamais de sonnerie ici : les deux parties de l'appel 1:1 d'origine
   * passent JOINED d'emblée côté serveur (voir
   * GroupCallsService.startFromEscalation), on entre donc directement en
   * phase "active", comme si on avait déjà rejoint.
   *
   * Aucune des deux parties n'est "celle qui rejoint" au sens de la
   * convention habituelle du maillage (voir GroupCallsGateway) — les DEUX
   * appellent startFromUpgrade en même temps (l'une via l'ack de son propre
   * escalate(), l'autre via l'événement 'call:upgraded'). Départage
   * déterministe, calculable indépendamment des deux côtés sans aucune
   * coordination serveur : l'id utilisateur le plus petit (ordre
   * lexicographique) initie l'offre vers l'autre, qui se contente d'attendre
   * l'offre entrante (déjà géré par le handler 'group-call:offer' existant,
   * dès que phase === "active").
   */
  const startFromUpgrade = useCallback(
    async (message: GroupCallMessagePayload, myUserId: string) => {
      if (stateRef.current.phase !== "idle") return;
      const kind = message.groupCall.type;
      try {
        await acquireMedia(kind);
      } catch {
        update({
          error:
            kind === "VIDEO"
              ? "Caméra/micro inaccessibles — vérifiez les autorisations du navigateur."
              : "Micro inaccessible — vérifiez les autorisations du navigateur.",
        });
        return;
      }
      answeredAtRef.current = Date.now();
      update({
        phase: "active",
        groupCallId: message.groupCall.id,
        conversationId: message.conversationId,
        kind,
        participants: message.groupCall.participants,
        videoEnabled: kind === "VIDEO",
        durationSeconds: 0,
      });
      onCallMessageRef.current(message);

      const otherJoined = message.groupCall.participants
        .filter((p) => p.status === "JOINED" && p.userId !== myUserId)
        .map((p) => p.userId);
      if (otherJoined.length > 0 && myUserId < otherJoined[0]) {
        void connectToPeersRef.current(otherJoined);
      }
    },
    [acquireMedia, update],
  );

  const join = useCallback(async () => {
    const socket = socketRef.current;
    const { groupCallId, kind, phase } = stateRef.current;
    if (!socket || !groupCallId || (phase !== "ringing" && phase !== "idle")) return;
    try {
      await acquireMedia(kind);
    } catch {
      update({
        error:
          kind === "VIDEO"
            ? "Caméra/micro inaccessibles — vérifiez les autorisations du navigateur."
            : "Micro inaccessible — vérifiez les autorisations du navigateur.",
      });
      return;
    }

    const res = await ack(socket, "group-call:join", { groupCallId });
    if (!res.ok || !res.call) {
      cleanupMedia();
      update({ error: res.error ?? "Impossible de rejoindre cet appel de groupe." });
      reset();
      return;
    }
    answeredAtRef.current = Date.now();
    update({
      phase: "active",
      participants: res.call.participants,
      videoEnabled: kind === "VIDEO",
      durationSeconds: 0,
    });
    if (res.peerUserIds && res.peerUserIds.length > 0) void connectToPeersRef.current(res.peerUserIds);
  }, [acquireMedia, cleanupMedia, reset, update]);

  /**
   * Rejoint un appel de groupe déjà affiché dans le fil (bulle "Appel de
   * groupe en cours") sans être passé par une sonnerie — même chemin que
   * join() une fois `groupCallId`/`kind` connus, voir MessageBubble.
   */
  const joinById = useCallback(
    async (groupCallId: string, conversationId: string, kind: GroupCallKind) => {
      if (stateRef.current.phase !== "idle") return;
      update({ groupCallId, conversationId, kind });
      await join();
    },
    [join, update],
  );

  const decline = useCallback(async () => {
    const socket = socketRef.current;
    const { groupCallId } = stateRef.current;
    if (!socket || !groupCallId) return;
    await ack(socket, "group-call:decline", { groupCallId });
    reset();
  }, [reset]);

  const leave = useCallback(async () => {
    const socket = socketRef.current;
    const { groupCallId } = stateRef.current;
    if (!socket || !groupCallId) return;
    await ack(socket, "group-call:leave", { groupCallId });
    reset();
  }, [reset]);

  const inviteMore = useCallback(async (userIds: string[]) => {
    const socket = socketRef.current;
    const { groupCallId } = stateRef.current;
    if (!socket || !groupCallId || userIds.length === 0) return;
    const res = await ack(socket, "group-call:invite", { groupCallId, userIds });
    if (res.ok && res.groupCallMessage) update({ participants: res.groupCallMessage.groupCall.participants });
  }, [update]);

  const toggleMute = useCallback(() => {
    const tracks = localStreamRef.current?.getAudioTracks() ?? [];
    const nextMuted = !stateRef.current.muted;
    tracks.forEach((track) => {
      track.enabled = !nextMuted;
    });
    update({ muted: nextMuted });
  }, [update]);

  useRingTone(state.phase === "ringing", "ringtone");

  return {
    phase: state.phase,
    groupCallId: state.groupCallId,
    conversationId: state.conversationId,
    kind: state.kind,
    participants: state.participants,
    durationSeconds: state.durationSeconds,
    muted: state.muted,
    videoEnabled: state.videoEnabled,
    error: state.error,
    remoteStreams,
    localVideoStream,
    start,
    startFromUpgrade,
    join,
    joinById,
    decline,
    leave,
    inviteMore,
    toggleMute,
  };
}
