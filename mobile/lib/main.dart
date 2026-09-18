import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/router.dart';
import 'core/theme.dart';
import 'services/app_lock_store.dart';
import 'services/notification_service.dart';
import 'state/theme_state.dart';
import 'widgets/app_lock_gate.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Avant `runApp` (exigence Firebase pour `onBackgroundMessage`) —
  // silencieux si `google-services.json` est absent, voir
  // NotificationService.init. L'enregistrement du jeton lui-même n'a lieu
  // qu'après authentification (voir AuthNotifier._loadMe).
  await NotificationService.instance.init();
  // Également avant `runApp` — voir le commentaire de AppLockNotifier.build,
  // section 10 : "un utilisateur qui prend le téléphone déverrouillé ne doit
  // pas pouvoir ouvrir directement l'application si le verrouillage global
  // est activé", donc aucune frame de contenu ne doit pouvoir s'afficher
  // avant de savoir si l'app est verrouillée.
  await AppLockStore.instance.hydrate();
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
      builder: (context, child) => AppLockGate(child: child ?? const SizedBox.shrink()),
    );
  }
}
