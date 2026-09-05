import type { AuthTokens } from "./types";

/**
 * Persistance des tokens en localStorage — même approche que l'app
 * principale (frontend/src/lib/token-store.ts), clés préfixées
 * "glotta-admin" (deux origines distinctes de toute façon, mais évite toute
 * confusion). Isolé de React pour qu'api.ts puisse y accéder directement.
 */

const ACCESS_KEY = "glotta-admin.accessToken";
const REFRESH_KEY = "glotta-admin.refreshToken";

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
