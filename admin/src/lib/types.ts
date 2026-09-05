// Formes minimales — seulement ce que l'app admin consomme réellement,
// jamais une copie complète de frontend/src/lib/types.ts (surface bien plus
// large, dont l'admin n'a pas besoin).

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse extends AuthTokens {
  user: { id: string; username: string; firstName: string; lastName: string };
}

/** Forme d'erreur Nest (voir ApiExceptionFilter côté backend). */
export interface ApiErrorBody {
  message?: string | { message?: string | string[] };
}

export type Role = "USER" | "ADMIN";

/** Voir GET /users/me côté backend (UsersService.toMeDto) — seuls les champs utiles ici. */
export interface Me {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string | null;
  role: Role;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface AdminMetrics {
  users: { total: number; active: number };
  messagesSent: { total: number; last7Days: number };
  calls: { total: number };
  activeStatuses: number;
  reports: { pending: number };
}

export interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  firstName: string;
  lastName: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  lastSeenAt: string | null;
}

export type ReportTargetType = "MESSAGE" | "STATUS" | "USER";
export type ReportStatus = "PENDING" | "RESOLVED" | "DISMISSED";

export interface Report {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  status: ReportStatus;
  createdAt: string;
  reporter: { id: string; username: string; firstName: string; lastName: string };
  targetPreview: string | null;
}
