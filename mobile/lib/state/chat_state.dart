import 'dart:async';
import 'package:collection/collection.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/message.dart';
import '../services/api_client.dart';
import '../services/socket_service.dart';
import 'conversations_state.dart';

/// Émojis fixes alignés avec le backend (`ALLOWED_REACTION_EMOJIS`) — jamais
/// un choix arbitraire, une réaction hors de cette liste est de toute façon
/// rejetée côté serveur.
const List<String> allowedReactionEmojis = ['👍', '❤️', '😂', '😮', '😢', '👏'];

class ChatState {
  final List<Message> messages;
  final bool loading;
  final bool loadingMore;
  final String? nextCursor;
  final String? error;
  final Set<String> typingUserIds;
  /// Message auquel on répond — affiché au-dessus du champ de saisie (voir
  /// ChatScreen), effacé après envoi ou annulation explicite.
  final Message? replyingTo;

  const ChatState({
    this.messages = const [],
    this.loading = false,
    this.loadingMore = false,
    this.nextCursor,
    this.error,
    this.typingUserIds = const {},
    this.replyingTo,
  });

  ChatState copyWith({
    List<Message>? messages,
    bool? loading,
    bool? loadingMore,
    String? nextCursor,
    bool clearNextCursor = false,
    String? error,
    Set<String>? typingUserIds,
    Message? replyingTo,
    bool clearReplyingTo = false,
  }) =>
      ChatState(
        messages: messages ?? this.messages,
        loading: loading ?? this.loading,
        loadingMore: loadingMore ?? this.loadingMore,
        nextCursor: clearNextCursor ? null : (nextCursor ?? this.nextCursor),
        error: error,
        typingUserIds: typingUserIds ?? this.typingUserIds,
        replyingTo: clearReplyingTo ? null : (replyingTo ?? this.replyingTo),
      );
}

/// Un notifier par conversation ouverte (voir `chatProvider.family` plus
/// bas) — équivalent du bloc `messages`/`applyIncomingMessage` de
/// `chat/page.tsx`, mais scindé de la liste des conversations
/// (`ConversationsNotifier`) plutôt que dans un seul état géant : chaque fil
/// de discussion a son propre cycle de vie (créé à l'ouverture, détruit à la
/// fermeture via `autoDispose`), la liste des conversations vit tout le
/// temps.
class ChatNotifier extends Notifier<ChatState> {
  final String conversationId;
  ChatNotifier(this.conversationId);

  StreamSubscription<Message>? _newSub;
  StreamSubscription<Message>? _updatedSub;
  StreamSubscription<Map<String, dynamic>>? _deletedSub;
  StreamSubscription<Map<String, String>>? _typingSub;
  StreamSubscription<Map<String, dynamic>>? _readSub;
  StreamSubscription<Map<String, dynamic>>? _translationSub;
  Timer? _stopTypingDebounce;

