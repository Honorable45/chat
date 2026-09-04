"use client";

import { useCallback, useRef, useState } from "react";

// Doit rester synchronisé avec MAX_VOICE_DURATION_SECONDS côté backend
// (backend/src/uploads/audio-upload.constants.ts) — l'enregistrement s'arrête
// de lui-même à la limite plutôt que de laisser l'utilisateur produire un
// fichier que le serveur refusera de toute façon.
const MAX_DURATION_SECONDS = 300;

// Types acceptés par le backend (ALLOWED_AUDIO_MIME_TYPES) — testés dans cet
// ordre de préférence. Demander explicitement l'un de ces types (sans suffixe
// de codec) fait que le Blob produit porte exactement ce `type`, qui doit
// correspondre tel quel à ce que le serveur attend.
const PREFERRED_MIME_TYPES = ["audio/webm", "audio/ogg", "audio/mp4"];

function pickSupportedMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

export type RecorderState = "idle" | "requesting" | "recording" | "error";

export interface VoiceRecording {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
}

export function useVoiceRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanupStream = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    const mimeType = pickSupportedMimeType();
    if (!mimeType) {
      setState("error");
      setError("Enregistrement audio non supporté par ce navigateur.");
      return;
    }

    setState("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorderRef.current = recorder;

      recorder.start();
      startedAtRef.current = Date.now();
      setElapsedSeconds(0);
      setState("recording");

      tickRef.current = setInterval(() => {
        const elapsed = (Date.now() - startedAtRef.current) / 1000;
        setElapsedSeconds(elapsed);
        if (elapsed >= MAX_DURATION_SECONDS) {
          recorder.stop();
        }
      }, 200);
    } catch {
      cleanupStream();
      setState("error");
      setError("Micro inaccessible — vérifiez les autorisations du navigateur.");
    }
  }, [cleanupStream]);

  /** Arrête et renvoie l'enregistrement, ou `null` s'il n'y avait rien à envoyer. */
  const stop = useCallback((): Promise<VoiceRecording | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        resolve(null);
        return;
      }
      const mimeType = recorder.mimeType;
      const durationSeconds = (Date.now() - startedAtRef.current) / 1000;

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        cleanupStream();
        setState("idle");
        setElapsedSeconds(0);
        if (blob.size === 0 || durationSeconds < 1) {
          resolve(null);
          return;
        }
        resolve({ blob, mimeType, durationSeconds });
      };
      recorder.stop();
    });
  }, [cleanupStream]);

  const cancel = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    cleanupStream();
    setState("idle");
    setElapsedSeconds(0);
  }, [cleanupStream]);

  return { state, elapsedSeconds, error, start, stop, cancel };
}
