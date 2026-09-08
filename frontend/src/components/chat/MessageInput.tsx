"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Socket } from "socket.io-client";
import { ImageIcon, MapPinIcon, MicIcon, PersonIcon, ReplyIcon, SendIcon, StickerIcon, XIcon } from "@/components/icons";
import { displayName, formatDuration, quotedMessagePreview } from "@/lib/format";
import type { ConversationParticipant, Message } from "@/lib/types";
import { useVoiceRecorder, type VoiceRecording } from "@/lib/use-voice-recorder";
import { StickerPicker } from "./StickerPicker";

const TYPING_STOP_DELAY_MS = 2500;
const ACCEPTED_MEDIA_TYPES = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime";
const MAX_MENTION_SUGGESTIONS = 5;

export function MessageInput({
  conversationId,
  socket,
  onSend,
  onSendVoice,
  onSendSticker,
  onPickMedia,
  onPickLocation,
  mentionCandidates,
  replyingTo,
  replyingToSenderName,
  onCancelReply,
}: {
  conversationId: string;
  socket: Socket | null;
  onSend: (text: string) => Promise<void>;
  onSendVoice: (recording: VoiceRecording) => Promise<void>;
  onSendSticker: (emoji: string) => Promise<void>;
  /** Ouvre l'écran de prévisualisation (voir MediaComposerModal, dans ChatWindow) — jamais envoyé directement depuis ici. */
  onPickMedia: (files: File[]) => void;
  /** Ouvre la confirmation de partage de position (voir ShareLocationModal, dans ChatWindow) — remplace l'ancien partage de contact à cet emplacement. */
  onPickLocation: () => void;
  /** Membres du groupe pour l'autocomplétion @nom (section 12) — absent/undefined en conversation DIRECT, où mentionner n'a pas de sens. */
  mentionCandidates?: ConversationParticipant[];
  /** Message auquel on répond (voir SwipeToReply/MessageBubble) — `null` hors réponse. L'ID est déjà injecté par ChatWindow dans `onSend`/`onSendVoice`, jamais ici. */
  replyingTo?: Message | null;
  /** "Vous" ou le nom de l'expéditeur cité — déjà résolu par ChatWindow (accès aux membres/à `me`), jamais recalculé ici. */
  replyingToSenderName?: string | null;
  onCancelReply?: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textInputRef = useRef<HTMLInputElement | null>(null);
  const recorder = useVoiceRecorder();
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const [sendingSticker, setSendingSticker] = useState(false);

  async function pickSticker(emoji: string) {
    setStickerPickerOpen(false);
    setSendingSticker(true);
    try {
      await onSendSticker(emoji);
    } finally {
      setSendingSticker(false);
    }
  }

  // Position du "@" en cours de frappe (index dans `text`) — `null` quand
  // aucune mention n'est activement composée. `mentionQuery` est le texte
  // déjà tapé après ce "@" (peut être vide juste après avoir tapé "@" seul).
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionQuery, setMentionQuery] = useState("");

  function updateMentionState(value: string, cursor: number) {
    if (!mentionCandidates) return;
    const uptoCursor = value.slice(0, cursor);
    const match = /(?:^|\s)@([a-zA-Z0-9_.]*)$/.exec(uptoCursor);
    if (match) {
      setMentionStart(cursor - match[1].length - 1);
      setMentionQuery(match[1]);
    } else {
      setMentionStart(null);
      setMentionQuery("");
    }
  }

  function selectMention(username: string) {
    if (mentionStart === null) return;
    const cursor = textInputRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, mentionStart);
    const after = text.slice(cursor);
    const inserted = `@${username} `;
    const newText = `${before}${inserted}${after}`;
    setText(newText);
    setMentionStart(null);
    setMentionQuery("");
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length;
      textInputRef.current?.focus();
      textInputRef.current?.setSelectionRange(pos, pos);
    });
  }

  const mentionMatches =
    mentionStart !== null && mentionCandidates
      ? mentionCandidates
          .filter(
            (m) =>
              m.username.toLowerCase().startsWith(mentionQuery.toLowerCase()) ||
              displayName(m).toLowerCase().includes(mentionQuery.toLowerCase()),
          )
          .slice(0, MAX_MENTION_SUGGESTIONS)
      : [];
  const showEveryoneOption =
    mentionStart !== null && "everyone".startsWith(mentionQuery.toLowerCase());

  // L'erreur d'enregistrement (micro refusé/inaccessible) reste visible
  // quelques secondes puis s'efface d'elle-même plutôt que de s'incruster.
  useEffect(() => {
    if (recorder.state !== "error") return;
    const timeout = setTimeout(() => recorder.cancel(), 4000);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ne doit repartir que sur un nouveau passage en erreur, pas à chaque nouvelle référence de `recorder`.
  }, [recorder.state]);

  function notifyTyping() {
    if (!socket) return;
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      socket.emit("message:typing", { conversationId });
    }
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
    stopTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      socket.emit("message:stop_typing", { conversationId });
    }, TYPING_STOP_DELAY_MS);
  }

  function stopTypingNow() {
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
    if (isTypingRef.current && socket) {
      isTypingRef.current = false;
      socket.emit("message:stop_typing", { conversationId });
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (sending) return;

    const trimmed = text.trim();
    if (!trimmed) return;
    stopTypingNow();
    setSending(true);
    setText("");
    try {
      await onSend(trimmed);
    } finally {
      setSending(false);
    }
  }

  async function finishRecording() {
    const recording = await recorder.stop();
    if (!recording) return;
    setSending(true);
    try {
      await onSendVoice(recording);
    } finally {
      setSending(false);
    }
  }

  if (recorder.state === "recording" || recorder.state === "requesting") {
    return (
      <div className="flex items-center gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={recorder.cancel}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-raised hover:text-danger"
          aria-label="Annuler l'enregistrement"
        >
          <XIcon size={18} />
        </button>

        <div className="flex flex-1 items-center gap-2.5 rounded-full border border-border bg-surface-raised px-4 py-2.5">
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-danger" />
          <span className="text-sm text-muted-strong">
            {recorder.state === "requesting" ? "Micro..." : "Enregistrement..."}
          </span>
          <span className="ml-auto text-sm tabular-nums text-muted">{formatDuration(recorder.elapsedSeconds)}</span>
        </div>

        <button
          type="button"
          onClick={finishRecording}
          disabled={recorder.state !== "recording" || sending}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[var(--accent-contrast)] transition disabled:opacity-40"
          aria-label="Envoyer le vocal"
        >
          <SendIcon size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-border">
      {replyingTo && (
        <div className="flex items-center gap-2 border-b border-border bg-surface-raised/60 px-4 py-2">
          <ReplyIcon size={16} className="shrink-0 text-[var(--accent-2)]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-[var(--accent-2)]">
              {replyingToSenderName ?? "Vous"}
            </p>
            <p className="truncate text-xs text-muted">{quotedMessagePreview(replyingTo)}</p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Annuler la réponse"
            title="Annuler"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface hover:text-foreground"
          >
            <XIcon size={14} />
          </button>
        </div>
      )}
      <form onSubmit={submit} className="flex items-center gap-2 px-4 py-3">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_MEDIA_TYPES}
          multiple
          hidden
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) onPickMedia(Array.from(files));
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Partager des photos/vidéos"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-raised hover:text-foreground"
        >
          <ImageIcon size={18} />
        </button>
        <button
          type="button"
          onClick={onPickLocation}
          title="Partager ma position"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-raised hover:text-foreground"
        >
          <MapPinIcon size={18} />
        </button>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setStickerPickerOpen((v) => !v)}
            disabled={sendingSticker}
            title="Envoyer un sticker"
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition hover:bg-surface-raised hover:text-foreground disabled:opacity-50"
          >
            <StickerIcon size={18} />
          </button>
          {stickerPickerOpen && (
            <StickerPicker onSelect={(emoji) => void pickSticker(emoji)} onClose={() => setStickerPickerOpen(false)} />
          )}
        </div>
        <button
          type="button"
          onClick={() => void recorder.start()}
          title="Message vocal"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-raised hover:text-foreground"
        >
          <MicIcon size={18} />
        </button>

        <div className="relative min-w-0 flex-1">
          {(mentionMatches.length > 0 || showEveryoneOption) && (
            <div className="absolute bottom-full left-0 z-20 mb-1.5 max-h-48 w-64 overflow-y-auto glotta-scroll-hidden rounded-xl border border-border bg-surface-raised py-1 shadow-lg">
              {showEveryoneOption && (
                <button
                  type="button"
                  onClick={() => selectMention("everyone")}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-surface"
                >
                  <PersonIcon size={14} className="text-muted" />
                  <span className="font-medium">@everyone</span>
                </button>
              )}
              {mentionMatches.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => selectMention(m.username)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition hover:bg-surface"
                >
                  <span className="truncate">{displayName(m)}</span>
                  <span className="shrink-0 text-xs text-muted">@{m.username}</span>
                </button>
              ))}
            </div>
          )}
          <input
            ref={textInputRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              updateMentionState(e.target.value, e.target.selectionStart ?? e.target.value.length);
              if (e.target.value.trim()) notifyTyping();
              else stopTypingNow();
            }}
            onKeyUp={(e) => updateMentionState(text, e.currentTarget.selectionStart ?? text.length)}
            onBlur={stopTypingNow}
            placeholder="Écrire un message..."
            className="w-full rounded-full border border-border bg-surface-raised px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-[var(--accent)]"
          />
        </div>

        <button
          type="submit"
          disabled={!text.trim() || sending}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--accent)] to-[var(--accent-2)] text-[var(--accent-contrast)] transition disabled:opacity-40"
          aria-label="Envoyer"
        >
          <SendIcon size={16} />
        </button>
      </form>

      {recorder.state === "error" && recorder.error && (
        <p className="px-4 pb-3 text-xs text-danger">{recorder.error}</p>
      )}
    </div>
  );
}
