"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { refreshSession } from "./api";
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
      // Fonction (jamais un objet figé) : appelée à chaque tentative, y
      // compris les reconnexions automatiques — sans ça, une reconnexion
      // après expiration de l'access token (15 min, voir JWT_ACCESS_EXPIRES_IN)
      // renverrait indéfiniment le même token périmé capturé au premier
      // montage, même après un rafraîchissement réussi côté REST (bug réel
      // constaté en prod : "jwt expired" en boucle après un redéploiement
      // backend, qui coupe tous les sockets ouverts).
      auth: (cb) => cb({ token: getAccessToken() }),
      reconnection: true,
      transports: ["websocket"],
    });

    // Le serveur rejette avec "jwt expired"/"invalid signature"... — jamais
    // un problème réseau ordinaire (celui-là redéclenche son propre
    // `connect_error` sans faute d'authentification). Tente un rafraîchissement
    // avant la prochaine tentative automatique de Socket.IO plutôt que
    // d'attendre qu'une requête REST échoue en 401 pour s'en apercevoir —
    // sans quoi la messagerie temps réel resterait muette jusqu'au prochain
    // rechargement complet de la page.
    instance.on("connect_error", () => {
      void refreshSession();
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
