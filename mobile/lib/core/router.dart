import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../screens/auth/phone_entry_screen.dart';
import '../screens/auth/profile_setup_screen.dart';
import '../screens/chat/chat_screen.dart';
import '../screens/home_shell.dart';
import '../screens/splash_screen.dart';
import '../state/auth_state.dart';

/// Relaie les changements de `authProvider` à go_router (`refreshListenable`
/// attend un `Listenable` classique, Riverpod n'en expose pas directement) —
/// permet à `redirect` ci-dessous d'être réévalué à chaque changement de
/// statut de session, même rôle que le `useEffect` de redirection dans
/// `auth-context.tsx` côté web.
class _AuthRefresh extends ChangeNotifier {
  _AuthRefresh(Ref ref) {
    ref.listen(authProvider, (_, _) => notifyListeners());
  }
}

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = _AuthRefresh(ref);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: '/',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authProvider);
      final atAuthScreen = state.matchedLocation == '/phone';

      if (auth.status == AuthStatus.unknown) {
        return state.matchedLocation == '/' ? null : '/';
      }
      if (auth.status == AuthStatus.unauthenticated) {
        return atAuthScreen ? null : '/phone';
      }
      // authenticated
      final atProfileSetup = state.matchedLocation == '/profile-setup';
      if (auth.needsProfileSetup) {
        return atProfileSetup ? null : '/profile-setup';
      }
      if (atAuthScreen || atProfileSetup || state.matchedLocation == '/') return '/conversations';
      return null;
    },
    routes: [
      GoRoute(path: '/', builder: (context, state) => const SplashScreen()),
      GoRoute(path: '/phone', builder: (context, state) => const PhoneEntryScreen()),
      GoRoute(path: '/profile-setup', builder: (context, state) => const ProfileSetupScreen()),
      GoRoute(
        path: '/conversations',
        builder: (context, state) => const HomeShell(),
      ),
      GoRoute(
        path: '/conversations/:id',
        builder: (context, state) => ChatScreen(conversationId: state.pathParameters['id']!),
      ),
    ],
  );
});
