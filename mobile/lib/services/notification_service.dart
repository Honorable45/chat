import 'dart:convert';
import 'dart:io';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import '../core/config.dart';
import 'api_client.dart';

const _defaultChannel = AndroidNotificationChannel(
  'default_channel',
  'Notifications',
  description: 'Messages et notifications générales',
  importance: Importance.high,
);

const _callsChannel = AndroidNotificationChannel(
  'incoming_calls',
  'Appels entrants',
  description: 'Sonnerie et actions pour les appels entrants',
  importance: Importance.max,
);

/// Notifications push mobiles (FCM — voir FcmProvider côté backend),
/// distinctes du web push (VAPID) déjà utilisé par `frontend/` : ce
/// singleton reste totalement silencieux si `Firebase.initializeApp()`
/// échoue (pas de `google-services.json`, voir android/app/build.gradle.kts)
/// — même convention que le reste de l'app pour une intégration optionnelle
/// non configurée, jamais un crash au démarrage.
class NotificationService {
  NotificationService._();
  static final NotificationService instance = NotificationService._();

  final _localNotifications = FlutterLocalNotificationsPlugin();
  bool _ready = false;

  Future<void> init() async {
    if (_ready) return;
    try {
      await Firebase.initializeApp();
    } catch (_) {
      return;
    }

    final androidPlugin = _localNotifications
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    await androidPlugin?.createNotificationChannel(_defaultChannel);
    await androidPlugin?.createNotificationChannel(_callsChannel);

    await _localNotifications.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      ),
      onDidReceiveNotificationResponse: _onNotificationResponse,
      onDidReceiveBackgroundNotificationResponse: _onBackgroundNotificationResponse,
    );

    FirebaseMessaging.onBackgroundMessage(_firebaseBackgroundMessageHandler);
    FirebaseMessaging.onMessage.listen((message) => _showForMessage(message));
    // Enregistré dès `init()` (appelé une seule fois, avant `runApp` — voir
    // main.dart) mais chaque appel de `_registerToken` reste best-effort :
    // avant une authentification réussie, `POST /push/fcm/register` échoue
    // simplement en 401, silencieusement, comme le reste de l'app tant
    // qu'aucune session n'existe encore.
    FirebaseMessaging.instance.onTokenRefresh.listen((_) => _registerToken());

    _ready = true;
  }

  /// À appeler une fois l'utilisateur authentifié (voir AuthNotifier) —
  /// demander la permission avant n'a aucun sens (rien à afficher tant
  /// qu'aucun jeton n'est enregistré côté backend).
  Future<void> requestPermissionAndRegister() async {
    if (!_ready) return;
    await FirebaseMessaging.instance.requestPermission();
    await _registerToken();
  }

  Future<void> unregister() async {
    if (!_ready) return;
    try {
      await ApiClient.instance.unregisterFcmToken();
    } catch (_) {
      // best-effort — la session est de toute façon révoquée côté backend au logout.
    }
  }

  Future<void> _registerToken() async {
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) await ApiClient.instance.registerFcmToken(token);
    } catch (_) {
      // best-effort — un jeton manqué se rattrapera au prochain démarrage/refresh.
    }
  }

  void _onNotificationResponse(NotificationResponse response) {
    _handleResponse(response);
  }

  static void _onBackgroundNotificationResponse(NotificationResponse response) {
    _handleResponse(response);
  }

  /// Commun premier plan/arrière-plan : "Refuser" un appel ne nécessite
  /// jamais l'UI Flutter (un simple appel réseau avec le jeton dédié, voir
  /// CallsController.quickReject — jamais le token de session), donc
  /// fonctionne même depuis l'isolate d'arrière-plan où rien d'autre que
  /// ceci n'est disponible. "Répondre"/un tap ouvre l'app normalement (déjà
  /// le comportement par défaut) — CallService.resumeIncoming (appelé au
  /// démarrage, voir HomeShell) prend le relais dès qu'un widget existe.
  static void _handleResponse(NotificationResponse response) {
    if (response.payload == null) return;
    final data = jsonDecode(response.payload!) as Map<String, dynamic>;
    if (data['kind'] != 'call') return;

    if (response.actionId == 'reject') {
      _quickReject(data['rejectToken'] as String);
    } else {
      pendingIncomingCallId = data['callId'] as String?;
    }
  }

  /// Lu par HomeShell au démarrage pour appeler CallService.resumeIncoming —
  /// une simple variable statique suffit : l'ouverture de l'app (tap sur la
  /// notification) relance toujours le processus Dart au même moment.
  static String? pendingIncomingCallId;

  static Future<void> _quickReject(String rejectToken) async {
    try {
      final uri = Uri.parse('${AppConfig.apiBaseUrl}/calls/quick-reject');
      final client = HttpClient();
      final request = await client.postUrl(uri);
      request.headers.set('Content-Type', 'application/json');
      request.write(jsonEncode({'token': rejectToken}));
      await request.close();
      client.close();
    } catch (_) {
      // Best-effort : un refus manqué laisse simplement l'appel sonner
      // jusqu'à expiration côté serveur, jamais bloquant.
    }
  }

  static Future<void> _showForMessage(RemoteMessage message) async {
    final plugin = FlutterLocalNotificationsPlugin();
    final data = message.data;

    if (data['kind'] == 'call') {
      final isVideo = data['callKind'] == 'VIDEO';
      await plugin.show(
        id: (data['callId'] as String).hashCode,
        title: 'Glotta',
        body: isVideo ? '📹 Appel vidéo entrant' : '📞 Appel entrant',
        notificationDetails: NotificationDetails(
          android: AndroidNotificationDetails(
            _callsChannel.id,
            _callsChannel.name,
            channelDescription: _callsChannel.description,
            importance: Importance.max,
            priority: Priority.max,
            category: AndroidNotificationCategory.call,
            ongoing: true,
            actions: const [
              AndroidNotificationAction('accept', 'Répondre', showsUserInterface: true),
              AndroidNotificationAction('reject', 'Refuser', cancelNotification: true),
            ],
          ),
        ),
        payload: jsonEncode(data),
      );
      return;
    }

    final notification = message.notification;
    await plugin.show(
      id: message.hashCode,
      title: notification?.title ?? 'Glotta',
      body: notification?.body ?? '',
      notificationDetails: NotificationDetails(
        android: AndroidNotificationDetails(
          _defaultChannel.id,
          _defaultChannel.name,
          channelDescription: _defaultChannel.description,
          importance: Importance.high,
          priority: Priority.high,
        ),
      ),
      payload: jsonEncode(data),
    );
  }
}

/// Doit rester une fonction de haut niveau (jamais une méthode d'instance) —
/// c'est le point d'entrée d'un isolate Dart séparé que le système relance
/// même app totalement fermée, voir la documentation `firebase_messaging`.
@pragma('vm:entry-point')
Future<void> _firebaseBackgroundMessageHandler(RemoteMessage message) async {
  await NotificationService._showForMessage(message);
}
