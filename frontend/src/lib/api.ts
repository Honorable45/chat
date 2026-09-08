import { clearTokens, getAccessToken, getRefreshToken, setTokens } from "./token-store";
import type {
  ApiErrorBody,
  AppNotification,
  AuthResponse,
  CallMessagePayload,
  ContactRequest,
  ContactStatus,
  Conversation,
  GroupInvite,
  GroupInvitePreview,
  GroupPermission,
  GroupRole,
  LanguageSummary,
  Me,
  Message,
  MessageAttachment,
  Page,
  ProfileRecord,
  PublicUser,
  SessionSummary,
  Status,
  StatusType,
  StatusVisibility,
  StatusView,
  WhoCanInteract,
} from "./types";

/** Entrée de l'historique des appels — voir GET /calls (CallsService.listForUser côté backend). */
export interface CallHistoryEntry {
  id: string;
  messageId: string;
  conversationId: string;
  direction: "outgoing" | "incoming";
  type: "AUDIO" | "VIDEO";
  status: "RINGING" | "ACTIVE" | "MISSED" | "DECLINED" | "ENDED";
  startedAt: string;
  durationSeconds: number | null;
  otherUser: { id: string; firstName: string; lastName: string; avatarUrl: string | null };
}

// Exporté (voir auth-context.tsx) : transmis au service worker par postMessage
// pour que son action "Refuser" (notification push d'appel entrant) sache
// vers quel backend faire son fetch — un fichier statique comme public/sw.js
// n'a accès à aucune variable d'environnement Next.js.
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api";

/**
 * Une URL de média renvoyée par le backend (avatar, pièce jointe, média de
 * statut...) est soit déjà absolue — une URL externe saisie à la main, ou
 * un lien Cloudinary direct (signé pour un message/statut, public pour un
 * avatar — voir CloudinaryProvider côté backend), auquel cas elle passe
 * inchangée — soit un chemin relatif interne (`/api/...`, servi par ce
 * backend lui-même) qui doit être préfixé par son origine, jamais utilisé
 * tel quel dans un <img src>/<video src>, sans quoi il se résoudrait contre
 * l'origine du frontend.
 */
export function resolveMediaSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!url.startsWith("/")) return url;
  return `${new URL(API_URL).origin}${url}`;
}

/** Origine de ce backend (ex. "http://localhost:4000") — jamais celle du frontend. */
export const API_ORIGIN = new URL(API_URL).origin;

/**
 * Une URL de média (relative OU déjà absolue, voir resolveMediaSrc) pointe-t-elle
 * vers CE backend, donc protégée par JwtAuthGuard et à récupérer en Blob
 * authentifié — par opposition à un lien Cloudinary/externe déjà public,
 * chargeable tel quel dans un <img>/<video> classique ? Ne jamais se fier à
 * "l'URL est absolue" seul : `api.messages.attachmentUrl`/`api.statuses.mediaUrl`
 * construisent aussi des URLs absolues vers ce même backend (bug réel
 * constaté en vérification live : une pièce jointe LOCAL absolutisée était
 * alors prise pour un lien public et chargée sans authentification).
 */
export function isOwnBackendUrl(url: string): boolean {
  return url.startsWith("/") || url.startsWith(API_ORIGIN);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Réduit la forme d'erreur Nest (voir types.ts) à un message affichable. */
function extractErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const { message } = body as ApiErrorBody;
  if (typeof message === "string") return message;
  if (message && typeof message === "object") {
    if (Array.isArray(message.message)) return message.message[0] ?? fallback;
    if (typeof message.message === "string") return message.message;
  }
  return fallback;
}

/** Efface la session et prévient AuthProvider (voir socket.ts/use-call.ts,
 * qui l'appellent aussi quand une reconnexion Socket.IO échoue après un
 * rafraîchissement raté) — jamais de `window.location.href` ici (ce module
 * n'est pas un composant, donc pas de useRouter) : on délègue la navigation
 * à AuthProvider, seul à détenir le routeur Next, via un événement DOM. */
export function handleUnauthorized(): void {
  clearTokens();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("glotta:unauthorized"));
  }
}

let refreshInFlight: Promise<boolean> | null = null;

/** Un seul refresh à la fois même si plusieurs requêtes échouent en 401 en
 * même temps (ex. plusieurs appels lancés au montage de la page), ou que
 * REST et sockets (voir socket.ts/use-call.ts, qui l'appellent aussi sur
 * `connect_error`) en réclament un simultanément — sans quoi chacun
 * tenterait de rafraîchir le token pour son propre compte. Exportée : les
 * connexions Socket.IO n'ont pas d'équivalent au 401 REST pour détecter un
 * access token expiré, seulement `connect_error` avec le message renvoyé
 * par verifySocketUserId ("jwt expired").
 */
