"use client";

import QRCode from "qrcode";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { AuthShell } from "@/components/auth/AuthShell";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { detectMobileOs, isLikelyMobileDevice } from "@/lib/device-info";
import type { AuthTokens, SafeUser } from "@/lib/types";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4000";
// Absente tant que l'APK n'est pas hébergé quelque part (voir DEPLOYMENT.md,
// section distribution mobile) — le bouton de téléchargement reste alors
// caché plutôt que de pointer vers un lien mort.
const ANDROID_APK_URL = process.env.NEXT_PUBLIC_ANDROID_APK_URL;

type LinkState = "loading" | "ready" | "expired" | "cancelled" | "error";

/**
 * Port de la section 6-9 du cahier des charges : "Connectez votre téléphone
 * à Glotta Web". Remplace l'ancien formulaire identifiant + mot de passe
 * (section 5-6 : plus de connexion classique sur Web). Le QR encode un
 * secret temporaire (jamais un token de session, voir
 * DeviceLinkService.createLinkRequest côté backend) ; ce navigateur attend
 * ensuite la confirmation mobile via un WebSocket dédié, non authentifié
 * ("/device-link" — il n'y a par définition aucune session avant ça).
 */
export default function LoginPage() {
  const router = useRouter();
  const { status, loginWithTokens } = useAuth();
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [linkState, setLinkState] = useState<LinkState>("loading");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status === "authenticated") router.replace("/chat");
  }, [status, router]);

  // Détection appareil (section 5) — signal UX, jamais une mesure de
  // sécurité (voir device-info.ts) : évaluée une seule fois côté client,
  // après le premier rendu, pour ne jamais dépendre du rendu serveur (le
  // User-Agent n'est pas fiable pour une redirection serveur non plus).
  useEffect(() => {
    // queueMicrotask (jamais un appel direct) : le corps d'un effet ne doit
    // jamais déclencher de setState de façon synchrone — même convention
    // qu'auth-context.tsx/socket.ts.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setIsMobile(isLikelyMobileDevice());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function createLink() {
    setLinkState("loading");
    setError(null);
    socketRef.current?.close();
    if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);

    api.auth
      .createLinkRequest()
      .then(async ({ token, expiresAt }) => {
        const qrUrl = `glotta://link-device?request=${token}`;
        const dataUrl = await QRCode.toDataURL(qrUrl, {
          width: 240,
          margin: 1,
          color: { dark: "#000000", light: "#ffffff" },
        });
        setQrDataUrl(dataUrl);
        setLinkState("ready");

        const socket = io(`${WS_URL}/device-link`, { transports: ["websocket"] });
        socketRef.current = socket;
        socket.on("connect", () => socket.emit("subscribe", { token }));
        socket.on(
          "link:confirmed",
          (payload: AuthTokens & { user: SafeUser }) => {
            void loginWithTokens(payload).then(() => router.replace("/chat"));
          },
        );
        socket.on("link:cancelled", () => setLinkState("cancelled"));

        const msUntilExpiry = new Date(expiresAt).getTime() - Date.now();
        expiryTimerRef.current = setTimeout(() => setLinkState("expired"), Math.max(0, msUntilExpiry));
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Impossible de générer le QR code.");
        setLinkState("error");
      });
  }

  useEffect(() => {
    let cancelled = false;
    if (isMobile === false) {
      queueMicrotask(() => {
        if (!cancelled) createLink();
      });
    }
    return () => {
      cancelled = true;
      socketRef.current?.close();
      if (expiryTimerRef.current) clearTimeout(expiryTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ne doit se déclencher qu'au moment où isMobile passe à false, jamais se réabonner à chaque rendu.
  }, [isMobile]);

  if (isMobile === null) return null;

  if (isMobile) {
    const mobileOs = detectMobileOs();
    return (
      <AuthShell title="Glotta Web" subtitle="" footer={null}>
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <p className="text-sm text-muted-strong">
            Glotta Web est disponible uniquement sur ordinateur. Utilisez l&rsquo;application mobile Glotta pour
            accéder à votre compte.
          </p>
          {mobileOs === "android" && ANDROID_APK_URL && (
            <a
              href={ANDROID_APK_URL}
              className="rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] px-5 py-2.5 text-sm font-semibold text-[var(--accent-contrast)] transition hover:opacity-90"
            >
              Télécharger l&rsquo;app Android
            </a>
          )}
          {mobileOs === "ios" && (
            <p className="text-xs text-muted">L&rsquo;app iOS n&rsquo;est pas encore disponible.</p>
          )}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Connectez votre téléphone à Glotta Web"
      subtitle="Ouvrez Glotta sur votre téléphone pour scanner ce code."
      footer={
        <span>
          Paramètres → Appareils connectés → Connecter un appareil, puis scannez ce QR et confirmez sur votre
          téléphone.
        </span>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <div className="flex h-[240px] w-[240px] items-center justify-center rounded-xl border border-border bg-white p-2">
          {linkState === "ready" && qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- data: URL générée localement.
            <img src={qrDataUrl} alt="QR code de connexion Glotta Web" width={224} height={224} />
          ) : linkState === "loading" ? (
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
          ) : (
            <div className="flex flex-col items-center gap-2 px-4 text-center text-sm text-neutral-600">
              <p>
                {linkState === "expired" && "Ce QR a expiré."}
                {linkState === "cancelled" && "Connexion refusée depuis le téléphone."}
                {linkState === "error" && (error ?? "Une erreur est survenue.")}
              </p>
              <button
                onClick={createLink}
                className="rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] px-4 py-1.5 text-xs font-semibold text-[var(--accent-contrast)] transition hover:opacity-90"
              >
                Nouveau QR
              </button>
            </div>
          )}
        </div>
        {linkState === "ready" && (
          <p className="text-center text-xs text-muted">En attente de confirmation sur votre téléphone...</p>
        )}
      </div>
    </AuthShell>
  );
}
