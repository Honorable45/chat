"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CameraIcon, CheckIcon, ShareIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { profileUrl } from "@/lib/profile-link";

/**
 * Partage du profil public — lien + QR code générés côté client (aucun
 * appel réseau, `qrcode` encode directement le texte). Le lien n'encode
 * que l'id utilisateur (voir lib/profile-link.ts) : jamais de mot de
 * passe, de token de session ni de donnée privée dans le QR, et ce QR est
 * totalement indépendant de tout flux de connexion (il n'y en a d'ailleurs
 * aucun basé sur un QR dans cette appli).
 */
export function ProfileShareSection() {
  const { user } = useAuth();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const link = user ? profileUrl(user.id) : "";

  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    QRCode.toDataURL(link, { width: 220, margin: 1, color: { dark: "#000000", light: "#ffffff" } })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setError("Impossible de générer le QR code.");
      });
    return () => {
      cancelled = true;
    };
  }, [link]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Impossible de copier le lien.");
    }
  }

  async function shareLink() {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Mon profil Glotta", url: link });
      } catch {
        // Annulation par l'utilisateur ou API indisponible — pas une erreur à afficher.
      }
    } else {
      void copyLink();
    }
  }

  if (!user) return null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface-raised p-6">
        {qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- data: URL générée localement, jamais une ressource distante à optimiser.
          <img src={qrDataUrl} alt="QR code de mon profil" width={220} height={220} className="rounded-xl border border-border bg-white p-2" />
        ) : (
          <div className="flex h-[220px] w-[220px] items-center justify-center rounded-xl border border-border bg-white">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
          </div>
        )}
        <p className="text-center text-xs text-muted">
          Faites scanner ce code pour que quelqu&rsquo;un ouvre votre profil et vous ajoute en contact.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm break-all text-muted-strong">
        {link}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          onClick={() => void copyLink()}
          className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm transition hover:bg-surface-raised"
        >
          {copied ? <CheckIcon size={15} className="text-[var(--online)]" /> : null}
          {copied ? "Lien copié" : "Copier le lien"}
        </button>
        <button
          onClick={() => void shareLink()}
          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] px-4 py-2 text-sm font-semibold text-[var(--accent-contrast)] transition hover:opacity-90"
        >
          <ShareIcon size={15} />
          Partager
        </button>
        <Link
          href="/scan"
          className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2 text-sm transition hover:bg-surface-raised"
        >
          <CameraIcon size={15} />
          Scanner un code
        </Link>
      </div>
    </div>
  );
}
