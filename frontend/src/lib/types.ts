/**
 * Types reflétant exactement les DTOs renvoyés par le backend (voir
 * backend/src/{auth,users,conversations,messages}/...). Tenus à jour à la
 * main plutôt que générés : la surface d'API est encore petite.
 */

export interface LanguageSummary {
  code: string;
  name: string;
  nativeName: string;
}

export interface SafeUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse extends AuthTokens {
  user: SafeUser;
}

export interface MeProfile {
  avatarUrl: string | null;
  avatarUploaded: boolean;
  statusText: string | null;
  showLastSeen: boolean;
  showOnlineStatus: boolean;
  showReadReceipts: boolean;
  whoCanMessageMe: string;
  whoCanSeeMyStatus: string;
  notificationsEnabled: boolean;
  voiceCloningConsent: boolean;
  voiceModelRegistered: boolean;
}

export interface Me {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  isOnline: boolean;
  lastSeenAt: string | null;
  primaryLanguage: LanguageSummary | null;
  preferredReceiveLanguage: LanguageSummary | null;
  spokenLanguages: LanguageSummary[];
  profile: MeProfile | null;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  statusText: string | null;
  isOnline: boolean;
  lastSeenAt: string | null;
  primaryLanguage: LanguageSummary | null;
  spokenLanguages: LanguageSummary[];
}

export type ConversationType = "DIRECT" | "GROUP";
export type MessageType =
  | "TEXT"
  | "VOICE"
  | "IMAGE"
  | "VIDEO"
  | "FILE"
  | "CALL"
  | "MEDIA_ALBUM"
  | "CONTACT_SHARE";

export type CallStatus = "RINGING" | "ACTIVE" | "MISSED" | "DECLINED" | "ENDED";

export interface CallDetail {
  id: string;
  messageId: string;
  callerId: string;
  calleeId: string;
  type: "AUDIO" | "VIDEO";
  status: CallStatus;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
}

/** Vue "message" d'un appel — jamais fournie par GET /conversations/:id/messages
 * (voir Message.call ci-dessous) : récupérée à la demande via
 * GET /calls/message/:messageId, ou reçue telle quelle via les événements du
 * namespace WebSocket "/calls" (voir use-call.ts). */
export interface CallMessagePayload {
  id: string;
  conversationId: string;
  senderId: string;
  type: "CALL";
  sentAt: string;
  createdAt: string;
  call: CallDetail;
}

/** Statut de la relation entre l'utilisateur courant et un autre — pilote le bouton affiché sur une carte de contact/profil (voir ContactsService.statusWith côté backend). */
export type ContactStatus =
  | "NONE"
  | "PENDING_SENT"
  | "PENDING_RECEIVED"
  | "ACCEPTED"
  | "BLOCKED_BY_ME"
  | "BLOCKED_BY_THEM";

