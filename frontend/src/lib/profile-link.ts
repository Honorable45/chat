/**
 * Lien de partage de profil — encode uniquement l'id utilisateur (déjà un
 * identifiant public non-sensible : exposé tel quel par GET /users/:id,
 * les URLs d'avatar, senderId des messages, etc. — jamais un mot de passe,
 * un token de session ou une donnée privée). Volontairement distinct de
 * tout flux de connexion : ce lien n'authentifie personne, il ne fait
 * qu'ouvrir un profil public pour qui est déjà connecté à Glotta (voir
 * app/profile/[userId]/page.tsx, protégé par JwtAuthGuard côté backend
 * comme n'importe quelle autre route authentifiée).
 */
export function profileUrl(userId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/profile/${userId}`;
}

/** Extrait l'id utilisateur d'un lien de profil scanné/collé, ou `null` si
 * le texte ne correspond pas à un lien de profil Glotta reconnu — jamais
 * de navigation vers une destination arbitraire à partir d'un QR code. */
export function parseProfileUrl(text: string): string | null {
  const trimmed = text.trim();
  try {
    const url = new URL(trimmed, typeof window !== "undefined" ? window.location.origin : undefined);
    const match = /^\/profile\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
