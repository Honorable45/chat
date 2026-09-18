import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/auth_flow.dart';
import '../models/user.dart';
import '../services/api_client.dart';
import '../services/call_service.dart';
import '../services/notification_service.dart';
import '../services/socket_service.dart';
import '../services/token_store.dart';

enum AuthStatus { unknown, authenticated, unauthenticated }

class AuthState {
  final AuthStatus status;
  final Me? me;
  final String? error;
  // Vrai juste après une inscription réussie (verifyRegisterOtp), jusqu'à ce
  // que ProfileSetupScreen appelle completeProfileSetup() — pilote la
  // redirection vers /profile-setup dans router.dart. Ne reflète aucun état
  // serveur (juste-inscrit n'est pas persisté côté backend, un compte auto-
  // généré est déjà pleinement utilisable) : purement une étape d'onboarding
  // côté client, jamais reconstituée après un redémarrage à froid.
  final bool needsProfileSetup;

  const AuthState({required this.status, this.me, this.error, this.needsProfileSetup = false});

  const AuthState.unknown() : this(status: AuthStatus.unknown);

  AuthState copyWith({AuthStatus? status, Me? me, String? error, bool? needsProfileSetup}) => AuthState(
        status: status ?? this.status,
        me: me ?? this.me,
        error: error,
        needsProfileSetup: needsProfileSetup ?? this.needsProfileSetup,
      );
}

/// Équivalent de `frontend/src/lib/auth-context.tsx` : source de vérité
/// unique de la session, câblée sur ApiClient/SocketService (`onUnauthorized`)
/// pour qu'un jeton expiré ramène toujours ici, quel que soit l'endroit du
/// code qui l'a détecté en premier (requête REST ou coupure du socket).
class AuthNotifier extends Notifier<AuthState> {
  @override
  AuthState build() {
    ApiClient.instance.onUnauthorized = _onUnauthorized;
    SocketService.instance.onUnauthorized = _onUnauthorized;
    _bootstrap();
    return const AuthState.unknown();
  }

  Future<void> _bootstrap() async {
    await TokenStore.instance.hydrate();
    if (TokenStore.instance.cachedAccessToken == null) {
      state = const AuthState(status: AuthStatus.unauthenticated);
      return;
    }
    await _loadMe();
  }

  Future<void> _loadMe() async {
    try {
      final me = await ApiClient.instance.me();
      state = AuthState(status: AuthStatus.authenticated, me: me);
      SocketService.instance.connect();
      CallService.instance.connect();
      unawaited(NotificationService.instance.requestPermissionAndRegister());
    } catch (_) {
      await TokenStore.instance.clear();
      state = const AuthState(status: AuthStatus.unauthenticated);
    }
  }

  void _onUnauthorized() {
    // Jamais d'appel à NotificationService.unregister() ici : le jeton
    // d'accès est déjà invalide à ce stade (c'est justement pourquoi on est
    // là), un DELETE authentifié échouerait pour rien — la session est de
    // toute façon déjà révoquée côté serveur, FcmProvider ne lui enverra
    // plus rien (voir `where: revokedAt: null`).
    TokenStore.instance.clear();
    SocketService.instance.disconnect();
    CallService.instance.disconnect();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  /// Rappelé par SettingsScreen après une modification de profil réussie —
  /// évite que chaque écran ait à dupliquer la mise à jour de `AuthState.me`.
  void setMe(Me me) {
    state = state.copyWith(me: me);
  }

  Future<void> login(String identifier, String password) async {
    state = state.copyWith(error: null);
    try {
      final auth = await ApiClient.instance.login(identifier: identifier, password: password);
      await TokenStore.instance.setTokens(
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
      );
      await _loadMe();
    } on ApiException catch (e) {
      state = state.copyWith(error: e.message);
      rethrow;
    }
  }

  Future<void> register({
    required String username,
    String? firstName,
    String? lastName,
    String? email,
    String? phone,
    required String password,
    String? primaryLanguageCode,
  }) async {
    state = state.copyWith(error: null);
    try {
      final auth = await ApiClient.instance.register(
        username: username,
        firstName: firstName,
        lastName: lastName,
        email: email,
        phone: phone,
        password: password,
        primaryLanguageCode: primaryLanguageCode,
      );
      await TokenStore.instance.setTokens(
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
      );
      await _loadMe();
    } on ApiException catch (e) {
      state = state.copyWith(error: e.message);
      rethrow;
    }
  }

  // --- Inscription/connexion téléphone + OTP (façon WhatsApp) ---

  /// Ne change jamais `state` — une simple requête réseau, l'écran appelant
  /// décide quoi afficher ensuite selon le `purpose` renvoyé.
  Future<OtpPurpose> requestOtp(String phone) => ApiClient.instance.requestOtp(phone);

  Future<void> verifyRegisterOtp({
    required String phone,
    required String code,
    String? deviceLabel,
  }) async {
    final auth = await ApiClient.instance.verifyRegisterOtp(
      phone: phone,
      code: code,
      deviceLabel: deviceLabel,
    );
    await _applyAuthResponse(auth);
    // Après _applyAuthResponse (qui repart d'un AuthState neuf via _loadMe) —
    // seul le parcours d'inscription doit déclencher /profile-setup, jamais
    // une connexion ou le bootstrap au démarrage.
    state = state.copyWith(needsProfileSetup: true);
  }

  /// Appelé par ProfileSetupScreen une fois l'assistant terminé (ou passé) —
  /// laisse le routeur revenir à /conversations.
  void completeProfileSetup() {
    state = state.copyWith(needsProfileSetup: false);
  }

  /// Ne connecte PAS l'utilisateur si la 2FA est active — voir
  /// `LoginOtpResult.requiresTwoFactor`, à charge de l'écran d'enchaîner sur
  /// verifyTwoFactorPin() avec le `continuationToken` renvoyé.
  Future<LoginOtpResult> verifyLoginOtp({
    required String phone,
    required String code,
    String? deviceLabel,
  }) async {
    final result = await ApiClient.instance.verifyLoginOtp(
      phone: phone,
      code: code,
      deviceLabel: deviceLabel,
    );
    if (!result.requiresTwoFactor) await _applyAuthResponse(result.auth!);
    return result;
  }

  Future<void> verifyTwoFactorPin({
    required String phone,
    required String continuationToken,
    required String pin,
    String? deviceLabel,
  }) async {
    final auth = await ApiClient.instance.verifyTwoFactorPin(
      phone: phone,
      continuationToken: continuationToken,
      pin: pin,
      deviceLabel: deviceLabel,
    );
    await _applyAuthResponse(auth);
  }

  Future<void> _applyAuthResponse(AuthResponse auth) async {
    await TokenStore.instance.setTokens(
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
    );
    await _loadMe();
  }

  Future<void> logout() async {
    try {
      await NotificationService.instance.unregister();
      await ApiClient.instance.logout();
    } catch (_) {
      // best-effort — on efface la session locale même si l'appel échoue.
    }
    await TokenStore.instance.clear();
    SocketService.instance.disconnect();
    CallService.instance.disconnect();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }
}

final authProvider = NotifierProvider<AuthNotifier, AuthState>(AuthNotifier.new);
