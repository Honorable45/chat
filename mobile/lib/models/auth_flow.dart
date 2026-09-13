import 'user.dart';

/// Port de `OtpPurpose` (backend) — indique à l'écran de vérification quel
/// endpoint appeler ensuite (`register/verify-otp` ou `login/verify-otp`),
/// voir AuthService.requestOtp côté backend : un seul champ "numéro de
/// téléphone" côté mobile, le serveur décide inscription/connexion.
enum OtpPurpose { register, login }

OtpPurpose otpPurposeFromJson(String value) => value == 'REGISTER' ? OtpPurpose.register : OtpPurpose.login;

/// Soit `auth` est renseigné (2FA désactivée, session créée immédiatement),
/// soit `continuationToken` l'est (2FA activée — l'écran suivant doit
/// demander le PIN puis appeler `verifyTwoFactorPin`) — jamais les deux.
class LoginOtpResult {
  final bool requiresTwoFactor;
  final AuthResponse? auth;
  final String? continuationToken;

  const LoginOtpResult({required this.requiresTwoFactor, this.auth, this.continuationToken});

  factory LoginOtpResult.fromJson(Map<String, dynamic> json) {
    final requiresTwoFactor = json['requiresTwoFactor'] as bool? ?? false;
    return LoginOtpResult(
      requiresTwoFactor: requiresTwoFactor,
      auth: requiresTwoFactor ? null : AuthResponse.fromJson(json),
      continuationToken: requiresTwoFactor ? json['continuationToken'] as String : null,
    );
  }
}

class TwoFactorStatus {
  final bool enabled;
  final bool hasRecoveryEmail;
  final bool recoveryEmailVerified;

  const TwoFactorStatus({
    required this.enabled,
    required this.hasRecoveryEmail,
    required this.recoveryEmailVerified,
  });

  factory TwoFactorStatus.fromJson(Map<String, dynamic> json) => TwoFactorStatus(
        enabled: json['enabled'] as bool? ?? false,
        hasRecoveryEmail: json['hasRecoveryEmail'] as bool? ?? false,
        recoveryEmailVerified: json['recoveryEmailVerified'] as bool? ?? false,
      );
}

/// Renvoyé après le scan d'un QR Glotta Web (avant confirmation) — purement
/// déclaratif côté backend (voir WebLinkRequest.browserName), jamais utilisé
/// pour une décision de sécurité, seulement affiché sur l'écran "Connecter
/// cet appareil ?".
class ScannedLinkInfo {
  final String? browserName;
  final String? operatingSystem;
  final DateTime requestedAt;

  const ScannedLinkInfo({this.browserName, this.operatingSystem, required this.requestedAt});

  factory ScannedLinkInfo.fromJson(Map<String, dynamic> json) => ScannedLinkInfo(
        browserName: json['browserName'] as String?,
        operatingSystem: json['operatingSystem'] as String?,
        requestedAt: DateTime.parse(json['requestedAt'] as String),
      );
}

enum SessionKind { mobile, web }

/// Port de `SessionSummary` (backend, `AuthService.listSessions`) — "un
/// appareil connecté" à l'écran Paramètres → Appareils connectés.
class SessionSummary {
  final String id;
  final SessionKind type;
  final String? deviceLabel;
  final String? userAgent;
  final String? ipAddress;
  final DateTime createdAt;
  final DateTime lastUsedAt;
  final bool isCurrent;

  const SessionSummary({
    required this.id,
    required this.type,
    this.deviceLabel,
    this.userAgent,
    this.ipAddress,
    required this.createdAt,
    required this.lastUsedAt,
    required this.isCurrent,
  });

  factory SessionSummary.fromJson(Map<String, dynamic> json) => SessionSummary(
        id: json['id'] as String,
        type: json['type'] == 'WEB' ? SessionKind.web : SessionKind.mobile,
        deviceLabel: json['deviceLabel'] as String?,
        userAgent: json['userAgent'] as String?,
        ipAddress: json['ipAddress'] as String?,
        createdAt: DateTime.parse(json['createdAt'] as String),
        lastUsedAt: DateTime.parse(json['lastUsedAt'] as String),
        isCurrent: json['isCurrent'] as bool? ?? false,
      );
}
