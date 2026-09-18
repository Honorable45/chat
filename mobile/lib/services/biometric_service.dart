import 'package:local_auth/local_auth.dart';

/// Wrapper autour de `local_auth` (section 7) — l'app ne reçoit jamais
/// l'empreinte/le visage ni un quelconque modèle biométrique, seulement
/// `true`/`false` : toute la vérification a lieu dans l'API biométrique
/// native de l'appareil (Face ID/Touch ID/BiometricPrompt), jamais côté Dart.
class BiometricService {
  BiometricService._();
  static final BiometricService instance = BiometricService._();

  final _auth = LocalAuthentication();

  Future<bool> isAvailable() async {
    try {
      final canCheck = await _auth.canCheckBiometrics;
      final isSupported = await _auth.isDeviceSupported();
      return canCheck && isSupported;
    } catch (_) {
      return false;
    }
  }

  Future<bool> authenticate({String reason = 'Déverrouillez Glotta'}) async {
    try {
      return await _auth.authenticate(
        localizedReason: reason,
        biometricOnly: true,
        persistAcrossBackgrounding: true,
      );
    } catch (_) {
      return false;
    }
  }
}
