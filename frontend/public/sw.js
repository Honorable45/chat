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

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  const { title, body, url } = payload;

  event.waitUntil(
    (async () => {
      // Si l'app est déjà au premier plan sur cet appareil, elle affiche
      // déjà l'événement in-app (toast/badge, voir websocket "notification:new")
      // — une notification système en plus ferait doublon.
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const hasFocusedClient = clientsList.some((client) => client.focused);
      if (hasFocusedClient) return;

      await self.registration.showNotification(title || "Glotta", {
        body: body || "",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: { url: url || "/chat" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/chat";

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
