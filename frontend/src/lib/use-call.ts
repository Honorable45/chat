"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api } from "./api";
import { getAccessToken } from "./token-store";
import type { CallMessagePayload } from "./types";
import { useRingTone } from "./use-ring-tone";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4000";

export type CallPhase = "idle" | "outgoing" | "incoming" | "active" | "ended";
export type CallKind = "AUDIO" | "VIDEO";

interface CallSnapshot {
  phase: CallPhase;
  conversationId: string | null;
  callId: string | null;
  otherUserId: string | null;
  /** Type demandé par l'appelant à l'invitation — voir Call.type côté backend. */
  kind: CallKind;
  durationSeconds: number;
  muted: boolean;
  videoEnabled: boolean;
  /**
   * Le flux local (micro/caméra), exposé comme état React plutôt que
   * seulement `localStreamRef` — l'aperçu `<video>` local n'est monté par
   * CallOverlay que sous condition (`phase`/`videoEnabled`), donc sa réf
   * n'existe pas encore au moment où start()/accept()/toggleVideo()
   * capturent le flux. Le réattacher depuis un effet déclenché par ce
   * changement d'état (voir plus bas) garantit que l'élément existe déjà
   * (React committe le DOM avant d'exécuter les effets) — corrige le bug
   * "je ne me vois pas" constaté en conditions réelles.
   */
  localStream: MediaStream | null;
  /** Simple supposition tant qu'aucun événement "call:video-state" n'a été
   * reçu — voir la note dans toggleVideo() sur pourquoi cet état n'est pas
   * déduit des pistes WebRTC elles-mêmes. */
  remoteVideoEnabled: boolean;
  /** Message bref affiché en phase "ended" ("Appel refusé.", "Appel manqué."...) — jamais une vraie erreur bloquante. */
  error: string | null;
}

const IDLE_SNAPSHOT: CallSnapshot = {
  phase: "idle",
  conversationId: null,
  callId: null,
  otherUserId: null,
  kind: "AUDIO",
  durationSeconds: 0,
  muted: false,
  videoEnabled: false,
  localStream: null,
  remoteVideoEnabled: false,
  error: null,
};

interface AckResult {
  ok: boolean;
  error?: string;
  busy?: boolean;
  callMessage?: CallMessagePayload;
}

function ack(socket: Socket, event: string, payload: unknown): Promise<AckResult> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

/**
 * Appels audio/vidéo WebRTC — une seule instance montée au niveau de la page
 * de chat (jamais par conversation) : un appel entrant doit pouvoir sonner
 * quelle que soit la conversation actuellement ouverte. Toute la
 * signalisation passe par le namespace WebSocket dédié "/calls" (voir
 * CallsGateway côté backend) ; le flux audio/vidéo lui-même est pair-à-pair
 * une fois la connexion WebRTC établie — jamais relayé par le serveur.
 *
 * La vidéo est activable/désactivable à tout moment pendant l'appel
 * (`toggleVideo`), indépendamment du type choisi à l'invitation : la
 * première activation ajoute une piste vidéo à la connexion existante
 * (renégociation WebRTC — voir `pc.onnegotiationneeded`, attaché seulement
 * après l'établissement initial pour ne jamais entrer en conflit avec l'offre
 * manuelle de connexion), les suivantes ne font que couper/rétablir la piste
 * déjà là (même principe que toggleMute).
 *
 * `onCallMessage` est appelé à chaque changement d'état persistant côté
 * serveur (invitation, acceptation, refus, fin...) avec le CallMessageDto
 * authoritative — à charge de l'appelant (chat/page.tsx) de mettre à jour le
 * fil de la conversation concernée et sa prévisualisation dans la liste.
 */
