"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { SearchIcon, XIcon } from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { displayName } from "@/lib/format";
import type { Conversation, PublicUser } from "@/lib/types";

export function NewConversationModal({
  onClose,
  onStarted,
}: {
  onClose: () => void;
  onStarted: (conversation: Conversation) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
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
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  async function start(user: PublicUser) {
    setStartingId(user.id);
    setError(null);
    try {
      const conversation = await api.conversations.createDirect(user.id);
      onStarted(conversation);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de démarrer la conversation.");
    } finally {
      setStartingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/60 px-4 pt-24" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-surface-raised p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Nouvelle conversation</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            <XIcon size={18} />
          </button>
        </div>

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

        {error && <p className="mb-2 text-sm text-danger">{error}</p>}

        <div className="max-h-72 overflow-y-auto glotta-scroll-hidden">
          {loading && <p className="px-2 py-4 text-center text-sm text-muted">Recherche...</p>}
          {!loading && query.trim().length >= 2 && results.length === 0 && (
            <p className="px-2 py-4 text-center text-sm text-muted">Aucun utilisateur trouvé.</p>
          )}
          {!loading && query.trim().length < 2 && (
            <p className="px-2 py-4 text-center text-sm text-muted">Tapez au moins 2 caractères.</p>
          )}
          {results.map((user) => (
            <button
              key={user.id}
              onClick={() => start(user)}
              disabled={startingId !== null}
              className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-surface disabled:opacity-60"
            >
              <Avatar firstName={user.firstName} lastName={user.lastName} avatarUrl={user.avatarUrl} online={user.isOnline} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{displayName(user)}</span>
                <span className="block truncate text-xs text-muted">@{user.username}</span>
              </span>
              {startingId === user.id && (
                <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
