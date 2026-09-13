import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Équivalent de `frontend/src/lib/token-store.ts`, mais sur stockage
/// chiffré du système (Keystore Android / Keychain iOS) plutôt que
/// `localStorage` — pas d'équivalent web direct à ce niveau de protection,
/// mais le contrat (deux jetons, lire/écrire/effacer) reste identique pour
/// que le reste du client (ApiClient, SocketService) n'ait pas à savoir où
/// ils vivent réellement.
class TokenStore {
  TokenStore._();
  static final TokenStore instance = TokenStore._();

  final _storage = const FlutterSecureStorage();
  static const _accessKey = 'glotta.accessToken';
  static const _refreshKey = 'glotta.refreshToken';

  String? _cachedAccessToken;

  /// Lu en synchrone par l'intercepteur Dio (voir ApiClient) et par la
  /// fonction `auth` du socket Socket.IO — tous deux appelés très
  /// fréquemment et jamais dans un contexte `await`-friendly pour Dio.
  /// Peuplé au démarrage via `hydrate()`.
  String? get cachedAccessToken => _cachedAccessToken;

  Future<void> hydrate() async {
    _cachedAccessToken = await _storage.read(key: _accessKey);
  }

  Future<String?> get refreshToken => _storage.read(key: _refreshKey);

  Future<void> setTokens({required String accessToken, required String refreshToken}) async {
    _cachedAccessToken = accessToken;
    await _storage.write(key: _accessKey, value: accessToken);
    await _storage.write(key: _refreshKey, value: refreshToken);
  }

  Future<void> clear() async {
    _cachedAccessToken = null;
    await _storage.delete(key: _accessKey);
    await _storage.delete(key: _refreshKey);
  }
}