export async function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const refreshToken = getRefreshToken();
      if (!refreshToken) return false;
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as AuthResponse;
        setTokens(data);
        return true;
      } catch {
        return false;
      }
    })();
  }
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
  /** Interne : évite une boucle infinie si le refresh lui-même échoue. */
  _retried?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true, _retried = false } = options;
  const isFormData = body instanceof FormData;

  const headers: Record<string, string> = {};
  // FormData : jamais de Content-Type manuel — le navigateur doit poser lui
  // même la frontière multipart (boundary), sans quoi le backend ne peut
  // pas parser le corps de la requête.
  if (body !== undefined && !isFormData) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });

  if (res.status === 401 && auth && !_retried) {
    const refreshed = await refreshSession();
    if (refreshed) {
      return request<T>(path, { ...options, _retried: true });
    }
    handleUnauthorized();
    throw new ApiError("Session expirée.", 401);
  }

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new ApiError(
      extractErrorMessage(data, "Une erreur est survenue. Merci de réessayer."),
      res.status,
    );
  }

  return data as T;
}

export interface RegisterInput {
  // firstName/lastName/primaryLanguageCode sont optionnels : l'inscription
  // ne demande plus que nom d'utilisateur/email/mot de passe, le backend
  // applique des valeurs par défaut (voir AuthService.register) modifiables
  // ensuite depuis Paramètres → Profil.
  firstName?: string;
  lastName?: string;
  username: string;
  email?: string;
  phone?: string;
  password: string;
  primaryLanguageCode?: string;
  preferredReceiveLanguageCode?: string;
  deviceLabel?: string;
}

export interface LoginInput {
  identifier: string;
  password: string;
  deviceLabel?: string;
}

export interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  username?: string;
  email?: string;
  phone?: string;
  primaryLanguageCode?: string;
  preferredReceiveLanguageCode?: string;
  spokenLanguageCodes?: string[];
}

export interface UpdateProfileInput {
  avatarUrl?: string;
  statusText?: string;
  showLastSeen?: boolean;
  showOnlineStatus?: boolean;
  showReadReceipts?: boolean;
  whoCanMessageMe?: WhoCanInteract;
  whoCanSeeMyStatus?: WhoCanInteract;
  notificationsEnabled?: boolean;
  voiceCloningConsent?: boolean;
}

