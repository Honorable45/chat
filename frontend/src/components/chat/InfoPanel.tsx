"use client";

import { useEffect, useRef, useState } from "react";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { Avatar } from "@/components/Avatar";
import { CheckIcon, PlayIcon, RefreshIcon, SettingsIcon, ShareIcon, ShieldIcon, TrashIcon, UsersIcon, XIcon } from "@/components/icons";
import { MediaGalleryLightbox, type GalleryItem } from "@/components/MediaGalleryLightbox";
import { Toggle } from "@/components/Toggle";
import { api, ApiError, isOwnBackendUrl } from "@/lib/api";
import { displayName, shortRelativeTime } from "@/lib/format";
import { useAuthenticatedBlobUrl } from "@/lib/use-authenticated-blob-url";
import type { Conversation, ConversationParticipant, GroupPermission, MessageAttachment } from "@/lib/types";
import { AddGroupMembersModal } from "./AddGroupMembersModal";

/** Vignette vidéo pour la grille "Médias partagés" — même principe que
 * VideoThumbnail dans MediaAlbumGrid.tsx (pas de lecture, juste une image
 * réelle de la première image du fichier, jamais une miniature générée).
 * Une pièce jointe Cloudinary est chargeable directement, jamais besoin du
 * détour par un Blob authentifié dans ce cas — reconnue via isOwnBackendUrl,
 * même exception que dans AuthenticatedVideo/VideoThumbnail (jamais un
 * simple test "URL absolue", voir leur commentaire). */
function MediaTileVideo({ attachment }: { attachment: MessageAttachment }) {
  if (!isOwnBackendUrl(attachment.url)) return <MediaTileVideoFrame url={attachment.url} />;
  return <MediaTileVideoProxy attachment={attachment} />;
}

function MediaTileVideoProxy({ attachment }: { attachment: MessageAttachment }) {
  const { url, failed } = useAuthenticatedBlobUrl(attachment.url);
  if (failed) {
    return (
      <div className="relative h-full w-full">
        <span className="flex h-full w-full items-center justify-center bg-surface text-xs text-muted">
          Indisponible
        </span>
      </div>
    );
  }
  if (!url) {
    return (
      <div className="relative h-full w-full">
        <span className="flex h-full w-full items-center justify-center bg-surface">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-transparent" />
        </span>
      </div>
    );
  }
  return <MediaTileVideoFrame url={url} />;
}

