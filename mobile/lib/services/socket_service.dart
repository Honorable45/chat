import 'dart:async';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../core/config.dart';
import '../models/message.dart';
import 'api_client.dart';
import 'token_store.dart';

/// Équivalent de `frontend/src/lib/socket.ts` — namespace par défaut ("/"),
/// jamais de reconnexion automatique de Socket.IO après un `disconnect`
/// serveur ("io server disconnect", jeton expiré) : ce cas précis doit
/// rafraîchir le jeton puis reconnecter à la main (voir `_onDisconnect`).
class SocketService {
  SocketService._();
  static final SocketService instance = SocketService._();

  io.Socket? _socket;

  final _newMessageController = StreamController<Message>.broadcast();
  final _updatedMessageController = StreamController<Message>.broadcast();
  final _deletedMessageController = StreamController<Map<String, dynamic>>.broadcast();
  final _typingController = StreamController<Map<String, String>>.broadcast();
  final _readController = StreamController<Map<String, dynamic>>.broadcast();
  final _connectionController = StreamController<bool>.broadcast();
  final _translationController = StreamController<Map<String, dynamic>>.broadcast();

  Stream<Message> get onNewMessage => _newMessageController.stream;
  Stream<Message> get onMessageUpdated => _updatedMessageController.stream;
  Stream<Map<String, dynamic>> get onMessageDeleted => _deletedMessageController.stream;
  Stream<Map<String, String>> get onTyping => _typingController.stream;
  Stream<Map<String, dynamic>> get onRead => _readController.stream;
  Stream<bool> get onConnectionChange => _connectionController.stream;
  /// `{event: "started"|"completed"|"failed", ...payload}` — voir
  /// TranslationStagePayload côté backend (aucun `message:updated` pour la
  /// progression d'une traduction vocale, seulement ces trois événements).
  Stream<Map<String, dynamic>> get onTranslationEvent => _translationController.stream;

  /// Rappelé quand une reconnexion échoue faute de jeton valide — même rôle
  /// que `handleUnauthorized()` côté web (ApiClient le déclenche déjà pour
  /// les requêtes REST ; ce service en a besoin séparément puisqu'un socket
  /// peut être coupé sans qu'aucune requête REST n'échoue en parallèle).
  void Function()? onUnauthorized;

  void connect() {
    if (_socket != null) return;
    final socket = io.io(
      AppConfig.wsBaseUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .enableReconnection()
          .setAuth({'token': TokenStore.instance.cachedAccessToken})
          .build(),
    );
    _socket = socket;

    socket.onConnect((_) => _connectionController.add(true));
    socket.onDisconnect((reason) {
      _connectionController.add(false);
      // Signature exacte du cas "jeton expiré" côté serveur (voir
      // socket.ts) — toute autre raison (perte réseau...) est déjà gérée par
      // la reconnexion automatique de Socket.IO.
      if (reason == 'io server disconnect') {
        _handleServerDisconnect();
      }
    });

    socket.on('message:new', (data) => _newMessageController.add(Message.fromJson(_asMap(data))));
    socket.on(
        'message:updated', (data) => _updatedMessageController.add(Message.fromJson(_asMap(data))));
    socket.on('message:deleted', (data) => _deletedMessageController.add(_asMap(data)));
    socket.on('message:typing', (data) {
      final map = _asMap(data);
      _typingController.add({
        'conversationId': map['conversationId'] as String,
        'userId': map['userId'] as String,
      });
    });
    socket.on('message:read', (data) => _readController.add(_asMap(data)));

    for (final stage in ['started', 'completed', 'failed']) {
      socket.on('translation:$stage', (data) {
        _translationController.add({'event': stage, ..._asMap(data)});
      });
    }
  }

  Map<String, dynamic> _asMap(dynamic data) => Map<String, dynamic>.from(data as Map);

  Future<void> _handleServerDisconnect() async {
    final refreshed = await ApiClient.instance.refreshSession();
    if (!refreshed) {
      onUnauthorized?.call();
      return;
    }
    // Relit le jeton fraîchement obtenu (voir la fonction `auth` ci-dessus,
    // capturée en closure sur TokenStore) puis reconnecte manuellement —
    // Socket.IO ne le fait jamais de lui-même après un "io server disconnect".
    _socket?.auth = {'token': TokenStore.instance.cachedAccessToken};
    _socket?.connect();
  }

  void emitTyping(String conversationId) {
    _socket?.emit('message:typing', {'conversationId': conversationId});
  }

  void emitStopTyping(String conversationId) {
    _socket?.emit('message:stop_typing', {'conversationId': conversationId});
  }

  void disconnect() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
  }
}
