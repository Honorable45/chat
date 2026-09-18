import type { NextConfig } from "next";

// Origine du backend (API REST + WebSocket) — nécessaire dans `connect-src`
// puisque cette app et le backend vivent sur des origines différentes en
// développement (localhost:3000 vs localhost:4000) et le plus souvent aussi
// en production (Vercel vs Render/Railway) : `default-src 'self'` seul
// bloquerait silencieusement tout fetch()/WebSocket vers le backend.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";
const apiOrigin = new URL(API_URL).origin;
const wsOrigin = apiOrigin.replace(/^http/, "ws");

// En-têtes de sécurité (audit de sécurité) — la CSP backend (helmet) reste
// désactivée par choix (voir main.ts côté backend, cette API ne sert pas de
// HTML applicatif) : c'est ici, côté page HTML réellement servie au
// navigateur, qu'elle a un sens. `script-src`/`style-src` gardent
// 'unsafe-inline' : le script d'initialisation du thème (voir
// lib/theme.ts, exécuté avant tout paint pour éviter un flash du mauvais
// thème) et les styles inline React (Tailwind + quelques dégradés en
// `style={{}}`) en dépendent tous les deux — les retirer nécessiterait soit
// un nonce par requête (middleware supplémentaire, hors scope de cette
// passe), soit un hash figé fragile à chaque modification de ces fichiers.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin} ${wsOrigin}`,
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
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self)" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
