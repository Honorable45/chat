/** Contenu des JWT access et refresh — volontairement identique et minimal. */
export interface JwtPayload {
  sub: string; // userId
  sessionId: string;
}

/** Ce que `req.user` contient une fois `JwtAuthGuard` passé. */
export interface AuthenticatedUser {
  userId: string;
  sessionId: string;
}
