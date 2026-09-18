import type { NextConfig } from "next";

// Même raisonnement que frontend/next.config.ts : origine du backend
// distincte de celle de cette app, nécessaire dans `connect-src`.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";
const apiOrigin = new URL(API_URL).origin;

// En-têtes de sécurité (audit de sécurité) — 'unsafe-inline' conservé pour
// script-src/style-src pour les mêmes raisons que frontend/next.config.ts
// (script d'initialisation du thème, styles inline React/Tailwind).
// Pas de connexion WebSocket dans cette app (contrairement au frontend
// principal) : `connect-src` n'a besoin que de l'origine HTTP du backend.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
