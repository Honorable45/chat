"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, ApiError } from "@/lib/api";
import type { AdminUser } from "@/lib/types";

export default function UsersPage() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    // Différé : le corps d'un effet ne doit jamais déclencher de setState de
    // façon synchrone (react-hooks/set-state-in-effect).
    queueMicrotask(() => {
      setLoading(true);
      setError(null);
    });
    const timeout = setTimeout(() => {
      api.admin
        .listUsers({ q: q || undefined })
        .then((page) => {
          setUsers(page.items);
          setNextCursor(page.nextCursor);
        })
        .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les utilisateurs."))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await api.admin.listUsers({ q: query.trim() || undefined, cursor: nextCursor });
      setUsers((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de charger la suite.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggleActive(user: AdminUser) {
    setBusyId(user.id);
    try {
      const updated = await api.admin.setUserActive(user.id, !user.isActive);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de modifier ce compte.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Shell>
      <h1 className="mb-5 text-lg font-semibold">Utilisateurs</h1>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Chercher par nom d'utilisateur ou email..."
        className="mb-4 w-full max-w-sm rounded-xl border border-border bg-surface-raised px-3.5 py-2.5 text-sm outline-none placeholder:text-muted focus:border-[var(--accent)]"
      />

      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      {loading && <p className="text-sm text-muted">Chargement...</p>}
      {!loading && users.length === 0 && <p className="text-sm text-muted">Aucun utilisateur trouvé.</p>}

      {!loading && users.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-raised text-xs tracking-wide text-muted uppercase">
              <tr>
                <th className="px-4 py-2.5">Nom</th>
                <th className="px-4 py-2.5">Nom d&rsquo;utilisateur</th>
                <th className="px-4 py-2.5">Email</th>
                <th className="px-4 py-2.5">Rôle</th>
                <th className="px-4 py-2.5">Statut</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2.5">{u.firstName} {u.lastName}</td>
                  <td className="px-4 py-2.5 text-muted">@{u.username}</td>
                  <td className="px-4 py-2.5 text-muted">{u.email ?? "—"}</td>
                  <td className="px-4 py-2.5">{u.role === "ADMIN" ? "Admin" : "Utilisateur"}</td>
                  <td className="px-4 py-2.5">
                    <span className={u.isActive ? "text-online" : "text-danger"}>
                      {u.isActive ? "Actif" : "Désactivé"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => void toggleActive(u)}
                      disabled={busyId === u.id}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs transition hover:bg-surface-raised disabled:opacity-50"
                    >
                      {u.isActive ? "Désactiver" : "Réactiver"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor && (
        <button
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="mt-4 rounded-xl border border-border px-4 py-2 text-sm transition hover:bg-surface-raised disabled:opacity-60"
        >
          {loadingMore ? "Chargement..." : "Charger plus"}
        </button>
      )}
    </Shell>
  );
}
