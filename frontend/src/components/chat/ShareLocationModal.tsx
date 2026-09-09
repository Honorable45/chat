"use client";

import { useEffect, useState } from "react";
import { BouncingDots } from "@/components/BouncingDots";
import { XIcon } from "@/components/icons";
import { LocationPreview } from "./LocationPreview";

type State =
  | { status: "locating" }
  | { status: "ready"; latitude: number; longitude: number }
  | { status: "denied" }
  | { status: "error"; message: string };

type Mode = "current" | "live";

/** 15 min / 1h / 8h — mêmes choix que WhatsApp, plutôt qu'une durée libre. */
const DURATION_OPTIONS: { label: string; seconds: number }[] = [
  { label: "15 min", seconds: 15 * 60 },
  { label: "1 heure", seconds: 60 * 60 },
  { label: "8 heures", seconds: 8 * 60 * 60 },
];

/**
 * Position ponctuelle OU en direct (section "partage de position") — voir
 * MessagesService.sendLocation côté backend. Toujours un aperçu avant envoi
 * (comme WhatsApp) plutôt qu'un envoi instantané au clic sur le bouton : la
 * position exacte de l'utilisateur est sensible, une confirmation
 * explicite reste nécessaire dans les deux cas.
 */
export function ShareLocationModal({
  onClose,
  onShare,
}: {
  onClose: () => void;
  /** `live` absent pour une position ponctuelle — voir use-live-location.ts, qui démarre le suivi une fois le premier message créé (id renvoyé par onShare côté appelant). */
  onShare: (latitude: number, longitude: number, live?: { durationSeconds: number }) => Promise<void>;
}) {
  const [state, setState] = useState<State>({ status: "locating" });
  const [mode, setMode] = useState<Mode>("current");
  const [durationSeconds, setDurationSeconds] = useState(DURATION_OPTIONS[0].seconds);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      queueMicrotask(() =>
        setState({ status: "error", message: "La géolocalisation n'est pas prise en charge par ce navigateur." }),
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setState({
          status: "ready",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (err) => {
        setState(
          err.code === err.PERMISSION_DENIED
            ? { status: "denied" }
            : { status: "error", message: "Impossible de déterminer votre position." },
        );
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, []);

  async function share() {
    if (state.status !== "ready") return;
    setSending(true);
    setError(null);
    try {
      await onShare(state.latitude, state.longitude, mode === "live" ? { durationSeconds } : undefined);
      onClose();
    } catch {
      setError("Impossible d'envoyer la position.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/60 px-4 pt-24" onClick={onClose}>
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 pb-3">
          <h2 className="text-sm font-semibold">Partager ma position</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            <XIcon size={18} />
          </button>
        </div>

        {state.status === "locating" && (
          <div className="flex flex-col items-center gap-3 px-4 pb-6">
            <BouncingDots />
            <p className="text-sm text-muted">Localisation en cours...</p>
          </div>
        )}

        {state.status === "denied" && (
          <p className="px-4 pb-6 text-sm text-muted">
            Autorisation refusée. Activez la localisation pour ce site dans les réglages de votre navigateur pour
            partager votre position.
          </p>
        )}

        {state.status === "error" && <p className="px-4 pb-6 text-sm text-danger">{state.message}</p>}

        {state.status === "ready" && (
          <>
            <LocationPreview latitude={state.latitude} longitude={state.longitude} height={200} />
            <div className="flex flex-col gap-3 p-4">
              <div className="flex rounded-full border border-border bg-surface p-1 text-sm">
                <button
                  onClick={() => setMode("current")}
                  className={`flex-1 rounded-full py-1.5 font-medium transition ${
                    mode === "current" ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "text-muted hover:text-foreground"
                  }`}
                >
                  Position actuelle
                </button>
                <button
                  onClick={() => setMode("live")}
                  className={`flex-1 rounded-full py-1.5 font-medium transition ${
                    mode === "live" ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : "text-muted hover:text-foreground"
                  }`}
                >
                  Position en direct
                </button>
              </div>

              {mode === "live" && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs text-muted">Partager pendant</p>
                  <div className="flex gap-1.5">
                    {DURATION_OPTIONS.map((option) => (
                      <button
                        key={option.seconds}
                        onClick={() => setDurationSeconds(option.seconds)}
                        className={`flex-1 rounded-full border py-1.5 text-sm font-medium transition ${
                          durationSeconds === option.seconds
                            ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                            : "border-border text-muted hover:text-foreground"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted">
                    Votre position se mettra à jour automatiquement dans cette conversation. Vous pourrez arrêter le
                    partage à tout moment.
                  </p>
                </div>
              )}

              {error && <p className="text-sm text-danger">{error}</p>}
              <button
                onClick={() => void share()}
                disabled={sending}
                className="rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition disabled:opacity-60"
              >
                {sending ? "Envoi..." : mode === "live" ? "Démarrer le partage en direct" : "Envoyer ma position"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
