import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Trois états ("light"/"dark"/"system"), même contrat que
/// `frontend/src/lib/theme.ts` — `ThemeMode.system` de Flutter correspond
/// exactement à `applyTheme("system")` côté web (aucun choix explicite,
/// `prefers-color-scheme`/luminosité système décide).
const _storageKey = 'glotta.theme';

class ThemeModeNotifier extends Notifier<ThemeMode> {
  @override
  ThemeMode build() {
    _hydrate();
    return ThemeMode.system;
  }

  Future<void> _hydrate() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_storageKey);
    if (raw == 'light') {
      state = ThemeMode.light;
    } else if (raw == 'dark') {
      state = ThemeMode.dark;
    }
  }

  Future<void> setMode(ThemeMode mode) async {
    state = mode;
    final prefs = await SharedPreferences.getInstance();
    if (mode == ThemeMode.system) {
      await prefs.remove(_storageKey);
    } else {
      await prefs.setString(_storageKey, mode == ThemeMode.dark ? 'dark' : 'light');
    }
  }
}

final themeModeProvider = NotifierProvider<ThemeModeNotifier, ThemeMode>(ThemeModeNotifier.new);
