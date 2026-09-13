import 'package:flutter/material.dart';
import '../core/theme.dart';

/// Port direct de `frontend/src/components/auth/AuthShell.tsx` : deux halos
/// dégradés flous en fond, logo "Glotta" en texte dégradé, carte centrale
/// semi-transparente avec bordure — même structure visuelle, mêmes couleurs.
class AuthShell extends StatelessWidget {
  final String title;
  final String subtitle;
  final Widget child;
  final Widget footer;

  const AuthShell({
    super.key,
    required this.title,
    required this.subtitle,
    required this.child,
    required this.footer,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return Scaffold(
      backgroundColor: c.background,
      body: Stack(
        children: [
          Positioned(
            top: -160,
            left: -160,
            child: _glow(c.accent),
          ),
          Positioned(
            bottom: -160,
            right: -160,
            child: _glow(c.accent2),
          ),
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 380),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      ShaderMask(
                        shaderCallback: (bounds) =>
                            LinearGradient(colors: [c.accent, c.accent2]).createShader(bounds),
                        child: const Text(
                          'Glotta',
                          style: TextStyle(
                            fontSize: 28,
                            fontWeight: FontWeight.w600,
                            color: Colors.white,
                            letterSpacing: -0.5,
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        title,
                        style: TextStyle(fontSize: 17, fontWeight: FontWeight.w500, color: c.foreground),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        subtitle,
                        style: TextStyle(fontSize: 13.5, color: c.muted),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 28),
                      Container(
                        padding: const EdgeInsets.all(22),
                        decoration: BoxDecoration(
                          color: c.surface.withValues(alpha: 0.8),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: c.border),
                          boxShadow: [
                            BoxShadow(color: Colors.black.withValues(alpha: 0.35), blurRadius: 40, offset: const Offset(0, 20)),
                          ],
                        ),
                        child: child,
                      ),
                      const SizedBox(height: 22),
                      DefaultTextStyle(
                        style: TextStyle(fontSize: 13.5, color: c.muted),
                        textAlign: TextAlign.center,
                        child: footer,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _glow(Color color) => IgnorePointer(
        child: Container(
          width: 320,
          height: 320,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: RadialGradient(
              colors: [color.withValues(alpha: 0.35), color.withValues(alpha: 0.0)],
            ),
          ),
        ),
      );
}

class AuthFormField extends StatelessWidget {
  final String label;
  final Widget child;

  const AuthFormField({super.key, required this.label, required this.child});

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: c.mutedStrong)),
        const SizedBox(height: 6),
        child,
      ],
    );
  }
}

/// Bouton principal en dégradé (accent → accent-2) — même contrat que
/// `primaryButtonClassName` côté web.
class AuthPrimaryButton extends StatelessWidget {
  final String label;
  final String loadingLabel;
  final bool loading;
  final VoidCallback? onPressed;

  const AuthPrimaryButton({
    super.key,
    required this.label,
    required this.loadingLabel,
    required this.loading,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return SizedBox(
      width: double.infinity,
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          gradient: LinearGradient(colors: [c.accent, c.accent2]),
        ),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            borderRadius: BorderRadius.circular(12),
            onTap: loading ? null : onPressed,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 13),
              child: Center(
                child: Text(
                  loading ? loadingLabel : label,
                  style: TextStyle(
                    color: c.accentContrast,
                    fontWeight: FontWeight.w600,
                    fontSize: 14.5,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
