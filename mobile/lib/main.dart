import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/router.dart';
import 'core/theme.dart';
import 'services/notification_service.dart';
import 'state/theme_state.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Avant `runApp` (exigence Firebase pour `onBackgroundMessage`) —
  // silencieux si `google-services.json` est absent, voir
  // NotificationService.init. L'enregistrement du jeton lui-même n'a lieu
  // qu'après authentification (voir AuthNotifier._loadMe).
  await NotificationService.instance.init();
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
