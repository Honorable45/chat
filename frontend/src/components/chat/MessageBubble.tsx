"use client";

import { useEffect, useState } from "react";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { Avatar } from "@/components/Avatar";
import { CheckCheckIcon, CheckIcon, ExpandIcon, FlagIcon, PersonIcon, PhoneIcon, PlusIcon, RefreshIcon, VideoIcon } from "@/components/icons";
import { ImageLightbox } from "@/components/ImageLightbox";
import { ReportModal } from "@/components/ReportModal";
import { api, ApiError } from "@/lib/api";
import { displayName, timeOfDay } from "@/lib/format";
import type { CallDetail, ContactStatus, ConversationParticipant, Message, PublicUser } from "@/lib/types";
import { MediaAlbumGrid } from "./MediaAlbumGrid";
import { VoiceMessageBubble } from "./VoiceMessageBubble";

function formatCallDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** `own` = j'ai initié l'appel (senderId du message CALL, toujours l'appelant) — voir Call.callerId côté backend. */
function callBubbleLabel(call: CallDetail, own: boolean): string {
  const prefix = call.type === "VIDEO" ? "Appel vidéo" : "Appel";
  switch (call.status) {
    case "RINGING":
      return own ? `${prefix} en cours...` : `${prefix} entrant...`;
    case "ACTIVE":
      return `${prefix} en cours`;
    case "DECLINED":
      return `${prefix} refusé`;
    case "MISSED":
      return own ? `${prefix} sans réponse` : `${prefix} manqué`;
    case "ENDED":
      return `${prefix}${call.durationSeconds != null ? ` · ${formatCallDuration(call.durationSeconds)}` : ""}`;
    default:
      return prefix;
  }
}

// Taille unique pour toutes les vignettes d'image de la conversation — pas
// de variation selon les proportions de l'original (voir demande : "toutes
// les images aient la même taille"). L'image complète reste consultable en
// grand via ImageLightbox (clic sur la vignette).
const IMAGE_THUMBNAIL_SIZE = 220;

/**
 * Carte affichée pour un message CONTACT_SHARE — seules des informations
 * publiques (voir ContactsService.shareContact côté backend, jamais email/
 * téléphone). Le bouton "Ajouter" appelle directement l'API de demande de
 * contact ; son état (NONE/PENDING/ACCEPTED/...) est chargé au montage,
 * comme les autres hydratations à la demande de ce fichier (voir
 * hydrateCallMessages/hydrateContactShareMessages dans chat/page.tsx).
 */
function ContactShareCard({ contact, own }: { contact: PublicUser; own: boolean }) {
  const [status, setStatus] = useState<ContactStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.contacts
      .statusWith(contact.id)
      .then((res) => {
        if (!cancelled) setStatus(res.status);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [contact.id]);

  async function sendRequest() {
    setBusy(true);
    try {
      await api.contacts.sendRequest(contact.id);
      setStatus("PENDING_SENT");
    } catch (err) {
      // Le plus souvent : déjà en contact/demande en attente (course avec un
      // autre appareil) — on relit simplement le statut réel plutôt que
      // d'afficher une erreur bruyante pour une action déjà satisfaite.
      if (err instanceof ApiError) {
        api.contacts
          .statusWith(contact.id)
          .then((res) => setStatus(res.status))
          .catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  }

  const actionLabel =
    status === "ACCEPTED"
      ? "Contact"
      : status === "PENDING_SENT"
        ? "Demande envoyée"
        : status === "PENDING_RECEIVED"
          ? "Vous a demandé"
          : "Ajouter";

  return (
    <div
      className={`flex w-64 items-center gap-3 rounded-2xl px-3.5 py-3 ${
        own
          ? "rounded-br-md bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] text-[var(--accent-contrast)]"
          : "rounded-bl-md border border-border bg-surface-raised text-foreground"
      }`}
    >
      <Avatar firstName={contact.firstName} lastName={contact.lastName} avatarUrl={contact.avatarUrl} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{displayName(contact)}</span>
        <span className={`block truncate text-xs ${own ? "opacity-80" : "text-muted"}`}>@{contact.username}</span>
      </span>
      {status === "NONE" && (
        <button
          onClick={() => void sendRequest()}
          disabled={busy}
          aria-label="Ajouter en contact"
          title="Ajouter en contact"
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition disabled:opacity-50 ${
            own ? "bg-white/20 hover:bg-white/30" : "bg-surface hover:bg-border"
          }`}
        >
          <PlusIcon size={15} />
        </button>
      )}
      {status && status !== "NONE" && (
        <span className={`shrink-0 text-[11px] ${own ? "opacity-85" : "text-muted"}`} title={actionLabel}>
          {status === "ACCEPTED" ? <CheckIcon size={15} /> : <PersonIcon size={15} />}
        </span>
      )}
    </div>
  );
}

function StatusTicks({ message }: { message: Message }) {
  if (message.readAt) return <CheckCheckIcon size={15} className="text-[var(--accent-2)]" />;
  if (message.deliveredAt) return <CheckCheckIcon size={15} className="opacity-70" />;
  return <CheckIcon size={15} className="opacity-70" />;
}

export function MessageBubble({
  message,
  own,
  sender,
  showAvatar,
  myLanguageCode,
  onDeleteVoice,
  onCallBack,
}: {
  message: Message;
  own: boolean;
  sender: ConversationParticipant | null;
  showAvatar: boolean;
  myLanguageCode?: string | null;
  onDeleteVoice?: (messageId: string) => void;
  /** Relance un appel du même type — bouton "rappeler" affiché uniquement sur un appel manqué (voir plus bas). */
  onCallBack?: (kind: "AUDIO" | "VIDEO") => void;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  if (message.deletedAt) {
    return (
      <div className={`flex items-end gap-2 ${own ? "justify-end" : "justify-start"}`}>
        {!own && <span className="w-7 shrink-0" />}
        <span className="rounded-2xl border border-dashed border-border px-3.5 py-2 text-sm italic text-muted">
          Message supprimé
        </span>
      </div>
    );
  }

  const attachmentUrl = message.attachments?.[0] ? api.messages.attachmentUrl(message.attachments[0].id) : null;

  return (
    <div className={`group flex items-end gap-2 ${own ? "justify-end" : "justify-start"}`}>
      {!own &&
        (showAvatar && sender ? (
          <Avatar firstName={sender.firstName} lastName={sender.lastName} avatarUrl={sender.avatarUrl} size={28} />
        ) : (
          <span className="w-7 shrink-0" />
        ))}

      <div className={`flex max-w-[70%] flex-col gap-1 ${own ? "items-end" : "items-start"}`}>
        {message.type === "VOICE" ? (
          <VoiceMessageBubble
            messageId={message.id}
            own={own}
            voice={message.voice}
            myLanguageCode={myLanguageCode}
            onDelete={onDeleteVoice}
          />
        ) : message.type === "IMAGE" && attachmentUrl ? (
          <div className="flex flex-col gap-1.5 overflow-hidden rounded-2xl border border-border bg-surface-raised p-1.5">
            <button
              onClick={() => setLightboxOpen(true)}
              className="group relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface"
              style={{ width: IMAGE_THUMBNAIL_SIZE, height: IMAGE_THUMBNAIL_SIZE }}
              aria-label="Agrandir l'image"
            >
              <AuthenticatedImage src={attachmentUrl} alt="" className="h-full w-full object-cover" />
              <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
                <ExpandIcon size={22} className="text-white" />
              </span>
            </button>
            {message.text && <p className="px-1.5 pb-1 text-sm text-foreground">{message.text}</p>}
            {lightboxOpen && <ImageLightbox src={attachmentUrl} onClose={() => setLightboxOpen(false)} />}
          </div>
        ) : message.type === "MEDIA_ALBUM" && message.attachments && message.attachments.length > 0 ? (
          <MediaAlbumGrid
            attachments={message.attachments.map((a) => ({ ...a, url: api.messages.attachmentUrl(a.id) }))}
            caption={message.text}
          />
        ) : message.type === "CALL" ? (
          <div
            className={`flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-sm ${
              own
                ? "rounded-br-md bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] text-[var(--accent-contrast)]"
                : "rounded-bl-md border border-border bg-surface-raised text-foreground"
            }`}
          >
            {message.call?.type === "VIDEO" ? <VideoIcon size={16} /> : <PhoneIcon size={16} />}
            <span>{message.call ? callBubbleLabel(message.call, own) : "Appel"}</span>
            {/* Rappeler : uniquement sur un appel manqué (section 5-13 du cahier des charges), même type (audio/vidéo) que l'original. */}
            {message.call?.status === "MISSED" && onCallBack && (
              <button
                onClick={() => onCallBack(message.call!.type)}
                aria-label="Rappeler"
                title="Rappeler"
                className={`ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition ${
                  own ? "bg-white/20 hover:bg-white/30" : "bg-surface hover:bg-border"
                }`}
              >
                <RefreshIcon size={13} />
              </button>
            )}
          </div>
        ) : message.type === "CONTACT_SHARE" ? (
          message.sharedContact ? (
            <ContactShareCard contact={message.sharedContact} own={own} />
          ) : (
            <div className="flex w-64 items-center gap-2.5 rounded-2xl border border-border bg-surface-raised px-3.5 py-3 text-sm text-muted">
              <PersonIcon size={16} />
              Contact...
            </div>
          )
        ) : (
          <div
            className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap ${
              own
                ? "rounded-br-md bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)] text-[var(--accent-contrast)]"
                : "rounded-bl-md border border-border bg-surface-raised text-foreground"
            }`}
          >
            {message.text}
            {message.editedAt && (
              <span className={`ml-1.5 text-[10px] ${own ? "opacity-75" : "text-muted"}`}>(modifié)</span>
            )}
          </div>
        )}

        <div className="flex items-center gap-1 px-1 text-[11px] text-muted">
          <span>{timeOfDay(message.sentAt)}</span>
          {own && <StatusTicks message={message} />}
        </div>
      </div>

      {/* Jamais son propre message, jamais un appel (rien à signaler) — visible seulement au survol pour rester discret. */}
      {!own && message.type !== "CALL" && (
        <button
          onClick={() => setReportOpen(true)}
          aria-label="Signaler ce message"
          title="Signaler"
          className="mb-1 self-end text-muted opacity-0 transition hover:text-danger group-hover:opacity-100"
        >
          <FlagIcon size={14} />
        </button>
      )}

      {reportOpen && (
        <ReportModal targetType="MESSAGE" targetId={message.id} onClose={() => setReportOpen(false)} />
      )}
    </div>
  );
}