  @override
  ChatState build() {
    ref.read(conversationsProvider.notifier).activeConversationId = conversationId;
    ref.onDispose(() {
      if (ref.read(conversationsProvider.notifier).activeConversationId == conversationId) {
        ref.read(conversationsProvider.notifier).activeConversationId = null;
      }
      _newSub?.cancel();
      _updatedSub?.cancel();
      _deletedSub?.cancel();
      _typingSub?.cancel();
      _readSub?.cancel();
      _translationSub?.cancel();
      _stopTypingDebounce?.cancel();
    });

    _newSub = SocketService.instance.onNewMessage.listen((m) {
      if (m.conversationId != conversationId) return;
      state = state.copyWith(messages: [...state.messages, m]);
    });
    _translationSub = SocketService.instance.onTranslationEvent.listen((payload) {
      final messageId = payload['messageId'] as String?;
      if (messageId == null) return;
      final index = state.messages.indexWhere((m) => m.id == messageId);
      if (index == -1 || state.messages[index].voice == null) return;
      final updated = [...state.messages];
      updated[index] =
          updated[index].copyWith(voice: _applyTranslationEvent(updated[index].voice!, payload));
      state = state.copyWith(messages: updated);
    });
    _updatedSub = SocketService.instance.onMessageUpdated.listen((m) {
      if (m.conversationId != conversationId) return;
      state = state.copyWith(
        messages: state.messages.map((existing) => existing.id == m.id ? m : existing).toList(),
      );
    });
    _deletedSub = SocketService.instance.onMessageDeleted.listen((payload) {
      final id = payload['id'] as String?;
      if (id == null) return;
      state = state.copyWith(messages: state.messages.where((m) => m.id != id).toList());
    });
    _typingSub = SocketService.instance.onTyping.listen((payload) {
      if (payload['conversationId'] != conversationId) return;
      state = state.copyWith(typingUserIds: {...state.typingUserIds, payload['userId']!});
    });
    _readSub = SocketService.instance.onRead.listen((payload) {
      if (payload['conversationId'] != conversationId) return;
      final readAt = DateTime.parse(payload['readAt'] as String);
      state = state.copyWith(
        messages: state.messages
            .map((m) => m.readAt == null ? m.copyWith(readAt: readAt, deliveredAt: readAt) : m)
            .toList(),
      );
    });

    Future.microtask(_load);
    return const ChatState(loading: true);
  }

  Future<void> _load() async {
    try {
      final page = await ApiClient.instance.messages(conversationId);
      // La page arrive triée du plus récent au plus ancien (curseur =
      // dernier id chargé) — inversée ici pour un affichage chronologique
      // classique (le plus ancien en haut), même convention que ChatWindow.
      state = state.copyWith(
        messages: page.items.reversed.toList(),
        loading: false,
        nextCursor: page.nextCursor,
      );
      unawaited(_markRead());
      _hydrateVoiceMessages(page.items);
    } on ApiException catch (e) {
      state = state.copyWith(loading: false, error: e.message);
    }
  }

  Future<void> loadMore() async {
    if (state.loadingMore || state.nextCursor == null) return;
    state = state.copyWith(loadingMore: true);
    try {
      final page = await ApiClient.instance.messages(conversationId, cursor: state.nextCursor);
      state = state.copyWith(
        messages: [...page.items.reversed, ...state.messages],
        loadingMore: false,
        nextCursor: page.nextCursor,
        clearNextCursor: page.nextCursor == null,
      );
      _hydrateVoiceMessages(page.items);
    } on ApiException catch (_) {
      state = state.copyWith(loadingMore: false);
    }
  }

  /// `GET /conversations/:id/messages` ne renvoie jamais `voice` (voir le
  /// rapport backend) — un appel de rattrapage par message vocal non
  /// hydraté, en tâche de fond, jamais bloquant pour le reste du fil (même
  /// tradeoff assumé côté web : rarement plus d'un ou deux vocaux par page).
  void _hydrateVoiceMessages(List<Message> messages) {
    for (final m in messages) {
      if (m.type == MessageType.voice && m.voice == null) {
        unawaited(_hydrateOne(m.id));
      }
    }
  }

  Future<void> _hydrateOne(String messageId) async {
    try {
      final hydrated = await ApiClient.instance.getVoiceDetails(messageId);
      state = state.copyWith(
        messages: state.messages
            .map((m) => m.id == messageId ? m.copyWith(voice: hydrated.voice) : m)
            .toList(),
      );
    } catch (_) {
      // best-effort, comme côté web : la bulle reste utilisable sans transcription/traduction.
    }
  }

  Future<void> _markRead() async {
    try {
      await ApiClient.instance.markRead(conversationId);
      ref.read(conversationsProvider.notifier).markReadLocally(conversationId);
    } catch (_) {
      // best-effort, comme côté web.
    }
  }