export function useCall(enabled: boolean, onCallMessage: (message: CallMessagePayload) => void) {
  const [state, setState] = useState<CallSnapshot>(IDLE_SNAPSHOT);
  const stateRef = useRef(state);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const answeredAtRef = useRef<number | null>(null);
  const onCallMessageRef = useRef(onCallMessage);
  const ensurePeerConnectionRef = useRef<(iceServers: RTCIceServer[]) => RTCPeerConnection>(null!);
  const renegotiateRef = useRef<() => void>(() => {});

  // Toujours la dernière callback fournie par l'appelant, jamais lue
  // pendant le rendu (react-hooks/refs) — seulement depuis les handlers
  // socket enregistrés une fois pour toute la durée de vie du composant.
  useEffect(() => {
    onCallMessageRef.current = onCallMessage;
  }, [onCallMessage]);

  const update = useCallback((patch: Partial<CallSnapshot>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    setState(stateRef.current);
  }, []);

  const cleanupMedia = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    answeredAtRef.current = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
  }, []);

  const reset = useCallback(() => {
    cleanupMedia();
    update(IDLE_SNAPSHOT);
  }, [cleanupMedia, update]);

  /** Termine avec un bref message informatif (déclenché par l'AUTRE partie, jamais par notre propre raccroché — voir hangUp). */
  const endWithFeedback = useCallback(
    (message: string) => {
      cleanupMedia();
      update({ phase: "ended", error: message });
      setTimeout(() => {
        if (stateRef.current.phase === "ended") reset();
      }, 2500);
    },
    [cleanupMedia, reset, update],
  );

  // Connexion socket dédiée ("/calls") — montée une seule fois tant que
  // `enabled`, jamais réabonnée en cours de route (les handlers ci-dessous
  // lisent toujours l'état le plus frais via stateRef/pcRef, jamais de
  // fermeture périmée malgré cet enregistrement unique).
  useEffect(() => {
    if (!enabled) return;
    const token = getAccessToken();
    if (!token) return;

    const socket = io(`${WS_URL}/calls`, {
      auth: { token },
      reconnection: true,
      transports: ["websocket"],
    });
    socketRef.current = socket;

    function ensurePeerConnection(iceServers: RTCIceServer[]): RTCPeerConnection {
      if (pcRef.current) return pcRef.current;
      const pc = new RTCPeerConnection({ iceServers });
      pc.onicecandidate = (event) => {
        if (event.candidate && stateRef.current.callId) {
          socket.emit("call:ice-candidate", {
            callId: stateRef.current.callId,
            data: event.candidate.toJSON(),
          });
        }
      };
      pc.ontrack = (event) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0] ?? null;
          void remoteVideoRef.current.play().catch(() => {});
        }
      };
      pcRef.current = pc;
      return pc;
    }

    // N'est attaché qu'APRÈS l'échange initial d'offre/réponse (voir les
    // deux handlers ci-dessous) : une piste ajoutée pendant start()/accept()
    // déclenche aussi "negotiationneeded", mais cette toute première
    // négociation est déjà gérée manuellement — l'attacher trop tôt
    // provoquerait une double offre concurrente pour la connexion initiale.
    function armRenegotiation(pc: RTCPeerConnection) {
      pc.onnegotiationneeded = () => renegotiateRef.current();
    }
    renegotiateRef.current = () => {
      const pc = pcRef.current;
      const callId = stateRef.current.callId;
      if (!pc || !callId) return;
      void (async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("call:offer", { callId, data: offer });
        } catch {
          // Best-effort : une renégociation manquée n'interrompt pas l'appel en cours, juste la mise à jour vidéo.
        }
      })();
    };

    socket.on("call:incoming", (message: CallMessagePayload) => {
      // Un appel déjà en cours ailleurs (autre onglet...) : le serveur a de
      // toute façon déjà répondu `busy` à l'appelant — on ignore ici plutôt
      // que d'interrompre quoi que ce soit localement.
      if (stateRef.current.phase !== "idle") return;
      update({
        phase: "incoming",
        conversationId: message.conversationId,
        callId: message.call.id,
        otherUserId: message.call.callerId,
        kind: message.call.type,
        error: null,
      });
      onCallMessageRef.current(message);
    });

    socket.on("call:accepted", (message: CallMessagePayload) => {
      if (stateRef.current.callId !== message.call.id || !pcRef.current) return;
      void (async () => {
        try {
          const pc = pcRef.current!;
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("call:offer", { callId: message.call.id, data: offer });
          armRenegotiation(pc);
          answeredAtRef.current = Date.now();
          update({ phase: "active", durationSeconds: 0, remoteVideoEnabled: stateRef.current.kind === "VIDEO" });
          onCallMessageRef.current(message);
        } catch {
          update({ error: "La connexion a échoué." });
          void ack(socket, "call:end", { callId: message.call.id });
          reset();
        }
      })();
    });

    socket.on("call:offer", (payload: { callId: string; data: RTCSessionDescriptionInit }) => {
      if (stateRef.current.callId !== payload.callId || !pcRef.current) return;
      void (async () => {
        const pc = pcRef.current!;
        await pc.setRemoteDescription(payload.data);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("call:answer", { callId: payload.callId, data: answer });
        // Idempotent (voir armRenegotiation) : reçu aussi bien pour l'offre
        // initiale (côté appelé) que pour une renégociation ultérieure
        // (activation vidéo par l'appelant) — pas besoin de distinguer les deux ici.
        armRenegotiation(pc);
      })();
    });

    socket.on("call:answer", (payload: { callId: string; data: RTCSessionDescriptionInit }) => {
      if (stateRef.current.callId !== payload.callId || !pcRef.current) return;
      void pcRef.current.setRemoteDescription(payload.data).catch(() => {});
    });

    socket.on("call:ice-candidate", (payload: { callId: string; data: RTCIceCandidateInit }) => {
      if (stateRef.current.callId !== payload.callId || !pcRef.current) return;
      void pcRef.current.addIceCandidate(payload.data).catch(() => {});
    });

    // L'autre participant a activé/coupé sa caméra — jamais déduit des
    // pistes WebRTC elles-mêmes (un `track.enabled = false` distant n'est
    // pas observable côté récepteur), donc signalé explicitement.
    socket.on("call:video-state", (payload: { callId: string; data: { enabled: boolean } }) => {
      if (stateRef.current.callId !== payload.callId) return;
      update({ remoteVideoEnabled: payload.data.enabled });
    });

    socket.on("call:rejected", (message: CallMessagePayload) => {
      if (stateRef.current.callId !== message.call.id) return;
      onCallMessageRef.current(message);
      endWithFeedback("Appel refusé.");
    });

    socket.on("call:cancelled", (message: CallMessagePayload) => {
      if (stateRef.current.callId !== message.call.id) return;
      const wasIncoming = stateRef.current.phase === "incoming";
      onCallMessageRef.current(message);
      endWithFeedback(wasIncoming ? "Appel manqué." : "Appel annulé.");
    });

    socket.on("call:ended", (message: CallMessagePayload) => {
      if (stateRef.current.callId !== message.call.id) return;
      onCallMessageRef.current(message);
      endWithFeedback("Appel terminé.");
    });

    // Un appel entrant sonne sur tous nos appareils connectés à la fois —
    // reçu uniquement par ceux qui n'ont PAS accepté/refusé eux-mêmes (voir
    // CallsGateway.handleAccept/handleReject, `client.to(...)` exclut déjà
    // l'émetteur) : cesse de sonner ici, avec un message distinct plutôt que
    // "Appel refusé"/"Appel manqué" qui laisseraient penser à une vraie
    // erreur (section 21-22, synchronisation multi-appareils).
    socket.on("call:resolved-elsewhere", (message: CallMessagePayload) => {
      if (stateRef.current.callId !== message.call.id || stateRef.current.phase !== "incoming") return;
      onCallMessageRef.current(message);
      endWithFeedback(
        message.call.status === "ACTIVE" ? "Répondu sur un autre appareil." : "Refusé sur un autre appareil.",
      );
    });

    // Expose ensurePeerConnection au reste du hook via une réf de fonction :
    // évite de dupliquer la création du RTCPeerConnection dans start()/accept().
    ensurePeerConnectionRef.current = ensurePeerConnection;

    return () => {
      socket.close();
      socketRef.current = null;
      cleanupMedia();
      update(IDLE_SNAPSHOT);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- s'abonne une seule fois par montage (voir commentaire ci-dessus) ; endWithFeedback/cleanupMedia/update sont stables (useCallback).
  }, [enabled]);

  // Rattache le flux local à l'élément vidéo dès qu'il existe — voir le
  // commentaire sur `localStream` dans CallSnapshot. `phase`/`videoEnabled`
  // sont inclus en dépendances car c'est justement leur changement qui fait
  // apparaître/disparaître l'élément `<video>` dans CallOverlay ; l'effet
  // doit alors se redéclencher pour retrouver une réf enfin non nulle.
  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = state.localStream;
    }
  }, [state.localStream, state.phase, state.videoEnabled]);

  // Minuteur de durée — dépend volontairement de l'état React (pas de la
  // réf) : c'est le seul endroit où l'on veut vraiment se réabonner à chaque
  // changement de phase.
  useEffect(() => {
    if (state.phase !== "active" || !answeredAtRef.current) return;
    const start = answeredAtRef.current;
    const tick = setInterval(() => {
      update({ durationSeconds: Math.floor((Date.now() - start) / 1000) });
    }, 1000);
    return () => clearInterval(tick);
  }, [state.phase, update]);

  const start = useCallback(
    async (conversationId: string, calleeId: string, kind: CallKind = "AUDIO") => {
      const socket = socketRef.current;
      if (!socket || stateRef.current.phase !== "idle") return;
      update({ error: null });

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === "VIDEO" });
      } catch {
        update({
          error:
            kind === "VIDEO"
              ? "Caméra/micro inaccessibles — vérifiez les autorisations du navigateur."
              : "Micro inaccessible — vérifiez les autorisations du navigateur.",
        });
        return;
      }
      localStreamRef.current = stream;

      const iceServers = await api.calls.iceServers().catch(() => []);
      const pc = ensurePeerConnectionRef.current(iceServers);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const res = await ack(socket, "call:invite", { conversationId, calleeId, type: kind });
      if (!res.ok) {
        cleanupMedia();
        update({ error: res.error ?? "Impossible de démarrer cet appel." });
        return;
      }
      if (res.busy) {
        cleanupMedia();
        endWithFeedback("Occupé.");
        return;
      }
      const message = res.callMessage!;
      update({
        phase: "outgoing",
        conversationId,
        callId: message.call.id,
        otherUserId: calleeId,
        kind,
        videoEnabled: kind === "VIDEO",
        localStream: stream,
      });
      onCallMessageRef.current(message);
    },
    [cleanupMedia, endWithFeedback, update],
  );

  const accept = useCallback(async () => {
    const socket = socketRef.current;
    const { callId, kind } = stateRef.current;
    if (!socket || !callId || stateRef.current.phase !== "incoming") return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === "VIDEO" });
    } catch {
      update({
        error:
          kind === "VIDEO"
            ? "Caméra/micro inaccessibles — vérifiez les autorisations du navigateur."
            : "Micro inaccessible — vérifiez les autorisations du navigateur.",
      });
      await ack(socket, "call:reject", { callId });
      reset();
      return;
    }
    localStreamRef.current = stream;

    const iceServers = await api.calls.iceServers().catch(() => []);
    const pc = ensurePeerConnectionRef.current(iceServers);
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    const res = await ack(socket, "call:accept", { callId });
    if (!res.ok) {
      cleanupMedia();
      update({ error: res.error ?? "Impossible de répondre à cet appel." });
      reset();
      return;
    }
    answeredAtRef.current = Date.now();
    update({
      phase: "active",
      durationSeconds: 0,
      videoEnabled: kind === "VIDEO",
      remoteVideoEnabled: kind === "VIDEO",
      localStream: stream,
    });
    if (res.callMessage) onCallMessageRef.current(res.callMessage);
  }, [cleanupMedia, reset, update]);

  const reject = useCallback(async () => {
    const socket = socketRef.current;
    const { callId } = stateRef.current;
    if (!socket || !callId || stateRef.current.phase !== "incoming") return;
    const res = await ack(socket, "call:reject", { callId });
    if (res.callMessage) onCallMessageRef.current(res.callMessage);
    reset();
  }, [reset]);

  const hangUp = useCallback(async () => {
    const socket = socketRef.current;
    const { callId, phase } = stateRef.current;
    if (!socket || !callId) return;
    const event = phase === "active" ? "call:end" : "call:cancel";
    const res = await ack(socket, event, { callId });
    if (res.callMessage) onCallMessageRef.current(res.callMessage);
    reset();
  }, [reset]);

  const toggleMute = useCallback(() => {
    const tracks = localStreamRef.current?.getAudioTracks() ?? [];
    const nextMuted = !stateRef.current.muted;
    tracks.forEach((track) => {
      track.enabled = !nextMuted;
    });
    update({ muted: nextMuted });
  }, [update]);

  /**
   * Active/coupe sa propre caméra en cours d'appel. La toute première
   * activation demande l'accès caméra et ajoute une piste à la connexion
   * (déclenche une renégociation automatique — voir `armRenegotiation`
   * ci-dessus) ; les suivantes coupent/rétablissent simplement la piste déjà
   * acquise (`track.enabled`), sans nouvelle renégociation — même principe
   * que toggleMute. L'état est explicitement signalé à l'autre participant
   * (`call:video-state`) : un `track.enabled = false` distant n'est pas
   * observable côté récepteur par les seules API WebRTC.
   */
  // Deux sonneries distinctes (section 5-13 du cahier des charges) : le
  // "ringback" pendant que NOUS attendons que l'autre décroche, la
  // "ringtone" pendant qu'un appel entrant sonne chez NOUS — jamais les
  // deux en même temps, `phase` ne peut valoir qu'une chose à la fois.
  useRingTone(state.phase === "outgoing", "ringback");
  useRingTone(state.phase === "incoming", "ringtone");

  const toggleVideo = useCallback(async () => {
    const socket = socketRef.current;
    const pc = pcRef.current;
    const callId = stateRef.current.callId;
    if (!socket || !pc || !callId) return;

    const existingTrack = localStreamRef.current?.getVideoTracks()[0];
    if (existingTrack) {
      const nextEnabled = !existingTrack.enabled;
      existingTrack.enabled = nextEnabled;
      update({ videoEnabled: nextEnabled });
      socket.emit("call:video-state", { callId, data: { enabled: nextEnabled } });
      return;
    }

    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const track = camStream.getVideoTracks()[0];
      if (!localStreamRef.current) {
        localStreamRef.current = camStream;
      } else {
        localStreamRef.current.addTrack(track);
      }
      pc.addTrack(track, localStreamRef.current);
      update({ videoEnabled: true, localStream: localStreamRef.current });
      socket.emit("call:video-state", { callId, data: { enabled: true } });
    } catch {
      update({ error: "Caméra inaccessible — vérifiez les autorisations du navigateur." });
    }
  }, [update]);

  return {
    phase: state.phase,
    conversationId: state.conversationId,
    otherUserId: state.otherUserId,
    kind: state.kind,
    durationSeconds: state.durationSeconds,
    muted: state.muted,
    videoEnabled: state.videoEnabled,
    remoteVideoEnabled: state.remoteVideoEnabled,
    error: state.error,
    remoteVideoRef,
    localVideoRef,
    start,
    accept,
    reject,
    hangUp,
    toggleMute,
    toggleVideo,
  };
}
