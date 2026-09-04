import type { AuthTokens } from "./types";

/**
 * Persistance des tokens en localStorage. Isolé dans son propre module (plutôt
 * que dans auth-context.tsx) pour que api.ts puisse y accéder sans dépendre
 * de React — le refresh-on-401 doit pouvoir se déclencher depuis un simple
 * appel fetch, pas seulement depuis un composant.
 */

const ACCESS_KEY = "glotta.accessToken";
const REFRESH_KEY = "glotta.refreshToken";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

export function getAccessToken(): string | null {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

export function setTokens(tokens: AuthTokens): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(ACCESS_KEY, tokens.accessToken);
  window.localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
}

export function clearTokens(): void {
  if (!isBrowser()) return;
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}
