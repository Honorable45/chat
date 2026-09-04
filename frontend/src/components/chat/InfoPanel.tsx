"use client";

import { useEffect, useState } from "react";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { Avatar } from "@/components/Avatar";
import { PlayIcon, XIcon } from "@/components/icons";
import { MediaGalleryLightbox, type GalleryItem } from "@/components/MediaGalleryLightbox";
import { Toggle } from "@/components/Toggle";
import { api, ApiError } from "@/lib/api";
import { displayName, shortRelativeTime } from "@/lib/format";
import { useAuthenticatedBlobUrl } from "@/lib/use-authenticated-blob-url";
import type { Conversation, MessageAttachment } from "@/lib/types";

/** Vignette vidéo pour la grille "Médias partagés" — même principe que
 * VideoThumbnail dans MediaAlbumGrid.tsx (pas de lecture, juste une image
 * réelle de la première image du fichier, jamais une miniature générée). */
function MediaTileVideo({ attachment }: { attachment: MessageAttachment }) {
  const { url, failed } = useAuthenticatedBlobUrl(attachment.url);
  return (
    <div className="relative h-full w-full">
      {failed ? (
        <span className="flex h-full w-full items-center justify-center bg-surface text-xs text-muted">
          Indisponible
        </span>
      ) : !url ? (
        <span className="flex h-full w-full items-center justify-center bg-surface">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-transparent" />
        </span>
      ) : (

        <video src={url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
      )}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/15">
        <PlayIcon size={18} className="text-white drop-shadow" />
      </span>
    </div>
  );
}

/**
 * Galerie "Médias partagés" — les vraies pièces jointes IMAGE/VIDEO de la
 * conversation (voir MessagesService.listMedia côté backend), plus jamais
 * les dégradés de couleur codés en dur d'une ancienne maquette jamais
 * terminée (bug réel constaté en testant l'interface).
 */
function toDisplayAttachment(m: MessageAttachment): MessageAttachment {
  // L'URL renvoyée par le backend est relative (`/api/...`) — jamais
  // utilisable telle quelle si le frontend n'est pas servi depuis la même
  // origine (voir MessageBubble/MediaAlbumGrid, qui la reconstruisent déjà
  // de la même façon plutôt que de faire confiance au champ `url` du DTO).
  return { ...m, url: api.messages.attachmentUrl(m.id) };
}

function SharedMediaGrid({ conversationId }: { conversationId: string }) {
  const [media, setMedia] = useState<MessageAttachment[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Réinitialise pendant le rendu quand la conversation change (motif
  // recommandé par React plutôt qu'un setState direct dans l'effet — voir
  // le commentaire équivalent dans SettingsPage.tsx).
  const [syncedConversationId, setSyncedConversationId] = useState(conversationId);
  if (conversationId !== syncedConversationId) {
    setSyncedConversationId(conversationId);
    setMedia(null);
    setNextCursor(null);
  }

  useEffect(() => {
    api.conversations
      .media(conversationId)
      .then((page) => {
        setMedia(page.items.map(toDisplayAttachment));
        setNextCursor(page.nextCursor);
      })
      .catch(() => setMedia([]));
  }, [conversationId]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.conversations.media(conversationId, nextCursor);
      setMedia((prev) => [...(prev ?? []), ...page.items.map(toDisplayAttachment)]);
      setNextCursor(page.nextCursor);
    } catch {
      // Best-effort : la galerie reste utilisable avec ce qui est déjà chargé.
    } finally {
      setLoadingMore(false);
    }
  }

  if (media === null) {
    return <p className="text-sm text-muted">Chargement...</p>;
  }
  if (media.length === 0) {
    return <p className="text-sm text-muted">Aucun média partagé pour l&rsquo;instant.</p>;
  }

  const galleryItems: GalleryItem[] = media.map((m) => ({ url: m.url, type: m.type }));

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {media.map((m, i) => (
          <button
            key={m.id}
            onClick={() => setLightboxIndex(i)}
            className="aspect-square overflow-hidden rounded-xl bg-surface"
            aria-label="Agrandir"
          >
            {m.type === "VIDEO" ? (
              <MediaTileVideo attachment={m} />
            ) : (
              <AuthenticatedImage src={m.url} alt="" className="h-full w-full object-cover" />
            )}
          </button>
        ))}
      </div>
      {nextCursor && (
        <button
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="mt-2.5 w-full rounded-full border border-border py-1.5 text-xs text-muted transition hover:bg-surface-raised disabled:opacity-60"
        >
          {loadingMore ? "Chargement..." : "Charger plus"}
        </button>
      )}
      {lightboxIndex !== null && (
        <MediaGalleryLightbox items={galleryItems} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      )}
    </>
  );
}

export function InfoPanel({
  conversation,
  onClose,
  onUpdated,
}: {
  conversation: Conversation;
  onClose: () => void;
  onUpdated: (conversation: Conversation) => void;
}) {
  const [savingMute, setSavingMute] = useState(false);
  const other = conversation.otherParticipant;
  // Compte réel : une conversation DIRECT a toujours exactement 2 membres.
  // Aucun chiffre fictif ici — voir la décision prise avec l'utilisateur au
  // sujet de cette maquette (à l'origine pensée pour un groupe).
  const onlineCount = conversation.members.filter((m) => m.isOnline).length;

  async function toggleMute() {
    setSavingMute(true);
    try {
      const updated = await api.conversations.updateMembership(conversation.id, {
        isMuted: !conversation.myMembership.isMuted,
      });
      onUpdated(updated);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    } finally {
      setSavingMute(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex min-h-0 w-full flex-col bg-background lg:static lg:z-auto lg:w-80 lg:shrink-0 lg:border-l lg:border-border">
      <div className="flex items-center justify-between px-4 py-4">
        <h2 className="text-sm font-semibold">Infos de la conversation</h2>
        <button onClick={onClose} className="text-muted hover:text-foreground" aria-label="Fermer">
          <XIcon size={18} />
        </button>
      </div>

      <div className="min-h-0 flex flex-1 flex-col overflow-y-auto glotta-scroll-hidden px-4 pb-6">
        {other && (
          <div className="mb-5 flex flex-col items-center gap-2 text-center">
            <Avatar firstName={other.firstName} lastName={other.lastName} avatarUrl={other.avatarUrl} online={other.isOnline} size={72} />
            <p className="text-base font-semibold">{displayName(other)}</p>
            <p className="text-xs text-muted">
              {other.isOnline ? "En ligne" : other.lastSeenAt ? `Vu ${shortRelativeTime(other.lastSeenAt)}` : "Hors ligne"}
            </p>
            <p className="text-xs text-muted">
              {conversation.members.length} membres • {onlineCount} en ligne
            </p>
          </div>
        )}

        {other?.statusText && (
          <div className="mb-5">
            <p className="mb-1.5 text-xs font-medium tracking-wide text-muted uppercase">À propos</p>
            <p className="text-sm text-muted-strong">{other.statusText}</p>
          </div>
        )}

        <div className="mb-5 flex items-center justify-between rounded-xl border border-border bg-surface-raised px-3.5 py-2.5">
          <span className="text-sm">Notifications</span>
          <Toggle checked={!conversation.myMembership.isMuted} onChange={toggleMute} disabled={savingMute} />
        </div>

        <div className="mb-3">
          <p className="mb-1.5 text-xs font-medium tracking-wide text-muted uppercase">Membres</p>
          <div className="flex flex-col gap-1">
            {conversation.members.map((m) => (
              <div key={m.id} className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5">
                <Avatar firstName={m.firstName} lastName={m.lastName} avatarUrl={m.avatarUrl} online={m.isOnline} size={32} />
                <span className="truncate text-sm">{displayName(m)}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium tracking-wide text-muted uppercase">Médias partagés</p>
          <SharedMediaGrid conversationId={conversation.id} />
        </div>
      </div>
    </div>
  );
}
