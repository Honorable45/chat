"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { CheckIcon, PersonIcon, PlusIcon, SearchIcon, XIcon } from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { displayName } from "@/lib/format";
import type { Conversation, ContactRequest, PublicUser } from "@/lib/types";

/**
 * Occupe la 2e colonne (même emplacement que ConversationList) quand
 * "Contacts" est sélectionné dans le rail d'icônes — même principe que
 * CallsPanel/StatusesPanel/NotificationsPanel (voir IconRail/chat/page.tsx).
 * Trois sections : demandes reçues en attente, recherche pour en envoyer une
 * nouvelle, puis la liste des contacts déjà acceptés (cliquer en ouvre/démarre
 * la conversation directe, même contrat que NewConversationModal.onStarted).
 */
export function ContactsPanel({
  onStartConversation,
  hiddenOnMobile,
}: {
  onStartConversation: (conversation: Conversation) => void;
  hiddenOnMobile?: boolean;
}) {
  const [contacts, setContacts] = useState<PublicUser[] | null>(null);
  const [incoming, setIncoming] = useState<ContactRequest[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.contacts
      .list()
      .then(setContacts)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les contacts."));
    api.contacts
      .requests("incoming")
      .then(setIncoming)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const q = query.trim();
    const timeout = setTimeout(() => {
      if (q.length < 2) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      api.users
        .search(q)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  async function sendRequest(userId: string) {
    setBusyId(userId);
    setError(null);
    try {
      await api.contacts.sendRequest(userId);
      setResults((prev) => prev.filter((u) => u.id !== userId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'envoyer la demande.");
    } finally {
      setBusyId(null);
    }
  }

  async function respond(request: ContactRequest, accept: boolean) {
    setBusyId(request.id);
    setError(null);
    try {
      if (accept) {
        await api.contacts.accept(request.id);
      } else {
        await api.contacts.decline(request.id);
      }
      setIncoming((prev) => prev.filter((r) => r.id !== request.id));
      if (accept) refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Action impossible.");
    } finally {
      setBusyId(null);
    }
  }

  async function openContact(contact: PublicUser) {
    setBusyId(contact.id);
    setError(null);
    try {
      const conversation = await api.conversations.createDirect(contact.id);
      onStartConversation(conversation);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'ouvrir la conversation.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className={`min-h-0 min-w-0 flex-1 flex-col border-r border-border lg:flex lg:w-80 lg:flex-none lg:shrink-0 ${
        hiddenOnMobile ? "hidden" : "flex"
      }`}
    >
      <div className="px-4 pt-4 pb-2">
        <h1 className="text-lg font-semibold">Contacts</h1>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <SearchIcon size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ajouter un contact par nom d'utilisateur..."
            className="w-full rounded-xl border border-border bg-surface px-9 py-2.5 text-sm outline-none placeholder:text-muted focus:border-[var(--accent)]"
          />
        </div>
      </div>

      {error && <p className="px-4 pb-2 text-sm text-danger">{error}</p>}

      <div className="min-h-0 flex-1 overflow-y-auto glotta-scroll-hidden p-2">
        {query.trim().length >= 2 ? (
          <>
            {searching && <p className="px-3 py-6 text-center text-sm text-muted">Recherche...</p>}
            {!searching && results.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted">Aucun utilisateur trouvé.</p>
            )}
            {results.map((user) => (
              <div key={user.id} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5">
                <Avatar firstName={user.firstName} lastName={user.lastName} avatarUrl={user.avatarUrl} online={user.isOnline} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{displayName(user)}</span>
                  <span className="block truncate text-xs text-muted">@{user.username}</span>
                </span>
                <button
                  onClick={() => void sendRequest(user.id)}
                  disabled={busyId === user.id}
                  aria-label="Envoyer une demande de contact"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[var(--accent-contrast)] transition disabled:opacity-50"
                >
                  <PlusIcon size={15} />
                </button>
              </div>
            ))}
          </>
        ) : (
          <>
            {incoming.length > 0 && (
              <div className="mb-2">
                <p className="px-2.5 pt-1 pb-2 text-xs font-medium tracking-wide text-muted uppercase">
                  Demandes reçues
                </p>
                {incoming.map((request) => (
                  <div key={request.id} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5">
                    <Avatar
                      firstName={request.user.firstName}
                      lastName={request.user.lastName}
                      avatarUrl={request.user.avatarUrl}
                      size={40}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{displayName(request.user)}</span>
                      <span className="block truncate text-xs text-muted">@{request.user.username}</span>
                    </span>
                    <button
                      onClick={() => void respond(request, false)}
                      disabled={busyId === request.id}
                      aria-label="Refuser"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-muted transition hover:text-danger disabled:opacity-50"
                    >
                      <XIcon size={14} />
                    </button>
                    <button
                      onClick={() => void respond(request, true)}
                      disabled={busyId === request.id}
                      aria-label="Accepter"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[var(--accent-contrast)] transition disabled:opacity-50"
                    >
                      <CheckIcon size={14} />
                    </button>
                  </div>
                ))}
                <div className="mx-2.5 my-2 h-px bg-border" />
              </div>
            )}

            {contacts === null && <p className="px-3 py-6 text-center text-sm text-muted">Chargement...</p>}
            {contacts?.length === 0 && incoming.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-3 py-10 text-center text-sm text-muted">
                <PersonIcon size={28} className="opacity-40" />
                <p>Aucun contact pour l&rsquo;instant. Cherchez un nom d&rsquo;utilisateur ci-dessus.</p>
              </div>
            )}
            {contacts?.map((contact) => (
              <button
                key={contact.id}
                onClick={() => void openContact(contact)}
                disabled={busyId === contact.id}
                className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition hover:bg-surface-raised disabled:opacity-60"
              >
                <Avatar
                  firstName={contact.firstName}
                  lastName={contact.lastName}
                  avatarUrl={contact.avatarUrl}
                  online={contact.isOnline}
                  size={40}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{displayName(contact)}</span>
                  <span className="block truncate text-xs text-muted">@{contact.username}</span>
                </span>
                {busyId === contact.id && (
                  <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
                )}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
