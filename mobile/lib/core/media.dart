import '../core/config.dart';
import '../services/token_store.dart';

/// Port de `resolveMediaSrc`/`isOwnBackendUrl` (`frontend/src/lib/api.ts`) :
/// une URL de média (avatar, vocal...) renvoyée par le backend est soit déjà
/// absolue (lien Cloudinary signé, public — jamais besoin d'authentification),
/// soit un chemin relatif interne (`/api/...`) à préfixer par l'origine du
/// backend ET à authentifier (Bearer) — le jeton d'accès ne doit JAMAIS être
/// envoyé à un hôte tiers comme Cloudinary, d'où la distinction stricte
/// ci-dessous plutôt qu'un en-tête ajouté sans condition à toute requête
/// média.
String get _apiOrigin => Uri.parse(AppConfig.apiBaseUrl).origin;

String resolveMediaUrl(String url) {
  if (!url.startsWith('/')) return url;
  return '$_apiOrigin$url';
}

bool isOwnBackendUrl(String url) => url.startsWith('/') || url.startsWith(_apiOrigin);

/// En-têtes à joindre pour LIRE un média (jamais pour les requêtes REST
/// classiques, déjà couvertes par l'intercepteur de ApiClient) — vide pour
/// un lien Cloudinary/externe déjà public.
Map<String, String> mediaHeaders(String url) {
  if (!isOwnBackendUrl(url)) return const {};
  final token = TokenStore.instance.cachedAccessToken;
  return token == null ? const {} : {'Authorization': 'Bearer $token'};
}
