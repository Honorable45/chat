"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "./api";
import { clearTokens, getAccessToken, setTokens } from "./token-store";
import type { Me } from "./types";

/**
 * "forbidden" (nouvel état, absent de l'app principale) : connecté avec un
 * compte réel mais sans le rôle ADMIN — jamais rediriger vers /login dans ce
 * cas (le compte est valide), afficher "Accès refusé" à la place. La vraie
 * décision d'autorisation reste de toute façon côté serveur (AdminGuard) :
 * cet état ne sert qu'à afficher la bonne chose, jamais une garantie de sécurité.
 */
type AuthStatus = "loading" | "authenticated" | "forbidden" | "anonymous";

interface AuthContextValue {
  user: Me | null;
  status: AuthStatus;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const router = useRouter();

  const loadMe = useCallback(async () => {
    if (!getAccessToken()) {
      setUser(null);
      setStatus("anonymous");
      return;
    }
    try {
      const me = await api.users.me();
      setUser(me);
      setStatus(me.role === "ADMIN" ? "authenticated" : "forbidden");
    } catch {
      clearTokens();
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => {
    // queueMicrotask : le corps de l'effet ne doit jamais déclencher de
    // setState de façon synchrone, même via une fonction async (même
    // principe que frontend/src/lib/auth-context.tsx).
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadMe();
    });
    return () => {
      cancelled = true;
    };
  }, [loadMe]);

  useEffect(() => {
    function onUnauthorized() {
      setUser(null);
      setStatus("anonymous");
      router.replace("/login");
    }
    window.addEventListener("glotta-admin:unauthorized", onUnauthorized);
    return () => window.removeEventListener("glotta-admin:unauthorized", onUnauthorized);
  }, [router]);

  const login = useCallback(async (identifier: string, password: string) => {
    const res = await api.auth.login(identifier, password);
    setTokens(res);
    const me = await api.users.me();
    setUser(me);
    setStatus(me.role === "ADMIN" ? "authenticated" : "forbidden");
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    } finally {
      clearTokens();
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => ({ user, status, login, logout }), [user, status, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé sous AuthProvider.");
  return ctx;
}
