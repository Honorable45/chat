"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { CheckIcon, ChevronLeftIcon, SearchIcon, XIcon } from "@/components/icons";
import { api, ApiError } from "@/lib/api";
import { displayName } from "@/lib/format";
import type { Conversation, PublicUser } from "@/lib/types";

/**
 * Assistant de création de groupe en 2 étapes (section 3) : sélection des
 * membres (recherche/debounce identique à NewConversationModal.tsx, mais
 * sélection multiple au lieu du clic-direct-démarre-la-conversation), puis
 * nom/description/photo. Le créateur devient automatiquement ADMIN côté
 * backend (voir ConversationsService.createGroup), jamais choisi ici.
 */
export function GroupCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (conversation: Conversation) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Map<string, PublicUser>>(new Map());
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [creating, setCreating] = useState(false);
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

  function toggleSelect(user: PublicUser) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(user.id)) next.delete(user.id);
      else next.set(user.id, user);
      return next;
    });
  }

  function pickPhoto(file: File | undefined) {
    if (!file) return;
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  async function submit() {
    if (!title.trim() || selected.size === 0) return;
    setCreating(true);
    setError(null);
    try {
      const conversation = await api.conversations.createGroup({
        title: title.trim(),
        description: description.trim() || undefined,
        memberIds: [...selected.keys()],
        photo: photo ?? undefined,
      });
      onCreated(conversation);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de créer le groupe.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/60 px-4 pt-20" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl border border-border bg-surface-raised p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {step === 2 && (
              <button
                onClick={() => setStep(1)}
                aria-label="Étape précédente"
                className="text-muted hover:text-foreground"
              >
                <ChevronLeftIcon size={18} />
              </button>
            )}
            <h2 className="text-sm font-semibold">
              {step === 1 ? "Sélectionner les membres" : "Détails du groupe"}
            </h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground" aria-label="Fermer">
            <XIcon size={18} />
          </button>
        </div>

        {error && <p className="mb-2 text-sm text-danger">{error}</p>}

        {step === 1 ? (
          <>
            {selected.size > 0 && (
              <div className="mb-2.5 flex flex-wrap gap-1.5">
                {[...selected.values()].map((u) => (
                  <button
                    key={u.id}
                    onClick={() => toggleSelect(u)}
                    className="flex items-center gap-1.5 rounded-full bg-surface px-2 py-1 text-xs transition hover:bg-border"
                  >
                    {displayName(u)}
                    <XIcon size={11} />
                  </button>
                ))}
              </div>
            )}

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
                <p className="px-2 py-4 text-center text-sm text-muted">Aucun utilisateur trouvé.</p>
              )}
              {!loading && query.trim().length < 2 && (
                <p className="px-2 py-4 text-center text-sm text-muted">Tapez au moins 2 caractères.</p>
              )}
              {results.map((user) => {
                const isSelected = selected.has(user.id);
                return (
                  <button
                    key={user.id}
                    onClick={() => toggleSelect(user)}
                    className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-surface"
                  >
                    <Avatar firstName={user.firstName} lastName={user.lastName} avatarUrl={user.avatarUrl} online={user.isOnline} size={36} />
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
              onClick={() => setStep(2)}
              disabled={selected.size === 0}
              className="mt-3 w-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition disabled:opacity-40"
            >
              Suivant ({selected.size} sélectionné{selected.size > 1 ? "s" : ""})
            </button>
          </>
        ) : (
          <>
            <div className="mb-4 flex flex-col items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => pickPhoto(e.target.files?.[0])}
              />
              <button onClick={() => fileInputRef.current?.click()} className="transition hover:opacity-80">
                {photoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- aperçu local (URL.createObjectURL), jamais un asset à optimiser.
                  <img src={photoPreview} alt="" className="h-20 w-20 rounded-full object-cover" />
                ) : (
                  <Avatar firstName={title || "Groupe"} lastName="" size={80} />
                )}
              </button>
              <span className="text-xs text-muted">Photo du groupe (optionnel)</span>
            </div>

            <label className="mb-1 block text-xs font-medium text-muted">Nom du groupe</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="ex. GL3 Algorithmique"
              maxLength={100}
              className="mb-3 w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none placeholder:text-muted focus:border-[var(--accent)]"
            />

            <label className="mb-1 block text-xs font-medium text-muted">Description (optionnel)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="ex. Groupe de travail pour les étudiants de Génie Logiciel."
              maxLength={500}
              rows={3}
              className="mb-4 w-full resize-none rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm outline-none placeholder:text-muted focus:border-[var(--accent)]"
            />

            <button
              onClick={() => void submit()}
              disabled={!title.trim() || creating}
              className="w-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] py-2.5 text-sm font-medium text-[var(--accent-contrast)] transition disabled:opacity-40"
            >
              {creating ? "Création..." : "Créer le groupe"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
