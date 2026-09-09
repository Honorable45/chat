"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

// Borne le débit d'appels réseau : `watchPosition` peut déclencher son
// callback bien plus souvent que nécessaire (parfois plusieurs fois par
// seconde en mouvement, avec enableHighAccuracy) — inutile et coûteux en
// batterie côté expéditeur pour une position affichée sur une simple tuile
// de carte, jamais un tracé au mètre près.
const MIN_UPDATE_INTERVAL_MS = 10_000;

/**
 * Position en direct (section "partage de position") — montée une seule
 * fois au niveau de la page de chat (comme useCall/useGroupCall) : le
 * partage continue en arrière-plan même après avoir fermé la modale ou
 * changé de conversation, jusqu'à expiration naturelle ou arrêt explicite,
 * exactement comme WhatsApp.
 *
 * Un seul partage actif à la fois par onglet — démarrer un nouveau partage
 * remplace silencieusement le précédent côté client (le précédent message
 * n'est pas explicitement arrêté côté serveur dans ce cas, il expirera de
 * lui-même ; en pratique ShareLocationModal ne permet jamais de démarrer un
 * second partage tant que le premier est actif).
 */
export function useLiveLocation() {
  const watchIdRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageIdRef = useRef<string | null>(null);
  const lastSentAtRef = useRef(0);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);

  const stop = useCallback(() => {
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;

    const messageId = messageIdRef.current;
    messageIdRef.current = null;
    setActiveMessageId(null);
    if (messageId) {
      // Best-effort : un arrêt qui échoue n'est pas grave, le partage
      // expirera de toute façon à l'heure prévue (expiresAt).
      void api.messages.stopLocation(messageId).catch(() => {});
    }
  }, []);

  const start = useCallback(
    (messageId: string, durationSeconds: number) => {
      if (!("geolocation" in navigator)) return;
      stop();

      messageIdRef.current = messageId;
      lastSentAtRef.current = 0;
      setActiveMessageId(messageId);

      watchIdRef.current = navigator.geolocation.watchPosition(
        (position) => {
          const now = Date.now();
          if (now - lastSentAtRef.current < MIN_UPDATE_INTERVAL_MS) return;
          lastSentAtRef.current = now;
          void api.messages
            .updateLocation(messageId, {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            })
            .catch(() => {
              // Best-effort : un déplacement raté n'interrompt jamais le partage, la position affichée reste simplement la dernière connue.
            });
        },
        () => {
          // Best-effort : permission retirée en cours de route, GPS
          // momentanément indisponible... le partage reste "en direct"
          // côté serveur jusqu'à expiresAt, juste plus mis à jour.
        },
        { enableHighAccuracy: true, maximumAge: 10_000 },
      );

      timeoutRef.current = setTimeout(stop, durationSeconds * 1000);
    },
    [stop],
  );

  // Arrête proprement si la page se démonte pendant un partage actif.
  useEffect(() => stop, [stop]);

  return { activeMessageId, start, stop };
}
