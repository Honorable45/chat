"use client";

import jsQR from "jsqr";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronLeftIcon } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { parseProfileUrl } from "@/lib/profile-link";

/**
 * Scanner un QR de profil (voir lib/profile-link.ts / ProfileShareSection)
 * — décodage réel côté client via `jsqr` sur les images de la caméra,
 * jamais une simulation. N'accepte que les liens reconnus comme un profil
 * Glotta (parseProfileUrl) : un QR quelconque scanné n'entraîne jamais de
 * navigation vers une destination arbitraire. Un champ "coller un lien"
 * reste disponible en repli (permission caméra refusée, pas de caméra, ou
 * simplement plus rapide pour un lien déjà copié).
 */
export default function ScanPage() {
  const router = useRouter();
  const { status: authStatus } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [pastedLink, setPastedLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus === "anonymous") router.replace("/login");
  }, [authStatus, router]);

  useEffect(() => {
    let cancelled = false;

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        frameRef.current = requestAnimationFrame(tick);
        return;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        frameRef.current = requestAnimationFrame(tick);
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code) {
        const userId = parseProfileUrl(code.data);
        if (userId) {
          router.push(`/profile/${userId}`);
          return;
        }
        // QR valide mais pas un lien de profil reconnu — on continue de scanner.
      }
      frameRef.current = requestAnimationFrame(tick);
    }

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
        frameRef.current = requestAnimationFrame(tick);
      })
      .catch(() => {
        if (!cancelled) setCameraError("Caméra indisponible — collez un lien de profil ci-dessous à la place.");
      });

    return () => {
      cancelled = true;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [router]);

  function openPastedLink() {
    const userId = parseProfileUrl(pastedLink);
    if (!userId) {
      setLinkError("Ce lien ne correspond pas à un profil Glotta.");
      return;
    }
    setLinkError(null);
    router.push(`/profile/${userId}`);
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <button
          onClick={() => router.back()}
          className="mb-4 flex items-center gap-1 text-sm text-muted transition hover:text-foreground"
        >
          <ChevronLeftIcon size={16} />
          Retour
        </button>

        <h1 className="mb-4 text-lg font-semibold">Scanner un code</h1>

        <div className="relative aspect-square overflow-hidden rounded-2xl border border-border bg-black">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          <canvas ref={canvasRef} hidden />
          {cameraError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4 text-center text-sm text-white">
              {cameraError}
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-muted">
          Visez le QR code du profil que vous souhaitez ouvrir.
        </p>

        <div className="mt-6 border-t border-border pt-5">
          <p className="mb-2 text-xs font-medium text-muted-strong">Ou collez un lien de profil</p>
          <div className="flex gap-2">
            <input
              value={pastedLink}
              onChange={(e) => setPastedLink(e.target.value)}
              placeholder="https://.../profile/..."
              className="flex-1 rounded-xl border border-border bg-surface-raised px-3.5 py-2.5 text-sm outline-none placeholder:text-muted focus:border-[var(--accent)]"
            />
            <button
              onClick={openPastedLink}
              disabled={!pastedLink.trim()}
              className="rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] px-4 py-2.5 text-sm font-semibold text-[var(--accent-contrast)] transition hover:opacity-90 disabled:opacity-50"
            >
              Ouvrir
            </button>
          </div>
          {linkError && <p className="mt-2 text-sm text-danger">{linkError}</p>}
        </div>
      </div>
    </div>
  );
}
