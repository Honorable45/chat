import { clearTokens, getAccessToken, getRefreshToken, setTokens } from "./token-store";
import type { AdminMetrics, AdminUser, ApiErrorBody, AuthResponse, Me, Page, Report, ReportStatus } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Réduit la forme d'erreur Nest à un message affichable — même logique que frontend/src/lib/api.ts. */
function extractErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const { message } = body as ApiErrorBody;
  if (typeof message === "string") return message;
  if (message && typeof message === "object") {
    if (Array.isArray(message.message)) return message.message[0] ?? fallback;
    if (typeof message.message === "string") return message.message;
  }
  return fallback;
}

let refreshInFlight: Promise<boolean> | null = null;

/** Un seul refresh à la fois — même garde qu'en frontend/src/lib/api.ts. */
async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return false;
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as AuthResponse;
        setTokens(data);
        return true;
      } catch {
        return false;
      }
    })();
  }
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  _retried?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true, _retried = false } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && auth && !_retried) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request<T>(path, { ...options, _retried: true });
    }
    clearTokens();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("glotta-admin:unauthorized"));
    }
    throw new ApiError("Session expirée.", 401);
  }

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new ApiError(extractErrorMessage(data, "Une erreur est survenue. Merci de réessayer."), res.status);
  }

  return data as T;
}

export const api = {
  auth: {
    login: (identifier: string, password: string) =>
      request<AuthResponse>("/auth/login", { method: "POST", body: { identifier, password }, auth: false }),
    logout: () => request<void>("/auth/logout", { method: "POST" }),
  },
  users: {
    me: () => request<Me>("/users/me"),
  },
  admin: {
    metrics: () => request<AdminMetrics>("/admin/metrics"),
    listUsers: (params: { q?: string; cursor?: string } = {}) => {
      const query = new URLSearchParams();
      if (params.q) query.set("q", params.q);
      if (params.cursor) query.set("cursor", params.cursor);
      const qs = query.toString();
      return request<Page<AdminUser>>(`/admin/users${qs ? `?${qs}` : ""}`);
    },
    setUserActive: (id: string, isActive: boolean) =>
      request<AdminUser>(`/admin/users/${id}`, { method: "PATCH", body: { isActive } }),
    listReports: (params: { status?: ReportStatus; cursor?: string } = {}) => {
      const query = new URLSearchParams();
      if (params.status) query.set("status", params.status);
      if (params.cursor) query.set("cursor", params.cursor);
      const qs = query.toString();
      return request<Page<Report>>(`/admin/reports${qs ? `?${qs}` : ""}`);
    },
    resolveReport: (id: string, action: "DISMISS" | "REMOVE_CONTENT") =>
      request<Report>(`/admin/reports/${id}`, { method: "PATCH", body: { action } }),
  },
};
