/** Bouton d'action principal des sections de paramètres — largeur au
 * contenu, contrairement à primaryButtonClassName (auth) qui est pensé pour
 * un formulaire pleine largeur. */
export const saveButtonClassName =
  "rounded-xl bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] px-6 py-2.5 text-sm font-semibold text-[var(--accent-contrast)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

export const sectionLabelClassName = "mb-1 block text-xs font-medium text-muted-strong";

/** Drapeau associé aux langues réellement seedées (voir prisma/seed.ts) —
 * volontairement pas de table pays↔langue générique : un code non listé
 * ici n'affiche aucun drapeau plutôt qu'un mauvais. */
const LANGUAGE_FLAGS: Record<string, string> = {
  fr: "🇫🇷",
  en: "🇬🇧",
  es: "🇪🇸",
  pt: "🇵🇹",
};

export function languageFlag(code: string): string | null {
  return LANGUAGE_FLAGS[code] ?? null;
}
