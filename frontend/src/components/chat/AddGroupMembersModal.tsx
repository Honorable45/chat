"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { CheckIcon, SearchIcon, XIcon } from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { displayName } from "@/lib/format";
import type { Conversation, PublicUser } from "@/lib/types";

/** Même pattern de recherche/sélection multiple que GroupCreateModal (étape
 * 1), réutilisé tel quel pour ajouter des membres à un groupe existant. */
export function AddGroupMembersModal({
  conversationId,
  existingMemberIds,
  onClose,
  onAdded,
}: {
  conversationId: string;
  existingMemberIds: Set<string>;
  onClose: () => void;
  onAdded: (conversation: Conversation) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Map<string, PublicUser>>(new Map());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    const timeout = setTimeout(() => {
      if (q.length < 2) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      api.users
        .search(q)
        .then((users) => setResults(users.filter((u) => !existingMemberIds.has(u.id))))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- existingMemberIds est stable pour la durée de vie de ce modal (le groupe ne change pas pendant qu'il est ouvert).
  }, [query]);

  function toggleSelect(user: PublicUser) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(user.id)) next.delete(user.id);
      else next.set(user.id, user);
      return next;
    });
  }

  async function submit() {
    if (selected.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      const conversation = await api.conversations.addMembers(conversationId, [...selected.keys()]);
      onAdded(conversation);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'ajouter ces membres.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-20" onClick={onClose}>
      <div
        className="flex max-h-[75vh] w-full max-w-md flex-col rounded-2xl border border-border bg-surface-raised p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Ajouter des membres</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground" aria-label="Fermer">
            <XIcon size={18} />
          </button>
        </div>

        {error && <p className="mb-2 text-sm text-danger">{error}</p>}

        <div className="relative mb-3">
          <SearchIcon size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Chercher par nom d'utilisateur..."
            className="w-full rounded-xl border border-border bg-surface px-9 py-2.5 text-sm outline-none placeholder:text-muted focus:border-[var(--accent)]"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto glotta-scroll-hidden">
          {loading && <p className="px-2 py-4 text-center text-sm text-muted">Recherche...</p>}
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <p className="px-2 py-4 text-center text-sm text-muted">Aucun résultat.</p>
          )}
          {results.map((user) => {
            const isSelected = selected.has(user.id);
            return (
              <button
                key={user.id}
                onClick={() => toggleSelect(user)}
                className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-surface"
              >
                <Avatar firstName={user.firstName} lastName={user.lastName} avatarUrl={user.avatarUrl} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{displayName(user)}</span>
                  <span className="block truncate text-xs text-muted">@{user.username}</span>
                </span>
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    isSelected ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]" : "border-border"
                  }`}
                >
                  {isSelected && <CheckIcon size={12} />}
                </span>
              </button>
            );
          })}
        </div>

        <button
          onClick={() => void submit()}
          disabled={selected.size === 0 || saving}
          className="mt-3 w-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition disabled:opacity-40"
        >
          {saving ? "Ajout..." : `Ajouter (${selected.size})`}
        </button>
      </div>
    </div>
  );
}