export interface ContactRequest {
  id: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "BLOCKED";
  user: PublicUser;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationParticipant {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  statusText: string | null;
  isOnline: boolean;
  lastSeenAt: string | null;
}

export interface ConversationLastMessage {
  id: string;
  type: MessageType;
  text: string | null;
  senderId: string;
  sentAt: string;
  /** Uniquement renseigné quand `type === "CALL"`. */
  callType: "AUDIO" | "VIDEO" | null;
  callStatus: CallStatus | null;
  callDurationSeconds: number | null;
  /** Uniquement renseigné quand `type === "MEDIA_ALBUM"`. */
  mediaCount: number | null;
  mediaHasVideo: boolean | null;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  title: string | null;
  otherParticipant: ConversationParticipant | null;
  members: ConversationParticipant[];
  myMembership: {
    isArchived: boolean;
    isMuted: boolean;
    lastReadAt: string | null;
  };
  lastMessage: ConversationLastMessage | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MessageAttachment {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  type: "IMAGE" | "VIDEO";
  fileName: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
}

export type TranslationStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface MessageTranslationDetail {
  targetLanguage: LanguageSummary;
  status: TranslationStatus;
  translatedText: string | null;
  /** URL authentifiée, `null` tant que la synthèse vocale n'a pas abouti (ou n'a pas été tentée). */
  audioUrl: string | null;
  usedVoiceCloning: boolean;
}

/** Détails d'un message vocal — transcription et traductions. Renvoyé par
 * `GET /voice/:messageId` (chargement depuis l'historique) et par les
 * événements socket "message:new"/"message:updated" pour un vocal (forme
 * `voice: {...}` distincte de `MessageDto`, voir normalize-message.ts) —
 * jamais par `GET /conversations/:id/messages`. */
export interface VoiceDetails {
  durationSeconds: number;
  waveform: number[] | null;
  transcript: string | null;
  detectedLanguage: LanguageSummary | null;
  languageOverridden: boolean;
  translations: MessageTranslationDetail[];
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  type: MessageType;
  text: string | null;
  replyToId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  sentAt: string;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
  /** Absent sur les messages VOIX (forme distincte — voir normalize-message.ts). */
  attachments?: MessageAttachment[];
  /** Transcription/traductions d'un message VOIX — jamais fourni par
   * l'historique, récupéré à la demande via `GET /voice/:id` ou mis à jour
   * en direct par les événements socket "translation:*". */
  voice?: VoiceDetails;
  /** Détail d'un message CALL — jamais fourni par l'historique, récupéré à
   * la demande via `GET /calls/message/:id` ou mis à jour en direct par les
   * événements du namespace WebSocket "/calls". */
  call?: CallDetail;
  /** Détail d'un message CONTACT_SHARE — contrairement à CALL, la forme
   * renvoyée par POST /contacts/share et GET /contacts/message/:id est déjà
   * un Message complet (voir ContactsService.toContactShareMessageDto côté
   * backend) : jamais besoin de conversion, juste absent tant qu'un message
   * chargé depuis l'historique n'a pas encore été hydraté. */
  sharedContact?: PublicUser;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export type WhoCanInteract = "EVERYONE" | "CONTACTS" | "NOBODY";

/** Forme exacte renvoyée par PATCH /users/me/profile — le contrôleur renvoie
 * directement ProfilesService.update(), donc la ligne Prisma `Profile` brute
 * (userId, voiceCloningUpdatedAt, voiceModelId...), pas la vue `Me`
 * assemblée par GET /users/me. Les deux endpoints ne renvoient pas la même
 * chose : ne pas les confondre. */
export interface ProfileRecord {
  id: string;
  userId: string;
  avatarUrl: string | null;
  statusText: string | null;
  voiceCloningConsent: boolean;
  voiceCloningUpdatedAt: string | null;
  voiceModelId: string | null;
  showLastSeen: boolean;
  showOnlineStatus: boolean;
  showReadReceipts: boolean;
  whoCanMessageMe: WhoCanInteract;
  whoCanSeeMyStatus: WhoCanInteract;
  notificationsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSummary {
  id: string;
  deviceLabel: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  isCurrent: boolean;
}

export type StatusType = "TEXT" | "IMAGE" | "VIDEO" | "VOICE";
export type StatusVisibility = "EVERYONE" | "CONTACTS" | "NOBODY";

export interface StatusAuthor {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
}

export interface Status {
  id: string;
  type: StatusType;
  text: string | null;
  mediaUrl: string | null;
  visibility: StatusVisibility;
  author: StatusAuthor;
  isMine: boolean;
  viewedByMe: boolean;
  /** Réservé à l'auteur — toujours `null` pour un statut qui n'est pas le sien. */
  viewCount: number | null;
  createdAt: string;
  expiresAt: string;
}

export interface StatusView {
  viewedAt: string;
  viewer: StatusAuthor;
}

export type NotificationType = "NEW_MESSAGE" | string;

export interface AppNotification {
  id: string;
  type: NotificationType;
  payload: {
    conversationId?: string;
    messageId?: string;
    senderId?: string;
    preview?: string;
    [key: string]: unknown;
  } | null;
  readAt: string | null;
  createdAt: string;
}

/** Forme générique d'une erreur HTTP renvoyée par HttpExceptionFilter côté
 * backend : `message` est soit une chaîne, soit un objet Nest standard
 * `{ statusCode, message, error }` où `message` peut lui-même être une
 * chaîne ou un tableau (erreurs de validation class-validator). */
export interface ApiErrorBody {
  statusCode: number;
  message: string | { message?: string | string[]; error?: string; statusCode?: number };
  timestamp: string;
}
