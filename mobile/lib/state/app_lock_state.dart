import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../services/app_lock_store.dart';
import '../services/biometric_service.dart';

class AppLockState {
  final bool enabled;
  // Purement en mémoire, jamais persisté — un redémarrage à froid repart
  // toujours de `false` quand `enabled` est vrai (voir build() ci-dessous).
  final bool unlocked;
  final LockMethod? method;
  final AutoLockDuration autoLock;
  final bool biometricEnabled;

  const AppLockState({
    required this.enabled,
    required this.unlocked,
    this.method,
    required this.autoLock,
    required this.biometricEnabled,
  });

  AppLockState copyWith({
    bool? enabled,
    bool? unlocked,
    LockMethod? method,
    AutoLockDuration? autoLock,
    bool? biometricEnabled,
  }) =>
      AppLockState(
        enabled: enabled ?? this.enabled,
        unlocked: unlocked ?? this.unlocked,
        method: method ?? this.method,
        autoLock: autoLock ?? this.autoLock,
        biometricEnabled: biometricEnabled ?? this.biometricEnabled,
      );
}

/// Verrouillage global de l'app (sections 6-10) — état purement local,
/// jamais synchronisé avec AuthState/le backend (voir AppLockStore). Piloté
/// par AppLockGate (lib/widgets/app_lock_gate.dart) pour le verrouillage
/// automatique, et par AppLockScreen/LockScreen pour la configuration et le
/// déverrouillage manuel.
class AppLockNotifier extends Notifier<AppLockState> {
  // AppLockStore.instance.hydrate() est attendu dans main() AVANT runApp
  // (comme NotificationService.instance.init()) : build() peut donc lire
  // l'état déjà chargé de façon parfaitement synchrone, sans jamais laisser
  // passer une frame où du contenu verrouillé apparaîtrait en clair pendant
  // qu'une lecture asynchrone serait encore en vol (voir main.dart) —
  // contrairement à AuthState, qui a besoin d'un statut "unknown" explicite
  // le temps de son propre bootstrap réseau, ce store est purement local et
  // n'a pas cette contrainte une fois pré-chargé.
  @override
  AppLockState build() {
    final store = AppLockStore.instance;
    return AppLockState(
      enabled: store.enabled,
      unlocked: !store.enabled,
      method: store.method,
      autoLock: store.autoLock,
      biometricEnabled: store.biometricEnabled,
    );
  }

  Future<void> enable({
    required LockMethod method,
    required String secret,
    required AutoLockDuration autoLock,
  }) async {
    await AppLockStore.instance.enable(method: method, secret: secret, autoLock: autoLock);
    state = state.copyWith(enabled: true, unlocked: true, method: method, autoLock: autoLock);
  }

  Future<void> setBiometricEnabled(bool value) async {
    await AppLockStore.instance.setBiometricEnabled(value);
    state = state.copyWith(biometricEnabled: value);
  }

  Future<void> disable() async {
    await AppLockStore.instance.disable();
    state = state.copyWith(enabled: false, unlocked: true, biometricEnabled: false);
  }

  Future<void> updateAutoLock(AutoLockDuration autoLock) async {
    await AppLockStore.instance.updateAutoLock(autoLock);
    state = state.copyWith(autoLock: autoLock);
  }

  /// Appelé par AppLockGate au retour au premier plan une fois le délai
  /// configuré dépassé — jamais par un écran directement.
  void lock() {
    if (!state.enabled || !state.unlocked) return;
    state = state.copyWith(unlocked: false);
  }

  Future<bool> unlockWithSecret(String secret) async {
    final ok = await AppLockStore.instance.verifySecret(secret);
    if (ok) state = state.copyWith(unlocked: true);
    return ok;
  }

  Future<bool> unlockWithBiometrics() async {
    if (!state.biometricEnabled) return false;
    final ok = await BiometricService.instance.authenticate();
    if (ok) state = state.copyWith(unlocked: true);
    return ok;
  }
}

final appLockProvider = NotifierProvider<AppLockNotifier, AppLockState>(AppLockNotifier.new);
