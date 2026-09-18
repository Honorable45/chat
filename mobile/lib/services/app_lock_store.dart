import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Méthode principale de déverrouillage (section 6) — toujours l'une des
/// trois ci-dessous : un secret local (PIN/mot de passe/schéma) est
/// obligatoire pour activer le verrouillage. La biométrie (section 7) n'est
/// jamais une méthode isolée sans repli : voir `biometricEnabled`, une
/// simple bascule "raccourci rapide" au-dessus d'une méthode déjà
/// configurée — sans elle, un échec (empreinte non reconnue, capteur
/// indisponible) laisserait l'utilisateur sans méthode de secours, ce que le
/// cahier des charges demande explicitement d'éviter.
enum LockMethod { pin, password, pattern }

/// Section 8 — `immediate` verrouille dès le passage en arrière-plan,
/// `onAppClose` ne verrouille jamais au simple passage en arrière-plan (voir
/// AppLockGate) : seul un redémarrage à froid réinitialise `unlocked` à
/// `false`, ce qui approxime "à la fermeture" sans pouvoir distinguer un
/// arrière-plan prolongé d'une vraie terminaison de processus côté Flutter.
enum AutoLockDuration { immediate, seconds30, minute1, minutes5, onAppClose }

extension AutoLockDurationX on AutoLockDuration {
  Duration? get threshold => switch (this) {
        AutoLockDuration.immediate => Duration.zero,
        AutoLockDuration.seconds30 => const Duration(seconds: 30),
        AutoLockDuration.minute1 => const Duration(minutes: 1),
        AutoLockDuration.minutes5 => const Duration(minutes: 5),
        AutoLockDuration.onAppClose => null,
      };

  String get label => switch (this) {
        AutoLockDuration.immediate => 'Immédiatement',
        AutoLockDuration.seconds30 => 'Après 30 secondes',
        AutoLockDuration.minute1 => 'Après 1 minute',
        AutoLockDuration.minutes5 => 'Après 5 minutes',
        AutoLockDuration.onAppClose => "Lorsque l'application est fermée",
      };
}

/// Verrouillage global de l'application (sections 6-10) : stockage
/// strictement local (Keystore/Keychain, même convention que TokenStore),
/// **jamais envoyé au backend** — ni le PIN/mot de passe/schéma en clair, ni
/// même leur hash, ni a fortiori une quelconque donnée biométrique (celle-ci
/// ne transite jamais par ce store, voir BiometricService). Un secret
/// (PIN/mot de passe/schéma) est réduit à un hash SHA-256 salé avant d'être
/// écrit sur disque, jamais comparé qu'à un autre hash calculé de la même
/// façon.
class AppLockStore {
  AppLockStore._();
  static final AppLockStore instance = AppLockStore._();

  final _storage = const FlutterSecureStorage();
  static const _enabledKey = 'glotta.applock.enabled';
  static const _methodKey = 'glotta.applock.method';
  static const _secretHashKey = 'glotta.applock.secretHash';
  static const _saltKey = 'glotta.applock.salt';
  static const _autoLockKey = 'glotta.applock.autoLock';
  static const _biometricKey = 'glotta.applock.biometric';

  bool _enabled = false;
  LockMethod? _method;
  AutoLockDuration _autoLock = AutoLockDuration.immediate;
  bool _biometricEnabled = false;

  bool get enabled => _enabled;
  LockMethod? get method => _method;
  AutoLockDuration get autoLock => _autoLock;
  bool get biometricEnabled => _biometricEnabled;

  /// À appeler au démarrage, avant que AppLockGate ne décide d'afficher
  /// l'écran de verrouillage — même rôle que TokenStore.hydrate().
  Future<void> hydrate() async {
    _enabled = (await _storage.read(key: _enabledKey)) == 'true';
    final methodRaw = await _storage.read(key: _methodKey);
    _method = LockMethod.values.where((m) => m.name == methodRaw).firstOrNull;
    final autoLockRaw = await _storage.read(key: _autoLockKey);
    _autoLock = AutoLockDuration.values.where((d) => d.name == autoLockRaw).firstOrNull ??
        AutoLockDuration.immediate;
    _biometricEnabled = (await _storage.read(key: _biometricKey)) == 'true';
  }

  Future<void> enable({
    required LockMethod method,
    required String secret,
    required AutoLockDuration autoLock,
  }) async {
    final salt = _randomSalt();
    await _storage.write(key: _saltKey, value: salt);
    await _storage.write(key: _secretHashKey, value: _hash(secret, salt));
    await _storage.write(key: _methodKey, value: method.name);
    await _storage.write(key: _autoLockKey, value: autoLock.name);
    await _storage.write(key: _enabledKey, value: 'true');
    _enabled = true;
    _method = method;
    _autoLock = autoLock;
  }

  Future<void> setBiometricEnabled(bool value) async {
    await _storage.write(key: _biometricKey, value: value.toString());
    _biometricEnabled = value;
  }

  Future<void> updateAutoLock(AutoLockDuration autoLock) async {
    await _storage.write(key: _autoLockKey, value: autoLock.name);
    _autoLock = autoLock;
  }

  Future<void> disable() async {
    await _storage.delete(key: _enabledKey);
    await _storage.delete(key: _methodKey);
    await _storage.delete(key: _secretHashKey);
    await _storage.delete(key: _saltKey);
    await _storage.delete(key: _biometricKey);
    _enabled = false;
    _method = null;
    _biometricEnabled = false;
  }

  /// Compare le secret saisi (PIN/mot de passe/schéma sérialisé en string)
  /// au hash stocké — jamais l'inverse (aucun déchiffrement, hash à sens
  /// unique).
  Future<bool> verifySecret(String secret) async {
    final salt = await _storage.read(key: _saltKey);
    final storedHash = await _storage.read(key: _secretHashKey);
    if (salt == null || storedHash == null) return false;
    return _hash(secret, salt) == storedHash;
  }

  String _hash(String secret, String salt) {
    return sha256.convert(utf8.encode('$salt:$secret')).toString();
  }

  String _randomSalt() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    return base64Url.encode(bytes);
  }
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
