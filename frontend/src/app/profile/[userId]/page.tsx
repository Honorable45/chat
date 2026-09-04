"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { languageFlag } from "@/components/settings/shared";
import { ChevronLeftIcon, LockIcon } from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { displayName } from "@/lib/format";
import type { ContactStatus, PublicUser } from "@/lib/types";

/**
 * Profil public accessible par lien/QR (voir lib/profile-link.ts et
 * ProfileShareSection) — protégé côté backend comme n'importe quelle autre
 * route authentifiée (GET /users/:id exige un JWT valide) : ouvrir ce lien
 * sans être connecté redirige vers /login plutôt que d'afficher quoi que
 * ce soit. Le bouton d'action reflète la vraie relation (NONE, en attente
 * envoyée/reçue, acceptée, bloquée dans un sens ou l'autre — voir
 * ContactsService.statusWith), jamais un simple "Ajouter" figé.
 */
export default function PublicProfilePage() {
  const params = useParams<{ userId: string }>();
  const router = useRouter();
  const { user: me, status: authStatus } = useAuth();
  const userId = params.userId;

  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [contactStatus, setContactStatus] = useState<ContactStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Remise à zéro de l'état affiché quand le profil visité change (le
  // composant est réutilisé d'une navigation à l'autre, pas remonté) —
  // pendant le rendu plutôt que dans un effet, motif recommandé par React
  // pour "ajuster un état quand une prop change" (voir le commentaire
  // équivalent dans SettingsPage.tsx).
  const [syncedUserId, setSyncedUserId] = useState(userId);
  if (userId !== syncedUserId) {
    setSyncedUserId(userId);
    setProfile(null);
    setContactStatus(null);
    setError(null);
    setNotFound(false);
  }

  useEffect(() => {
    if (authStatus === "anonymous") router.replace("/login");
  }, [authStatus, router]);

  useEffect(() => {
    if (!me || userId === me.id) return;
    api.users
      .publicProfile(userId)
      .then(setProfile)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setError(err instanceof ApiError ? err.message : "Impossible de charger ce profil.");
      });
    api.contacts
      .statusWith(userId)
      .then((res) => setContactStatus(res.status))
      .catch(() => {});
  }, [me, userId]);

  async function sendRequest() {
    setBusy(true);
    setError(null);
    try {
      await api.contacts.sendRequest(userId);
      setContactStatus("PENDING_SENT");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'envoyer la demande.");
    } finally {
      setBusy(false);
    }
  }

  async function unblock() {
    setBusy(true);
    setError(null);
    try {
      await api.contacts.unblock(userId);
      setContactStatus("NONE");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de débloquer.");
    } finally {
      setBusy(false);
    }
  }

  async function openConversation() {
    setBusy(true);
    setError(null);
    try {
      const conversation = await api.conversations.createDirect(userId);
      router.push(`/chat?c=${conversation.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'ouvrir la conversation.");
    } finally {
      setBusy(false);
    }
  }

  if (!me) return null;

  return (
    <div className="flex flex-1 items-start justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <button
          onClick={() => router.push("/chat")}
          className="mb-4 flex items-center gap-1 text-sm text-muted transition hover:text-foreground"
        >
          <ChevronLeftIcon size={16} />
          Retour
        </button>

        {userId === me.id ? (
          <div className="rounded-2xl border border-border bg-surface-raised p-6 text-center">
            <Avatar firstName={me.firstName} lastName={me.lastName} avatarUrl={me.profile?.avatarUrl} size={72} />
            <p className="mt-3 text-sm text-muted">C&rsquo;est votre profil. Partagez-le depuis Paramètres → Partager.</p>
          </div>
        ) : notFound ? (
          <p className="rounded-2xl border border-border bg-surface-raised p-6 text-center text-sm text-muted">
            Ce profil n&rsquo;existe pas ou n&rsquo;est plus disponible.
          </p>
        ) : !profile ? (
          <div className="flex justify-center py-10">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-surface-raised p-6 text-center">
            <Avatar firstName={profile.firstName} lastName={profile.lastName} avatarUrl={profile.avatarUrl} online={profile.isOnline} size={80} />
            <h1 className="mt-3 text-lg font-semibold">{displayName(profile)}</h1>
            <p className="text-sm text-muted">@{profile.username}</p>
            {profile.statusText && <p className="mt-2 text-sm text-muted-strong">{profile.statusText}</p>}
            {profile.primaryLanguage && (
              <p className="mt-1 text-xs text-muted">
                {languageFlag(profile.primaryLanguage.code) ?? "🌐"} {profile.primaryLanguage.name}
              </p>
            )}

            {error && <p className="mt-3 text-sm text-danger">{error}</p>}

            <div className="mt-5 flex flex-col gap-2">
              {contactStatus === "ACCEPTED" && (
                <button onClick={() => void openConversation()} disabled={busy} className="rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-contrast)] transition hover:opacity-90 disabled:opacity-50">
                  Envoyer un message
                </button>
              )}
              {contactStatus === "NONE" && (
                <button onClick={() => void sendRequest()} disabled={busy} className="rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-contrast)] transition hover:opacity-90 disabled:opacity-50">
                  Ajouter en contact
                </button>
              )}
              {contactStatus === "PENDING_SENT" && (
                <p className="rounded-xl border border-border px-4 py-2.5 text-sm text-muted">Demande de contact envoyée</p>
              )}
              {contactStatus === "PENDING_RECEIVED" && (
                <p className="rounded-xl border border-border px-4 py-2.5 text-sm text-muted">
                  Cette personne vous a envoyé une demande — répondez depuis Contacts.
                </p>
              )}
              {contactStatus === "BLOCKED_BY_ME" && (
                <button onClick={() => void unblock()} disabled={busy} className="rounded-xl border border-border px-4 py-2.5 text-sm transition hover:bg-surface disabled:opacity-50">
                  Débloquer
                </button>
              )}
              {contactStatus === "BLOCKED_BY_THEM" && (
                <p className="flex items-center justify-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm text-muted">
                  <LockIcon size={14} />
                  Indisponible
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
