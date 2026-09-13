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
}
