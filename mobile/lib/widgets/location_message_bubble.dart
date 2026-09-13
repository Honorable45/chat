import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/theme.dart';
import '../models/message.dart';

/// Lien Google Maps public sans clé d'API — recherche simple, pas d'appel
/// facturé à l'API Maps (voir le choix déjà fait côté web,
/// `googleMapsUrl`/`osm-tile.ts`).
Uri googleMapsUri(double lat, double lng) =>
    Uri.parse('https://www.google.com/maps/search/?api=1&query=$lat,$lng');

class LocationMessageBubbleContent extends StatelessWidget {
  final Message message;
  final bool own;

  const LocationMessageBubbleContent({super.key, required this.message, required this.own});

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final location = message.location;
    final textColor = own ? c.accentContrast : c.foreground;
    if (location == null) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.location_on_outlined, size: 18, color: textColor),
          const SizedBox(width: 8),
          Text('Position', style: TextStyle(fontSize: 14, color: textColor)),
        ],
      );
    }

    return GestureDetector(
      onTap: () => launchUrl(googleMapsUri(location.latitude, location.longitude),
          mode: LaunchMode.externalApplication),
      child: SizedBox(
        width: 220,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: Container(
                height: 120,
                color: own ? Colors.black.withValues(alpha: 0.15) : c.surface,
                child: Icon(Icons.map_outlined, size: 40, color: textColor.withValues(alpha: 0.7)),
              ),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Icon(Icons.location_on, size: 16, color: textColor),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Voir sur Google Maps',
                    style: TextStyle(fontSize: 13, color: textColor, fontWeight: FontWeight.w500),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