  Future<void> send(String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;
    emitStopTyping();
    final replyToId = state.replyingTo?.id;
    state = state.copyWith(clearReplyingTo: true);
    try {
      final message =
          await ApiClient.instance.sendMessage(conversationId, trimmed, replyToId: replyToId);
      state = state.copyWith(messages: [...state.messages, message]);
    } on ApiException catch (e) {
      state = state.copyWith(error: e.message);
    }
  }

  void setReplyingTo(Message? message) {
    state = state.copyWith(replyingTo: message, clearReplyingTo: message == null);
  }

  /// Bascule ma réaction sur ce message : même émoji déjà posé → la retire,
  /// sinon la pose/remplace (une seule réaction par personne, voir le
  /// commentaire backend sur `addOrChangeReaction`).
  Future<void> toggleReaction(String messageId, String emoji, String myUserId) async {
    final message = state.messages.firstWhereOrNull((m) => m.id == messageId);
    if (message == null) return;
    final mine = message.reactions.firstWhereOrNull((r) => r.userId == myUserId);
    try {
      final updated = mine?.emoji == emoji
          ? await ApiClient.instance.removeReaction(messageId)
          : await ApiClient.instance.addReaction(messageId, emoji);
      state = state.copyWith(
        messages: state.messages.map((m) => m.id == messageId ? m.copyWith(reactions: updated.reactions) : m).toList(),
      );
    } on ApiException catch (_) {
      // best-effort, comme côté web : pas de bannière d'erreur bruyante pour une réaction ratée.
    }
  }

  Future<void> sendImage(String filePath, {String? text}) async {
    try {
      final message = await ApiClient.instance.sendImage(
        conversationId: conversationId,
        filePath: filePath,
        text: text,
      );
      state = state.copyWith(messages: [...state.messages, message]);
    } on ApiException catch (e) {
      state = state.copyWith(error: e.message);
    }
  }

  Future<void> sendSticker(String emoji) async {
    final replyToId = state.replyingTo?.id;
    state = state.copyWith(clearReplyingTo: true);
    try {
      final message = await ApiClient.instance.sendSticker(conversationId, emoji, replyToId: replyToId);
      state = state.copyWith(messages: [...state.messages, message]);
    } on ApiException catch (e) {
      state = state.copyWith(error: e.message);
    }
  }

  Future<void> sendLocation(double latitude, double longitude) async {
    final replyToId = state.replyingTo?.id;
    state = state.copyWith(clearReplyingTo: true);
    try {
      final message = await ApiClient.instance.sendLocation(
        conversationId: conversationId,
        latitude: latitude,
        longitude: longitude,
        replyToId: replyToId,
      );
      state = state.copyWith(messages: [...state.messages, message]);
    } on ApiException catch (e) {
      state = state.copyWith(error: e.message);
    }
  }

  Future<void> sendVoice(String filePath, int durationSeconds) async {
    try {
      final message = await ApiClient.instance.uploadVoice(
        conversationId: conversationId,
        filePath: filePath,
        durationSeconds: durationSeconds,
      );
      state = state.copyWith(messages: [...state.messages, message]);
    } on ApiException catch (e) {
      state = state.copyWith(error: e.message);
    }
  }

