import { api } from "./api";

/** VAPID publique : convertie en tableau d'octets attendu par PushManager.subscribe (forme standard, voir MDN). */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

/**
 * Abonne cet appareil aux notifications push — les notifications push sont
 * activées par défaut et non désactivables depuis l'app (voir
 * auth-context.tsx, qui appelle ceci automatiquement à chaque session
 * authentifiée, et PushNotificationsRow, dont le seul contrôle restant est
 * de réessayer en cas d'échec). `Notification.requestPermission()` ne
 * réaffiche jamais l'invite navigateur si l'utilisateur a déjà tranché
 * (accepté ou refusé) — sûr à rappeler à chaque chargement de page.
 *
 * Volontairement sans branche "déjà abonné, ne rien refaire" : réabonner
 * avec les mêmes options renvoie la même subscription côté navigateur (pas
 * de doublon, voir MDN), et réenvoyer son détail au serveur (upsert, voir
 * PushService.subscribe) referme silencieusement tout désynchronisation
 * antérieure — ex. un tout premier essai qui aurait échoué côté réseau sans
 * que l'abonnement navigateur ait été défait.
 */
export async function subscribeToPush(): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Autorisation refusée par le navigateur.");
  }
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await api.push.getPublicKey();
  const sub = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await api.push.subscribe(sub.toJSON() as PushSubscriptionJSON);
  return sub;
}
