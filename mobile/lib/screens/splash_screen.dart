import 'package:flutter/material.dart';
import '../core/theme.dart';

/// Affiché tant que `AuthStatus.unknown` (hydratation du jeton + `GET
/// /users/me`, voir `AuthNotifier.build`/`_bootstrap`) — cet écran ne
/// déclenche jamais lui-même de chargement ni de redirection : c'est déjà
/// le rôle de `router.dart` (`_AuthRefresh` relaie `authProvider` à
/// go_router comme `refreshListenable`, et `redirect` bascule vers
/// `/phone` ou `/conversations` dès que le statut devient connu) — un
/// second `FutureProvider` dédié ferait doublon avec ce mécanisme déjà en
/// place plutôt que d'apporter un vrai nouveau chargement à observer.
class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _shimmer;

  @override
  void initState() {
    super.initState();
    _shimmer = AnimationController(vsync: this, duration: const Duration(seconds: 2))..repeat();
  }

  @override
  void dispose() {
    _shimmer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return Scaffold(
      // Pas de `backgroundColor` ici : hérite de `scaffoldBackgroundColor`
      // (déjà `c.background`, voir buildGlottaTheme) plutôt que de le
      // redéfinir une deuxième fois au même endroit.
      body: Stack(
        children: [
          Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 60,
                  height: 60,
                  decoration: BoxDecoration(
                    color: c.accent,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    'G',
                    style: TextStyle(
                      color: c.accentContrast,
                      fontSize: 30,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'Glotta',
                  style: TextStyle(color: c.foreground, fontSize: 19, fontWeight: FontWeight.w500),
                ),
                const SizedBox(height: 28),
                AnimatedBuilder(
                  animation: _shimmer,
                  builder: (context, child) {
                    // Glisse de -1.5 à 1.5 sur toute la durée : la bande
                    // lumineuse (au centre du dégradé) sort du texte aux
                    // deux extrémités du cycle, donc le saut 1.0 → 0.0 de
                    // `repeat()` reste invisible — pas besoin de `reverse`.
                    final dx = -1.5 + 3.0 * _shimmer.value;
                    return ShaderMask(
                      shaderCallback: (bounds) => LinearGradient(
                        colors: [Colors.transparent, c.accent, Colors.transparent],
                        stops: const [0.35, 0.5, 0.65],
                        begin: Alignment(dx - 0.3, 0),
                        end: Alignment(dx + 0.3, 0),
                      ).createShader(bounds),
                      child: child,
                    );
                  },
                  child: Text(
                    'Chargement…',
                    style: TextStyle(color: c.muted, fontSize: 13, fontWeight: FontWeight.w500),
                  ),
                ),
              ],
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: LinearProgressIndicator(
              minHeight: 2,
              backgroundColor: c.border,
              color: c.accent,
            ),
          ),
        ],
      ),
    );
  }
}
