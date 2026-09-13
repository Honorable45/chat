import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../core/media.dart';
import '../core/theme.dart';
import '../models/message.dart';

/// Vignette carrée de taille unique (220px, voir `IMAGE_THUMBNAIL_SIZE` côté
/// web — "que toutes les images aient la même taille"), agrandissable en
/// plein écran au tap.
const double imageThumbnailSize = 220;

class ImageMessageBubbleContent extends StatelessWidget {
  final Message message;
  final bool own;

  const ImageMessageBubbleContent({super.key, required this.message, required this.own});

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final attachment = message.attachments.isEmpty ? null : message.attachments.first;
    if (attachment == null) {
      return SizedBox(
        width: imageThumbnailSize,
        height: imageThumbnailSize,
        child: Center(child: Icon(Icons.broken_image_outlined, color: c.muted)),
      );
    }
    final url = resolveMediaUrl(attachment.url);
    final headers = mediaHeaders(attachment.url);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        GestureDetector(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => _FullscreenImageViewer(url: url, headers: headers)),
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: SizedBox(
              width: imageThumbnailSize,
              height: imageThumbnailSize,
              child: CachedNetworkImage(
                imageUrl: url,
                httpHeaders: headers,
                fit: BoxFit.cover,
                placeholder: (context, url) => Container(
                  color: c.border,
                  child: const Center(child: CircularProgressIndicator(strokeWidth: 2)),
                ),
                errorWidget: (context, url, error) => Container(
                  color: c.border,
                  child: Icon(Icons.broken_image_outlined, color: c.muted),
                ),
              ),
            ),
          ),
        ),
        if (message.text != null && message.text!.isNotEmpty) ...[
          const SizedBox(height: 6),
          // Jamais de fond coloré sous une image (voir MessageBubbleWidget,
          // `isBareImage`) — la légende utilise donc toujours la couleur de
          // texte normale, jamais `accentContrast` (pensée pour un fond dégradé).
          Text(message.text!, style: TextStyle(fontSize: 14, color: c.foreground)),
        ],
      ],
    );
  }
}

class _FullscreenImageViewer extends StatelessWidget {
  final String url;
  final Map<String, String> headers;
  const _FullscreenImageViewer({required this.url, required this.headers});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      extendBodyBehindAppBar: true,
      body: Center(
        child: InteractiveViewer(
          minScale: 0.5,
          maxScale: 4,
          child: CachedNetworkImage(
            imageUrl: url,
            httpHeaders: headers,
            fit: BoxFit.contain,
            errorWidget: (context, url, error) =>
                const Icon(Icons.broken_image_outlined, color: Colors.white, size: 48),
          ),
        ),
      ),
    );
  }
}
