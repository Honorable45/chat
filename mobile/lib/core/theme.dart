import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Jetons de couleur — copiés à l'identique de `frontend/src/app/globals.css`
/// (mêmes valeurs hexadécimales, sombre par défaut, variante claire ci-dessous)
/// pour que le mobile "ressemble exactement à la version web" (demande
/// explicite). Si une valeur change côté web, la reporter ici à la main —
/// aucune génération automatique entre les deux frontends.
class GlottaColors {
  final Color background;
  final Color surface;
  final Color surfaceRaised;
  final Color border;
  final Color borderStrong;
  final Color foreground;
  final Color muted;
  final Color mutedStrong;
  final Color accent;
  final Color accent2;
  final Color accentContrast;
  final Color unread;
  final Color online;
  final Color danger;

  const GlottaColors({
    required this.background,
    required this.surface,
    required this.surfaceRaised,
    required this.border,
    required this.borderStrong,
    required this.foreground,
    required this.muted,
    required this.mutedStrong,
    required this.accent,
    required this.accent2,
    required this.accentContrast,
    required this.unread,
    required this.online,
    required this.danger,
  });

  static const dark = GlottaColors(
    background: Color(0xFF0A0A12),
    surface: Color(0xFF12121D),
    surfaceRaised: Color(0xFF171726),
    border: Color(0x14FFFFFF), // rgba(255,255,255,0.08)
    borderStrong: Color(0x24FFFFFF), // rgba(255,255,255,0.14)
    foreground: Color(0xFFF4F4F8),
    muted: Color(0xFF8B8B9E),
    mutedStrong: Color(0xFFB4B4C6),
    accent: Color(0xFF7C6CF6),
    accent2: Color(0xFF22D3EE),
    accentContrast: Color(0xFF0A0A12),
    unread: Color(0xFFEC4899),
    online: Color(0xFF34D399),
    danger: Color(0xFFF87171),
  );

  static const light = GlottaColors(
    background: Color(0xFFF5F5FA),
    surface: Color(0xFFFFFFFF),
    surfaceRaised: Color(0xFFFFFFFF),
    border: Color(0x170F0F1E), // rgba(15,15,30,0.09)
    borderStrong: Color(0x290F0F1E), // rgba(15,15,30,0.16)
    foreground: Color(0xFF14141F),
    muted: Color(0xFF6B6B7C),
    mutedStrong: Color(0xFF43434F),
    accent: Color(0xFF6D5CF0),
    accent2: Color(0xFF0891B2),
    accentContrast: Color(0xFFFFFFFF),
    unread: Color(0xFFDB2777),
    online: Color(0xFF059669),
    danger: Color(0xFFDC2626),
  );
}

/// Étend `ThemeExtension` pour exposer `GlottaColors` via `Theme.of(context)`
/// sans repasser par les couleurs génériques de Material (qui ne collent pas
/// à la palette violet/cyan de Glotta) — un seul point d'accès,
/// `context.glotta`, utilisé par tous les écrans.
class GlottaTheme extends ThemeExtension<GlottaTheme> {
  final GlottaColors colors;
  const GlottaTheme(this.colors);

  @override
  GlottaTheme copyWith({GlottaColors? colors}) => GlottaTheme(colors ?? this.colors);

  @override
  GlottaTheme lerp(ThemeExtension<GlottaTheme>? other, double t) {
    if (other is! GlottaTheme) return this;
    return t < 0.5 ? this : other;
  }
}

extension GlottaThemeContext on BuildContext {
  GlottaColors get glotta => Theme.of(this).extension<GlottaTheme>()!.colors;
}

ThemeData buildGlottaTheme(GlottaColors c, Brightness brightness) {
  final textTheme = GoogleFonts.interTextTheme(
    brightness == Brightness.dark ? ThemeData.dark().textTheme : ThemeData.light().textTheme,
  ).apply(bodyColor: c.foreground, displayColor: c.foreground);

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    scaffoldBackgroundColor: c.background,
    fontFamily: GoogleFonts.inter().fontFamily,
    textTheme: textTheme,
    colorScheme: ColorScheme(
      brightness: brightness,
      primary: c.accent,
      onPrimary: c.accentContrast,
      secondary: c.accent2,
      onSecondary: c.accentContrast,
      error: c.danger,
      onError: Colors.white,
      surface: c.surface,
      onSurface: c.foreground,
    ),
    dividerColor: c.border,
    cardColor: c.surfaceRaised,
    appBarTheme: AppBarTheme(
      backgroundColor: c.surface,
      foregroundColor: c.foreground,
      elevation: 0,
      surfaceTintColor: Colors.transparent,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: c.surfaceRaised,
      hintStyle: TextStyle(color: c.muted),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: c.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: c.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: c.accent, width: 1.5),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: c.accent,
        foregroundColor: c.accentContrast,
        padding: const EdgeInsets.symmetric(vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: c.accent),
    ),
    extensions: [GlottaTheme(c)],
  );
}

final ThemeData glottaDarkTheme = buildGlottaTheme(GlottaColors.dark, Brightness.dark);
final ThemeData glottaLightTheme = buildGlottaTheme(GlottaColors.light, Brightness.light);
