"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { BouncingDots } from "@/components/BouncingDots";
import { ChatIcon } from "@/components/icons";
import { CallOverlay } from "@/components/chat/CallOverlay";
import { MinimizedCallBar } from "@/components/chat/MinimizedCallBar";
import { CallsPanel } from "@/components/chat/CallsPanel";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { ContactsPanel } from "@/components/chat/ContactsPanel";
import { ConversationList } from "@/components/chat/ConversationList";
import { GroupCreateModal } from "@/components/chat/GroupCreateModal";
import { IconRail, type RailView } from "@/components/chat/IconRail";
import { InfoPanel } from "@/components/chat/InfoPanel";
import { NewConversationModal } from "@/components/chat/NewConversationModal";
import { NotificationsPanel } from "@/components/chat/NotificationsPanel";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { StatusesPanel } from "@/components/statuses/StatusesPanel";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { readMediaMeta } from "@/lib/media-metadata";
import { normalizeIncomingMessage } from "@/lib/normalize-message";
import { useSocket } from "@/lib/socket";
import { useCall } from "@/lib/use-call";
import { unlockAudioOnFirstInteraction } from "@/lib/use-ring-tone";
import type { CallMessagePayload, Conversation, ConversationLastMessage, Message, MessageTranslationDetail } from "@/lib/types";
import type { VoiceRecording } from "@/lib/use-voice-recorder";

