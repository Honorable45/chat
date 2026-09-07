import type { Message, VoiceDetails } from "./types";

/**
 * Les messages VOIX arrivent avec une forme différente (VoiceService.
 * toVoiceMessageDto côté backend : champ imbriqué `voice`, pas de `text`/
 * `readAt`) de celle de GET /conversations/:id/messages (messages.service.ts
 * toMessageDto) — que ce soit via l'événement socket "message:new"/
 * "message:updated", la réponse REST de POST /voice/messages, ou
 * GET /voice/:id. On les ramène à la forme commune `Message`, en conservant
 * cette fois le détail (`voice`) plutôt que de le jeter : transcription et
 * traductions doivent pouvoir s'afficher (VoiceMessageBubble).
 */
export function normalizeIncomingMessage(raw: unknown): Message | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.conversationId !== "string") return null;

  if ("voice" in r) {
    const voice = r.voice as VoiceDetails | null;
    return {
      id: r.id,
      conversationId: r.conversationId,
      senderId: String(r.senderId),
      type: "VOICE",
      text: null,
      systemAction: null,
      systemTargetUserId: null,
      replyToId: (r.replyToId as string | null) ?? null,
      editedAt: null,
      deletedAt: (r.deletedAt as string | null) ?? null,
      sentAt: String(r.sentAt),
      deliveredAt: (r.deliveredAt as string | null) ?? null,
      readAt: null,
      createdAt: String(r.createdAt ?? r.sentAt),
      reactions: [],
      mentions: [],
      mentionsEveryone: false,
      voice: voice ?? undefined,
    };
  }

  return r as unknown as Message;
}
