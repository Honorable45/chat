import 'dart:convert';
import 'package:dio/dio.dart';
import '../core/config.dart';
import '../models/conversation.dart';
import '../models/language.dart';
import '../models/message.dart';
import '../models/notification.dart';
import '../models/auth_flow.dart';
import '../models/call.dart';
import '../models/public_user.dart';
import '../models/status.dart';
import '../models/user.dart';
import 'token_store.dart';

class ApiException implements Exception {
  final String message;
  final int? statusCode;
  ApiException(this.message, {this.statusCode});
  @override
  String toString() => message;
}

/// Extrait un message affichable d'une réponse d'erreur Nest — même logique
/// que `extractErrorMessage()` dans `frontend/src/lib/api.ts` (le `message`
/// peut être une string, ou (ValidationPipe) un tableau de strings).
String _extractErrorMessage(dynamic data, String fallback) {
  if (data is! Map) return fallback;
  final message = data['message'];
  if (message is String) return message;
  if (message is List && message.isNotEmpty) return message.first.toString();
  return fallback;
}

/// Un seul refresh en vol à la fois, comme `refreshSession()` côté web —
/// évite que plusieurs requêtes en 401 simultanées ne déclenchent chacune
/// leur propre `POST /auth/refresh` (qui invaliderait les tentatives
/// concurrentes, le refresh token étant à usage unique côté serveur).
Future<bool>? _refreshInFlight;

/// Prévenu quand le refresh échoue franchement (refresh token lui-même
/// invalide/expiré) — poussé par AuthController pour ramener l'utilisateur à
/// l'écran de connexion, jamais appelé directement par ApiClient (qui ne
/// connaît pas la navigation).
typedef UnauthorizedHandler = void Function();