function sortByUpdatedAtDesc(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

/** Résumé utilisé pour Conversation.lastMessage — les messages CALL portent
 * en plus un statut/une durée (voir preview() dans ConversationList), tous
 * les autres types les laissent à `null`. */
function toLastMessage(message: Message): ConversationLastMessage {
  return {
    id: message.id,
    type: message.type,
    text: message.text,
    senderId: message.senderId,
    sentAt: message.sentAt,
    systemAction: message.systemAction,
    systemTargetUserId: message.systemTargetUserId,
    callType: message.call?.type ?? null,
    callStatus: message.call?.status ?? null,
    callDurationSeconds: message.call?.durationSeconds ?? null,
    mediaCount: message.attachments?.length ?? null,
    mediaHasVideo: message.attachments?.some((a) => a.type === "VIDEO") ?? null,
  };
}

/** Convertit le CallMessageDto reçu du namespace WebSocket "/calls" (ou de
 * GET /calls/message/:id) en Message affichable dans le fil — même forme que
 * ce que renvoie normalize-message.ts pour les autres types. */
function toCallMessage(payload: CallMessagePayload): Message {
  return {
    id: payload.id,
    conversationId: payload.conversationId,
    senderId: payload.senderId,
    type: "CALL",
    text: null,
    systemAction: null,
    systemTargetUserId: null,
    replyToId: null,
    replyTo: null,
    editedAt: null,
    deletedAt: null,
    sentAt: payload.sentAt,
    deliveredAt: null,
    readAt: null,
    createdAt: payload.createdAt,
    reactions: [],
    location: null,
    mentions: [],
    mentionsEveryone: false,
    call: payload.call,
  };
}


interface TranslationStagePayload {
  messageId: string;
  stage: "transcription" | "translation" | "tts";
  transcript?: string;
  detectedLanguageCode?: string | null;
  targetLanguageCode?: string;
  translatedText?: string;
  audioUrl?: string;
  usedVoiceCloning?: boolean;
}

/** Fusionne un événement "translation:*" dans le message vocal concerné,
 * sans jamais inventer de valeur : seuls les champs que l'événement porte
 * réellement sont mis à jour (voir VoiceTranslationPipelineService côté
 * backend pour la forme exacte de chaque étage). */
function applyTranslationEvent(
  messages: Message[],
  payload: TranslationStagePayload,
  kind: "started" | "completed" | "failed",
): Message[] {
  return messages.map((m) => {
    if (m.id !== payload.messageId || !m.voice) return m;

    if (payload.stage === "transcription") {
      if (kind !== "completed") return m;
      return {
        ...m,
        voice: {
          ...m.voice,
          transcript: payload.transcript ?? m.voice.transcript,
          detectedLanguage: payload.detectedLanguageCode
            ? { code: payload.detectedLanguageCode, name: payload.detectedLanguageCode, nativeName: payload.detectedLanguageCode }
            : m.voice.detectedLanguage,
        },
      };
    }

    // stage "translation" ou "tts" : les deux visent la même entrée (une
    // par langue cible), upsertée par code de langue. `status` ne reflète
    // que la traduction TEXTE (comme côté backend, MessageTranslation.
    // status) — un échec de synthèse vocale ("tts") ne doit jamais faire
    // disparaître un texte déjà traduit avec succès, donc ne touche jamais
    // `status` ici, seulement `audioUrl`.
    if (!payload.targetLanguageCode) return m;
    const code = payload.targetLanguageCode;
    const existing = m.voice.translations.find((t) => t.targetLanguage.code === code);
    const status =
      payload.stage === "translation"
        ? kind === "failed"
          ? "FAILED"
          : kind === "started"
            ? "PROCESSING"
            : "COMPLETED"
        : (existing?.status ?? "PROCESSING");

    const updated: MessageTranslationDetail = {
      targetLanguage: existing?.targetLanguage ?? { code, name: code, nativeName: code },
      status,
      translatedText: payload.translatedText ?? existing?.translatedText ?? null,
      audioUrl: payload.audioUrl ?? existing?.audioUrl ?? null,
      usedVoiceCloning: payload.usedVoiceCloning ?? existing?.usedVoiceCloning ?? false,
    };

    return {
      ...m,
      voice: {
        ...m.voice,
        translations: existing
          ? m.voice.translations.map((t) => (t.targetLanguage.code === code ? updated : t))
          : [...m.voice.translations, updated],
      },
    };
  });
}

export default function ChatPage() {
  // useSearchParams() exige une frontière Suspense côté App Router (lecture
  // de l'URL non disponible avant l'hydratation) — voir ChatPageInner ci-dessous.
  return (
    <Suspense fallback={null}>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const { user } = useAuth();
  const socket = useSocket(true);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [typingConversationIds, setTypingConversationIds] = useState<Set<string>>(new Set());
  const [infoOpen, setInfoOpen] = useState(false);
  // Message sur lequel on vient de sauter depuis MessageSearchPanel —
  // brièvement surligné puis effacé (voir jumpToMessage ci-dessous).
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showNewConversation, setShowNewConversation] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Détermine le contenu de la 2e colonne — voir IconRail. "conversations"
  // reste le seul cas géré par selectConversation()/openConversationById()
  // sans y repasser explicitement, mais sélectionner une conversation
  // depuis n'importe quelle vue (ex. un appel dans CallsPanel) y ramène.
  const [activeView, setActiveView] = useState<RailView>("conversations");
  // Badge du rail — vit ici (pas dans NotificationsPanel) pour rester à
  // jour même quand ce panneau n'est pas monté (voir IconRail/NotificationsBell).
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Débloque la sonnerie synthétisée dès la première interaction sur cette
  // page — un appel entrant n'est précédé d'aucun geste de notre part à cet
  // instant précis, impossible de compter dessus pour lever la politique de
  // lecture automatique du navigateur (voir use-ring-tone.ts).
  useEffect(() => {
    unlockAudioOnFirstInteraction();
  }, []);

  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  // Déclare au backend quelle conversation (le cas échéant) est réellement
  // affichée à l'écran — voir PresenceService.isViewingConversation /
  // NotificationsService.create côté serveur (section 14-18 : jamais de
  // notification "nouveau message" redondante pour une conversation déjà
  // ouverte). `ChatWindow` reste monté même quand le rail affiche un autre
  // panneau (Statuts/Appels/...), donc "ouverte" = `selected` non nul ET
  // Paramètres fermé, pas seulement `activeView === "conversations"`.
  const openConversationIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!socket) return;
    const activeId = !showSettings && selected ? selected.id : null;
    if (activeId === openConversationIdRef.current) return;
    if (activeId) {
      socket.emit("conversation:opened", { conversationId: activeId });
    } else if (openConversationIdRef.current) {
      socket.emit("conversation:closed", {});
    }
    openConversationIdRef.current = activeId;
  }, [socket, showSettings, selected]);

  const patchConversation = useCallback((id: string, patch: Partial<Conversation> | ((c: Conversation) => Conversation)) => {
    setConversations((prev) =>
      sortByUpdatedAtDesc(
        prev.map((c) => (c.id === id ? (typeof patch === "function" ? patch(c) : { ...c, ...patch }) : c)),
      ),
    );
  }, []);

  /** Groupe supprimé/quitté/dont on a été retiré — sur cet appareil ou un
   * autre (voir l'événement socket "conversation:left" ci-dessous, émis
   * uniquement à la personne concernée par ConversationsService). */
  const removeConversationFromList = useCallback((id: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setSelectedId((current) => (current === id ? null : current));
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      const page = await api.conversations.list();
      setConversations(sortByUpdatedAtDesc(page.items));
    } catch {
      // Laisse la liste précédente affichée plutôt que de la vider.
    }
  }, []);

  useEffect(() => {
    api.notifications.unreadCount().then((r) => setUnreadNotifications(r.count)).catch(() => {});
  }, []);

  useEffect(() => {
    // `loadingConversations` démarre déjà à `true` (voir useState ci-dessus) :
    // pas besoin de le refixer ici de façon synchrone.
    api.conversations
      .list()
      .then((page) => setConversations(sortByUpdatedAtDesc(page.items)))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Impossible de charger les conversations."))
      .finally(() => setLoadingConversations(false));
  }, []);

  // GET /conversations/:id/messages ne renvoie jamais transcription ni
  // traductions pour un vocal (voir normalize-message.ts) — un appel par
  // vocal manquant, en arrière-plan, sans bloquer l'affichage du reste.
  // N+1 assumé pour ce MVP (même choix documenté ailleurs, ex. le compteur
  // de non-lus) : rarement plus d'un ou deux vocaux par page de messages.
  const hydrateVoiceMessages = useCallback((items: Message[]) => {
    const toHydrate = items.filter((m) => m.type === "VOICE" && !m.voice);
    for (const m of toHydrate) {
      api.voice
        .getDetails(m.id)
        .then((raw) => {
          const detailed = normalizeIncomingMessage(raw);
          if (!detailed) return;
          setMessages((prev) => prev.map((existing) => (existing.id === m.id ? detailed : existing)));
        })
        .catch(() => {
          // Best-effort : la bulle reste utilisable sans transcription/traduction.
        });
    }
  }, []);

  // Même principe que hydrateVoiceMessages ci-dessus, pour les messages CALL
  // (jamais fournis avec leur détail par l'historique — voir GET /calls/message/:id).
  const hydrateCallMessages = useCallback((items: Message[]) => {
    const toHydrate = items.filter((m) => m.type === "CALL" && !m.call);
    for (const m of toHydrate) {
      api.calls
        .getMessage(m.id)
        .then((payload) => {
          setMessages((prev) => prev.map((existing) => (existing.id === m.id ? toCallMessage(payload) : existing)));
        })
        .catch(() => {
          // Best-effort : la bulle reste utilisable sans le détail (statut/durée).
        });
    }
  }, []);

  // Même principe que hydrateCallMessages ci-dessus, pour les messages
  // CONTACT_SHARE (jamais fournis avec leur détail par l'historique — voir
  // GET /contacts/message/:id).
  const hydrateContactShareMessages = useCallback((items: Message[]) => {
    const toHydrate = items.filter((m) => m.type === "CONTACT_SHARE" && !m.sharedContact);
    for (const m of toHydrate) {
      api.contacts
        .getMessage(m.id)
        .then((message) => {
          setMessages((prev) => prev.map((existing) => (existing.id === m.id ? message : existing)));
        })
        .catch(() => {
          // Best-effort : la bulle reste utilisable sans le profil (voir MessageBubble).
        });
    }
  }, []);

  const selectConversation = useCallback(
    async (conversation: Conversation) => {
      setSelectedId(conversation.id);
      setInfoOpen(false);
      setShowSettings(false);
      setActiveView("conversations");
      setLoadingMessages(true);
      setMessages([]);
      setNextCursor(null);
      setHighlightMessageId(null);
      try {
        const page = await api.conversations.messages(conversation.id);
        setMessages(page.items);
        setNextCursor(page.nextCursor);
        hydrateVoiceMessages(page.items);
        hydrateCallMessages(page.items);
        hydrateContactShareMessages(page.items);
        if (conversation.unreadCount > 0) {
          patchConversation(conversation.id, { unreadCount: 0 });
          await api.conversations.markRead(conversation.id);
        }
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Impossible de charger cette conversation.");
      } finally {
        setLoadingMessages(false);
      }
    },
    [patchConversation, hydrateVoiceMessages, hydrateCallMessages, hydrateContactShareMessages],
  );

  // Sélectionne, au premier chargement : la conversation demandée par
  // `?c=<id>` si présente (voir profile/[userId]/page.tsx → "Envoyer un
  // message", qui vient de la créer via POST /conversations) — jamais de
  // sélection automatique de la conversation la plus récente sinon : l'app
  // s'ouvre toujours sur la liste (façon WhatsApp Web), jamais directement
  // dans une discussion, voir l'état vide "Sélectionnez une conversation"
  // plus bas. queueMicrotask : voir le commentaire équivalent dans
  // auth-context.tsx — le corps de l'effet ne doit jamais déclencher de
  // setState de façon synchrone, même via une fonction async
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (loadingConversations || selectedId) return;
    const targetId = searchParams.get("c");
    if (!targetId) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      router.replace("/chat");
      void openConversationById(targetId);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ne doit s'exécuter qu'à la fin du chargement initial, pas à chaque changement de sélection.
  }, [loadingConversations, conversations.length]);

  async function loadOlderMessages() {
    if (!selected || !nextCursor) return;
    setLoadingOlder(true);
    try {
      const page = await api.conversations.messages(selected.id, nextCursor);
      setMessages((prev) => [...page.items, ...prev]);
      setNextCursor(page.nextCursor);
      hydrateVoiceMessages(page.items);
      hydrateCallMessages(page.items);
      hydrateContactShareMessages(page.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de charger la suite.");
    } finally {
      setLoadingOlder(false);
    }
  }

  // Depuis un résultat de MessageSearchPanel : recharge le fil autour du
  // message ciblé (voir GET .../messages/around/:messageId) plutôt que de
  // chercher dans les messages déjà en mémoire, qui peuvent très bien ne pas
  // couvrir ce point de l'historique. `hasOlder` du contexte remplace
  // `nextCursor` pour que "Charger les messages précédents" reste correct
  // depuis ce nouvel ancrage.
  const jumpToMessage = useCallback(
    async (messageId: string) => {
      if (!selected) return;
      try {
        const page = await api.conversations.messagesAround(selected.id, messageId);
        setMessages(page.items);
        setNextCursor(page.hasOlder && page.items.length > 0 ? page.items[0].id : null);
        hydrateVoiceMessages(page.items);
        hydrateCallMessages(page.items);
        hydrateContactShareMessages(page.items);
        if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
        setHighlightMessageId(messageId);
        highlightTimeoutRef.current = setTimeout(() => setHighlightMessageId(null), 2500);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Impossible d'afficher ce message.");
      }
    },
    [selected, hydrateVoiceMessages, hydrateCallMessages, hydrateContactShareMessages],
  );

  async function sendMessage(text: string, replyToId?: string) {
    if (!selected) return;
    const msg = await api.messages.send(selected.id, text, replyToId);
    setMessages((prev) => [...prev, msg]);
    patchConversation(selected.id, {
      lastMessage: toLastMessage(msg),
      updatedAt: msg.sentAt,
    });
  }

  async function sendLocation(latitude: number, longitude: number, replyToId?: string) {
    if (!selected) return;
    const msg = await api.messages.sendLocation({ conversationId: selected.id, latitude, longitude, replyToId });
    setMessages((prev) => [...prev, msg]);
    patchConversation(selected.id, {
      lastMessage: toLastMessage(msg),
      updatedAt: msg.sentAt,
    });
  }

  async function sendSticker(emoji: string, replyToId?: string) {
    if (!selected) return;
    const msg = await api.messages.sendSticker({ conversationId: selected.id, emoji, replyToId });
    setMessages((prev) => [...prev, msg]);
    patchConversation(selected.id, {
      lastMessage: toLastMessage(msg),
      updatedAt: msg.sentAt,
    });
  }

  async function sendVoiceMessage(recording: VoiceRecording, replyToId?: string) {
    if (!selected) return;
    try {
      const raw = await api.voice.send({
        conversationId: selected.id,
        durationSeconds: recording.durationSeconds,
        blob: recording.blob,
        mimeType: recording.mimeType,
        replyToId,
      });
      const msg = normalizeIncomingMessage(raw);
      if (!msg) return;
      setMessages((prev) => [...prev, msg]);
      patchConversation(selected.id, {
        lastMessage: toLastMessage(msg),
        updatedAt: msg.sentAt,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'envoyer le message vocal.");
    }
  }

  async function sendMediaMessage(files: File[], caption: string, replyToId?: string) {
    if (!selected) return;
    try {
      // Lu réellement depuis chaque fichier (jamais inventé, voir media-metadata.ts)
      // — purement cosmétique côté affichage, le backend ne recalcule rien lui-même.
      const meta = await Promise.all(files.map((file) => readMediaMeta(file)));
      const msg = await api.messages.sendMedia({
        conversationId: selected.id,
        files,
        text: caption || undefined,
        meta,
        replyToId,
      });
      setMessages((prev) => [...prev, msg]);
      patchConversation(selected.id, {
        lastMessage: toLastMessage(msg),
        updatedAt: msg.sentAt,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'envoyer ces médias.");
    }
  }

  async function deleteVoiceMessage(messageId: string) {
    try {
      await api.voice.remove(messageId);
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, deletedAt: new Date().toISOString(), text: null } : m)),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible de supprimer ce message vocal.");
    }
  }

  function startConversation(conversation: Conversation) {
    setShowNewConversation(false);
    setConversations((prev) => {
      const exists = prev.some((c) => c.id === conversation.id);
      return sortByUpdatedAtDesc(exists ? prev : [conversation, ...prev]);
    });
    void selectConversation(conversation);
  }

  function onGroupCreated(conversation: Conversation) {
    setShowNewGroup(false);
    setConversations((prev) => sortByUpdatedAtDesc([conversation, ...prev]));
    void selectConversation(conversation);
  }

  async function openConversationById(conversationId: string) {
    const existing = conversations.find((c) => c.id === conversationId);
    if (existing) {
      void selectConversation(existing);
      return;
    }
    try {
      const conversation = await api.conversations.get(conversationId);
      setConversations((prev) => sortByUpdatedAtDesc([conversation, ...prev]));
      void selectConversation(conversation);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Impossible d'ouvrir cette conversation.");
    }
  }

  // Reflète chaque changement d'état d'appel (invitation, acceptation, refus,
  // fin...) dans le fil de la conversation concernée si c'est celle
  // actuellement ouverte, et dans sa prévisualisation dans la liste sinon —
  // même logique que onMessageNew ci-dessous, réutilisée par useCall.
  const applyCallMessage = useCallback(
    (payload: CallMessagePayload) => {
      const message = toCallMessage(payload);

      if (selectedIdRef.current === payload.conversationId) {
        setMessages((prev) => {
          const exists = prev.some((m) => m.id === message.id);
          return exists ? prev.map((m) => (m.id === message.id ? message : m)) : [...prev, message];
        });
      }

      setConversations((prev) => {
        const exists = prev.some((c) => c.id === payload.conversationId);
        if (!exists) {
          void refreshConversations();
          return prev;
        }
        return sortByUpdatedAtDesc(
          prev.map((c) =>
            c.id === payload.conversationId
              ? { ...c, lastMessage: toLastMessage(message), updatedAt: message.sentAt }
              : c,
          ),
        );
      });
    },
    [refreshConversations],
  );

  const call = useCall(Boolean(user), applyCallMessage);

  // État d'affichage pur (aucun lien avec useCall/WebRTC) — permet de réduire
  // l'appel en cours en une pastille flottante pour continuer à écrire des
  // messages sans raccrocher (façon WhatsApp). Toujours remis à false à la
  // fin d'un appel et à l'arrivée d'un nouvel appel entrant, pour qu'un appel
  // ne démarre/sonne jamais réduit par défaut.
  const [callMinimized, setCallMinimized] = useState(false);
  useEffect(() => {
    if (call.phase === "idle" || call.phase === "incoming") {
      queueMicrotask(() => setCallMinimized(false));
    }
  }, [call.phase]);

  // Reprise d'un appel entrant après ouverture de l'app depuis l'action
  // "Répondre" d'une notification push système (voir sw.js,
  // useCall.resumeIncoming) — le socket "/calls" vient tout juste de se
  // connecter ci-dessus, donc aucun événement `call:incoming` en temps réel
  // n'a pu être reçu pour un appel initié pendant que l'app était fermée.
  useEffect(() => {
    const callId = searchParams.get("incomingCall");
    if (!callId || call.phase !== "idle") return;
    queueMicrotask(() => {
      // Ne retire QUE `incomingCall` de l'URL (jamais `/chat` en dur) : le
      // lien de la notification porte aussi `?c=<conversationId>` (voir
      // PushProvider.sendCallInvite), que l'effet ci-dessus doit encore
      // pouvoir traiter une fois la liste de conversations chargée.
      const params = new URLSearchParams(searchParams.toString());
      params.delete("incomingCall");
      const query = params.toString();
      router.replace(query ? `/chat?${query}` : "/chat");
      void call.resumeIncoming(callId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `call` (retourné par useCall) est un nouvel objet à chaque rendu ; dépendre de sa seule référence stable (call.resumeIncoming, via useCallback) plutôt que de l'objet entier évite une boucle de ré-exécution.
  }, [call.phase, call.resumeIncoming, searchParams, router]);

  function startCall(kind: "AUDIO" | "VIDEO") {
    if (!selected?.otherParticipant) return;
    void call.start(selected.id, selected.otherParticipant.id, kind);
  }

  const callConversation = conversations.find((c) => c.id === call.conversationId) ?? null;
  const callPeer =
    callConversation?.otherParticipant ??
    (call.otherUserId ? conversations.flatMap((c) => c.members).find((m) => m.id === call.otherUserId) : null) ??
    null;

  // Temps réel : un seul abonnement pour toute la durée de vie de la
  // connexion socket, jamais réabonné à chaque changement de sélection (voir
  // selectedIdRef) — resouscrire à chaque clic romprait brièvement la
  // réception d'événements pendant la reconnexion.
  useEffect(() => {
    if (!socket || !user) return;

    function onMessageNew(raw: unknown) {
      const msg = normalizeIncomingMessage(raw);
      if (!msg) return;

      setConversations((prev) => {
        const exists = prev.some((c) => c.id === msg!.conversationId);
        if (!exists) {
          void refreshConversations();
          return prev;
        }
        return sortByUpdatedAtDesc(
          prev.map((c) =>
            c.id === msg!.conversationId
              ? {
                  ...c,
                  lastMessage: toLastMessage(msg!),
                  unreadCount: selectedIdRef.current === msg!.conversationId ? c.unreadCount : c.unreadCount + 1,
                  updatedAt: msg!.sentAt,
                }
              : c,
          ),
        );
      });

      if (selectedIdRef.current === msg.conversationId) {
        setMessages((prev) => [...prev, msg]);
        void api.conversations.markRead(msg.conversationId);
      }
    }

    function onMessageUpdated(raw: unknown) {
      const msg = normalizeIncomingMessage(raw);
      if (!msg) return;
      if (selectedIdRef.current === msg.conversationId) {
        setMessages((prev) => prev.map((m) => (m.id === msg!.id ? msg! : m)));
      }
    }

    function onMessageDeleted(payload: { id: string; conversationId: string }) {
      if (selectedIdRef.current === payload.conversationId) {
        setMessages((prev) => prev.map((m) => (m.id === payload.id ? { ...m, deletedAt: new Date().toISOString(), text: null } : m)));
      }
    }

    function onMessageRead(payload: { conversationId: string; readerId: string; readAt: string }) {
      if (payload.readerId === user!.id) {
        // Conversation lue depuis un AUTRE de nos appareils (section 21-22,
        // synchronisation multi-appareils) — jamais les coches (celles-ci ne
        // concernent que la lecture par l'AUTRE participant), seulement le
        // badge non-lu ici. Sur l'appareil qui a réellement effectué la
        // lecture, ceci est un no-op (déjà à 0 via l'appel optimiste dans
        // selectConversation()).
        patchConversation(payload.conversationId, { unreadCount: 0 });
        return;
      }
      if (selectedIdRef.current === payload.conversationId) {
        setMessages((prev) =>
          prev.map((m) => (m.senderId === user!.id && !m.readAt ? { ...m, readAt: payload.readAt, deliveredAt: m.deliveredAt ?? payload.readAt } : m)),
        );
      }
    }

    function onTyping(payload: { conversationId: string; userId: string }) {
      if (payload.userId === user!.id) return;
      setTypingConversationIds((prev) => new Set(prev).add(payload.conversationId));
    }

    function onStopTyping(payload: { conversationId: string; userId: string }) {
      if (payload.userId === user!.id) return;
      setTypingConversationIds((prev) => {
        const next = new Set(prev);
        next.delete(payload.conversationId);
        return next;
      });
    }

    function patchPresence(userId: string, isOnline: boolean, lastSeenAt: string | null) {
      setConversations((prev) =>
        prev.map((c) => ({
          ...c,
          otherParticipant:
            c.otherParticipant?.id === userId ? { ...c.otherParticipant, isOnline, lastSeenAt } : c.otherParticipant,
          members: c.members.map((m) => (m.id === userId ? { ...m, isOnline, lastSeenAt } : m)),
        })),
      );
    }

    function onOnline(payload: { userId: string }) {
      patchPresence(payload.userId, true, null);
    }
    function onOffline(payload: { userId: string; lastSeenAt: string }) {
      patchPresence(payload.userId, false, payload.lastSeenAt);
    }

    // Badge du rail (voir IconRail/NotificationsBell) — mis à jour en direct
    // ici, indépendamment de NotificationsPanel qui n'est monté que quand
    // cette vue est active.
    function onNotificationNew() {
      setUnreadNotifications((n) => n + 1);
    }

    // Pipeline de traduction d'un vocal — seul le message affiché est mis à
    // jour (les autres, pas encore chargés, seront hydratés par
    // hydrateVoiceMessages à leur tour, avec l'état déjà à jour en base).
    function onTranslationStarted(payload: TranslationStagePayload) {
      setMessages((prev) => applyTranslationEvent(prev, payload, "started"));
    }
    function onTranslationCompleted(payload: TranslationStagePayload) {
      setMessages((prev) => applyTranslationEvent(prev, payload, "completed"));
    }
    function onTranslationFailed(payload: TranslationStagePayload) {
      setMessages((prev) => applyTranslationEvent(prev, payload, "failed"));
    }

    // Groupe supprimé/quitté/dont on a été retiré (voir removeConversationFromList) —
    // le seul événement temps réel réellement nouveau pour les groupes :
    // tout le reste (création, ajout de membre, renommage...) passe par les
    // messages système via "message:new"/"message:updated", déjà gérés
    // ci-dessus sans code supplémentaire.
    function onConversationLeft(payload: { conversationId: string }) {
      removeConversationFromList(payload.conversationId);
    }

    socket.on("message:new", onMessageNew);
    socket.on("message:updated", onMessageUpdated);
    socket.on("message:deleted", onMessageDeleted);
    socket.on("translation:started", onTranslationStarted);
    socket.on("translation:completed", onTranslationCompleted);
    socket.on("translation:failed", onTranslationFailed);
    socket.on("message:read", onMessageRead);
    socket.on("message:typing", onTyping);
    socket.on("message:stop_typing", onStopTyping);
    socket.on("user:online", onOnline);
    socket.on("user:offline", onOffline);
    socket.on("notification:new", onNotificationNew);
    socket.on("conversation:left", onConversationLeft);

    return () => {
      socket.off("message:new", onMessageNew);
      socket.off("message:updated", onMessageUpdated);
      socket.off("message:deleted", onMessageDeleted);
      socket.off("translation:started", onTranslationStarted);
      socket.off("translation:completed", onTranslationCompleted);
      socket.off("translation:failed", onTranslationFailed);
      socket.off("message:read", onMessageRead);
      socket.off("message:typing", onTyping);
      socket.off("message:stop_typing", onStopTyping);
      socket.off("user:online", onOnline);
      socket.off("user:offline", onOffline);
      socket.off("notification:new", onNotificationNew);
      socket.off("conversation:left", onConversationLeft);
    };
  }, [socket, user, refreshConversations, patchConversation, removeConversationFromList]);

  if (!user) return null;

  return (
    <>
      <IconRail
        unreadNotifications={unreadNotifications}
        activeView={activeView}
        onSelectView={(view) => {
          setShowSettings(false);
          setActiveView(view);
        }}
        onNewConversation={() => setShowNewConversation(true)}
        onOpenSettings={() => setShowSettings(true)}
        hiddenOnMobile={Boolean(selected) || showSettings}
      />

      {activeView === "conversations" && (
        <ConversationList
          conversations={conversations}
          loading={loadingConversations}
          selectedId={selectedId}
          myUserId={user.id}
          typingConversationIds={typingConversationIds}
          onSelect={(c) => void selectConversation(c)}
          onNewGroup={() => setShowNewGroup(true)}
          hiddenOnMobile={Boolean(selected) || showSettings}
        />
      )}

      {activeView === "groups" && (
        <ConversationList
          conversations={conversations}
          loading={loadingConversations}
          selectedId={selectedId}
          myUserId={user.id}
          typingConversationIds={typingConversationIds}
          onSelect={(c) => void selectConversation(c)}
          onNewGroup={() => setShowNewGroup(true)}
          hiddenOnMobile={Boolean(selected) || showSettings}
          variant="groups"
        />
      )}

      {activeView === "statuses" && <StatusesPanel hiddenOnMobile={Boolean(selected) || showSettings} />}

      {activeView === "calls" && (
        <CallsPanel
          onOpenConversation={(conversationId) => void openConversationById(conversationId)}
          hiddenOnMobile={Boolean(selected) || showSettings}
        />
      )}

      {activeView === "contacts" && (
        <ContactsPanel onStartConversation={startConversation} hiddenOnMobile={Boolean(selected) || showSettings} />
      )}

      {activeView === "notifications" && (
        <NotificationsPanel
          onOpenConversation={(conversationId) => void openConversationById(conversationId)}
          onUnreadCountChange={setUnreadNotifications}
          hiddenOnMobile={Boolean(selected) || showSettings}
        />
      )}

      {showSettings ? (
        <SettingsPage onClose={() => setShowSettings(false)} />
      ) : selected ? (
        <ChatWindow
          conversation={selected}
          me={user}
          messages={messages}
          loadingMessages={loadingMessages}
          hasOlder={nextCursor !== null}
          loadingOlder={loadingOlder}
          onLoadOlder={loadOlderMessages}
          isOtherTyping={typingConversationIds.has(selected.id)}
          socket={socket}
          onSend={sendMessage}
          onSendVoice={sendVoiceMessage}
          onSendMedia={sendMediaMessage}
          onSendSticker={sendSticker}
          onSendLocation={sendLocation}
          onDeleteVoice={(id) => void deleteVoiceMessage(id)}
          infoOpen={infoOpen}
          onToggleInfo={() => setInfoOpen((v) => !v)}
          onStartCall={startCall}
          canCall={call.phase === "idle"}
          onBack={() => setSelectedId(null)}
          highlightMessageId={highlightMessageId}
          onJumpToMessage={(id) => void jumpToMessage(id)}
        />
      ) : (
        <div className="hidden flex-1 flex-col items-center justify-center gap-3 text-center lg:flex">
          {loadingConversations ? (
            <BouncingDots />
          ) : (
            <>
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-surface-raised text-muted">
                <ChatIcon size={28} />
              </span>
              <p className="text-sm text-muted">
                {conversations.length === 0
                  ? "Aucune conversation pour l'instant. Cliquez sur + pour en démarrer une."
                  : "Sélectionnez une conversation."}
              </p>
            </>
          )}
        </div>
      )}

      {!showSettings && selected && infoOpen && (
        <InfoPanel
          conversation={selected}
          myUserId={user.id}
          onClose={() => setInfoOpen(false)}
          onUpdated={(c) => patchConversation(c.id, c)}
          onLeft={() => {
            setInfoOpen(false);
            removeConversationFromList(selected.id);
          }}
        />
      )}

      {showNewConversation && (
        <NewConversationModal onClose={() => setShowNewConversation(false)} onStarted={startConversation} />
      )}

      {showNewGroup && (
        <GroupCreateModal onClose={() => setShowNewGroup(false)} onCreated={onGroupCreated} />
      )}

      {call.phase !== "idle" && !callMinimized && (
        <CallOverlay
          phase={call.phase}
          kind={call.kind}
          peer={callPeer}
          durationSeconds={call.durationSeconds}
          muted={call.muted}
          videoEnabled={call.videoEnabled}
          remoteVideoEnabled={call.remoteVideoEnabled}
          error={call.error}
          remoteVideoRef={call.remoteVideoRef}
          localVideoRef={call.localVideoRef}
          onAccept={() => void call.accept()}
          onReject={() => void call.reject()}
          onHangUp={() => void call.hangUp()}
          onToggleMute={call.toggleMute}
          onToggleVideo={() => void call.toggleVideo()}
          onMinimize={() => setCallMinimized(true)}
        />
      )}

      {call.phase !== "idle" && callMinimized && (
        <MinimizedCallBar
          peer={callPeer}
          phase={call.phase}
          kind={call.kind}
          durationSeconds={call.durationSeconds}
          onExpand={() => setCallMinimized(false)}
          onHangUp={() => void call.hangUp()}
        />
      )}

      {error && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-xl border border-danger/30 bg-surface-raised px-4 py-2.5 text-sm text-danger shadow-2xl">
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-muted hover:text-foreground">
            ✕
          </button>
        </div>
      )}
    </>
  );
}