function MediaTileVideoFrame({ url }: { url: string }) {
  return (
    <div className="relative h-full w-full">
      <video src={url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
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
 * terminée (bug réel constaté en testant l'interface). L'URL de chaque
 * pièce jointe vient déjà résolue du DTO (proxy backend relatif, ou lien
 * Cloudinary déjà absolu selon storageProvider — voir
 * MessagesService.toAttachmentDto) : ne jamais la reconstruire ni la
 * repasser dans resolveMediaSrc ici, sous peine de casser la distinction
 * relative/absolue dont dépendent AuthenticatedImage/Video pour savoir si
 * un Blob authentifié est nécessaire (voir le même correctif dans
 * MessageBubble.tsx).
 */
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
        setMedia(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch(() => setMedia([]));
  }, [conversationId]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.conversations.media(conversationId, nextCursor);
      setMedia((prev) => [...(prev ?? []), ...page.items]);
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

const GROUP_PERMISSION_LABELS: Record<GroupPermission, string> = {
  ADMIN_ONLY: "Administrateurs uniquement",
  EVERYONE: "Tous les membres",
};

/** Petite confirmation inline (deux clics) plutôt qu'une boîte de dialogue
 * séparée — aucun composant de confirmation partagé n'existe encore dans
 * l'app, pas la peine d'en introduire un pour ces deux seuls usages. */
function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  danger,
  disabled,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted">{confirmLabel}</span>
        <button onClick={onConfirm} className="font-medium text-danger">
          Confirmer
        </button>
        <button onClick={() => setConfirming(false)} className="text-muted hover:text-foreground">
          Annuler
        </button>
      </div>
    );
  }
  return (
    <button
      onClick={() => setConfirming(true)}
      disabled={disabled}
      className={`w-full rounded-xl border px-3.5 py-2.5 text-left text-sm transition disabled:opacity-50 ${
        danger ? "border-danger/30 text-danger hover:bg-danger/10" : "border-border hover:bg-surface-raised"
      }`}
    >
      {label}
    </button>
  );
}

function MemberRow({
  member,
  isSelf,
  viewerIsAdmin,
  busy,
  onPromote,
  onDemote,
  onRemove,
}: {
  member: ConversationParticipant;
  isSelf: boolean;
  viewerIsAdmin: boolean;
  busy: boolean;
  onPromote: () => void;
  onDemote: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5">
      <Avatar firstName={member.firstName} lastName={member.lastName} avatarUrl={member.avatarUrl} online={member.isOnline} size={32} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">
          {displayName(member)} {isSelf && <span className="text-muted">(vous)</span>}
        </span>
        {member.role === "ADMIN" && (
          <span className="flex items-center gap-1 text-[11px] text-[var(--accent-2)]">
            <ShieldIcon size={11} /> Administrateur
          </span>
        )}
      </span>
      {viewerIsAdmin && !isSelf && (
        <span className="flex shrink-0 items-center gap-1">
          <button
            onClick={member.role === "ADMIN" ? onDemote : onPromote}
            disabled={busy}
            title={member.role === "ADMIN" ? "Retirer les droits administrateur" : "Nommer administrateur"}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
          >
            <ShieldIcon size={14} />
          </button>
          <button
            onClick={onRemove}
            disabled={busy}
            title="Retirer du groupe"
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition hover:bg-danger/10 hover:text-danger disabled:opacity-50"
          >
            <TrashIcon size={14} />
          </button>
        </span>
      )}
    </div>
  );
}

/** Formulaire admin (nom/description/photo/permissions) — n'apparaît que
 * pour un ADMIN, jamais rendu pour un simple membre (section 5). */
function GroupEditForm({
  conversation,
  onSaved,
  onCancel,
}: {
  conversation: Conversation;
  onSaved: (c: Conversation) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(conversation.title ?? "");
  const [description, setDescription] = useState(conversation.description ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [editInfoPermission, setEditInfoPermission] = useState(conversation.editInfoPermission);
  const [sendMessagesPermission, setSendMessagesPermission] = useState(conversation.sendMessagesPermission);
  const [addMembersPermission, setAddMembersPermission] = useState(conversation.addMembersPermission);
  const [sendMediaPermission, setSendMediaPermission] = useState(conversation.sendMediaPermission);
  const [mentionEveryonePermission, setMentionEveryonePermission] = useState(
    conversation.mentionEveryonePermission,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // N'envoyer que les champs réellement modifiés par rapport à
      // l'original : un champ contrôlé React renvoie toujours sa valeur
      // actuelle, même non touchée — l'envoyer systématiquement ferait
      // croire au backend à un changement (ex. "a modifié la description")
      // à chaque sauvegarde, même quand seul le nom a été édité (bug réel
      // constaté en vérification live : description initialisée à "" pour
      // un groupe sans description, `"" !== null` déclenchait toujours un
      // faux message système).
      const updated = await api.conversations.updateGroup(conversation.id, {
        title: title.trim() !== (conversation.title ?? "") ? title.trim() : undefined,
        description: description !== (conversation.description ?? "") ? description : undefined,
        photo: photo ?? undefined,
        editInfoPermission: editInfoPermission !== conversation.editInfoPermission ? editInfoPermission : undefined,
        sendMessagesPermission:
          sendMessagesPermission !== conversation.sendMessagesPermission ? sendMessagesPermission : undefined,
        addMembersPermission:
          addMembersPermission !== conversation.addMembersPermission ? addMembersPermission : undefined,
        sendMediaPermission:
          sendMediaPermission !== conversation.sendMediaPermission ? sendMediaPermission : undefined,
        mentionEveryonePermission:
          mentionEveryonePermission !== conversation.mentionEveryonePermission
            ? mentionEveryonePermission
            : undefined,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'enregistrer ces modifications.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-5 rounded-xl border border-border p-3.5">
      <p className="mb-3 text-xs font-medium tracking-wide text-muted uppercase">Modifier le groupe</p>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}

      <div className="mb-3 flex flex-col items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setPhoto(file);
            setPhotoPreview(URL.createObjectURL(file));
          }}
        />
        <button onClick={() => fileInputRef.current?.click()} className="transition hover:opacity-80">
          {photoPreview ? (
            // eslint-disable-next-line @next/next/no-img-element -- aperçu local (URL.createObjectURL), jamais un asset à optimiser.
            <img src={photoPreview} alt="" className="h-16 w-16 rounded-full object-cover" />
          ) : (
            <Avatar firstName={title || "Groupe"} lastName="" avatarUrl={conversation.photoUrl} size={64} />
          )}
        </button>
      </div>

      <label className="mb-1 block text-xs font-medium text-muted">Nom</label>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={100}
        className="mb-2.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
      />

      <label className="mb-1 block text-xs font-medium text-muted">Description</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={500}
        rows={2}
        className="mb-3 w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
      />

      <p className="mb-1.5 text-xs font-medium tracking-wide text-muted uppercase">Permissions</p>
      {(
        [
          ["Modifier les infos du groupe", editInfoPermission, setEditInfoPermission] as const,
          ["Envoyer des messages", sendMessagesPermission, setSendMessagesPermission] as const,
          ["Ajouter des membres", addMembersPermission, setAddMembersPermission] as const,
          ["Envoyer des médias", sendMediaPermission, setSendMediaPermission] as const,
          ["Mentionner @everyone", mentionEveryonePermission, setMentionEveryonePermission] as const,
        ]
      ).map(([label, value, setValue]) => (
        <div key={label} className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-strong">{label}</span>
          <select
            value={value}
            onChange={(e) => setValue(e.target.value as GroupPermission)}
            className="rounded-lg border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
          >
            <option value="EVERYONE">{GROUP_PERMISSION_LABELS.EVERYONE}</option>
            <option value="ADMIN_ONLY">{GROUP_PERMISSION_LABELS.ADMIN_ONLY}</option>
          </select>
        </div>
      ))}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => void save()}
          disabled={saving || !title.trim()}
          className="flex-1 rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] py-2 text-sm font-medium text-[var(--accent-contrast)] transition disabled:opacity-40"
        >
          {saving ? "Enregistrement..." : "Enregistrer"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-full border border-border px-4 py-2 text-sm transition hover:bg-surface-raised"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}

/**
 * Lien d'invitation (section 7) — ADMIN uniquement, comme sa gestion côté
 * backend. Chargé à la demande (jamais au montage du panneau) : ouvrir
 * "Infos" ne doit pas créer une ligne GroupInvite pour un groupe dont
 * personne n'a jamais eu l'intention de partager le lien.
 */
function GroupInviteSection({ conversationId }: { conversationId: string }) {
  const [invite, setInvite] = useState<{ token: string; isActive: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadOrCreate() {
    setLoading(true);
    setError(null);
    try {
      setInvite(await api.conversations.getOrCreateInvite(conversationId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de générer le lien.");
    } finally {
      setLoading(false);
    }
  }

  function inviteUrl(token: string): string {
    return `${window.location.origin}/group/invite/${token}`;
  }

  async function copyLink() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(inviteUrl(invite.token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Best-effort : certains navigateurs/contextes refusent l'accès au
      // presse-papiers — le lien reste visible et copiable manuellement.
    }
  }

  async function shareLink() {
    if (!invite) return;
    const url = inviteUrl(invite.token);
    if (navigator.share) {
      try {
        await navigator.share({ url, title: "Rejoindre le groupe" });
      } catch {
        // L'utilisateur a annulé le partage — rien à faire.
      }
    } else {
      await copyLink();
    }
  }

  async function reset() {
    setLoading(true);
    setError(null);
    try {
      setInvite(await api.conversations.resetInvite(conversationId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de réinitialiser le lien.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive() {
    if (!invite) return;
    setLoading(true);
    setError(null);
    try {
      setInvite(await api.conversations.setInviteActive(conversationId, !invite.isActive));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de modifier le lien.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-5">
      <p className="mb-1.5 text-xs font-medium tracking-wide text-muted uppercase">Lien d&rsquo;invitation</p>
      {error && <p className="mb-2 text-sm text-danger">{error}</p>}
      {!invite ? (
        <button
          onClick={() => void loadOrCreate()}
          disabled={loading}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border px-3.5 py-2.5 text-sm transition hover:bg-surface-raised disabled:opacity-50"
        >
          <ShareIcon size={14} /> {loading ? "Génération..." : "Inviter via un lien"}
        </button>
      ) : (
        <div className="rounded-xl border border-border p-3">
          <p className="mb-2 truncate rounded-lg bg-surface px-2.5 py-1.5 text-xs text-muted-strong">
            {inviteUrl(invite.token)}
          </p>
          {!invite.isActive && <p className="mb-2 text-xs text-danger">Ce lien est actuellement désactivé.</p>}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => void copyLink()}
              className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs transition hover:bg-surface-raised"
            >
              {copied ? <CheckIcon size={12} /> : null} {copied ? "Copié !" : "Copier"}
            </button>
            <button
              onClick={() => void shareLink()}
              className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs transition hover:bg-surface-raised"
            >
              <ShareIcon size={12} /> Partager
            </button>
            <button
              onClick={() => void reset()}
              disabled={loading}
              className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs transition hover:bg-surface-raised disabled:opacity-50"
            >
              <RefreshIcon size={12} /> Réinitialiser
            </button>
            <button
              onClick={() => void toggleActive()}
              disabled={loading}
              className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs transition hover:bg-surface-raised disabled:opacity-50"
            >
              {invite.isActive ? "Désactiver" : "Réactiver"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function InfoPanel({
  conversation,
  myUserId,
  onClose,
  onUpdated,
  onLeft,
}: {
  conversation: Conversation;
  myUserId: string;
  onClose: () => void;
  onUpdated: (conversation: Conversation) => void;
  /** Le groupe a été quitté/supprimé par l'utilisateur courant depuis ce panneau — voir chat/page.tsx::removeConversationFromList. */
  onLeft: () => void;
}) {
  const [savingMute, setSavingMute] = useState(false);
  const [editingGroup, setEditingGroup] = useState(false);
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const other = conversation.otherParticipant;
  const isGroup = conversation.type === "GROUP";
  const viewerIsAdmin = conversation.myMembership.role === "ADMIN";
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

  async function runMemberAction(targetUserId: string, action: () => Promise<Conversation | void>) {
    setBusyMemberId(targetUserId);
    setActionError(null);
    try {
      const result = await action();
      if (result) onUpdated(result);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Action impossible.");
    } finally {
      setBusyMemberId(null);
    }
  }

  async function leaveGroup() {
    try {
      await api.conversations.leaveGroup(conversation.id);
      onLeft();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Impossible de quitter le groupe.");
    }
  }

  async function deleteGroup() {
    try {
      await api.conversations.deleteGroup(conversation.id);
      onLeft();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Impossible de supprimer le groupe.");
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

        {isGroup && !editingGroup && (
          <div className="mb-5 flex flex-col items-center gap-2 text-center">
            <Avatar firstName={conversation.title ?? "Groupe"} lastName="" avatarUrl={conversation.photoUrl} size={72} />
            <p className="text-base font-semibold">{conversation.title}</p>
            {conversation.description && <p className="text-sm text-muted-strong">{conversation.description}</p>}
            <p className="text-xs text-muted">
              {conversation.members.length} membres • {onlineCount} en ligne
            </p>
            {viewerIsAdmin && (
              <button
                onClick={() => setEditingGroup(true)}
                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs transition hover:bg-surface-raised"
              >
                <SettingsIcon size={13} /> Modifier le groupe
              </button>
            )}
          </div>
        )}

        {isGroup && editingGroup && (
          <GroupEditForm
            conversation={conversation}
            onSaved={(c) => {
              onUpdated(c);
              setEditingGroup(false);
            }}
            onCancel={() => setEditingGroup(false)}
          />
        )}

        <div className="mb-5 flex items-center justify-between rounded-xl border border-border bg-surface-raised px-3.5 py-2.5">
          <span className="text-sm">Notifications</span>
          <Toggle checked={!conversation.myMembership.isMuted} onChange={toggleMute} disabled={savingMute} />
        </div>

        {isGroup && viewerIsAdmin && <GroupInviteSection conversationId={conversation.id} />}

        {actionError && <p className="mb-3 text-sm text-danger">{actionError}</p>}

        <div className="mb-3">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-medium tracking-wide text-muted uppercase">Membres</p>
            {isGroup && (conversation.addMembersPermission === "EVERYONE" || viewerIsAdmin) && (
              <button
                onClick={() => setAddMembersOpen(true)}
                className="flex items-center gap-1 text-xs font-medium text-[var(--accent-2)]"
              >
                <UsersIcon size={13} /> Ajouter
              </button>
            )}
          </div>
          <div className="flex flex-col gap-1">
            {conversation.members.map((m) =>
              isGroup ? (
                <MemberRow
                  key={m.id}
                  member={m}
                  isSelf={m.id === myUserId}
                  viewerIsAdmin={viewerIsAdmin}
                  busy={busyMemberId === m.id}
                  onPromote={() =>
                    void runMemberAction(m.id, () => api.conversations.setMemberRole(conversation.id, m.id, "ADMIN"))
                  }
                  onDemote={() =>
                    void runMemberAction(m.id, () => api.conversations.setMemberRole(conversation.id, m.id, "MEMBER"))
                  }
                  onRemove={() =>
                    void runMemberAction(m.id, async () => {
                      // DELETE renvoie 204 (aucun corps) — recharger la
                      // conversation pour refléter le retrait dans ce panneau
                      // (bug réel constaté en vérification live : sans ce
                      // second appel, la liste des membres restait périmée).
                      await api.conversations.removeMember(conversation.id, m.id);
                      return api.conversations.get(conversation.id);
                    })
                  }
                />
              ) : (
                <div key={m.id} className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5">
                  <Avatar firstName={m.firstName} lastName={m.lastName} avatarUrl={m.avatarUrl} online={m.isOnline} size={32} />
                  <span className="truncate text-sm">{displayName(m)}</span>
                </div>
              ),
            )}
          </div>
        </div>

        {isGroup && (
          <div className="mb-5 flex flex-col gap-2">
            <ConfirmButton
              label="Quitter le groupe"
              confirmLabel="Quitter ce groupe ?"
              danger
              onConfirm={() => void leaveGroup()}
            />
            {viewerIsAdmin && (
              <ConfirmButton
                label="Supprimer le groupe"
                confirmLabel="Supprimer définitivement ce groupe ?"
                danger
                onConfirm={() => void deleteGroup()}
              />
            )}
          </div>
        )}

        <div>
          <p className="mb-1.5 text-xs font-medium tracking-wide text-muted uppercase">Médias partagés</p>
          <SharedMediaGrid conversationId={conversation.id} />
        </div>
      </div>

      {addMembersOpen && (
        <AddGroupMembersModal
          conversationId={conversation.id}
          existingMemberIds={new Set(conversation.members.map((m) => m.id))}
          onClose={() => setAddMembersOpen(false)}
          onAdded={(c) => {
            onUpdated(c);
            setAddMembersOpen(false);
          }}
        />
      )}
    </div>
  );
}
