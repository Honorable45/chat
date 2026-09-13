import 'package:flutter/material.dart';
import '../core/theme.dart';

/// Affiché pendant `AuthStatus.unknown` (hydratation du jeton + `GET
/// /users/me`, voir AuthNotifier) — le routeur redirige dès que le statut
/// est connu, cet écran ne fait jamais rien lui-même.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return Scaffold(
      backgroundColor: c.background,
      body: Center(
        child: ShaderMask(
          shaderCallback: (bounds) =>
              LinearGradient(colors: [c.accent, c.accent2]).createShader(bounds),
          child: const Text(
            'Glotta',
            style: TextStyle(fontSize: 40, fontWeight: FontWeight.w700, color: Colors.white),
          ),
        ),
      ),
    );
  }
}
