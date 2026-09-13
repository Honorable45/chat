import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/conversation.dart';
import '../models/message.dart';
import '../services/api_client.dart';
import '../services/socket_service.dart';

class ConversationsState {
  final List<Conversation> items;
  final bool loading;
  final bool loadingMore;
  final String? nextCursor;
  final String? error;

  const ConversationsState({
    this.items = const [],
    this.loading = false,
    this.loadingMore = false,
    this.nextCursor,
    this.error,
  });

  ConversationsState copyWith({
    List<Conversation>? items,
    bool? loading,
    bool? loadingMore,
    String? nextCursor,
    bool clearNextCursor = false,
    String? error,
  }) =>
      ConversationsState(
        items: items ?? this.items,
        loading: loading ?? this.loading,
        loadingMore: loadingMore ?? this.loadingMore,
        nextCursor: clearNextCursor ? null : (nextCursor ?? this.nextCursor),
        error: error,
      );
}

/// Équivalent de la partie "liste de conversations" de `chat/page.tsx` :
/// chargement paginé + mise à jour en direct (nouveau message ⇒ remonte la
/// conversation en tête et met à jour son aperçu, exactement comme
/// `applyIncomingMessage` côté web) via les mêmes événements socket que
/// ChatNotifier ci-dessous — les deux écoutent indépendamment `message:new`,
/// chacun avec son propre filtre (ici : bump + aperçu, jamais le contenu
/// complet du fil).
class ConversationsNotifier extends Notifier<ConversationsState> {
  StreamSubscription<Message>? _newMessageSub;

  /// Conversation actuellement ouverte à l'écran — un nouveau message pour
  /// celle-ci ne doit pas incrémenter son compteur de non-lus ici (déjà lu
  /// en le regardant), même logique que `selectedIdRef` côté web.
  String? activeConversationId;

  @override
  ConversationsState build() {
    _newMessageSub = SocketService.instance.onNewMessage.listen(_onNewMessage);
    ref.onDispose(() => _newMessageSub?.cancel());
    Future.microtask(load);
    return const ConversationsState();
  }

  Future<void> load() async {
    state = state.copyWith(loading: true, error: null);
    try {
      final page = await ApiClient.instance.conversations();
      state = state.copyWith(items: page.items, loading: false, nextCursor: page.nextCursor);
    } on ApiException catch (e) {
      state = state.copyWith(loading: false, error: e.message);
    }
  }

  Future<void> loadMore() async {
    if (state.loadingMore || state.nextCursor == null) return;
    state = state.copyWith(loadingMore: true);
    try {
      final page = await ApiClient.instance.conversations(cursor: state.nextCursor);
      state = state.copyWith(
        items: [...state.items, ...page.items],
        loadingMore: false,
        nextCursor: page.nextCursor,
        clearNextCursor: page.nextCursor == null,
      );
    } on ApiException catch (_) {
      state = state.copyWith(loadingMore: false);
    }
  }

  void _onNewMessage(Message message) {
    final index = state.items.indexWhere((c) => c.id == message.conversationId);
    if (index == -1) {
      // Conversation pas encore chargée localement (ex. toute nouvelle
      // conversation directe) — plus simple de recharger la première page
      // que de reconstruire un Conversation complet à partir du seul message.
      Future.microtask(load);
      return;
    }
    final existing = state.items[index];
    final bumpUnread = activeConversationId != message.conversationId;
    final updated = Conversation(
      id: existing.id,
      type: existing.type,
      title: existing.title,
      photoUrl: existing.photoUrl,
      otherParticipant: existing.otherParticipant,
      members: existing.members,
      myMembership: existing.myMembership,
      lastMessage: ConversationLastMessage(
        id: message.id,
        type: _rawType(message.type),
        text: message.text,
        senderId: message.senderId,
        sentAt: message.sentAt,
      ),
      unreadCount: bumpUnread ? existing.unreadCount + 1 : existing.unreadCount,
      updatedAt: message.sentAt,
    );
    final next = [updated, ...state.items.where((c) => c.id != existing.id)];
    state = state.copyWith(items: next);
  }

  /// Remet à zéro le compteur de non-lus localement, en écho à
  /// `POST /conversations/:id/read` (voir ChatNotifier.markRead) — jamais
  /// l'inverse, cette méthode ne fait aucun appel réseau elle-même.
  void markReadLocally(String conversationId) {
    state = state.copyWith(
      items: state.items
          .map((c) => c.id == conversationId
              ? Conversation(
                  id: c.id,
                  type: c.type,
                  title: c.title,
                  photoUrl: c.photoUrl,
                  otherParticipant: c.otherParticipant,
                  members: c.members,
                  myMembership: c.myMembership,
                  lastMessage: c.lastMessage,
                  unreadCount: 0,
                  updatedAt: c.updatedAt,
                )
              : c)
          .toList(),
    );
  }

  String _rawType(MessageType type) => type.name.toUpperCase();
}

final conversationsProvider = NotifierProvider<ConversationsNotifier, ConversationsState>(
  ConversationsNotifier.new,
);
