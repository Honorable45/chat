import type { MetadataRoute } from "next";

// Convention Next.js (app/manifest.ts) — servi automatiquement à
// /manifest.webmanifest, jamais un public/manifest.json statique à
// maintenir à la main. Couleurs alignées sur les tokens --background/
// --accent du thème sombre par défaut (globals.css).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Glotta",
    short_name: "Glotta",
    description: "Messagerie instantanée multilingue avec vocaux traduits en temps réel.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a12",
    theme_color: "#7c6cf6",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
