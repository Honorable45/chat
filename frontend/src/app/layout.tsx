import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Glotta",
  description: "Messagerie instantanée multilingue avec vocaux traduits en temps réel.",
  manifest: "/manifest.webmanifest",
};

// themeColor vit dans un export séparé de `metadata` depuis les versions
// récentes de Next.js (metadata.themeColor est déprécié) — voir
// node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md.
export const viewport: Viewport = {
  themeColor: "#7c6cf6",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // Le script ci-dessous pose `data-theme` avant l'hydratation React,
      // qui ne peut donc jamais correspondre au HTML rendu côté serveur
      // (celui-ci ignore forcément le choix stocké en localStorage) — un
      // écart attendu et sans conséquence sur cet attribut précis, jamais
      // sur le contenu. Même technique que la librairie next-themes.
      suppressHydrationWarning
    >
      <head>
        {/* Applique un choix de thème déjà enregistré AVANT tout rendu React
            — sans ça, un choix "Clair" flasherait en sombre le temps de
            l'hydratation (voir lib/theme.ts). Script minimal et autonome,
            jamais de dépendance externe chargée ici. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
