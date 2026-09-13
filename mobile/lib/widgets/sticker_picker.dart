import 'package:flutter/material.dart';
import '../core/sticker_emojis.dart';
import '../core/theme.dart';
import '../services/api_client.dart';

/// Port de `StickerPicker.tsx` : favoris en haut (étoile pour
/// ajouter/retirer), puis la grille complète — sélectionner envoie tout de
/// suite, jamais de bouton "envoyer" séparé.
class StickerPickerSheet extends StatefulWidget {
  final void Function(String emoji) onSelect;

  const StickerPickerSheet({super.key, required this.onSelect});

  @override
  State<StickerPickerSheet> createState() => _StickerPickerSheetState();
}

class _StickerPickerSheetState extends State<StickerPickerSheet> {
  List<String> _favorites = [];

  @override
  void initState() {
    super.initState();
    ApiClient.instance.favoriteStickers().then((list) {
      if (mounted) setState(() => _favorites = list);
    }).catchError((_) {});
  }

  Future<void> _toggleFavorite(String emoji) async {
    final isFavorite = _favorites.contains(emoji);
    setState(() {
      _favorites = isFavorite ? _favorites.where((e) => e != emoji).toList() : [..._favorites, emoji];
    });
    try {
      if (isFavorite) {
        await ApiClient.instance.removeFavoriteSticker(emoji);
      } else {
        await ApiClient.instance.addFavoriteSticker(emoji);
      }
    } catch (_) {
      // best-effort, comme côté web.
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return SafeArea(
      child: SizedBox(
        height: 380,
        child: Column(
          children: [
            if (_favorites.isNotEmpty) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    'FAVORIS',
                    style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: c.muted, letterSpacing: 0.4),
                  ),
                ),
              ),
              SizedBox(
                height: 52,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  children: _favorites
                      .map((emoji) => _StickerTile(
                            emoji: emoji,
                            isFavorite: true,
                            onSelect: () => widget.onSelect(emoji),
                            onToggleFavorite: () => _toggleFavorite(emoji),
                          ))
                      .toList(),
                ),
              ),
              Divider(color: c.border, height: 1),
            ],
            Expanded(
              child: GridView.builder(
                padding: const EdgeInsets.all(12),
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 8),
                itemCount: stickerEmojis.length,
                itemBuilder: (context, index) {
                  final emoji = stickerEmojis[index];
                  return _StickerTile(
                    emoji: emoji,
                    isFavorite: _favorites.contains(emoji),
                    onSelect: () => widget.onSelect(emoji),
                    onToggleFavorite: () => _toggleFavorite(emoji),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StickerTile extends StatelessWidget {
  final String emoji;
  final bool isFavorite;
  final VoidCallback onSelect;
  final VoidCallback onToggleFavorite;

  const _StickerTile({
    required this.emoji,
    required this.isFavorite,
    required this.onSelect,
    required this.onToggleFavorite,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return GestureDetector(
      onTap: onSelect,
      onLongPress: onToggleFavorite,
      child: Container(
        margin: const EdgeInsets.all(2),
        alignment: Alignment.center,
        child: Stack(
          alignment: Alignment.center,
          children: [
            Text(emoji, style: const TextStyle(fontSize: 26)),
            if (isFavorite)
              Positioned(
                bottom: -2,
                right: -2,
                child: Icon(Icons.star, size: 10, color: c.accent2),
              ),
          ],
        ),
      ),
    );
  }
}
