/**
 * Détection très simple du navigateur/système à partir de `navigator.userAgent`
 * — purement déclaratif (section 6 : jamais utilisé pour une décision de
 * sécurité), seulement pour l'affichage sur l'écran de confirmation mobile
 * ("Navigateur : Firefox, Système : Ubuntu"). Un signal UX, pas une mesure
 * de sécurité (voir aussi isLikelyMobileDevice ci-dessous, même principe).
 */
export function detectBrowserName(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return undefined;
}

export function detectOperatingSystem(): string | undefined {
  if (typeof navigator === "undefined") return undefined;
  const ua = navigator.userAgent;
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Android/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Linux/.test(ua)) return "Linux";
  return undefined;
}

/**
 * Signal UX pour rediriger vers l'écran "disponible uniquement sur
 * ordinateur" (section 5) — délibérément PAS une mesure de sécurité
 * (l'énoncé le précise explicitement) : un User-Agent se falsifie
 * trivialement. La vraie frontière reste que la session Web n'existe que
 * si un mobile déjà authentifié la confirme explicitement (section 8-9).
 */
export function isLikelyMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/** Distingue Android/iOS sur l'écran "disponible uniquement sur ordinateur"
 * — seul Android propose un téléchargement direct de l'APK pour l'instant
 * (voir LoginPage), jamais présenté comme disponible sur iOS. */
export function detectMobileOs(): "android" | "ios" | "other" {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  return "other";
}