class ApiClient {
  ApiClient._internal() {
    _dio = Dio(BaseOptions(baseUrl: AppConfig.apiBaseUrl, connectTimeout: const Duration(seconds: 15)));
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) {
        final token = TokenStore.instance.cachedAccessToken;
        if (token != null) options.headers['Authorization'] = 'Bearer $token';
        handler.next(options);
      },
      onError: (error, handler) async {
        final status = error.response?.statusCode;
        final path = error.requestOptions.path;
        // Ne jamais retenter le rafraîchissement lui-même en boucle.
        if (status == 401 && !path.contains('/auth/refresh') && !path.contains('/auth/login')) {
          final refreshed = await refreshSession();
          if (refreshed) {
            try {
              final clone = await _dio.fetch(error.requestOptions);
              return handler.resolve(clone);
            } catch (_) {
              // tombe dans le rejet ci-dessous
            }
          } else {
            onUnauthorized?.call();
          }
        }
        handler.next(error);
      },
    ));
  }

  static final ApiClient instance = ApiClient._internal();
  late final Dio _dio;

  UnauthorizedHandler? onUnauthorized;

  /// Public — aussi appelé par SocketService quand le socket est coupé par
  /// le serveur pour cause de jeton expiré (`"io server disconnect"`, voir
  /// son commentaire), qui n'a sinon aucun moyen de rafraîchir lui-même.
  Future<bool> refreshSession() {
    return _refreshInFlight ??= () async {
      try {
        final refreshToken = await TokenStore.instance.refreshToken;
        if (refreshToken == null) return false;
        final res = await _dio.post('/auth/refresh', data: {'refreshToken': refreshToken});
        final auth = AuthResponse.fromJson(res.data as Map<String, dynamic>);
        await TokenStore.instance.setTokens(
          accessToken: auth.accessToken,
          refreshToken: auth.refreshToken,
        );
        return true;
      } catch (_) {
        return false;
      } finally {
        _refreshInFlight = null;
      }
    }();
  }

  Future<T> _guard<T>(Future<Response> Function() call, T Function(dynamic data) parse) async {
    try {
      final res = await call();
      return parse(res.data);
    } on DioException catch (e) {
      final message = _extractErrorMessage(e.response?.data, "Une erreur est survenue.");
      throw ApiException(message, statusCode: e.response?.statusCode);
    }
  }

  // ---- Auth ----

  Future<AuthResponse> register({
    required String username,
    String? firstName,
    String? lastName,
    String? email,
    String? phone,
    required String password,
    String? primaryLanguageCode,
    String? preferredReceiveLanguageCode,
    String? deviceLabel,
  }) {
    return _guard(
      () => _dio.post('/auth/register', data: {
        'username': username,
        if (firstName != null) 'firstName': firstName,
        if (lastName != null) 'lastName': lastName,
        if (email != null) 'email': email,
        if (phone != null) 'phone': phone,
        'password': password,
        if (primaryLanguageCode != null) 'primaryLanguageCode': primaryLanguageCode,
        if (preferredReceiveLanguageCode != null)
          'preferredReceiveLanguageCode': preferredReceiveLanguageCode,
        if (deviceLabel != null) 'deviceLabel': deviceLabel,
      }),
      (data) => AuthResponse.fromJson(data as Map<String, dynamic>),
    );
  }

  Future<AuthResponse> login({
    required String identifier,
    required String password,
    String? deviceLabel,
  }) {
    return _guard(
      () => _dio.post('/auth/login', data: {
        'identifier': identifier,
        'password': password,
        if (deviceLabel != null) 'deviceLabel': deviceLabel,
      }),
      (data) => AuthResponse.fromJson(data as Map<String, dynamic>),
    );
  }

  Future<void> logout() {
    return _guard(() => _dio.post('/auth/logout'), (_) {});
  }

  // --- Téléphone + OTP (inscription/connexion façon WhatsApp) ---

  /// Un seul champ "numéro de téléphone" — le backend décide lui-même s'il
  /// s'agit d'une inscription ou d'une connexion (voir AuthService.requestOtp
  /// côté backend) et renvoie lequel des deux écrans de vérification suivre.
  Future<OtpPurpose> requestOtp(String phone) {
    return _guard(
      () => _dio.post('/auth/otp/request', data: {'phone': phone}),
      (data) => otpPurposeFromJson((data as Map<String, dynamic>)['purpose'] as String),
    );
  }

  Future<AuthResponse> verifyRegisterOtp({
    required String phone,
    required String code,
    String? deviceLabel,
  }) {
    return _guard(
      () => _dio.post('/auth/register/verify-otp', data: {
        'phone': phone,
        'code': code,
        if (deviceLabel != null) 'deviceLabel': deviceLabel,
      }),
      (data) => AuthResponse.fromJson(data as Map<String, dynamic>),
    );
  }

  /// `AuthResponse` si la 2FA n'est pas activée, `LoginOtpChallenge` sinon
  /// (voir chat_state... non, voir LoginOtpResult) — jamais les deux à la
  /// fois, distingués par `requiresTwoFactor` dans la réponse brute.
  Future<LoginOtpResult> verifyLoginOtp({
    required String phone,
    required String code,
    String? deviceLabel,
  }) {
    return _guard(
      () => _dio.post('/auth/login/verify-otp', data: {
        'phone': phone,
        'code': code,
        if (deviceLabel != null) 'deviceLabel': deviceLabel,
      }),
      (data) => LoginOtpResult.fromJson(data as Map<String, dynamic>),
    );
  }

  Future<AuthResponse> verifyTwoFactorPin({
    required String phone,
    required String continuationToken,
    required String pin,
    String? deviceLabel,
  }) {
    return _guard(
      () => _dio.post('/auth/2fa/verify', data: {
        'phone': phone,
        'continuationToken': continuationToken,
        'pin': pin,
        if (deviceLabel != null) 'deviceLabel': deviceLabel,
      }),
      (data) => AuthResponse.fromJson(data as Map<String, dynamic>),
    );
  }

  // --- Vérification en deux étapes (Paramètres → Sécurité) ---

  Future<TwoFactorStatus> twoFactorStatus() {
    return _guard(
      () => _dio.get('/auth/2fa/status'),
      (data) => TwoFactorStatus.fromJson(data as Map<String, dynamic>),
    );
  }

  Future<void> enableTwoFactor(String pin) {
    return _guard(() => _dio.post('/auth/2fa/enable', data: {'pin': pin}), (_) {});
  }

  Future<void> disableTwoFactor(String pin) {
    return _guard(() => _dio.post('/auth/2fa/disable', data: {'pin': pin}), (_) {});
  }

  Future<void> changePin({required String currentPin, required String newPin}) {
    return _guard(
      () => _dio.post('/auth/2fa/change-pin', data: {'currentPin': currentPin, 'newPin': newPin}),
      (_) {},
    );
  }

  Future<void> requestRecoveryEmail(String email) {
    return _guard(
      () => _dio.post('/auth/2fa/recovery-email/request', data: {'email': email}),
      (_) {},
    );
  }

  Future<void> verifyRecoveryEmail(String code) {
    return _guard(
      () => _dio.post('/auth/2fa/recovery-email/verify', data: {'code': code}),
      (_) {},
    );
  }

  /// Étape 1 de "PIN oublié" — envoie un OTP SMS de reconfirmation.
  Future<void> recoveryRequest(String phone) {
    return _guard(() => _dio.post('/auth/2fa/recovery/request', data: {'phone': phone}), (_) {});
  }

  /// Étape 2 — code SMS vérifié → un code part vers l'email de secours,
  /// jeton de continuation renvoyé pour l'étape finale.
  Future<String> recoveryVerifyPhone({required String phone, required String code}) {
    return _guard(
      () => _dio.post('/auth/2fa/recovery/verify-phone', data: {'phone': phone, 'code': code}),
      (data) => (data as Map<String, dynamic>)['continuationToken'] as String,
    );
  }

  /// Étape 3 (finale) — code email vérifié → nouveau PIN.
  Future<void> recoveryResetPin({
    required String phone,
    required String continuationToken,
    required String emailCode,
    required String newPin,
  }) {
    return _guard(
      () => _dio.post('/auth/2fa/recovery/reset-pin', data: {
        'phone': phone,
        'continuationToken': continuationToken,
        'emailCode': emailCode,
        'newPin': newPin,
      }),
      (_) {},
    );
  }

  // --- Liaison Glotta Web par QR (scanné depuis le mobile) ---

  Future<ScannedLinkInfo> scanLinkRequest(String token) {
    return _guard(
      () => _dio.post('/auth/web/scan-link-request', data: {'token': token}),
      (data) => ScannedLinkInfo.fromJson(data as Map<String, dynamic>),
    );
  }

  Future<void> confirmLinkRequest({
    required String token,
    required bool confirm,
    String? deviceLabel,
  }) {
    return _guard(
      () => _dio.post('/auth/web/confirm-link', data: {
        'token': token,
        'decision': confirm ? 'confirm' : 'cancel',
        if (deviceLabel != null) 'deviceLabel': deviceLabel,
      }),
      (_) {},
    );
  }

  // --- Sessions / appareils connectés ---

  Future<List<SessionSummary>> sessions() {
    return _guard(
      () => _dio.get('/auth/sessions'),
      (data) =>
          (data as List<dynamic>).map((e) => SessionSummary.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  Future<void> revokeSession(String sessionId) {
    return _guard(() => _dio.delete('/auth/sessions/$sessionId'), (_) {});
  }

  // ---- Users ----

  Future<Me> me() {
    return _guard(() => _dio.get('/users/me'), (data) => Me.fromJson(data as Map<String, dynamic>));
  }

  Future<Me> updateMe({
    String? firstName,
    String? lastName,
    String? username,
    String? phone,
    String? primaryLanguageCode,
    String? preferredReceiveLanguageCode,
  }) {
    return _guard(
      () => _dio.patch('/users/me', data: {
        if (firstName != null) 'firstName': firstName,
        if (lastName != null) 'lastName': lastName,
        if (username != null) 'username': username,
        if (phone != null) 'phone': phone,
        if (primaryLanguageCode != null) 'primaryLanguageCode': primaryLanguageCode,
        if (preferredReceiveLanguageCode != null)
          'preferredReceiveLanguageCode': preferredReceiveLanguageCode,
      }),
      (data) => Me.fromJson(data as Map<String, dynamic>),
    );
  }

  // Port de `ProfileSection.tsx` (`api.users.updateProfile`) — seul le champ
  // `statusText` est utilisé côté mobile pour l'instant (voir ProfileScreen).
  Future<void> updateMyProfile({String? statusText}) {
    return _guard(
      () => _dio.patch('/users/me/profile', data: {
        if (statusText != null) 'statusText': statusText,
      }),
      (_) {},
    );
  }

  // Renvoie le `Profile` mis à jour côté backend, mais on refait un `me()`
  // ensuite (voir ProfileScreen) — même approche que le web (`refreshMe()`
  // après `api.users.setAvatar`) plutôt que de dupliquer le mapping ici.
  Future<void> setAvatar(String filePath) {
    return _guard(
      () => _dio.post(
        '/users/me/avatar',
        data: FormData.fromMap({
          'avatar': MultipartFile.fromFileSync(filePath, filename: filePath.split('/').last),
        }),
      ),
      (_) {},
    );
  }

  Future<void> removeAvatar() {
    return _guard(() => _dio.delete('/users/me/avatar'), (_) {});
  }

  // ---- Languages ----

  Future<List<LanguageSummary>> languages() {
    return _guard(
      () => _dio.get('/languages'),
      (data) =>
          (data as List<dynamic>).map((e) => LanguageSummary.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  // ---- Conversations ----

  Future<Page<Conversation>> conversations({String? cursor, int limit = 30}) {
    return _guard(
      () => _dio.get('/conversations', queryParameters: {
        if (cursor != null) 'cursor': cursor,
        'limit': limit,
      }),
      (data) => Page.fromJson(data as Map<String, dynamic>, Conversation.fromJson),
    );
  }

  Future<Page<Message>> messages(String conversationId, {String? cursor, int limit = 30}) {
    return _guard(
      () => _dio.get('/conversations/$conversationId/messages', queryParameters: {
        if (cursor != null) 'cursor': cursor,
        'limit': limit,
      }),
      (data) => Page.fromJson(data as Map<String, dynamic>, Message.fromJson),
    );
  }

  Future<Message> sendMessage(String conversationId, String text, {String? replyToId}) {
    return _guard(
      () => _dio.post('/messages', data: {
        'conversationId': conversationId,
        'text': text,
        if (replyToId != null) 'replyToId': replyToId,
      }),
      (data) => Message.fromJson(data as Map<String, dynamic>),
    );
  }

  Future<Message> addReaction(String messageId, String emoji) {
    return _guard(
      () => _dio.post('/messages/$messageId/reactions', data: {'emoji': emoji}),
      (data) => Message.fromJson(data as Map<String, dynamic>),
    );
  }

  Future<Message> removeReaction(String messageId) {
    return _guard(
      () => _dio.delete('/messages/$messageId/reactions'),
      (data) => Message.fromJson(data as Map<String, dynamic>),
    );
  }

  // ---- Stickers ----

  Future<List<String>> favoriteStickers() {
    return _guard(
      () => _dio.get('/stickers/favorites'),
      (data) => (data as List<dynamic>).cast<String>(),
    );
  }

  Future<void> addFavoriteSticker(String emoji) {
    return _guard(() => _dio.post('/stickers/favorites', data: {'emoji': emoji}), (_) {});
  }

  Future<void> removeFavoriteSticker(String emoji) {
    return _guard(
      () => _dio.delete('/stickers/favorites/${Uri.encodeComponent(emoji)}'),
      (_) {},
    );
  }

  Future<Message> sendSticker(String conversationId, String emoji, {String? replyToId}) {
    return _guard(
      () => _dio.post('/messages/sticker', data: {
        'conversationId': conversationId,
        'emoji': emoji,
        if (replyToId != null) 'replyToId': replyToId,
      }),
      (data) => Message.fromJson(data as Map<String, dynamic>),
    );
  }

  // ---- Position ----

  Future<Message> sendLocation({
    required String conversationId,
    required double latitude,
    required double longitude,
    String? replyToId,
  }) {
    return _guard(
      () => _dio.post('/messages/location', data: {
        'conversationId': conversationId,
        'latitude': latitude,
        'longitude': longitude,
        if (replyToId != null) 'replyToId': replyToId,
      }),
      (data) => Message.fromJson(data as Map<String, dynamic>),
    );
  }

  Future<Conversation> createDirectConversation(String userId) {
    return _guard(
      () => _dio.post('/conversations', data: {'userId': userId}),
      (data) => Conversation.fromJson(data as Map<String, dynamic>),
    );
  }

  Future<Conversation> createGroup({
    required String title,
    String? description,
    required List<String> memberIds,
    String? photoPath,
  }) {
    return _guard(
      () => _dio.post(
        '/conversations/group',
        data: FormData.fromMap({
          'title': title,
          if (description != null && description.isNotEmpty) 'description': description,
          // Tableau JSON stringifié — même convention que côté web (voir DTO backend).
          'memberIds': jsonEncode(memberIds),
          if (photoPath != null)
            'photo': MultipartFile.fromFileSync(photoPath, filename: photoPath.split('/').last),
        }),
      ),
      (data) => Conversation.fromJson(data as Map<String, dynamic>),
    );
  }

  /// `PATCH /conversations/:id/group` — n'importe quel sous-ensemble des
  /// autorisations (les absentes restent inchangées côté serveur).
  Future<Conversation> updateGroupPermissions(
    String conversationId, {
    GroupPermission? editInfo,
    GroupPermission? sendMessages,
    GroupPermission? addMembers,
  }) {
    return _guard(
      () => _dio.patch(
        '/conversations/$conversationId/group',
        data: FormData.fromMap({
          if (editInfo != null) 'editInfoPermission': groupPermissionToJson(editInfo),
          if (sendMessages != null) 'sendMessagesPermission': groupPermissionToJson(sendMessages),
          if (addMembers != null) 'addMembersPermission': groupPermissionToJson(addMembers),
        }),
      ),
      (data) => Conversation.fromJson(data as Map<String, dynamic>),
    );
  }

  Future<List<PublicUser>> searchUsers(String query) {
    return _guard(
      () => _dio.get('/users/search', queryParameters: {'q': query}),
      (data) => (data as List<dynamic>).map((e) => PublicUser.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  // ---- Contacts ----

  Future<List<PublicUser>> contacts() {
    return _guard(
      () => _dio.get('/contacts'),
      (data) => (data as List<dynamic>).map((e) => PublicUser.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  Future<List<ContactRequest>> contactRequests({String direction = 'incoming'}) {
    return _guard(
      () => _dio.get('/contacts/requests', queryParameters: {'direction': direction}),
      (data) =>
          (data as List<dynamic>).map((e) => ContactRequest.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  Future<ContactRequest> sendContactRequest(String userId) {
    return _guard(
      () => _dio.post('/contacts/requests', data: {'userId': userId}),
      (data) => ContactRequest.fromJson(data as Map<String, dynamic>),
    );
  }

  Future<ContactRequest> acceptContactRequest(String requestId) {
    return _guard(
      () => _dio.post('/contacts/requests/$requestId/accept'),
      (data) => ContactRequest.fromJson(data as Map<String, dynamic>),
    );
  }

  Future<ContactRequest> declineContactRequest(String requestId) {
    return _guard(
      () => _dio.post('/contacts/requests/$requestId/decline'),
      (data) => ContactRequest.fromJson(data as Map<String, dynamic>),
    );
  }

  Future<void> cancelContactRequest(String requestId) {
    return _guard(() => _dio.delete('/contacts/requests/$requestId'), (_) {});
  }

  Future<DateTime> markRead(String conversationId) {
    return _guard(
      () => _dio.post('/conversations/$conversationId/read'),
      (data) => DateTime.parse((data as Map<String, dynamic>)['readAt'] as String),
    );
  }

  // ---- Images ----

  Future<Message> sendImage({
    required String conversationId,
    required String filePath,
    String? text,
    String? replyToId,
  }) {
    final filename = filePath.split('/').last;
    return _guard(
      () => _dio.post(
        '/messages/image',
        data: FormData.fromMap({
          'conversationId': conversationId,
          if (text != null && text.isNotEmpty) 'text': text,
          if (replyToId != null) 'replyToId': replyToId,
          'image': MultipartFile.fromFileSync(filePath, filename: filename),
        }),
      ),
      (data) => Message.fromJson(data as Map<String, dynamic>),
    );
  }

  // ---- Voix ----

  /// `filePath` : fichier enregistré localement (voir use_voice_recorder.dart) —
  /// le champ de formulaire doit s'appeler exactement "audio" (voir
  /// `FileInterceptor('audio', ...)` côté backend).
  Future<Message> uploadVoice({
    required String conversationId,
    required String filePath,
    required int durationSeconds,
    String? replyToId,
  }) {
    final filename = filePath.split('/').last;
    return _guard(
      () => _dio.post(
        '/voice/messages',
        data: FormData.fromMap({
          'conversationId': conversationId,
          'durationSeconds': durationSeconds.toString(),
          if (replyToId != null) 'replyToId': replyToId,
          'audio': MultipartFile.fromFileSync(filePath, filename: filename),
        }),
      ),
      (data) => Message.fromVoiceJson(data as Map<String, dynamic>),
    );
  }

  /// Hydratation à la demande d'un message VOICE chargé depuis l'historique
  /// (`GET /conversations/:id/messages` ne renvoie jamais `voice`, voir le
  /// rapport backend) — appelé une fois par message vocal non hydraté.
  Future<Message> getVoiceDetails(String messageId) {
    return _guard(
      () => _dio.get('/voice/$messageId'),
      (data) => Message.fromVoiceJson(data as Map<String, dynamic>),
    );
  }

  /// Renvoie soit le détail complet (déjà traduit/idempotent), soit
  /// `{started: true}` — dans ce second cas, la progression n'arrive que par
  /// les événements socket `translation:*` (voir SocketService), jamais par
  /// le retour de cette méthode.
  Future<Message?> requestTranslation(String messageId, String languageCode) async {
    final result = await _guard(
      () => _dio.post('/voice/$messageId/translate', data: {'languageCode': languageCode}),
      (data) => data as Map<String, dynamic>,
    );
    if (result['started'] == true) return null;
    return Message.fromVoiceJson(result);
  }

  // ---- Notifications ----

  Future<Page<AppNotification>> notifications({String? cursor, int limit = 30}) {
    return _guard(
      () => _dio.get('/notifications', queryParameters: {
        if (cursor != null) 'cursor': cursor,
        'limit': limit,
      }),
      (data) => Page.fromJson(data as Map<String, dynamic>, AppNotification.fromJson),
    );
  }

  Future<int> unreadNotificationCount() {
    return _guard(
      () => _dio.get('/notifications/unread-count'),
      (data) => (data as Map<String, dynamic>)['count'] as int,
    );
  }

  Future<void> markNotificationRead(String id) {
    return _guard(() => _dio.patch('/notifications/$id/read'), (_) {});
  }

  Future<void> markAllNotificationsRead() {
    return _guard(() => _dio.patch('/notifications/read-all'), (_) {});
  }

  // ---- Statuts ----

  Future<List<AppStatus>> statuses() {
    return _guard(
      () => _dio.get('/statuses'),
      (data) => (data as List<dynamic>).map((e) => AppStatus.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  Future<AppStatus> createStatus({
    required StatusType type,
    String? text,
    StatusVisibility visibility = StatusVisibility.contacts,
    String? filePath,
  }) {
    return _guard(
      () => _dio.post(
        '/statuses',
        data: FormData.fromMap({
          'type': statusTypeToJson(type),
          if (text != null && text.isNotEmpty) 'text': text,
          'visibility': statusVisibilityToJson(visibility),
          if (filePath != null)
            'media': MultipartFile.fromFileSync(filePath, filename: filePath.split('/').last),
        }),
      ),
      (data) => AppStatus.fromJson(data as Map<String, dynamic>),
    );
  }

  Future<void> markStatusViewed(String id) {
    return _guard(() => _dio.post('/statuses/$id/view'), (_) {});
  }

  Future<List<StatusView>> statusViews(String id) {
    return _guard(
      () => _dio.get('/statuses/$id/views'),
      (data) => (data as List<dynamic>).map((e) => StatusView.fromJson(e as Map<String, dynamic>)).toList(),
    );
  }

  Future<void> deleteStatus(String id) {
    return _guard(() => _dio.delete('/statuses/$id'), (_) {});
  }

  // ---- Appels ----

  /// Chaque élément est déjà au format attendu par `RTCConfiguration`
  /// (`urls`/`username`/`credential`) — jamais réinterprété ici, relayé tel
  /// quel (voir CallsService.iceServers côté backend).
  Future<List<Map<String, dynamic>>> iceServers() {
    return _guard(
      () => _dio.get('/calls/ice-servers'),
      (data) => (data as List<dynamic>).cast<Map<String, dynamic>>(),
    );
  }

  /// Reprend un appel entrant après ouverture de l'app depuis l'action
  /// "Répondre" d'une notification push système (voir
  /// CallService.resumeIncoming) — aucun événement socket 'call:incoming'
  /// n'a pu être reçu tant que l'app était fermée.
  Future<CallMessageDto> getCall(String callId) {
    return _guard(
      () => _dio.get('/calls/$callId'),
      (data) => CallMessageDto.fromJson(data as Map<String, dynamic>),
    );
  }

  // ---- Notifications push mobiles (FCM) ----

  Future<void> registerFcmToken(String token) {
    return _guard(() => _dio.post('/push/fcm/register', data: {'token': token}), (_) {});
  }

  Future<void> unregisterFcmToken() {
    return _guard(() => _dio.delete('/push/fcm/register'), (_) {});
  }
}
