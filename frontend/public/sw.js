// Service worker minimal, écrit à la main (volontairement pas de
// next-pwa/Workbox — cette app dépend fortement de Socket.IO et d'appels
// API en temps réel, un précaching agressif serait plus risqué qu'utile
// pour le seul besoin ici : les notifications push hors de l'app).

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Petit magasin clé/valeur en IndexedDB — un simple module-scope `let`
// serait remis à zéro à chaque redémarrage du processus worker (fréquent,
// le navigateur le termine agressivement entre deux événements), ce qui
// casserait justement le cas qui nous intéresse le plus : réagir à un push
// d'appel entrant alors qu'aucune page de l'app n'est ouverte pour renvoyer
// la config.
const CONFIG_DB = "glotta-sw";
const CONFIG_STORE = "config";

function withConfigStore(mode, run) {
  return new Promise((resolve) => {
    const openReq = indexedDB.open(CONFIG_DB, 1);
    openReq.onupgradeneeded = () => openReq.result.createObjectStore(CONFIG_STORE);
    openReq.onerror = () => resolve(undefined);
    openReq.onsuccess = () => {
      const tx = openReq.result.transaction(CONFIG_STORE, mode);
      const result = run(tx.objectStore(CONFIG_STORE));
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => resolve(undefined);
    };
  });
}

function configGet(key) {
  return withConfigStore("readonly", (store) => {
    const req = store.get(key);
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  }).then((v) => v ?? null);
}

function configSet(key, value) {
  return withConfigStore("readwrite", (store) => {
    store.put(value, key);
  });
}

// Reçoit l'URL de l'API depuis la page (voir auth-context.tsx) — un fichier
// statique comme celui-ci n'a accès à aucune variable d'environnement
// Next.js, et en a pourtant besoin pour l'action "Refuser" ci-dessous.
self.addEventListener("message", (event) => {
  if (event.data?.type === "config" && event.data.apiUrl) {
    event.waitUntil(configSet("apiUrl", event.data.apiUrl));
  }
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  const isCall = payload.kind === "call";

  event.waitUntil(
    (async () => {
      // Si l'app est déjà au premier plan sur cet appareil, elle affiche
      // déjà l'événement in-app (toast/badge pour un message, sonnerie
      // plein écran pour un appel — voir websocket "notification:new"/
      // "call:incoming") — une notification système en plus ferait doublon.
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const hasFocusedClient = clientsList.some((client) => client.focused);
      if (hasFocusedClient) return;

      await self.registration.showNotification(payload.title || "Glotta", {
        body: payload.body || "",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        // `tag` : une deuxième notification pour le même appel (ex. relance)
        // remplace la première plutôt que de s'empiler. `requireInteraction`
        // : reste affichée jusqu'à action explicite, un appel entrant ne
        // doit jamais disparaître tout seul comme un simple message.
        tag: isCall ? `call-${payload.callId}` : undefined,
        requireInteraction: isCall,
        actions: isCall
          ? [
              { action: "accept", title: "Répondre" },
              { action: "reject", title: "Refuser" },
            ]
          : undefined,
        data: { url: payload.url || "/chat", rejectToken: payload.rejectToken },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  event.notification.close();

  // Action "Refuser" d'un appel entrant : ne jamais ouvrir l'app pour ça,
  // juste prévenir le serveur (voir CallsController.quickReject) — le jeton
  // porte à lui seul l'identité et le périmètre (voir CallsService), aucun
  // accessToken de session n'est nécessaire ni même accessible ici
  // (localStorage n'existe pas dans un service worker).
  if (event.action === "reject" && data.rejectToken) {
    event.waitUntil(
      (async () => {
        const apiUrl = await configGet("apiUrl");
        if (!apiUrl) return;
        try {
          await fetch(`${apiUrl}/calls/quick-reject`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: data.rejectToken }),
          });
        } catch {
          // Best-effort : un refus qui échoue laisse simplement l'appelant sonner — jamais bloquant pour l'utilisateur qui a fermé l'app.
        }
      })(),
    );
    return;
  }

  // Clic simple ou action "Répondre" : ouvre/focalise l'app sur l'URL de la
  // notification (pour un appel, inclut `?incomingCall=<id>` — voir
  // chat/page.tsx, qui reprend alors l'appel via useCall.resumeIncoming).
  const targetUrl = data.url || "/chat";

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = clientsList.find((client) => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });
      if (existing) {
        await existing.navigate(targetUrl);
        await existing.focus();
        return;
      }
      await self.clients.openWindow(targetUrl);
    })(),
  );
});
