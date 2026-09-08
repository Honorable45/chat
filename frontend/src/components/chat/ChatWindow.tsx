"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { Avatar } from "@/components/Avatar";
import { BouncingDots } from "@/components/BouncingDots";
import { ChevronLeftIcon, GridIcon, InfoIcon, PhoneIcon, SearchIcon, VideoIcon } from "@/components/icons";
import { displayName, shortRelativeTime } from "@/lib/format";
import type { Conversation, Me, Message } from "@/lib/types";
import type { VoiceRecording } from "@/lib/use-voice-recorder";
import { MediaComposerModal } from "./MediaComposerModal";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";
import { MessageSearchPanel } from "./MessageSearchPanel";
import { ShareContactModal } from "./ShareContactModal";

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Aujourd'hui";
  if (sameDay(date, yesterday)) return "Hier";
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
}

export function ChatWindow({
  conversation,
  me,
  messages,
  loadingMessages,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  isOtherTyping,
  socket,
  onSend,
  onSendVoice,
  onSendMedia,
  onSendContact,
  onDeleteVoice,
  infoOpen,
  onToggleInfo,
  onStartCall,
  canCall,
  onBack,
  highlightMessageId,
  onJumpToMessage,
}: {
  conversation: Conversation;
  me: Me;
  messages: Message[];
  loadingMessages: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  isOtherTyping: boolean;
  socket: Socket | null;
  /** `replyToId` : message auquel on répond (voir état `replyingTo` ci-dessous), jamais fourni par l'appelant. */
  onSend: (text: string, replyToId?: string) => Promise<void>;
  onSendVoice: (recording: VoiceRecording, replyToId?: string) => Promise<void>;
  /** Un ou plusieurs médias envoyés ensemble — voir MediaComposerModal, jamais un fichier par action. */
  onSendMedia: (files: File[], caption: string, replyToId?: string) => Promise<void>;
  /** Partage la carte publique d'un utilisateur — voir ShareContactModal. */
  onSendContact: (userId: string) => Promise<void>;
  onDeleteVoice: (messageId: string) => void;
  infoOpen: boolean;
  onToggleInfo: () => void;
  /** Appels réservés aux conversations DIRECT — voir Call.type côté backend, jamais de groupe. */
  onStartCall: (kind: "AUDIO" | "VIDEO") => void;
  canCall: boolean;
  /** Écrans étroits (< lg) uniquement : retour à la liste des conversations — voir chat/page.tsx. */
  onBack: () => void;
  /** Message sur lequel on vient de sauter depuis la recherche — brièvement surligné, voir MessageBubble. */
  highlightMessageId: string | null;
  onJumpToMessage: (messageId: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef(new Map<string, HTMLDivElement>());
  const [composerFiles, setComposerFiles] = useState<File[] | null>(null);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Message auquel on est en train de répondre (voir SwipeToReply/le bouton
  // "Répondre" de MessageBubble) — réinitialisé en changeant de conversation
  // (une réponse en cours n'a plus de sens ailleurs) et après un envoi.
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  useEffect(() => {
    // queueMicrotask : le corps de l'effet ne doit jamais déclencher de
    // setState de façon synchrone — même motif que auth-context.tsx.
    queueMicrotask(() => setReplyingTo(null));
  }, [conversation.id]);

  // Un saut vers un résultat de recherche gère lui-même son défilement (voir
  // l'effet suivant) — jamais aussi tirer la vue tout en bas dans ce cas,
  // ce qui annulerait le saut.
  useEffect(() => {
    if (highlightMessageId) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [conversation.id, messages.length, highlightMessageId]);

  useEffect(() => {
    if (!highlightMessageId) return;
    messageRefs.current.get(highlightMessageId)?.scrollIntoView({ block: "center" });
  }, [highlightMessageId, messages]);

  const other = conversation.otherParticipant;
  const isGroup = conversation.type === "GROUP";
  const title = other ? displayName(other) : (conversation.title ?? "Conversation");
  const onlineCount = conversation.members.filter((m) => m.isOnline).length;
  // Résolu par message, jamais seulement "other" (toujours null pour un
  // groupe — voir Conversation.otherParticipant côté backend) : sans ça,
  // aucun expéditeur reçu en groupe n'affiche son nom/avatar (bug réel
  // constaté en vérification live).
  const membersById = useMemo(
    () => new Map(conversation.members.map((p) => [p.id, p])),
    [conversation.members],
  );

  // Nom affiché dans la barre "Vous répondez à..." (voir MessageInput) — le
  // cas "Vous" est géré séparément là où cette valeur est utilisée.
  const replyingToSenderDisplay =
    replyingTo && replyingTo.senderId !== me.id
      ? displayName(membersById.get(replyingTo.senderId) ?? other ?? { firstName: "Quelqu'un", lastName: "" })
      : null;

  // Pas d'accumulateur mutable (react-hooks/immutability) : chaque ligne ne
  // regarde que son propre message et le précédent, jamais une variable
  // reportée d'une itération à l'autre.
  const rows = useMemo(
    () =>
      messages.map((m, i) => {
        const prev = messages[i - 1];
        const label = dayLabel(m.sentAt);
        // Même résolution que `sender` plus bas (own -> null, sinon membre du
        // groupe ou "other" en DIRECT) — jamais absent tant que replyTo l'est.
        const replyToSender = m.replyTo
          ? m.replyTo.senderId === me.id
            ? null
            : (membersById.get(m.replyTo.senderId) ?? other ?? null)
          : null;
        return {
          message: m,
          label,
          showDaySeparator: !prev || dayLabel(prev.sentAt) !== label,
          showAvatar: !prev || prev.senderId !== m.senderId,
          replyToSender,
        };
      }),
    [messages, me.id, membersById, other],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="relative flex items-center justify-between border-b border-border px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onBack}
            aria-label="Retour aux conversations"
            className="-ml-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-surface-raised hover:text-foreground lg:hidden"
          >
            <ChevronLeftIcon size={20} />
          </button>
          {other ? (
            // Ouvre le profil public de l'autre participant (voir
            // app/profile/[userId]/page.tsx) — jamais pour une conversation
            // de groupe, où "other" reste null (aucune personne unique à afficher).
            <Link href={`/profile/${other.id}`} className="flex min-w-0 items-center gap-3 transition hover:opacity-80">
              <Avatar firstName={other.firstName} lastName={other.lastName} avatarUrl={other.avatarUrl} online={other.isOnline} size={40} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{title}</p>
                <p className="truncate text-xs text-muted">
                  {isOtherTyping
                    ? "en train d'écrire..."
                    : other.isOnline
                      ? "En ligne"
                      : other.lastSeenAt
                        ? `Vu ${shortRelativeTime(other.lastSeenAt)}`
                        : `${conversation.members.length} membres • ${onlineCount} en ligne`}
                </p>
              </div>
            </Link>
          ) : (
            // Groupe : le clic ouvre le panneau d'infos (membres/paramètres),
            // jamais un profil unique — voir InfoPanel pour le rendu GROUP.
            <button
              onClick={onToggleInfo}
              className="flex min-w-0 items-center gap-3 text-left transition hover:opacity-80"
            >
              <Avatar firstName={title} lastName="" avatarUrl={conversation.photoUrl} size={40} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{title}</p>
                <p className="truncate text-xs text-muted">
                  {isOtherTyping ? "en train d'écrire..." : `${conversation.members.length} membres • ${onlineCount} en ligne`}
                </p>
              </div>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-muted">
          <button
            onClick={() => onStartCall("AUDIO")}
            disabled={!other || !canCall}
            title={other ? (canCall ? `Appeler ${title}` : "Un appel est déjà en cours") : "Appel indisponible pour un groupe"}
            className="flex h-9 w-9 items-center justify-center rounded-xl transition hover:bg-surface-raised hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
          >
            <PhoneIcon size={18} />
          </button>
          <button
            onClick={() => onStartCall("VIDEO")}
            disabled={!other || !canCall}
            title={other ? (canCall ? `Appel vidéo avec ${title}` : "Un appel est déjà en cours") : "Appel indisponible pour un groupe"}
            className="flex h-9 w-9 items-center justify-center rounded-xl transition hover:bg-surface-raised hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
          >
            <VideoIcon size={18} />
          </button>
          <button
            onClick={() => setSearchOpen((v) => !v)}
            title="Rechercher dans la conversation"
            className={`flex h-9 w-9 items-center justify-center rounded-xl transition hover:bg-surface-raised hover:text-foreground ${
              searchOpen ? "bg-surface-raised text-foreground" : ""
            }`}
          >
            <SearchIcon size={18} />
          </button>
          <button
            onClick={onToggleInfo}
            title="Infos de la conversation"
            className={`flex h-9 w-9 items-center justify-center rounded-xl transition hover:bg-surface-raised hover:text-foreground ${
              infoOpen ? "bg-surface-raised text-foreground" : ""
            }`}
          >
            {infoOpen ? <InfoIcon size={18} /> : <GridIcon size={18} />}
          </button>
        </div>

        {searchOpen && (
          <MessageSearchPanel
            conversationId={conversation.id}
            onClose={() => setSearchOpen(false)}
            onJumpToMessage={(messageId) => {
              onJumpToMessage(messageId);
              setSearchOpen(false);
            }}
          />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto glotta-scroll-hidden px-5 py-4">
        {loadingMessages && (
          <div className="flex h-full items-center justify-center py-10">
            <BouncingDots />
          </div>
        )}

        {!loadingMessages && hasOlder && (
          <div className="mb-3 flex justify-center">
            <button
              onClick={onLoadOlder}
              disabled={loadingOlder}
              className="rounded-full border border-border px-3.5 py-1.5 text-xs text-muted transition hover:bg-surface-raised disabled:opacity-60"
            >
              {loadingOlder ? "Chargement..." : "Charger les messages précédents"}
            </button>
          </div>
        )}

        {!loadingMessages && messages.length === 0 && (
          <p className="py-10 text-center text-sm text-muted">
            Aucun message pour l&rsquo;instant. Dites bonjour 👋
          </p>
        )}

        <div className="flex flex-col gap-3">
          {rows.map(({ message: m, label, showDaySeparator, showAvatar, replyToSender }) => {
            const own = m.senderId === me.id;
            const sender = own ? null : (membersById.get(m.senderId) ?? other);
            return (
              <div
                key={m.id}
                ref={(el) => {
                  if (el) messageRefs.current.set(m.id, el);
                  else messageRefs.current.delete(m.id);
                }}
                className={
                  highlightMessageId === m.id
                    ? "-mx-2 rounded-xl bg-[var(--accent-2)]/15 px-2 transition-colors duration-1000"
                    : "transition-colors duration-1000"
                }
              >
                {showDaySeparator && (
                  <div className="my-3 flex items-center justify-center">
                    <span className="rounded-full bg-surface-raised px-3 py-1 text-[11px] text-muted">{label}</span>
                  </div>
                )}
                <MessageBubble
                  message={m}
                  own={own}
                  sender={sender}
                  target={m.systemTargetUserId ? (membersById.get(m.systemTargetUserId) ?? null) : null}
                  replyToSender={replyToSender}
                  isGroup={isGroup}
                  myUserId={me.id}
                  showAvatar={showAvatar}
                  myLanguageCode={me.preferredReceiveLanguage?.code ?? me.primaryLanguage?.code}
                  onDeleteVoice={onDeleteVoice}
                  onCallBack={canCall ? onStartCall : undefined}
                  onReply={setReplyingTo}
                  onJumpToMessage={onJumpToMessage}
                />
              </div>
            );
          })}
        </div>
        <div ref={bottomRef} />
      </div>

      <MessageInput
        conversationId={conversation.id}
        socket={socket}
        onSend={async (text) => {
          await onSend(text, replyingTo?.id);
          setReplyingTo(null);
        }}
        onSendVoice={async (recording) => {
          await onSendVoice(recording, replyingTo?.id);
          setReplyingTo(null);
        }}
        onPickMedia={setComposerFiles}
        onPickContact={() => setContactPickerOpen(true)}
        mentionCandidates={isGroup ? conversation.members : undefined}
        replyingTo={replyingTo}
        replyingToSenderName={
          replyingTo ? (replyingTo.senderId === me.id ? "Vous" : replyingToSenderDisplay) : null
        }
        onCancelReply={() => setReplyingTo(null)}
      />

      {composerFiles && (
        <MediaComposerModal
          initialFiles={composerFiles}
          onClose={() => setComposerFiles(null)}
          onSend={async (files, caption) => {
            await onSendMedia(files, caption, replyingTo?.id);
            setComposerFiles(null);
            setReplyingTo(null);
          }}
        />
      )}

      {contactPickerOpen && (
        <ShareContactModal onClose={() => setContactPickerOpen(false)} onShare={onSendContact} />
      )}
    </div>
  );
}
