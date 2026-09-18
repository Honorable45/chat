import type { Response } from 'express';

/**
 * Migration additive hors de `localStorage` côté web (audit de sécurité) :
 * en plus du corps JSON existant (inchangé, le mobile continue de le lire
 * tel quel via l'en-tête Authorization), login/register/refresh posent
 * aussi ces deux cookies httpOnly — inaccessibles au JS, donc jamais
 * exfiltrables par une XSS frontend. `glotta_refresh` est scopé à
 * `/api/auth/refresh` uniquement (moindre exposition : aucune autre route
 * n'a besoin de le lire).
 */
export const ACCESS_TOKEN_COOKIE_NAME = 'glotta_access';
export const REFRESH_TOKEN_COOKIE_NAME = 'glotta_refresh';

// Alignées sur les valeurs par défaut de JWT_ACCESS_EXPIRES_IN/
// JWT_REFRESH_EXPIRES_IN (voir .env.example) — un simple plafond de
// rétention côté navigateur, jamais la frontière de sécurité réelle : le
// token reste de toute façon revérifié (signature + expiration + session
// active en base, voir session-validation.util.ts) à chaque requête, quelle
// que soit la durée de vie du cookie qui le transporte.
const ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;

export interface CookieTokens {
  accessToken: string;
  refreshToken: string;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function setAuthCookies(res: Response, tokens: CookieTokens): void {
  res.cookie(ACCESS_TOKEN_COOKIE_NAME, tokens.accessToken, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/api',
    maxAge: ACCESS_COOKIE_MAX_AGE_MS,
  });
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, tokens.refreshToken, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/api/auth/refresh',
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE_NAME, { path: '/api' });
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { path: '/api/auth/refresh' });
}
