import 'dart:async';
import 'package:collection/collection.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../models/message.dart';
import '../services/api_client.dart';
import '../services/audio_playback_manager.dart';
import '../services/socket_service.dart';
import 'auth_state.dart';
import 'conversations_state.dart';

/// Émojis fixes alignés avec le backend (`ALLOWED_REACTION_EMOJIS`) — jamais
/// un choix arbitraire, une réaction hors de cette liste est de toute façon
/// rejetée côté serveur.
const List<String> allowedReactionEmojis = ['👍', '❤️', '😂', '😮', '😢', '👏'];

const _uuid = Uuid();

/// Délai de sécurité pour l'indicateur de frappe (section 24) : si aucun
/// `message:stop_typing` n'arrive jamais pour une raison ou une autre
/// (événement perdu, appareil de l'autre tué brutalement), on ne veut jamais
/// afficher "en train d'écrire..." indéfiniment.
const _typingTimeout = Duration(seconds: 8);

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
  /// Messages épinglés DANS la conversation (section 20) — distinct du pin
  /// de conversation. Peut contenir des messages plus anciens que la page
  /// actuellement chargée dans `messages`.
  final List<Message> pinnedMessages;

  const ChatState({
    this.messages = const [],
    this.loading = false,
    this.loadingMore = false,
    this.nextCursor,
    this.error,
    this.typingUserIds = const {},
    this.replyingTo,
    this.pinnedMessages = const [],
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
    List<Message>? pinnedMessages,
  }) =>
      ChatState(
        messages: messages ?? this.messages,
        loading: loading ?? this.loading,
        loadingMore: loadingMore ?? this.loadingMore,
        nextCursor: clearNextCursor ? null : (nextCursor ?? this.nextCursor),
        error: error,
        typingUserIds: typingUserIds ?? this.typingUserIds,
        replyingTo: clearReplyingTo ? null : (replyingTo ?? this.replyingTo),
        pinnedMessages: pinnedMessages ?? this.pinnedMessages,
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
  StreamSubscription<Map<String, String>>? _stopTypingSub;
  StreamSubscription<Map<String, dynamic>>? _readSub;
  StreamSubscription<Map<String, dynamic>>? _translationSub;
  StreamSubscription<bool>? _connectionSub;
  StreamSubscription<List<ConnectivityResult>>? _connectivitySub;
  Timer? _stopTypingDebounce;
  final Map<String, Timer> _typingTimeouts = {};
  bool _everDisconnected = false;
  bool _everOffline = false;

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
      _stopTypingSub?.cancel();
      _readSub?.cancel();
      _translationSub?.cancel();
      _connectionSub?.cancel();
      _connectivitySub?.cancel();
      _stopTypingDebounce?.cancel();
      for (final timer in _typingTimeouts.values) {
        timer.cancel();
      }
    });

    _newSub = SocketService.instance.onNewMessage.listen((m) {
      if (m.conversationId != conversationId) return;
      state = state.copyWith(messages: _mergeById(state.messages, [m]));
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
        pinnedMessages: _applyPinnedUpdate(state.pinnedMessages, m),
      );
    });
    _deletedSub = SocketService.instance.onMessageDeleted.listen((payload) {
      final id = payload['id'] as String?;
      if (id == null) return;
      // Un vocal supprimé pendant sa propre lecture doit s'arrêter tout de
      // suite (section 2) — jamais continuer à jouer un fichier dont le
      // message vient de disparaître de la conversation.
      final deleted = state.messages.firstWhereOrNull((m) => m.id == id);
      final voiceUrl = deleted?.voice?.audioUrl;
      if (voiceUrl != null) AudioPlaybackManager.instance.stopIfPlaying(voiceUrl);
      state = state.copyWith(messages: state.messages.where((m) => m.id != id).toList());
    });
    _typingSub = SocketService.instance.onTyping.listen((payload) {
      if (payload['conversationId'] != conversationId) return;
      final userId = payload['userId']!;
      state = state.copyWith(typingUserIds: {...state.typingUserIds, userId});
      // Filet de sécurité (section 24) : voir _typingTimeout — indépendant du
      // stop_typing explicite ci-dessous, qui reste le chemin normal.
      _typingTimeouts[userId]?.cancel();
      _typingTimeouts[userId] = Timer(_typingTimeout, () => _removeTypingUser(userId));
    });
    _stopTypingSub = SocketService.instance.onStopTyping.listen((payload) {
      if (payload['conversationId'] != conversationId) return;
      _removeTypingUser(payload['userId']!);
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
    // Resynchronisation après reconnexion WebSocket (section 23) — sans ça
    // les événements manqués pendant la coupure ne rattraperaient jamais le
    // fil (voir le rapport d'exploration : `onConnectionChange` était déjà
    // émis mais jamais écouté). `_mergeById` garantit qu'aucun message ne
    // se retrouve dupliqué avec ce qui est déjà affiché.
    _connectionSub = SocketService.instance.onConnectionChange.listen((connected) {
      if (!connected) {
        _everDisconnected = true;
        return;
      }
      if (_everDisconnected) {
        _everDisconnected = false;
        unawaited(_resync());
      }
    });
    // File d'envoi hors-ligne, version légère en mémoire (section 21-22,
    // décision retenue avec l'utilisateur : pas de persistance survivant la
    // fermeture de l'app) — renvoie automatiquement ce qui est resté
    // `failed` dès que la connectivité de l'appareil revient.
    _connectivitySub = Connectivity().onConnectivityChanged.listen((results) {
      final offline = results.every((r) => r == ConnectivityResult.none);
      if (offline) {
        _everOffline = true;
        return;
      }
      if (_everOffline) {
        _everOffline = false;
        unawaited(retryAllFailed());
      }
    });

    Future.microtask(_load);
    return const ChatState(loading: true);
  }

  /// Ajoute/retire/met à jour une entrée de `pinnedMessages` selon
  /// `m.pinnedAt` — réutilisé par la réception `message:updated` ET par
  /// `togglePin` (même logique, jamais dupliquée).
  List<Message> _applyPinnedUpdate(List<Message> pinned, Message m) {
    final withoutM = pinned.where((p) => p.id != m.id).toList();
    if (m.pinnedAt == null) return withoutM;
    return [...withoutM, m]..sort((a, b) => b.pinnedAt!.compareTo(a.pinnedAt!));
  }

  void _removeTypingUser(String userId) {
    _typingTimeouts.remove(userId)?.cancel();
    if (!state.typingUserIds.contains(userId)) return;
    final next = {...state.typingUserIds}..remove(userId);
    state = state.copyWith(typingUserIds: next);
  }

  /// Fusionne par id : les entrées déjà présentes gardent leur place, celles
  /// manquantes s'ajoutent, celles déjà connues sont mises à jour avec la
  /// version serveur (plus fraîche) — jamais de doublon visuel, y compris
  /// pour un message optimiste local (id = clientId, ne collisionne jamais
  /// avec un id serveur réel).
  List<Message> _mergeById(List<Message> current, List<Message> incoming) {
    final byId = {for (final m in current) m.id: m};
    for (final m in incoming) {
      byId[m.id] = m;
    }
    final merged = byId.values.toList()..sort((a, b) => a.createdAt.compareTo(b.createdAt));
    return merged;
  }

  Future<void> _resync() async {
    try {
      final page = await ApiClient.instance.messages(conversationId);
      state = state.copyWith(messages: _mergeById(state.messages, page.items));
    } catch (_) {
      // Best-effort — une resynchronisation manquée n'est jamais bloquante,
      // la prochaine reconnexion (ou la prochaine ouverture de l'écran)
      // retentera.
    }
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
      unawaited(_loadPinned());
      _hydrateVoiceMessages(page.items);
    } on ApiException catch (e) {
      state = state.copyWith(loading: false, error: e.message);
    }
  }

  Future<void> _loadPinned() async {
    try {
      final pinned = await ApiClient.instance.pinnedMessages(conversationId);
      state = state.copyWith(pinnedMessages: pinned);
    } catch (_) {
      // best-effort — la bannière reste simplement absente si ce chargement échoue.
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

  /// Envoi optimiste (sections 1, 21-22, 30) : le message apparaît tout de
  /// suite en local (`SendStatus.sending`, horloge à la place des coches),
  /// remplacé par la version serveur au succès, ou marqué `failed` avec
  /// possibilité de retenter (voir `retry`) — jamais perdu silencieusement.
  /// `clientId` (UUID) permet au backend de reconnaître un renvoi après un
  /// échec réseau ambigu et de ne jamais créer de doublon (voir
  /// MessagesService.findExistingByClientId côté backend).
  Future<void> send(String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;
    emitStopTyping();
    final replyToId = state.replyingTo?.id;
    state = state.copyWith(clearReplyingTo: true);

    final clientId = _uuid.v4();
    final optimistic = Message(
      id: clientId,
      conversationId: conversationId,
      // ChatScreen calcule `own` en comparant senderId à l'utilisateur
      // courant (jamais deviné autrement) — un senderId vide afficherait ce
      // message optimiste comme venant de quelqu'un d'autre.
      senderId: ref.read(authProvider).me?.id ?? '',
      type: MessageType.text,
      text: trimmed,
      // Conservé sur le message optimiste lui-même (pas juste une variable
      // locale) : un `retry()` ultérieur doit renvoyer la même réponse à X,
      // jamais la perdre en route.
      replyToId: replyToId,
      sentAt: DateTime.now(),
      createdAt: DateTime.now(),
      clientId: clientId,
      sendStatus: SendStatus.sending,
    );
    state = state.copyWith(messages: [...state.messages, optimistic]);

    await _sendOptimistic(optimistic);
  }

  /// Retente l'envoi d'un message resté `failed` — jamais un nouveau
  /// message, le même `clientId` est réutilisé pour que le backend
  /// dédoublonne si le premier envoi avait en fait réussi.
  Future<void> retry(String localId) async {
    final message = state.messages.firstWhereOrNull((m) => m.id == localId);
    if (message == null || message.sendStatus != SendStatus.failed) return;
    state = state.copyWith(
      messages: state.messages
          .map((m) => m.id == localId ? m.copyWith(sendStatus: SendStatus.sending) : m)
          .toList(),
    );
    await _sendOptimistic(message);
  }

  Future<void> _sendOptimistic(Message optimistic) async {
    try {
      final sent = await ApiClient.instance.sendMessage(
        conversationId,
        optimistic.text ?? '',
        replyToId: optimistic.replyToId,
        clientId: optimistic.clientId,
      );
      state = state.copyWith(
        messages: state.messages.map((m) => m.id == optimistic.id ? sent : m).toList(),
      );
    } on ApiException catch (_) {
      state = state.copyWith(
        messages: state.messages
            .map((m) => m.id == optimistic.id ? m.copyWith(sendStatus: SendStatus.failed) : m)
            .toList(),
      );
    } catch (_) {
      // Panne réseau (pas de réponse du tout, pas seulement une erreur
      // applicative) — même traitement : jamais perdu, juste marqué en échec.
      state = state.copyWith(
        messages: state.messages
            .map((m) => m.id == optimistic.id ? m.copyWith(sendStatus: SendStatus.failed) : m)
            .toList(),
      );
    }
  }

  /// Renvoie automatiquement tout ce qui est resté `failed` — appelé par
  /// ConnectivityService au retour du réseau (section 22), jamais par une
  /// action explicite de l'utilisateur (voir `retry` pour ce cas).
  Future<void> retryAllFailed() async {
    final failedIds = state.messages
        .where((m) => m.sendStatus == SendStatus.failed)
        .map((m) => m.id)
        .toList();
    for (final id in failedIds) {
      await retry(id);
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

  /// "Supprimer pour moi" (section 5B) — retrait local immédiat, jamais
  /// besoin d'attendre un événement socket (rien n'est diffusé aux autres
  /// membres pour cette action, contrairement à `deleteForEveryone`).
  Future<void> deleteForMe(String messageId) async {
    try {
      await ApiClient.instance.deleteMessageForMe(messageId);
      state = state.copyWith(messages: state.messages.where((m) => m.id != messageId).toList());
    } on ApiException catch (e) {
      state = state.copyWith(error: e.message);
    }
  }

  Future<void> deleteForEveryone(String messageId) async {
    try {
      final updated = await ApiClient.instance.deleteMessage(messageId);
      state = state.copyWith(
        messages: state.messages.map((m) => m.id == messageId ? updated : m).toList(),
      );
    } on ApiException catch (e) {
      state = state.copyWith(error: e.message);
    }
  }

  Future<void> togglePin(String messageId, bool pinned) async {
    try {
      final updated = pinned
          ? await ApiClient.instance.unpinMessage(messageId)
          : await ApiClient.instance.pinMessage(messageId);
      state = state.copyWith(
        messages: state.messages.map((m) => m.id == messageId ? updated : m).toList(),
        pinnedMessages: _applyPinnedUpdate(state.pinnedMessages, updated),
      );
    } on ApiException catch (e) {
      state = state.copyWith(error: e.message);
    }
  }

  /// Utilisé par la bannière "Messages épinglés" (ChatScreen) pour sauter au
  /// message dans l'historique — réutilise `listAroundMessage`, déjà
  /// construit pour le même besoin depuis un résultat de recherche.
  Future<void> jumpToMessage(String messageId) async {
    try {
      final window = await ApiClient.instance.messagesAround(conversationId, messageId);
      state = state.copyWith(messages: _mergeById(state.messages, window));
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