export const api = {
  auth: {
    register: (dto: RegisterInput) =>
      request<AuthResponse>("/auth/register", { method: "POST", body: dto, auth: false }),
    login: (dto: LoginInput) =>
      request<AuthResponse>("/auth/login", { method: "POST", body: dto, auth: false }),
    logout: () => request<void>("/auth/logout", { method: "POST" }),
    logoutAll: () => request<void>("/auth/logout-all", { method: "POST" }),
    changePassword: (dto: { currentPassword: string; newPassword: string }) =>
      request<void>("/auth/change-password", { method: "PATCH", body: dto }),
    sessions: () => request<SessionSummary[]>("/auth/sessions"),
    revokeSession: (id: string) => request<void>(`/auth/sessions/${id}`, { method: "DELETE" }),
  },
  languages: {
    list: () => request<LanguageSummary[]>("/languages", { auth: false }),
  },
  users: {
    me: () => request<Me>("/users/me"),
    updateMe: (dto: UpdateUserInput) => request<Me>("/users/me", { method: "PATCH", body: dto }),
    updateProfile: (dto: UpdateProfileInput) =>
      request<ProfileRecord>("/users/me/profile", { method: "PATCH", body: dto }),
    search: (q: string) =>
      request<PublicUser[]>(`/users/search?q=${encodeURIComponent(q)}`),
    publicProfile: (id: string) => request<PublicUser>(`/users/${id}`),
    enrollVoiceModel: (sample: Blob, filename = "sample.webm") => {
      const form = new FormData();
      form.append("sample", sample, filename);
      return request<{ voiceModelId: string }>("/users/me/voice-model", { method: "POST", body: form });
    },
    removeVoiceModel: () => request<void>("/users/me/voice-model", { method: "DELETE" }),
    setAvatar: (file: File) => {
      const form = new FormData();
      form.append("avatar", file);
      return request<ProfileRecord>("/users/me/avatar", { method: "POST", body: form });
    },
    removeAvatar: () => request<void>("/users/me/avatar", { method: "DELETE" }),
  },
  conversations: {
    list: (cursor?: string) =>
      request<Page<Conversation>>(
        `/conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      ),
    get: (id: string) => request<Conversation>(`/conversations/${id}`),
    createDirect: (userId: string) =>
      request<Conversation>("/conversations", { method: "POST", body: { userId } }),
    messages: (id: string, cursor?: string) =>
      request<Page<Message>>(
        `/conversations/${id}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      ),
    // Galerie "Médias partagés" (InfoPanel) — les pièces jointes IMAGE/VIDEO
    // de la conversation, les plus récentes d'abord. Paginée par curseur
    // (jamais tout l'historique média d'un coup, même avec des centaines
    // de photos — voir MessagesService.listMedia côté backend).
    media: (id: string, cursor?: string) =>
      request<Page<MessageAttachment>>(
        `/conversations/${id}/media${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      ),
    markRead: (id: string) => request<void>(`/conversations/${id}/read`, { method: "POST" }),
    updateMembership: (id: string, dto: { isMuted?: boolean; isArchived?: boolean }) =>
      request<Conversation>(`/conversations/${id}`, { method: "PATCH", body: dto }),
    // Recherche texte dans la conversation (bouton "Rechercher" de l'en-tête,
    // jusqu'ici marqué "bientôt disponible") — paginée par curseur.
    searchMessages: (id: string, q: string, cursor?: string) =>
      request<Page<Message>>(
        `/conversations/${id}/messages/search?q=${encodeURIComponent(q)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      ),
    // Contexte immédiat autour d'un résultat de recherche — voir
    // MessagesService.listAroundMessage côté backend.
    messagesAround: (id: string, messageId: string) =>
      request<{ items: Message[]; matchedMessageId: string; hasOlder: boolean }>(
        `/conversations/${id}/messages/around/${messageId}`,
      ),
    // --- Groupes ---
    createGroup: (params: { title: string; description?: string; memberIds: string[]; photo?: File }) => {
      const form = new FormData();
      form.append("title", params.title);
      if (params.description) form.append("description", params.description);
      form.append("memberIds", JSON.stringify(params.memberIds));
      if (params.photo) form.append("photo", params.photo);
      return request<Conversation>("/conversations/group", { method: "POST", body: form });
    },
    updateGroup: (
      id: string,
      params: {
        title?: string;
        description?: string;
        photo?: File;
        editInfoPermission?: GroupPermission;
        sendMessagesPermission?: GroupPermission;
        addMembersPermission?: GroupPermission;
        sendMediaPermission?: GroupPermission;
        mentionEveryonePermission?: GroupPermission;
      },
    ) => {
      const form = new FormData();
      if (params.title !== undefined) form.append("title", params.title);
      if (params.description !== undefined) form.append("description", params.description);
      if (params.editInfoPermission) form.append("editInfoPermission", params.editInfoPermission);
      if (params.sendMessagesPermission) form.append("sendMessagesPermission", params.sendMessagesPermission);
      if (params.addMembersPermission) form.append("addMembersPermission", params.addMembersPermission);
      if (params.sendMediaPermission) form.append("sendMediaPermission", params.sendMediaPermission);
      if (params.mentionEveryonePermission)
        form.append("mentionEveryonePermission", params.mentionEveryonePermission);
      if (params.photo) form.append("photo", params.photo);
      return request<Conversation>(`/conversations/${id}/group`, { method: "PATCH", body: form });
    },
    photoUrl: (id: string) => `${API_URL}/conversations/${id}/photo`,
    addMembers: (id: string, userIds: string[]) =>
      request<Conversation>(`/conversations/${id}/members`, { method: "POST", body: { userIds } }),
    removeMember: (id: string, userId: string) =>
      request<void>(`/conversations/${id}/members/${userId}`, { method: "DELETE" }),
    leaveGroup: (id: string) => request<void>(`/conversations/${id}/leave`, { method: "POST" }),
    setMemberRole: (id: string, userId: string, role: GroupRole) =>
      request<Conversation>(`/conversations/${id}/members/${userId}/role`, {
        method: "PATCH",
        body: { role },
      }),
    deleteGroup: (id: string) => request<void>(`/conversations/${id}/group`, { method: "DELETE" }),
    // --- Lien d'invitation (section 7) ---
    getOrCreateInvite: (id: string) =>
      request<GroupInvite>(`/conversations/${id}/invite`, { method: "POST" }),
    resetInvite: (id: string) =>
      request<GroupInvite>(`/conversations/${id}/invite/reset`, { method: "POST" }),
    setInviteActive: (id: string, isActive: boolean) =>
      request<GroupInvite>(`/conversations/${id}/invite`, { method: "PATCH", body: { isActive } }),
  },
  groupInvites: {
    // Public — aucune authentification (voir GroupInvitesController côté backend).
    preview: (token: string) => request<GroupInvitePreview>(`/group-invites/${token}`, { auth: false }),
    join: (token: string) => request<Conversation>(`/group-invites/${token}/join`, { method: "POST" }),
  },
  messages: {
    send: (conversationId: string, text: string, replyToId?: string) =>
      request<Message>("/messages", { method: "POST", body: { conversationId, text, replyToId } }),
    sendImage: (params: { conversationId: string; file: File; text?: string; replyToId?: string }) => {
      const form = new FormData();
      form.append("conversationId", params.conversationId);
      if (params.text) form.append("text", params.text);
      if (params.replyToId) form.append("replyToId", params.replyToId);
      form.append("image", params.file);
      return request<Message>("/messages/image", { method: "POST", body: form });
    },
    // Un ou plusieurs médias envoyés ensemble ("album") — remplace sendImage
    // pour tout nouvel envoi, même un seul fichier (voir MessagesService.sendMedia).
    sendMedia: (params: {
      conversationId: string;
      files: File[];
      text?: string;
      replyToId?: string;
      // Aligné par position sur `files` — lu réellement depuis chaque fichier
      // côté composeur (voir media-metadata.ts), jamais inventé.
      meta?: Array<{ fileName?: string; durationSeconds?: number; width?: number; height?: number }>;
    }) => {
      const form = new FormData();
      form.append("conversationId", params.conversationId);
      if (params.text) form.append("text", params.text);
      if (params.replyToId) form.append("replyToId", params.replyToId);
      if (params.meta) form.append("meta", JSON.stringify(params.meta));
      params.files.forEach((file) => form.append("media", file));
      return request<Message>("/messages/media", { method: "POST", body: form });
    },
    attachmentUrl: (attachmentId: string) => `${API_URL}/messages/attachments/${attachmentId}`,
    edit: (id: string, text: string) =>
      request<Message>(`/messages/${id}`, { method: "PATCH", body: { text } }),
    remove: (id: string) => request<void>(`/messages/${id}`, { method: "DELETE" }),
    addReaction: (id: string, emoji: string) =>
      request<Message>(`/messages/${id}/reactions`, { method: "POST", body: { emoji } }),
    removeReaction: (id: string) => request<Message>(`/messages/${id}/reactions`, { method: "DELETE" }),
  },
  voice: {
    audioUrl: (messageId: string) => `${API_URL}/voice/${messageId}/audio`,
    // Renvoie la forme VoiceMessageDto du backend (imbriquée sous `voice`,
    // différente de MessageDto) — voir lib/normalize-message.ts, utilisé
    // aussi bien ici que pour l'événement socket "message:new".
    send: (params: { conversationId: string; durationSeconds: number; blob: Blob; mimeType: string; replyToId?: string }) => {
      const extension = params.mimeType.split("/")[1]?.split(";")[0] ?? "webm";
      const form = new FormData();
      form.append("conversationId", params.conversationId);
      form.append("durationSeconds", String(Math.max(1, Math.round(params.durationSeconds))));
      if (params.replyToId) form.append("replyToId", params.replyToId);
      form.append("audio", params.blob, `voice.${extension}`);
      return request<unknown>("/voice/messages", { method: "POST", body: form });
    },
    remove: (messageId: string) => request<void>(`/voice/${messageId}`, { method: "DELETE" }),
    // Renvoie la forme VoiceMessageDto (imbriquée sous `voice`) — jamais
    // fournie par GET /conversations/:id/messages, nécessaire pour afficher
    // la transcription/traduction d'un vocal chargé depuis l'historique.
    getDetails: (messageId: string) => request<unknown>(`/voice/${messageId}`),
    translatedAudioUrl: (messageId: string, languageCode: string) =>
      `${API_URL}/voice/${messageId}/translations/${languageCode}/audio`,
  },
  notifications: {
    list: (cursor?: string) =>
      request<Page<AppNotification>>(
        `/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      ),
    unreadCount: () => request<{ count: number }>("/notifications/unread-count"),
    markAllRead: () => request<void>("/notifications/read-all", { method: "PATCH" }),
    markRead: (id: string) => request<AppNotification>(`/notifications/${id}/read`, { method: "PATCH" }),
  },
  push: {
    // Route publique (pas de guard côté backend) : utilisable avant même la
    // connexion pour préparer un abonnement.
    getPublicKey: () => request<{ publicKey: string }>("/push/public-key", { auth: false }),
    subscribe: (subscription: PushSubscriptionJSON) =>
      request<void>("/push/subscribe", { method: "POST", body: subscription }),
    unsubscribe: (endpoint: string) =>
      request<void>("/push/subscribe", { method: "DELETE", body: { endpoint } }),
  },
  calls: {
    // RTCIceServer est un type global du lib DOM (forme identique au JSON renvoyé par le backend).
    iceServers: () => request<RTCIceServer[]>("/calls/ice-servers"),
    // Hydratation à la demande d'un message CALL chargé depuis l'historique — jamais fourni par GET /conversations/:id/messages.
    getMessage: (messageId: string) => request<CallMessagePayload>(`/calls/message/${messageId}`),
    // Reprise d'un appel entrant après ouverture de l'app depuis l'action "Répondre" d'une notification push (voir use-call.ts resumeIncoming).
    getById: (callId: string) => request<CallMessagePayload>(`/calls/${callId}`),
    history: (cursor?: string) =>
      request<Page<CallHistoryEntry>>(`/calls${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
  },
  contacts: {
    list: () => request<PublicUser[]>("/contacts"),
    requests: (direction: "incoming" | "sent" = "incoming") =>
      request<ContactRequest[]>(`/contacts/requests?direction=${direction}`),
    sendRequest: (userId: string) =>
      request<ContactRequest>("/contacts/requests", { method: "POST", body: { userId } }),
    accept: (requestId: string) =>
      request<ContactRequest>(`/contacts/requests/${requestId}/accept`, { method: "POST" }),
    decline: (requestId: string) =>
      request<void>(`/contacts/requests/${requestId}/decline`, { method: "POST" }),
    cancel: (requestId: string) => request<void>(`/contacts/requests/${requestId}`, { method: "DELETE" }),
    block: (userId: string) => request<void>("/contacts/block", { method: "POST", body: { userId } }),
    unblock: (userId: string) => request<void>("/contacts/unblock", { method: "POST", body: { userId } }),
    statusWith: (userId: string) => request<{ status: ContactStatus }>(`/contacts/status/${userId}`),
    share: (conversationId: string, userId: string) =>
      request<Message>("/contacts/share", { method: "POST", body: { conversationId, userId } }),
    // Hydratation à la demande d'un message CONTACT_SHARE chargé depuis
    // l'historique — jamais fourni par GET /conversations/:id/messages.
    // Contrairement à CallMessagePayload, la forme renvoyée est déjà un
    // Message complet (voir ContactsService.toContactShareMessageDto côté
    // backend), pas besoin d'un type/converteur séparé.
    getMessage: (messageId: string) => request<Message>(`/contacts/message/${messageId}`),
  },
  statuses: {
    list: () => request<Status[]>("/statuses"),
    mediaUrl: (id: string) => `${API_URL}/statuses/${id}/media`,
    create: (params: {
      type: StatusType;
      text?: string;
      visibility?: StatusVisibility;
      // `Blob` (pas seulement `File`) : un statut VOICE vient de
      // MediaRecorder, qui ne produit qu'un Blob — jamais de nom de fichier
      // propre, d'où le paramètre séparé.
      file?: Blob;
      filename?: string;
    }) => {
      const form = new FormData();
      form.append("type", params.type);
      if (params.text) form.append("text", params.text);
      if (params.visibility) form.append("visibility", params.visibility);
      if (params.file) form.append("media", params.file, params.filename);
      return request<Status>("/statuses", { method: "POST", body: form });
    },
    markViewed: (id: string) => request<void>(`/statuses/${id}/view`, { method: "POST" }),
    views: (id: string) => request<StatusView[]>(`/statuses/${id}/views`),
    remove: (id: string) => request<void>(`/statuses/${id}`, { method: "DELETE" }),
  },
  reports: {
    // N'importe quel utilisateur peut signaler (section admin/modération) —
    // aucune lecture côté app principale, seule l'app admin séparée liste
    // et traite les signalements.
    create: (params: { targetType: "MESSAGE" | "STATUS" | "USER"; targetId: string; reason: string }) =>
      request<{ id: string; status: string }>("/reports", { method: "POST", body: params }),
  },
};

export { extractErrorMessage };
