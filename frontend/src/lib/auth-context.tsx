"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError, type LoginInput, type RegisterInput } from "./api";
import { clearTokens, getAccessToken, setTokens } from "./token-store";
import type { Me } from "./types";

interface AuthContextValue {
  user: Me | null;
  /** null tant qu'on n'a pas fini de vérifier un éventuel token déjà stocké. */
  status: "loading" | "authenticated" | "anonymous";
  login: (dto: LoginInput) => Promise<void>;
  register: (dto: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [status, setStatus] = useState<AuthContextValue["status"]>("loading");
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
      setStatus("authenticated");
    } catch {
      // api.ts a déjà tenté un refresh avant d'arriver ici en cas de 401 —
      // un échec ici signifie une session réellement invalide.
      clearTokens();
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => {
    // queueMicrotask (et non un appel direct) : le corps de l'effet lui-même
    // ne doit jamais déclencher de setState de façon synchrone, même en
    // passant par une fonction async — react-hooks/set-state-in-effect ne
    // regarde que l'appel immédiat, pas s'il existe un `await` plus loin.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadMe();
    });
    return () => {
      cancelled = true;
    };
  }, [loadMe]);

  // api.ts déclenche cet événement quand un refresh échoue (session
  // réellement expirée) — c'est le seul endroit du code qui détient à la
  // fois l'état d'auth et le routeur Next, donc c'est ici que la
  // redirection doit avoir lieu (voir le commentaire dans api.ts).
  useEffect(() => {
    function onUnauthorized() {
      setUser(null);
      setStatus("anonymous");
      router.replace("/login");
    }
    window.addEventListener("glotta:unauthorized", onUnauthorized);
    return () => window.removeEventListener("glotta:unauthorized", onUnauthorized);
  }, [router]);

  const login = useCallback(async (dto: LoginInput) => {
    const res = await api.auth.login(dto);
    setTokens(res);
    setUser(await api.users.me());
    setStatus("authenticated");
  }, []);

  const register = useCallback(async (dto: RegisterInput) => {
    const res = await api.auth.register(dto);
    setTokens(res);
    setUser(await api.users.me());
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch (error) {
      // Une déconnexion doit toujours réussir côté client même si l'appel
      // réseau échoue (session déjà expirée, backend injoignable...).
      if (!(error instanceof ApiError)) throw error;
    } finally {
      clearTokens();
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, register, logout, refreshMe: loadMe }),
    [user, status, login, register, logout, loadMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé sous AuthProvider.");
  return ctx;
}
