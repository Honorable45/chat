/** Petits utilitaires d'affichage partagés par les composants du chat. */

export function displayName(p: { firstName: string; lastName: string }): string {
  return `${p.firstName} ${p.lastName}`.trim();
}

export function initials(p: { firstName: string; lastName: string }): string {
  const a = p.firstName.trim().charAt(0);
  const b = p.lastName.trim().charAt(0);
  return `${a}${b}`.toUpperCase() || "?";
}

/** Résumé compact d'un message pour un aperçu de citation ("répondre à...")
 * — utilisé à la fois dans la barre de composition (MessageInput) et dans
 * l'aperçu cité affiché à l'intérieur d'une bulle (MessageBubble). */
export function quotedMessagePreview(m: {
  type: string;
  text: string | null;
  deletedAt?: string | null;
}): string {
  if (m.deletedAt) return "Message supprimé";
  switch (m.type) {
    case "IMAGE":
      return m.text ? `📷 ${m.text}` : "📷 Photo";
    case "MEDIA_ALBUM":
      return "📷 Média";
    case "VOICE":
      return "🎤 Message vocal";
    case "CALL":
      return "📞 Appel";
    case "GROUP_CALL":
      return "📞 Appel de groupe";
    case "CONTACT_SHARE":
      return "👤 Contact partagé";
    case "LOCATION":
      return "📍 Position";
    case "SYSTEM":
      return "Message système";
    default:
      return m.text ?? "Message";
  }
}

// Dégradés déterministes (même id -> même dégradé) pour les avatars sans
// photo : pas de dépendance réseau, jamais de contenu généré présenté comme
// une vraie photo.
const AVATAR_GRADIENTS = [
  ["#7c6cf6", "#22d3ee"],
  ["#ec4899", "#7c6cf6"],
  ["#f59e0b", "#ef4444"],
  ["#22d3ee", "#34d399"],
  ["#a855f7", "#ec4899"],
  ["#34d399", "#7c6cf6"],
];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function avatarGradient(seed: string): string {
  const [from, to] = AVATAR_GRADIENTS[hashString(seed) % AVATAR_GRADIENTS.length];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 1000 * 60 * 60 * 24 * 365],
  ["month", 1000 * 60 * 60 * 24 * 30],
  ["week", 1000 * 60 * 60 * 24 * 7],
  ["day", 1000 * 60 * 60 * 24],
  ["hour", 1000 * 60 * 60],
  ["minute", 1000 * 60],
];

const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto", style: "narrow" });

/** "3m", "2h", "à l'instant"... — court, pour les listes/en-têtes. */
export function shortRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const diffMs = new Date(iso).getTime() - Date.now();
  const diffAbs = Math.abs(diffMs);

  if (diffAbs < 60_000) return "à l'instant";

  for (const [unit, ms] of RELATIVE_UNITS) {
    if (diffAbs >= ms || unit === "minute") {
      const value = Math.round(diffMs / ms);
      return rtf.format(value, unit).replace("il y a ", "").replace("dans ", "");
    }
  }
  return "";
}

/** "Septembre 2025" — pour "Membre depuis" dans l'aperçu de profil. */
export function monthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

export function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
