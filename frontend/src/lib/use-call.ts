"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api, handleUnauthorized, refreshSession } from "./api";
import { getAccessToken } from "./token-store";
import type { CallMessagePayload, GroupCallMessagePayload } from "./types";
import { useRingTone } from "./use-ring-tone";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4000";

export type CallPhase = "idle" | "outgoing" | "incoming" | "active" | "ended";
export type CallKind = "AUDIO" | "VIDEO";

/** Une réplique traduite pendant l'appel — voir CallsGateway.handleSpeechChunk. */
export interface CallSubtitle {
  seq: number;
  /** Vrai si c'est MOI qui ai parlé (sous-titre de confirmation de ma propre phrase). */
  mine: boolean;
  original: string;
  translated: string;
  sourceLanguage: string;
  targetLanguage: string;
}

// Fenêtre d'un fragment de voix envoyé pour traduction (~5 s) : compromis
// entre latence (plus court = plus réactif) et qualité de transcription
// (trop court = phrases coupées).
const SPEECH_CHUNK_MS = 5000;
// Volume du flux WebRTC d'origine quand une traduction est active : assez bas
// pour laisser la voix traduite au premier plan, pas coupé (repli si la
// traduction d'un fragment échoue).
const DUCKED_REMOTE_VOLUME = 0.12;
const MAX_SUBTITLES = 4;

function pickAudioMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? "";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("lecture du fragment audio impossible"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Capture la voix locale par fragments complets et indépendants (~5 s) — un
 * MediaRecorder recyclé à chaque tour plutôt qu'un seul en continu : un
 * segment WebM/Opus produit « au fil de l'eau » n'est pas décodable seul,
 * alors que la transcription (STT) a besoin d'un conteneur valide par requête.
 * Best-effort de bout en bout : si MediaRecorder n'est pas disponible ou
 * refuse le format, la capture s'arrête sans bruit (l'appel continue).
 */
class CallSpeechCapture {
  private stopped = false;
  private recorder: MediaRecorder | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly stream: MediaStream,
    private readonly onChunk: (blob: Blob) => void,
  ) {}

  start(): void {
    this.cycle();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {
        // déjà arrêté
      }
    }
    this.recorder = null;
  }

  private cycle(): void {
    if (this.stopped) return;
    const tracks = this.stream.getAudioTracks();
    if (tracks.length === 0) {
      this.timer = setTimeout(() => this.cycle(), SPEECH_CHUNK_MS);
      return;
    }

    let recorder: MediaRecorder;
    try {
      const mime = pickAudioMime();
      recorder = new MediaRecorder(
        new MediaStream(tracks),
        mime ? { mimeType: mime } : undefined,
      );
    } catch {
      this.stopped = true;
      return;
    }
    this.recorder = recorder;

    const parts: BlobPart[] = [];
    recorder.addEventListener("dataavailable", (e) => {
      if (e.data.size > 0) parts.push(e.data);
    });
    recorder.addEventListener("stop", () => {
      if (!this.stopped && parts.length > 0) {
        this.onChunk(new Blob(parts, { type: recorder.mimeType || "audio/webm" }));
      }
      if (!this.stopped) this.cycle();
    });

    recorder.start();
    this.timer = setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, SPEECH_CHUNK_MS);
  }
}

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
  /** Langue d'envoi (profil) de l'interlocuteur — défaut du sélecteur « recevoir en… ». */
  otherPartyLanguage: string | null;
  /** Langue dans laquelle JE veux entendre l'interlocuteur (`null` = aucune traduction). */
  receiveLanguage: string | null;
  /** Langue de réception choisie par l'INTERLOCUTEUR — quand elle est posée, ma voix est capturée et envoyée pour traduction. */
  remoteReceiveLanguage: string | null;
  /** Dernières répliques traduites de l'appel (voix + texte). */
  subtitles: CallSubtitle[];
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
  otherPartyLanguage: null,
  receiveLanguage: null,
  remoteReceiveLanguage: null,
  subtitles: [],
  error: null,
};