  /// Retenter une traduction FAILED se fait avec le même appel — jamais de
  /// distinction "première demande" vs "nouvelle tentative" côté client,
  /// comme côté web (`pickLanguage`).
  Future<void> requestTranslation(String messageId, String languageCode) async {
    final index = state.messages.indexWhere((m) => m.id == messageId);
    if (index == -1 || state.messages[index].voice == null) return;
    final voice = state.messages[index].voice!;
    final already = voice.translations.firstWhereOrNull((t) => t.targetLanguage.code == languageCode);
    if (already != null &&
        (already.status == TranslationStatus.completed || already.status == TranslationStatus.processing)) {
      return;
    }

    // Optimiste : passe tout de suite en "en cours" pour un retour immédiat,
    // même si la confirmation serveur (ou le premier événement socket) met
    // un instant à arriver.
    final translations = [...voice.translations];
    final placeholder = VoiceTranslation(
      targetLanguage: already?.targetLanguage ?? LanguageRef(code: languageCode, name: languageCode, nativeName: languageCode),
      status: TranslationStatus.processing,
    );
    final idx = translations.indexWhere((t) => t.targetLanguage.code == languageCode);
    if (idx == -1) {
      translations.add(placeholder);
    } else {
      translations[idx] = placeholder;
    }
    _updateMessageVoice(messageId, voice.copyWith(translations: translations));

    try {
      final result = await ApiClient.instance.requestTranslation(messageId, languageCode);
      // Non-null : déjà complet côté serveur (idempotent), on applique tout de suite.
      if (result?.voice != null) {
        _updateMessageVoice(messageId, result!.voice!);
      }
      // Sinon (`null`, "started: true") : on attend les événements socket ci-dessus.
    } on ApiException catch (_) {
      final failed = [...translations];
      final failedIdx = failed.indexWhere((t) => t.targetLanguage.code == languageCode);
      if (failedIdx != -1) failed[failedIdx] = failed[failedIdx].copyWith(status: TranslationStatus.failed);
      final current = state.messages.firstWhereOrNull((m) => m.id == messageId)?.voice;
      if (current != null) _updateMessageVoice(messageId, current.copyWith(translations: failed));
    }
  }

  void _updateMessageVoice(String messageId, VoiceDetails voice) {
    state = state.copyWith(
      messages: state.messages.map((m) => m.id == messageId ? m.copyWith(voice: voice) : m).toList(),
    );
  }

  VoiceDetails _applyTranslationEvent(VoiceDetails voice, Map<String, dynamic> payload) {
    final event = payload['event'] as String;
    final stage = payload['stage'] as String?;

    if (stage == 'transcription') {
      if (event == 'completed') {
        return voice.copyWith(transcript: payload['transcript'] as String?);
      }
      return voice;
    }

    final targetCode = payload['targetLanguageCode'] as String?;
    if (targetCode == null) return voice;
    final translations = [...voice.translations];
    final idx = translations.indexWhere((t) => t.targetLanguage.code == targetCode);

    if (stage == 'translation') {
      switch (event) {
        case 'started':
          final placeholder = VoiceTranslation(
            targetLanguage:
                idx == -1 ? LanguageRef(code: targetCode, name: targetCode, nativeName: targetCode) : translations[idx].targetLanguage,
            status: TranslationStatus.processing,
          );
          if (idx == -1) {
            translations.add(placeholder);
          } else {
            translations[idx] = translations[idx].copyWith(status: TranslationStatus.processing);
          }
        case 'completed':
          if (idx != -1) {
            translations[idx] = translations[idx].copyWith(
              status: TranslationStatus.completed,
              translatedText: payload['translatedText'] as String?,
            );
          }
        case 'failed':
          if (idx != -1) {
            translations[idx] = translations[idx].copyWith(status: TranslationStatus.failed);
          }
      }
    } else if (stage == 'tts' && event == 'completed' && idx != -1) {
      // Un échec de "tts" ne fait jamais rien ici (voir le rapport backend) :
      // `audioUrl` reste `null`, le texte déjà traduit reste affiché tel quel.
      translations[idx] = translations[idx].copyWith(
        audioUrl: payload['audioUrl'] as String?,
        usedVoiceCloning: payload['usedVoiceCloning'] as bool? ?? false,
      );
    }

    return voice.copyWith(translations: translations);
  }

  void emitTyping() {
    SocketService.instance.emitTyping(conversationId);
    _stopTypingDebounce?.cancel();
    _stopTypingDebounce = Timer(const Duration(seconds: 3), emitStopTyping);
  }

  void emitStopTyping() {
    _stopTypingDebounce?.cancel();
    SocketService.instance.emitStopTyping(conversationId);
  }
}

final chatProvider = NotifierProvider.family<ChatNotifier, ChatState, String>(
  (conversationId) => ChatNotifier(conversationId),
);
