"use client";

import { useEffect, useState } from "react";
import { Toggle } from "@/components/Toggle";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { saveButtonClassName } from "./shared";

function Row({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface-raised px-4 py-3">
      <div>
        <p className="text-sm">{label}</p>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** VAPID publique : convertie en tableau d'octets attendu par PushManager.subscribe (forme standard, voir MDN). */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

type PushState = "checking" | "unsupported" | "subscribed" | "unsubscribed";

/**
 * Interrupteur "Notifications push sur cet appareil" — indépendant du
 * réglage serveur ci-dessus : celui-ci coupe TOUTES les notifications
 * (in-app comprises), celui-là active seulement leur diffusion système
 * quand l'app/l'onglet n'est pas ouvert (voir public/sw.js). L'état affiché
 * relit toujours `pushManager.getSubscription()` — jamais un simple flag
 * local, qui pourrait mentir après une désinscription faite depuis les
 * réglages du navigateur plutôt que depuis ce bouton.
 */
function PushNotificationsRow() {
  const [state, setState] = useState<PushState>("checking");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // queueMicrotask : le corps de l'effet ne doit jamais déclencher de
    // setState de façon synchrone (même dans la branche "non supporté") —
    // voir le même motif dans auth-context.tsx.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setState("unsupported");
        return;
      }
      navigator.serviceWorker.ready
        .then((registration) => registration.pushManager.getSubscription())
        .then((sub) => {
          if (cancelled) return;
          setSubscription(sub);
          setState(sub ? "subscribed" : "unsubscribed");
        })
        .catch(() => {
          if (!cancelled) setState("unsupported");
        });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setError("Autorisation refusée par le navigateur.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const { publicKey } = await api.push.getPublicKey();
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await api.push.subscribe(sub.toJSON() as PushSubscriptionJSON);
      setSubscription(sub);
      setState("subscribed");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'activer les notifications push.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!subscription) return;
    setBusy(true);
    setError(null);
    try {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await api.push.unsubscribe(endpoint);
      setSubscription(null);
      setState("unsubscribed");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de désactiver les notifications push.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "unsupported") {
    return (
      <Row
        label="Notifications push sur cet appareil"
        description="Non prises en charge par ce navigateur."
      >
        <Toggle checked={false} onChange={() => {}} disabled />
      </Row>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Row
        label="Notifications push sur cet appareil"
        description="Reçoit une notification système même quand l'onglet est fermé (nouveau message, mention, appel manqué...)."
      >
        <Toggle
          checked={state === "subscribed"}
          onChange={() => void (state === "subscribed" ? disable() : enable())}
          disabled={busy || state === "checking"}
        />
      </Row>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

/** Un seul réglage global pour l'instant (section 11 du cahier des charges)
 * — un réglage par catégorie (messages, vocaux, appels...) pourra affiner
 * ceci plus tard sans remettre en cause ce champ, voir Profile.notificationsEnabled. */
export function NotificationsSection() {
  const { user, refreshMe } = useAuth();
  const profile = user?.profile;

  const [notificationsEnabled, setNotificationsEnabled] = useState(profile?.notificationsEnabled ?? true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.users.updateProfile({ notificationsEnabled });
      await refreshMe();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ce réglage.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Row label="Notifications" description="Recevoir des notifications pour les nouveaux messages, vocaux et appels.">
        <Toggle checked={notificationsEnabled} onChange={() => setNotificationsEnabled((v) => !v)} />
      </Row>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center gap-3 pt-1">
        <button onClick={save} disabled={saving} className={saveButtonClassName}>
          {saving ? "Enregistrement..." : "Enregistrer"}
        </button>
        {saved && <span className="text-sm text-[var(--online)]">Enregistré ✓</span>}
      </div>

      <div className="h-px bg-border" />

      <PushNotificationsRow />
    </div>
  );
}
