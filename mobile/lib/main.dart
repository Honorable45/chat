import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/router.dart';
import 'core/theme.dart';
import 'state/theme_state.dart';

void main() {
  runApp(const ProviderScope(child: GlottaApp()));
}

class GlottaApp extends ConsumerWidget {
  const GlottaApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    final themeMode = ref.watch(themeModeProvider);

    return MaterialApp.router(
      title: 'Glotta',
      debugShowCheckedModeBanner: false,
      themeMode: themeMode,
      theme: glottaLightTheme,
      darkTheme: glottaDarkTheme,
      routerConfig: router,
    );
  }
}
