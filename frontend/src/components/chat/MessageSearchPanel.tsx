"use client";

import { useEffect, useRef, useState } from "react";
import { SearchIcon, XIcon } from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { shortRelativeTime } from "@/lib/format";
import type { Message } from "@/lib/types";

function snippet(text: string, query: string): { before: string; match: string; after: string } {
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i === -1) return { before: text, match: "", after: "" };
  return { before: text.slice(0, i), match: text.slice(i, i + query.length), after: text.slice(i + query.length) };
}

/**
 * Recherche texte dans la conversation (bouton "Rechercher" de l'en-tête,
 * jusqu'ici marqué "bientôt disponible" — voir MessagesService.search côté
 * backend). S'affiche comme un panneau déroulant sous l'en-tête, jamais une
 * modale plein écran : on veut pouvoir cliquer un résultat sans perdre le
 * contexte de la conversation déjà affichée derrière.
 */
export function MessageSearchPanel({
  conversationId,
  onClose,
  onJumpToMessage,
}: {
  conversationId: string;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      // Différé : le corps d'un effet ne doit jamais déclencher de setState
      // de façon synchrone (react-hooks/set-state-in-effect).
      queueMicrotask(() => {
        setResults([]);
        setLoading(false);
      });
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
    });
    const timeout = setTimeout(() => {
      api.conversations
        .searchMessages(conversationId, q)
        .then((page) => {
          if (!cancelled) setResults(page.items);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof ApiError ? err.message : "Recherche impossible.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [conversationId, query]);

  return (
    <div className="absolute inset-x-0 top-full z-10 border-b border-border bg-surface shadow-2xl">
      <div className="relative border-b border-border p-3">
        <SearchIcon size={16} className="absolute top-1/2 left-6 -translate-y-1/2 text-muted" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher dans cette conversation..."
          className="w-full rounded-full border border-border bg-surface-raised py-2.5 pr-9 pl-9 text-sm outline-none placeholder:text-muted focus:border-[var(--accent)]"
        />
        <button
          onClick={onClose}
          aria-label="Fermer la recherche"
          className="absolute top-1/2 right-6 -translate-y-1/2 text-muted hover:text-foreground"
        >
          <XIcon size={16} />
        </button>
      </div>

      <div className="max-h-96 overflow-y-auto glotta-scroll-hidden">
        {loading && <p className="px-4 py-4 text-center text-sm text-muted">Recherche...</p>}
        {error && <p className="px-4 py-4 text-center text-sm text-danger">{error}</p>}
        {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
          <p className="px-4 py-4 text-center text-sm text-muted">Aucun message trouvé.</p>
        )}
        {!loading && query.trim().length < 2 && (
          <p className="px-4 py-4 text-center text-sm text-muted">Tapez au moins 2 caractères.</p>
        )}
        {results.map((m) => {
          const text = m.text ?? "";
          const { before, match, after } = snippet(text, query.trim());
          return (
            <button
              key={m.id}
              onClick={() => onJumpToMessage(m.id)}
              className="flex w-full flex-col gap-0.5 border-b border-border px-4 py-2.5 text-left transition last:border-b-0 hover:bg-surface-raised"
            >
              <span className="text-xs text-muted">{shortRelativeTime(m.sentAt)}</span>
              <span className="truncate text-sm text-foreground">
                {before}
                <span className="bg-[var(--accent-2)]/25 font-semibold">{match}</span>
                {after}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
