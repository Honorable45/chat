/// Adresses du backend NestJS déjà existant (voir `backend/`, inchangé pour
/// le mobile) — mêmes valeurs par défaut que `frontend/.env.example`
/// (`NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_WS_URL`), overridables au build via
/// `--dart-define` (ex. pour pointer un appareil physique vers l'IP LAN du
/// poste de développement, ou vers la prod) plutôt qu'en dur : l'émulateur
/// Android résout "localhost" vers lui-même, jamais vers l'hôte, d'où le
/// 10.0.2.2 par défaut ci-dessous (alias spécial de l'émulateur Android vers
/// la machine hôte — voir AndroidConfig.host).
class AppConfig {
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:4000/api',
  );

  static const String wsBaseUrl = String.fromEnvironment(
    'WS_BASE_URL',
    defaultValue: 'http://10.0.2.2:4000',
  );

  /// Bascule temporaire (même nom exact côté backend, voir
  /// AuthService.isRegistrationOtpEnabled) — désactivée par défaut : voir
  /// PhoneEntryScreen._submit, qui saute l'écran de saisie du code pour une
  /// inscription tant que ceci vaut `false`. Repasser à `true` ICI (ou via
  /// `--dart-define=REGISTRATION_OTP_ENABLED=true` au build) ET dans
  /// backend/.env pour réactiver — aucune autre modification de code
  /// nécessaire, OtpVerifyScreen reste intact et continue de servir la
  /// connexion (jamais affectée par cette bascule) quoi qu'il arrive ici.
  static const bool registrationOtpEnabled = bool.fromEnvironment(
    'REGISTRATION_OTP_ENABLED',
    defaultValue: false,
  );
}
