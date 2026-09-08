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

/**
 * Position ponctuelle (section "partage de position") — jamais de position
 * en direct (hors périmètre, voir SendLocationMessageDto côté backend).
 * Toujours un aperçu avant envoi (comme WhatsApp) plutôt qu'un envoi
 * instantané au clic sur le bouton : la position exacte de l'utilisateur
 * est sensible, une confirmation explicite reste nécessaire.
 */
export function ShareLocationModal({
  onClose,
  onShare,
}: {
  onClose: () => void;
  onShare: (latitude: number, longitude: number) => Promise<void>;
}) {
  const [state, setState] = useState<State>({ status: "locating" });
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
      await onShare(state.latitude, state.longitude);
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
            <div className="flex flex-col gap-2 p-4">
              {error && <p className="text-sm text-danger">{error}</p>}
              <button
                onClick={() => void share()}
                disabled={sending}
                className="rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] px-4 py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition disabled:opacity-60"
              >
                {sending ? "Envoi..." : "Envoyer ma position"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
