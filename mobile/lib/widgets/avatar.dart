import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../core/config.dart';
import '../core/theme.dart';

/// Port de `frontend/src/components/Avatar.tsx` : image si `avatarUrl` est
/// fourni, sinon initiales sur fond dégradé accent → accent-2 (même
/// dégradé que le reste de l'identité visuelle) ; pastille verte "en ligne"
/// en option, même position (bas-droite, anneau de la couleur de fond pour
/// se détacher).
class GlottaAvatar extends StatelessWidget {
  final String firstName;
  final String lastName;
  final String? avatarUrl;
  final bool? online;
  final double size;

  const GlottaAvatar({
    super.key,
    required this.firstName,
    this.lastName = '',
    this.avatarUrl,
    this.online,
    this.size = 44,
  });

  String get _initials {
    final a = firstName.isNotEmpty ? firstName[0] : '';
    final b = lastName.isNotEmpty ? lastName[0] : '';
    final initials = ('$a$b').toUpperCase();
    return initials.isEmpty ? '?' : initials;
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final url = avatarUrl;
    final resolved = url == null
        ? null
        : (url.startsWith('/') ? '${Uri.parse(AppConfig.apiBaseUrl).origin}$url' : url);

    return Stack(
      clipBehavior: Clip.none,
      children: [
        ClipOval(
          child: SizedBox(
            width: size,
            height: size,
            child: resolved != null
                ? CachedNetworkImage(
                    imageUrl: resolved,
                    fit: BoxFit.cover,
                    errorWidget: (context, url, error) => _initialsFallback(c),
                    placeholder: (context, url) => _initialsFallback(c),
                  )
                : _initialsFallback(c),
          ),
        ),
        if (online == true)
          Positioned(
            right: -1,
            bottom: -1,
            child: Container(
              width: size * 0.28,
              height: size * 0.28,
              decoration: BoxDecoration(
                color: c.online,
                shape: BoxShape.circle,
                border: Border.all(color: c.background, width: 2),
              ),
            ),
          ),
      ],
    );
  }

  Widget _initialsFallback(GlottaColors c) => DecoratedBox(
        decoration: BoxDecoration(gradient: LinearGradient(colors: [c.accent, c.accent2])),
        child: Center(
          child: Text(
            _initials,
            style: TextStyle(
              color: c.accentContrast,
              fontWeight: FontWeight.w600,
              fontSize: size * 0.38,
            ),
          ),
        ),
      );
}
