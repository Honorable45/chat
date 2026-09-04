"use client";

import { useEffect, useRef } from "react";

/**
 * Sonneries synthétisées via Web Audio (oscillateurs simples) — jamais un
 * fichier audio existant, encore moins une ressource protégée d'une
 * application tierce : on reproduit le COMPORTEMENT (deux sonneries
 * distinctes, une pour l'appelant qui attend, une pour l'appelé qui reçoit
 * l'appel — section 5-13 du cahier des charges) sans copier aucun son réel.
 */

let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedCtx) sharedCtx = new Ctor();
  return sharedCtx;
}

/**
 * Débloque le contexte audio partagé dès la toute première interaction de
 * l'utilisateur avec la page (clic, appui touche...) — les navigateurs
 * exigent un geste utilisateur avant d'autoriser un AudioContext à
 * démarrer, mais un appel entrant n'est précédé d'aucun geste de l'appelé
 * à cet instant précis : on ne peut pas compter dessus. À appeler une
 * seule fois, tôt (voir chat/page.tsx).
 */
export function unlockAudioOnFirstInteraction(): void {
  if (typeof window === "undefined") return;
  const resume = () => {
    getAudioContext()
      ?.resume()
      .catch(() => {});
  };
  window.addEventListener("pointerdown", resume, { once: true });
  window.addEventListener("keydown", resume, { once: true });
}

type RingKind = "ringback" | "ringtone";

function beep(ctx: AudioContext, atSeconds: number, freq: number, durationSec: number, peakGain: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, atSeconds);
  gain.gain.linearRampToValueAtTime(peakGain, atSeconds + 0.03);
  gain.gain.linearRampToValueAtTime(0, atSeconds + durationSec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(atSeconds);
  osc.stop(atSeconds + durationSec + 0.02);
}

/**
 * Joue une sonnerie tant que `active` est vrai. "ringback" (on attend que
 * l'autre décroche) : cadence lente, deux tonalités graves façon
 * "ring-ring... pause". "ringtone" (on reçoit un appel) : motif plus
 * rapproché et plus aigu, volontairement plus pressant.
 */
export function useRingTone(active: boolean, kind: RingKind): void {
  const stoppedRef = useRef(true);

  useEffect(() => {
    if (!active) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    stoppedRef.current = false;
    void ctx.resume().catch(() => {});

    let cycleTimeout: ReturnType<typeof setTimeout> | null = null;

    function playCycle() {
      if (stoppedRef.current || !ctx) return;
      const now = ctx.currentTime + 0.05;
      if (kind === "ringback") {
        beep(ctx, now, 425, 0.4, 0.12);
        beep(ctx, now + 0.55, 425, 0.4, 0.12);
        cycleTimeout = setTimeout(playCycle, 3000);
      } else {
        beep(ctx, now, 587, 0.25, 0.14);
        beep(ctx, now + 0.3, 740, 0.25, 0.14);
        beep(ctx, now + 0.75, 587, 0.25, 0.14);
        beep(ctx, now + 1.05, 740, 0.25, 0.14);
        cycleTimeout = setTimeout(playCycle, 1900);
      }
    }
    playCycle();

    return () => {
      stoppedRef.current = true;
      if (cycleTimeout) clearTimeout(cycleTimeout);
    };
  }, [active, kind]);
}
