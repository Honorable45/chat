"use client";

import { useEffect, useState } from "react";
import { getAccessToken } from "./token-store";

/**
 * Récupère une ressource protégée par JwtAuthGuard (image/vidéo de statut,
 * pièce jointe...) en blob authentifié puis expose une URL d'objet locale —
 * un `<img>`/`<video src>` classique ne peut porter aucun en-tête
 * `Authorization`. Voir AuthenticatedImage, qui utilisait ce code avant
 * l'extraction de ce hook partagé (statuts vidéo en ont besoin aussi).
 */
export function useAuthenticatedBlobUrl(src: string): { url: string | null; failed: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let currentUrl: string | null = null;

    // Différé : le corps d'un effet ne doit jamais déclencher de setState de
    // façon synchrone (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      if (!cancelled) {
        setFailed(false);
        setUrl(null);
      }
    });

    const token = getAccessToken();
    fetch(src, { headers: token ? { Authorization: `Bearer ${token}` } : undefined })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        currentUrl = URL.createObjectURL(blob);
        setUrl(currentUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [src]);

  return { url, failed };
}