interface AckResult {
  ok: boolean;
  error?: string;
  busy?: boolean;
  callMessage?: CallMessagePayload;
  groupCallMessage?: GroupCallMessagePayload;
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
export function useCall(
  enabled: boolean,
  onCallMessage: (message: CallMessagePayload) => void,
  /**
   * Appelé quand CE 1:1 a été basculé en appel de groupe par l'AUTRE partie
   * (voir escalate() ci-dessous pour le cas où c'est nous qui l'avons
   * demandé — l'ack suffit alors, jamais besoin de cet événement pour
   * nous-même) — reçu via 'call:upgraded' sur le namespace "/calls". À
   * charge de l'appelant (chat/page.tsx) d'enchaîner avec
   * useGroupCall.startFromUpgrade.
   */
  onUpgradedToGroup?: (message: GroupCallMessagePayload) => void,
) {
  const [state, setState] = useState<CallSnapshot>(IDLE_SNAPSHOT);
  const stateRef = useRef(state);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const answeredAtRef = useRef<number | null>(null);
  const onCallMessageRef = useRef(onCallMessage);
  const onUpgradedToGroupRef = useRef(onUpgradedToGroup);
  const ensurePeerConnectionRef = useRef<(iceServers: RTCIceServer[]) => RTCPeerConnection>(null!);
  const renegotiateRef = useRef<() => void>(() => {});
  // Traduction d'appel : capture de la voix locale, lecture en file des
  // répliques traduites reçues, numéro de séquence des fragments envoyés.
  const speechCaptureRef = useRef<CallSpeechCapture | null>(null);
  const translatedQueueRef = useRef<HTMLAudioElement[]>([]);
  const translatedPlayingRef = useRef(false);
  const chunkSeqRef = useRef(0);
  const duckHoldRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Atténue le flux WebRTC d'origine UNIQUEMENT pendant qu'une voix traduite
   * joue (court maintien à la fin) — jamais en permanence : si la synthèse
   * vocale est indisponible (aucun `audio` reçu, ex. plan ElevenLabs
   * gratuit), l'utilisateur garde l'audio d'origine à plein volume + les
   * sous-titres, plutôt qu'un son quasi inaudible sans rien pour le remplacer.
   */
  function setRemoteDucked(ducked: boolean): void {
    if (duckHoldRef.current) {
      clearTimeout(duckHoldRef.current);
      duckHoldRef.current = null;
    }
    const el = remoteVideoRef.current;
    if (!el) return;
    if (ducked) {
      el.volume = DUCKED_REMOTE_VOLUME;
    } else {
      duckHoldRef.current = setTimeout(() => {
        if (remoteVideoRef.current) remoteVideoRef.current.volume = 1;
      }, 600);
    }
  }

  const stopTranslationMedia = useCallback(() => {
    speechCaptureRef.current?.stop();
    speechCaptureRef.current = null;
    translatedQueueRef.current.forEach((audio) => audio.pause());
    translatedQueueRef.current = [];
    translatedPlayingRef.current = false;
    chunkSeqRef.current = 0;
    if (duckHoldRef.current) clearTimeout(duckHoldRef.current);
    duckHoldRef.current = null;
    if (remoteVideoRef.current) remoteVideoRef.current.volume = 1;
  }, []);

  // Fonctions simples (jamais des hooks, pas d'auto-référence dans un
  // useCallback) : ne lisent/écrivent que des refs et le DOM, la fermeture
  // capturée une fois par l'effet socket reste donc toujours valide.
  function drainTranslatedQueue(): void {
    const audio = translatedQueueRef.current.shift();
    if (!audio) {
      translatedPlayingRef.current = false;
      setRemoteDucked(false);
      return;
    }
    translatedPlayingRef.current = true;
    setRemoteDucked(true);
    audio.addEventListener("ended", drainTranslatedQueue, { once: true });
    audio.addEventListener("error", drainTranslatedQueue, { once: true });
    void audio.play().catch(() => drainTranslatedQueue());
  }

  // Toujours la dernière callback fournie par l'appelant, jamais lue
  // pendant le rendu (react-hooks/refs) — seulement depuis les handlers
  // socket enregistrés une fois pour toute la durée de vie du composant.
  useEffect(() => {
    onCallMessageRef.current = onCallMessage;
  }, [onCallMessage]);
  useEffect(() => {
    onUpgradedToGroupRef.current = onUpgradedToGroup;
  }, [onUpgradedToGroup]);

  const update = useCallback((patch: Partial<CallSnapshot>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    setState(stateRef.current);
  }, []);

  const cleanupMedia = useCallback(() => {
    stopTranslationMedia();
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    answeredAtRef.current = null;
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
      remoteVideoRef.current.volume = 1;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
  }, [stopTranslationMedia]);

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
      // Fonction (jamais un objet figé) — voir le commentaire équivalent
      // dans socket.ts : une reconnexion automatique après expiration de
      // l'access token doit repartir avec le token le plus frais, pas celui
      // capturé au montage.
      auth: (cb) => cb({ token: getAccessToken() }),
      reconnection: true,
      transports: ["websocket"],
    });
    socketRef.current = socket;

    // Voir le commentaire équivalent (et plus détaillé) dans socket.ts : un
    // access token expiré se traduit par un `disconnect` côté client, raison
    // "io server disconnect" — jamais `connect_error` — pour laquelle
    // Socket.IO n'enclenche pas de reconnexion automatique. Sans ce handler,
    // un appel entrant ne sonnerait plus du tout après expiration du token
    // (15 min), jusqu'au prochain rechargement complet de la page.
    socket.on("disconnect", (reason) => {
      if (reason !== "io server disconnect") return;
      void refreshSession().then((refreshed) => {
        if (refreshed) socket.connect();
        else handleUnauthorized();
      });
    });

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
        // Langue d'envoi de l'appelant — défaut du sélecteur « recevoir en… ».
        otherPartyLanguage: message.call.callerLanguage ?? null,
        receiveLanguage: null,
        remoteReceiveLanguage: null,
        subtitles: [],
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
          update({
            phase: "active",
            durationSeconds: 0,
            remoteVideoEnabled: stateRef.current.kind === "VIDEO",
            // Langue d'envoi de l'appelé — défaut du sélecteur côté appelant.
            otherPartyLanguage: message.call.calleeLanguage ?? stateRef.current.otherPartyLanguage,
          });
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

    // L'interlocuteur a choisi/retiré une langue de réception : quand elle
    // est posée, il faut capturer ma voix et l'envoyer pour traduction (voir
    // l'effet de capture plus bas).
    socket.on(
      "call:language-changed",
      (payload: { callId: string; userId: string; language: string | null }) => {
        if (stateRef.current.callId !== payload.callId) return;
        if (payload.userId === stateRef.current.otherUserId) {
          update({ remoteReceiveLanguage: payload.language });
        }
      },
    );

    // Réplique traduite de l'interlocuteur : on lit la voix synthétisée (si
    // fournie) — le flux d'origine est atténué le temps de la lecture (voir drainTranslatedQueue).
    socket.on(
      "call:translated-speech",
      (payload: { callId: string; seq: number; text: string; audio: string | null; mimeType: string | null }) => {
        if (stateRef.current.callId !== payload.callId || !payload.audio) return;
        const audio = new Audio(`data:${payload.mimeType ?? "audio/mpeg"};base64,${payload.audio}`);
        translatedQueueRef.current.push(audio);
        if (!translatedPlayingRef.current) drainTranslatedQueue();
      },
    );

    // Sous-titres (les deux sens) — `speakerId` dit si c'est ma phrase
    // (confirmation) ou celle de l'interlocuteur (traduction).
    socket.on(
      "call:subtitle",
      (payload: {
        callId: string;
        seq: number;
        speakerId: string;
        original: string;
        translated: string;
        sourceLanguage: string;
        targetLanguage: string;
      }) => {
        if (stateRef.current.callId !== payload.callId) return;
        const line: CallSubtitle = {
          seq: payload.seq,
          mine: payload.speakerId !== stateRef.current.otherUserId,
          original: payload.original,
          translated: payload.translated,
          sourceLanguage: payload.sourceLanguage,
          targetLanguage: payload.targetLanguage,
        };
        update({
          subtitles: [...stateRef.current.subtitles, line].slice(-MAX_SUBTITLES),
        });
      },
    );

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

    // L'AUTRE partie de notre appel 1:1 vient d'inviter une troisième
    // personne (voir CallsGateway.handleEscalate) — jamais un vrai
    // raccroché : on se tait silencieusement (aucun message "Appel
    // terminé.", contrairement à endWithFeedback) et on laisse
    // chat/page.tsx enchaîner avec useGroupCall.startFromUpgrade.
    socket.on(
      "call:upgraded",
      (payload: { endedCallId: string; groupCallMessage: GroupCallMessagePayload }) => {
        if (stateRef.current.callId !== payload.endedCallId) return;
        cleanupMedia();
        update(IDLE_SNAPSHOT);
        onUpgradedToGroupRef.current?.(payload.groupCallMessage);
      },
    );

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

  // Capture de la voix locale par fragments, uniquement quand l'appel est
  // actif ET que l'interlocuteur a choisi une langue de réception (sinon rien
  // à traduire — on n'envoie aucun fragment inutilement). Chaque fragment
  // complet part en base64 vers "call:speech-chunk".
  useEffect(() => {
    const shouldCapture =
      state.phase === "active" && !!state.remoteReceiveLanguage && !!localStreamRef.current;

    if (shouldCapture && !speechCaptureRef.current) {
      const capture = new CallSpeechCapture(localStreamRef.current!, (blob) => {
        const socket = socketRef.current;
        const callId = stateRef.current.callId;
        if (!socket || !callId) return;
        void blobToBase64(blob)
          .then((audio) => {
            chunkSeqRef.current += 1;
            socket.emit("call:speech-chunk", {
              callId,
              audio,
              mimeType: blob.type || "audio/webm",
              seq: chunkSeqRef.current,
            });
          })
          .catch(() => {});
      });
      capture.start();
      speechCaptureRef.current = capture;
    } else if (!shouldCapture && speechCaptureRef.current) {
      speechCaptureRef.current.stop();
      speechCaptureRef.current = null;
    }
  }, [state.phase, state.remoteReceiveLanguage]);

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

  const accept = useCallback(async (receiveLanguage?: string | null) => {
    const socket = socketRef.current;
    const { callId, kind } = stateRef.current;
    if (!socket || !callId || stateRef.current.phase !== "incoming") return;
    // Aucune traduction si la langue de réception choisie est déjà la langue
    // d'envoi de l'interlocuteur (le défaut du sélecteur) — voir CallOverlay.
    const wantsTranslation =
      !!receiveLanguage && receiveLanguage !== stateRef.current.otherPartyLanguage;
    const chosenLanguage = wantsTranslation ? receiveLanguage : null;

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

    const res = await ack(socket, "call:accept", { callId, receiveLanguage: chosenLanguage });
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
      receiveLanguage: chosenLanguage,
    });
    if (res.callMessage) onCallMessageRef.current(res.callMessage);
  }, [cleanupMedia, reset, update]);

  /**
   * Reprend un appel entrant après ouverture de l'app depuis l'action
   * "Répondre" d'une notification push système (voir sw.js/chat/page.tsx,
   * `?incomingCall=<callId>`) — aucun événement `call:incoming` n'a été reçu
   * en temps réel puisque le socket "/calls" n'existait pas encore à
   * l'invitation (app totalement fermée). Simule le même effet que ce
   * handler socket, à partir de l'état authoritative renvoyé par le serveur,
   * sans rien réémettre : `accept()`/`reject()` ensuite suivent leur
   * chemin normal.
   */
  const resumeIncoming = useCallback(
    async (callId: string) => {
      if (stateRef.current.phase !== "idle") return;
      try {
        const message = await api.calls.getById(callId);
        if (message.call.status !== "RINGING") return;
        update({
          phase: "incoming",
          conversationId: message.conversationId,
          callId: message.call.id,
          otherUserId: message.call.callerId,
          kind: message.call.type,
          error: null,
        });
        onCallMessageRef.current(message);
      } catch {
        // Appel déjà résolu (accepté/refusé/expiré) avant l'ouverture de l'app — rien à afficher.
      }
    },
    [update],
  );

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

  /**
   * "Inviter une personne à rejoindre l'appel" pour un appel simple —
   * bascule cet appel 1:1 en appel de groupe (voir
   * CallsService.escalateToGroup) : on renvoie ici directement le
   * GroupCallMessageDto reçu dans l'ack, à charge de l'appelant
   * (chat/page.tsx) d'enchaîner avec useGroupCall.startFromUpgrade — jamais
   * besoin d'attendre 'call:upgraded', réservé à l'AUTRE partie de l'appel.
   */
  const escalate = useCallback(
    async (inviteeId: string) => {
      const socket = socketRef.current;
      const { callId, phase } = stateRef.current;
      if (!socket || !callId || phase !== "active") return null;
      const res = await ack(socket, "call:escalate", { callId, inviteeId });
      if (!res.ok || !res.groupCallMessage) {
        update({ error: res.error ?? "Impossible d'ajouter cette personne à l'appel." });
        return null;
      }
      cleanupMedia();
      update(IDLE_SNAPSHOT);
      return res.groupCallMessage;
    },
    [cleanupMedia, update],
  );

  const toggleMute = useCallback(() => {
    const tracks = localStreamRef.current?.getAudioTracks() ?? [];
    const nextMuted = !stateRef.current.muted;
    tracks.forEach((track) => {
      track.enabled = !nextMuted;
    });
    update({ muted: nextMuted });
  }, [update]);

  /**
   * Change la langue dans laquelle J'entends l'interlocuteur — depuis l'écran
   * d'appel entrant (via accept) ou le menu en cours d'appel. `null` (ou la
   * langue d'envoi de l'interlocuteur) = pas de traduction. Le backend
   * prévient l'autre partie (`call:language-changed`) pour qu'elle capture sa
   * voix.
   */
  const setReceiveLanguage = useCallback(
    async (language: string | null) => {
      const socket = socketRef.current;
      const callId = stateRef.current.callId;
      if (!socket || !callId) return;
      const normalized =
        language && language !== stateRef.current.otherPartyLanguage ? language : null;
      update({ receiveLanguage: normalized, subtitles: [] });
      if (!normalized && remoteVideoRef.current) remoteVideoRef.current.volume = 1;
      await ack(socket, "call:set-language", { callId, language: normalized });
    },
    [update],
  );

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
    otherPartyLanguage: state.otherPartyLanguage,
    receiveLanguage: state.receiveLanguage,
    remoteReceiveLanguage: state.remoteReceiveLanguage,
    subtitles: state.subtitles,
    error: state.error,
    remoteVideoRef,
    localVideoRef,
    start,
    accept,
    resumeIncoming,
    reject,
    hangUp,
    escalate,
    toggleMute,
    toggleVideo,
    setReceiveLanguage,
  };
}
