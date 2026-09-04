/**
 * Thème clair/sombre — trois états ("light"/"dark"/"system"), jamais deux.
 * Un choix explicite pose `data-theme` sur <html> (gagne toujours, dans les
 * deux sens) ; "system" retire cet attribut et laisse `prefers-color-scheme`
 * décider (voir globals.css pour les deux jeux de valeurs). Le script
 * injecté dans <head> (voir app/layout.tsx) applique ce même choix AVANT
 * l'hydratation React, pour ne jamais montrer un flash du mauvais thème.
 */

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "glotta.theme";

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
 * texte. Doit rester autonome (aucune référence à une variable externe) et
 * volontairement dupliqué en syntaxe pure plutôt que d'appeler les fonctions
 * ci-dessus, qui ne sont pas encore chargées à ce stade.
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
