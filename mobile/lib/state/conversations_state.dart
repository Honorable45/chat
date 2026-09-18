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
  StreamSubscription<Map<String, dynamic>>? _membershipUpdatedSub;

  /// Conversation actuellement ouverte à l'écran — un nouveau message pour
  /// celle-ci ne doit pas incrémenter son compteur de non-lus ici (déjà lu
  /// en le regardant), même logique que `selectedIdRef` côté web.
  String? activeConversationId;

  @override
  ConversationsState build() {
    _newMessageSub = SocketService.instance.onNewMessage.listen(_onNewMessage);
    // Pin/archive/mute/masquage modifié depuis un AUTRE appareil du même
    // compte (section 1 : synchronisation multi-appareils) — un rechargement
    // complet plutôt qu'une fusion bespoke : ces changements sont rares
    // (réglages, pas des messages), pas besoin d'optimiser ce chemin.
    _membershipUpdatedSub = SocketService.instance.onMembershipUpdated.listen((_) => load());
    ref.onDispose(() {
      _newMessageSub?.cancel();
      _membershipUpdatedSub?.cancel();
    });
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
    state = state.copyWith(
      items: _sortConversations([updated, ...state.items.where((c) => c.id != existing.id)]),
    );
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

  /// "Marquer comme lu" depuis la liste (section 3) — même endpoint que
  /// l'ouverture d'une conversation (ChatNotifier._markRead), déclenché ici
  /// sans avoir à ouvrir le fil.
  Future<void> markAsRead(String conversationId) async {
    try {
      await ApiClient.instance.markRead(conversationId);
      markReadLocally(conversationId);
    } catch (_) {
      // best-effort, comme le reste des actions de la barre de sélection.
    }
  }

  Future<void> markAsUnread(String conversationId) async {
    try {
      final updated =
          await ApiClient.instance.updateConversationMembership(conversationId, markUnread: true);
      _replace(updated);
    } catch (_) {}
  }

  Future<void> togglePin(String conversationId, bool currentlyPinned) async {
    try {
      final updated = await ApiClient.instance
          .updateConversationMembership(conversationId, isPinned: !currentlyPinned);
      _replace(updated);
    } catch (_) {}
  }

  Future<void> toggleArchive(String conversationId, bool currentlyArchived) async {
    try {
      final updated = await ApiClient.instance
          .updateConversationMembership(conversationId, isArchived: !currentlyArchived);
      _replace(updated);
    } catch (_) {}
  }

  Future<void> toggleMute(String conversationId, bool currentlyMuted) async {
    try {
      final updated = await ApiClient.instance
          .updateConversationMembership(conversationId, isMuted: !currentlyMuted);
      _replace(updated);
    } catch (_) {}
  }

  /// Suppression locale (section 5A) — disparaît de la liste tout de suite ;
  /// réapparaîtra d'elle-même si un nouveau message arrive (voir
  /// ConversationsService.listMine côté backend), jamais une vraie
  /// destruction de données.
  Future<void> hide(String conversationId) async {
    try {
      await ApiClient.instance.updateConversationMembership(conversationId, hidden: true);
      state = state.copyWith(items: state.items.where((c) => c.id != conversationId).toList());
    } catch (_) {}
  }

  void _replace(Conversation updated) {
    final next = state.items.map((c) => c.id == updated.id ? updated : c).toList();
    state = state.copyWith(items: _sortConversations(next));
  }

  /// Épinglées d'abord, puis les plus récemment actives — même ordre que
  /// `ConversationsService.listMine` côté backend (voir son commentaire), à
  /// respecter aussi pour les mises à jour purement locales (nouveau
  /// message, pin/dépin) plutôt que de toujours pousser en tête.
  List<Conversation> _sortConversations(List<Conversation> items) {
    final sorted = [...items];
    sorted.sort((a, b) {
      if (a.myMembership.isPinned != b.myMembership.isPinned) {
        return a.myMembership.isPinned ? -1 : 1;
      }
      return b.updatedAt.compareTo(a.updatedAt);
    });
    return sorted;
  }

  String _rawType(MessageType type) => type.name.toUpperCase();
}

final conversationsProvider = NotifierProvider<ConversationsNotifier, ConversationsState>(
  ConversationsNotifier.new,
);
