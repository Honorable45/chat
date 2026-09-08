"use client";

import { useEffect, useState } from "react";
import { Toggle } from "@/components/Toggle";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isPushSupported, subscribeToPush } from "@/lib/push";
import { saveButtonClassName } from "./shared";

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children?: React.ReactNode;
}) {
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

type PushState = "checking" | "unsupported" | "subscribed" | "denied" | "unsubscribed";

/**
 * État "Notifications push sur cet appareil" — indépendant du réglage
 * serveur ci-dessus : celui-ci coupe TOUTES les notifications (in-app
 * comprises), celui-là ne concerne que leur diffusion système quand l'app/
 * l'onglet n'est pas ouvert (voir public/sw.js). Activées par défaut et non
 * désactivables depuis l'app (voir auth-context.tsx, qui déclenche
 * l'abonnement automatiquement à la connexion) : ceci n'affiche plus qu'un
 * statut, avec un bouton "Activer" seulement pour rattraper un abonnement
 * qui aurait échoué — jamais de bouton pour le couper. Un refus navigateur
 * ("denied") ne peut être renversé que depuis les réglages du système/
 * navigateur, jamais depuis l'app — affiché tel quel plutôt que proposer un
 * bouton qui ne pourrait rien faire.
 */
function PushNotificationsRow() {
  const [state, setState] = useState<PushState>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // queueMicrotask : le corps de l'effet ne doit jamais déclencher de
    // setState de façon synchrone (même dans la branche "non supporté") —
    // voir le même motif dans auth-context.tsx.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (!isPushSupported()) {
        setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      navigator.serviceWorker.ready
        .then((registration) => registration.pushManager.getSubscription())
        .then((sub) => {
          if (!cancelled) setState(sub ? "subscribed" : "unsubscribed");
        })
        .catch(() => {
          if (!cancelled) setState("unsupported");
        });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      await subscribeToPush();
      setState("subscribed");
    } catch (err) {
      // Affiche toujours le message réel (y compris une DOMException du
      // navigateur, ex. "Registration failed - push service error" côté
      // pushManager.subscribe) plutôt qu'un message générique qui masquait
      // la vraie cause — nécessaire pour diagnostiquer un échec silencieux
      // constaté en prod (bug réel : l'abonnement semblait réussi sans
      // qu'aucun abonnement n'arrive jamais côté serveur).
      setError(err instanceof Error ? err.message : "Impossible d'activer les notifications push.");
      setState(Notification.permission === "denied" ? "denied" : "unsubscribed");
    } finally {
      setBusy(false);
    }
  }

  if (state === "unsupported") {
    return (
      <Row label="Notifications push sur cet appareil" description="Non prises en charge par ce navigateur." />
    );
  }

  if (state === "denied") {
    return (
      <Row
        label="Notifications push sur cet appareil"
        description="Refusées par le navigateur — réactivez-les dans les réglages de notifications de votre appareil pour ce site."
      />
    );
  }

  if (state === "subscribed") {
    return (
      <Row
        label="Notifications push sur cet appareil"
        description="Reçoit une notification système même quand l'onglet est fermé (nouveau message, mention, appel manqué...)."
      >
        <span className="text-xs font-medium text-[var(--online)]">Activées ✓</span>
      </Row>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Row
        label="Notifications push sur cet appareil"
        description="Reçoit une notification système même quand l'onglet est fermé (nouveau message, mention, appel manqué...)."
      >
        <button
          onClick={() => void activate()}
          disabled={busy || state === "checking"}
          className="rounded-full border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-surface disabled:opacity-60"
        >
          {busy ? "..." : "Activer"}
        </button>
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
