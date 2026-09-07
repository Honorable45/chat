"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { AuthShell, primaryButtonClassName } from "@/components/auth/AuthShell";
import { UsersIcon } from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { GroupInvitePreview } from "@/lib/types";

/**
 * Aperçu public d'un lien d'invitation de groupe (section 7) — accessible
 * sans être connecté (voir GET /group-invites/:token, aucune authentification
 * requise côté backend), pour décider de rejoindre avant même d'avoir un
 * compte.
 */
export default function GroupInvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const { status } = useAuth();

  const [preview, setPreview] = useState<GroupInvitePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    api.groupInvites
      .preview(params.token)
      .then(setPreview)
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Ce lien d'invitation est invalide ou n'est plus actif.",
        ),
      )
      .finally(() => setLoading(false));
  }, [params.token]);

  async function join() {
    setJoining(true);
    setError(null);
    try {
      const conversation = await api.groupInvites.join(params.token);
      router.replace(`/chat?c=${conversation.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de rejoindre ce groupe.");
      setJoining(false);
    }
  }

  return (
    <AuthShell
      title={preview?.title ?? "Invitation à un groupe"}
      subtitle={preview ? `${preview.memberCount} membre${preview.memberCount > 1 ? "s" : ""}` : ""}
      footer={
        <Link href="/chat" className="font-medium text-[var(--accent-2)] hover:underline">
          Retour à la messagerie
        </Link>
      }
    >
      <div className="flex flex-col items-center gap-4 text-center">
        {loading && <p className="text-sm text-muted">Chargement...</p>}

        {!loading && error && !preview && <p className="text-sm text-danger">{error}</p>}

        {preview && (
          <>
            <Avatar firstName={preview.title ?? "Groupe"} lastName="" avatarUrl={preview.photoUrl} size={80} />
            <div>
              <p className="flex items-center justify-center gap-1.5 text-sm text-muted">
                <UsersIcon size={14} />
                {preview.memberCount} membre{preview.memberCount > 1 ? "s" : ""}
              </p>
              {preview.description && <p className="mt-2 text-sm text-muted-strong">{preview.description}</p>}
            </div>

            {error && <p className="text-sm text-danger">{error}</p>}

            {status === "authenticated" ? (
              <button onClick={() => void join()} disabled={joining} className={primaryButtonClassName}>
                {joining ? "Connexion au groupe..." : "Rejoindre le groupe"}
              </button>
            ) : status === "anonymous" ? (
              <div className="flex w-full flex-col gap-2">
                <p className="text-sm text-muted">Connectez-vous ou créez un compte, puis revenez sur ce lien pour rejoindre.</p>
                <Link href="/login" className={primaryButtonClassName}>
                  Se connecter
                </Link>
                <Link
                  href="/register"
                  className="rounded-full border border-border px-4 py-2.5 text-center text-sm font-medium transition hover:bg-surface-raised"
                >
                  Créer un compte
                </Link>
              </div>
            ) : (
              <p className="text-sm text-muted">Chargement...</p>
            )}
          </>
        )}
      </div>
    </AuthShell>
  );
}
