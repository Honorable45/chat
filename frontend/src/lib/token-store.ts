import type { AuthTokens } from "./types";

/**
 * Accès en mémoire uniquement (audit de sécurité — migration hors
 * localStorage). Le refresh token n'est plus jamais stocké ni lu côté JS :
 * il vit exclusivement dans le cookie httpOnly `glotta_refresh` posé par le
 * backend (voir auth-cookies.util.ts côté backend, et refreshSession
 * ci-dessous dans api.ts), invisible et donc invulnérable à un vol par XSS.
 *
 * L'access token, lui, reste nécessairement lisible en JS : plusieurs
 * fetch de médias authentifiés (voix, avatars, pièces jointes — voir
 * use-authenticated-blob-url.ts, VoiceMessageBubble.tsx,
 * StatusVoicePlayer.tsx) l'attachent manuellement en en-tête Authorization,
 * de même que la poignée de main Socket.IO (voir socket.ts/use-call.ts/
 * use-group-call.ts) — aucun de ces appels ne peut se reposer sur un cookie
 * httpOnly, invisible par construction à ce code. Il n'est en revanche
 * conservé qu'EN MÉMOIRE (jamais sur disque) : contrairement à
 * localStorage, cette valeur disparaît à la fermeture de l'onglet et n'est
 * jamais lisible après coup par un script injecté qui s'exécuterait plus
 * tard. Au rechargement de la page, AuthProvider la reconstitue via
 * refreshSession() (voir api.ts), qui s'appuie sur le cookie httpOnly.
 */
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setTokens(tokens: AuthTokens): void {
  accessToken = tokens.accessToken;
}

export function clearTokens(): void {
  accessToken = null;
}
