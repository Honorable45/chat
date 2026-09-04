"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { getAccessToken } from "./token-store";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4000";

/**
 * Une connexion Socket.IO par session de page, authentifiée par le même
 * access token que les requêtes REST (voir EventsGateway côté backend, qui
 * lit `handshake.auth.token`). Ne tente de se connecter que si l'appelant a
 * un utilisateur authentifié (paramètre `enabled`).
 */
export function useSocket(enabled: boolean): Socket | null {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const token = getAccessToken();
    if (!token) return;

    const instance = io(WS_URL, {
      auth: { token },
      reconnection: true,
      transports: ["websocket"],
    });

    // Différé d'un micro-tick : évite un setState synchrone dans le corps de
    // l'effet (react-hooks/set-state-in-effect) — la connexion elle-même
    // reste asynchrone de toute façon (Socket.IO ne se connecte pas avant le
    // prochain tick).
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setSocket(instance);
    });

    return () => {
      cancelled = true;
      instance.close();
      setSocket(null);
    };
  }, [enabled]);

  return socket;
}
