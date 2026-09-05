/**
 * Thème clair/sombre — même logique que l'app principale
 * (frontend/src/lib/theme.ts) : trois états, jamais deux. Clé localStorage
 * différente (préfixe "glotta-admin") — deux origines distinctes de toute
 * façon (ports différents), mais évite toute confusion si un jour servies
 * sous le même domaine.
 */

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "glotta-admin.theme";

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === "light" || raw === "dark" ? raw : "system";
}

export function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  if (mode === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", mode);
  }
}

export function setStoredTheme(mode: ThemeMode): void {
  if (typeof window === "undefined") return;
  if (mode === "system") {
    window.localStorage.removeItem(STORAGE_KEY);
  } else {
    window.localStorage.setItem(STORAGE_KEY, mode);
  }
  applyTheme(mode);
}

/**
 * Code exécuté tel quel dans un <script> inline en tête de page (voir
 * app/layout.tsx) — jamais importé/exécuté par React, juste sérialisé en
 * texte. Doit rester autonome, aucune référence aux fonctions ci-dessus.
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    if (stored === 'light' || stored === 'dark') {
      document.documentElement.setAttribute('data-theme', stored);
    }
  } catch (e) {}
})();
`;
