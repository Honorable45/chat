import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../models/conversation.dart';
import '../models/message.dart';
import '../state/chat_state.dart' show allowedReactionEmojis;
import 'avatar.dart';
import 'image_message_bubble.dart';
import 'location_message_bubble.dart';
import 'voice_message_bubble.dart';

/// Disposition façon WhatsApp (demande explicite : "la partie de discussion
/// comme pour WhatsApp exactement"), couleurs Glotta conservées (dégradé
/// accent→accent-2 pour mes messages, `surfaceRaised` pour les autres — pas
/// le vert WhatsApp) :
/// - bulle avec petite pointe (voir `_BubbleTail`) sur le premier message
///   d'une série consécutive du même expéditeur seulement ;
/// - heure + coche de lecture à l'INTÉRIEUR de la bulle, en bas à droite,
///   dans le prolongement du texte (voir `_TextBubbleBody`) plutôt qu'en
///   dessous sur sa propre ligne ;
/// - fond à motifs volontairement absent (spécifique à la marque WhatsApp,
///   hors de la question posée sur les couleurs).
class MessageBubbleWidget extends StatelessWidget {
  final Message message;
  final bool own;
  /// Faux pour tout message d'une série consécutive du même expéditeur sauf
  /// le premier — voir `_buildRows` dans ChatScreen. Détermine aussi la
  /// pointe de la bulle (uniquement sur le premier message d'une série).
  final bool showAvatar;
  final bool isGroup;
  final ConversationParticipant? sender;
  final String? myUserId;
  final void Function(String messageId, String languageCode)? onRequestTranslation;
  final void Function(String messageId, String emoji)? onReact;
  final void Function(Message message)? onReply;

  const MessageBubbleWidget({
    super.key,
    required this.message,
    required this.own,
    this.showAvatar = true,
    this.isGroup = false,
    this.sender,
    this.myUserId,
    this.onRequestTranslation,
    this.onReact,
    this.onReply,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;

    if (message.type == MessageType.system) {
      return Center(
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 6),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
          decoration: BoxDecoration(color: c.surfaceRaised, borderRadius: BorderRadius.circular(999)),
          child: Text(
            'Le groupe a été mis à jour',
            style: TextStyle(fontSize: 11.5, color: c.muted),
          ),
        ),
      );
    }

    const bigRadius = Radius.circular(14);
    const tailCornerRadius = Radius.circular(2);
    final hasTail = showAvatar;
    // Une image se suffit à elle-même (déjà un rectangle net, voir
    // ImageMessageBubbleContent) — jamais le fond dégradé/bordé des bulles
    // texte, qui ne ferait que déborder autour d'une vignette déjà carrée.
    final isBareImage = message.type == MessageType.image && message.attachments.isNotEmpty;
    final isTextLike = message.type == MessageType.text && !isBareImage;

    final borderRadius = BorderRadius.only(
      topLeft: (!own && hasTail) ? tailCornerRadius : bigRadius,
      topRight: (own && hasTail) ? tailCornerRadius : bigRadius,
      bottomLeft: bigRadius,
      bottomRight: bigRadius,
    );

    Widget bubbleBox = Container(
      padding: isTextLike
          ? const EdgeInsets.fromLTRB(11, 7, 9, 7)
          : const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        gradient: own ? LinearGradient(colors: [c.accent, c.accent2]) : null,
        color: own ? null : c.surfaceRaised,
        border: own ? null : Border.all(color: c.border),
        borderRadius: borderRadius,
      ),
      child: isTextLike ? _TextBubbleBody(message: message, own: own) : _content(c),
    );

    if (isBareImage) {
      bubbleBox = _content(c);
    } else if (!isTextLike) {
      // Types non-texte (vocal, appel...) : heure/coche restent sous la
      // bulle, sur leur propre ligne — voir le commentaire de classe.
      bubbleBox = Column(
        crossAxisAlignment: own ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          bubbleBox,
          const SizedBox(height: 2),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 2),
            child: _Footer(message: message, own: own, color: c.muted, tickColor: c.accent2),
          ),
        ],
      );
    }

    final tailedBubble = Stack(
      clipBehavior: Clip.none,
      children: [
        bubbleBox,
        if (hasTail && !isBareImage)
          Positioned(
            top: 0,
            left: own ? null : -6,
            right: own ? -6 : null,
            child: _BubbleTail(own: own, color: own ? c.accent2 : c.surfaceRaised),
          ),
      ],
    );

    final bubbleColumn = Column(
      crossAxisAlignment: own ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      children: [
        if (isGroup && !own && showAvatar && sender != null)
          Padding(
            padding: const EdgeInsets.only(left: 4, bottom: 1),
            child: Text(
              sender!.displayName,
              style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: c.accent2),
            ),
          ),
        GestureDetector(
          onLongPress: () => _showActions(context),
          child: Column(
            crossAxisAlignment: own ? CrossAxisAlignment.end : CrossAxisAlignment.start,
            children: [
              if (message.replyTo != null)
                Container(
                  margin: const EdgeInsets.only(bottom: 3),
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                  decoration: BoxDecoration(
                    color: c.surfaceRaised.withValues(alpha: 0.7),
                    borderRadius: BorderRadius.circular(8),
                    border: Border(left: BorderSide(color: c.accent2, width: 3)),
                  ),
                  child: Text(
                    _replyPreview(message.replyTo!),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 11.5, color: c.muted),
                  ),
                ),
              tailedBubble,
            ],
          ),
        ),
        if (message.reactions.isNotEmpty) ...[
          const SizedBox(height: 3),
          _ReactionPills(
            reactions: message.reactions,
            myUserId: myUserId,
            onTap: (emoji) => onReact?.call(message.id, emoji),
          ),
        ],
      ],
    );

    final bubbleContent = Container(
      constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.76),
      child: bubbleColumn,
    );

    return Align(
      alignment: own ? Alignment.centerRight : Alignment.centerLeft,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 1.5),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            if (!own) ...[
              showAvatar && sender != null
                  ? GlottaAvatar(
                      firstName: sender!.firstName,
                      lastName: sender!.lastName,
                      avatarUrl: sender!.avatarUrl,
                      size: 24,
                    )
                  : const SizedBox(width: 24),
              const SizedBox(width: 6),
            ],
            bubbleContent,
          ],
        ),
      ),
    );
  }

  Widget _content(GlottaColors c) {
    final textColor = own ? c.accentContrast : c.foreground;
    switch (message.type) {
      case MessageType.text:
        return _TextBubbleBody(message: message, own: own);
      case MessageType.sticker:
        return Text(message.text ?? '🙂', style: const TextStyle(fontSize: 48));
      case MessageType.voice:
        final voice = message.voice;
        if (voice == null) {
          return SizedBox(
            width: 40,
            child: Center(
              child: SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2, color: textColor),
              ),
            ),
          );
        }
        return VoiceMessageBubbleContent(
          voice: voice,
          own: own,
          onRequestTranslation: (languageCode) => onRequestTranslation?.call(message.id, languageCode),
        );
      case MessageType.image:
        return message.attachments.isEmpty
            ? _placeholder(c, textColor, Icons.image_outlined, 'Photo')
            : ImageMessageBubbleContent(message: message, own: own);
      case MessageType.video:
        return _placeholder(c, textColor, Icons.videocam_outlined, 'Vidéo');
      case MessageType.mediaAlbum:
        return _placeholder(c, textColor, Icons.photo_library_outlined, 'Médias');
      case MessageType.call:
        return _placeholder(c, textColor, Icons.call_outlined, 'Appel');
      case MessageType.groupCall:
        return _placeholder(c, textColor, Icons.call_outlined, 'Appel de groupe');
      case MessageType.contactShare:
        return _placeholder(c, textColor, Icons.person_outline, 'Contact partagé');
      case MessageType.location:
        return LocationMessageBubbleContent(message: message, own: own);
      case MessageType.file:
        return _placeholder(c, textColor, Icons.insert_drive_file_outlined, 'Fichier');
      case MessageType.system:
      case MessageType.unknown:
        return Text(message.text ?? 'Message', style: TextStyle(fontSize: 14, color: textColor));
    }
  }

  Widget _placeholder(GlottaColors c, Color textColor, IconData icon, String label) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 18, color: textColor),
          const SizedBox(width: 8),
          Text(label, style: TextStyle(fontSize: 14, color: textColor)),
        ],
      );

  String _replyPreview(ReplyToSummary reply) {
    if (reply.deletedAt != null) return 'Message supprimé';
    switch (reply.type) {
      case MessageType.voice:
        return '🎤 Message vocal';
      case MessageType.image:
        return '📷 Photo';
      case MessageType.video:
        return '🎥 Vidéo';
      case MessageType.location:
        return '📍 Position';
      default:
        return reply.text ?? 'Message';
    }
  }

  void _showActions(BuildContext context) {
    if (onReact == null && onReply == null) return;
    final c = context.glotta;
    final myReaction =
        myUserId == null ? null : message.reactions.firstWhereOrNull((r) => r.userId == myUserId);
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: c.surfaceRaised,
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (onReact != null)
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    for (final emoji in allowedReactionEmojis)
                      GestureDetector(
                        onTap: () {
                          Navigator.of(sheetContext).pop();
                          onReact!(message.id, emoji);
                        },
                        child: Container(
                          padding: const EdgeInsets.all(6),
                          decoration: BoxDecoration(
                            color: myReaction?.emoji == emoji ? c.accent2.withValues(alpha: 0.15) : null,
                            shape: BoxShape.circle,
                          ),
                          child: Text(emoji, style: const TextStyle(fontSize: 26)),
                        ),
                      ),
                  ],
                ),
              if (onReply != null && message.type != MessageType.system) ...[
                const SizedBox(height: 8),
                ListTile(
                  leading: const Icon(Icons.reply),
                  title: const Text('Répondre'),
                  onTap: () {
                    Navigator.of(sheetContext).pop();
                    onReply!(message);
                  },
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Heure + coches — utilisé à la fois dans le pied de bulle inline (texte,
/// voir `_TextBubbleBody`) et sous la bulle pour les types non-texte.
class _Footer extends StatelessWidget {
  final Message message;
  final bool own;
  final Color color;
  final Color tickColor;

  const _Footer({required this.message, required this.own, required this.color, required this.tickColor});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(timeOfDay(message.sentAt), style: TextStyle(fontSize: 10.5, color: color)),
        if (own) ...[
          const SizedBox(width: 3),
          Icon(
            message.deliveredAt != null || message.readAt != null ? Icons.done_all : Icons.done,
            size: 13,
            color: message.readAt != null ? tickColor : color,
          ),
        ],
      ],
    );
  }
}

/// Reproduit la technique WhatsApp : l'heure/coche est ajoutée comme
/// `WidgetSpan` invisible à la fin du texte (réserve juste la place), puis
/// superposée en vrai en bas à droite via `Stack` — un texte court la
/// retrouve donc juste après le dernier mot, un texte qui remplit la ligne
/// la fait passer à la ligne suivante toute seule, exactement comme
/// WhatsApp. Jamais une simple ligne séparée en dessous (l'ancien rendu).
class _TextBubbleBody extends StatelessWidget {
  final Message message;
  final bool own;

  const _TextBubbleBody({required this.message, required this.own});

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final textColor = own ? c.accentContrast : c.foreground;
    final footerColor = own ? c.accentContrast.withValues(alpha: 0.75) : c.muted;

    return Stack(
      children: [
        Text.rich(
          TextSpan(
            children: [
              TextSpan(
                text: message.text ?? '',
                style: TextStyle(fontSize: 14.5, height: 1.35, color: textColor),
              ),
              const WidgetSpan(
                alignment: PlaceholderAlignment.middle,
                child: SizedBox(width: 52, height: 14),
              ),
            ],
          ),
        ),
        Positioned(
          right: 0,
          bottom: 0,
          child: _Footer(message: message, own: own, color: footerColor, tickColor: Colors.white),
        ),
      ],
    );
  }
}

/// Petite pointe de bulle (voir le commentaire de classe de
/// MessageBubbleWidget) — un simple triangle plein, pas la courbe bézier
/// exacte de WhatsApp : suffisant pour lire "bulle avec pointe" au premier
/// coup d'œil, sans risquer un calcul de tracé bézier fragile.
class _BubbleTail extends StatelessWidget {
  final bool own;
  final Color color;

  const _BubbleTail({required this.own, required this.color});

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: const Size(8, 10),
      painter: _TailPainter(own: own, color: color),
    );
  }
}

class _TailPainter extends CustomPainter {
  final bool own;
  final Color color;

  _TailPainter({required this.own, required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = color;
    final path = Path();
    if (own) {
      path.moveTo(0, 0);
      path.lineTo(size.width, 0);
      path.lineTo(size.width, size.height * 0.65);
      path.close();
    } else {
      path.moveTo(size.width, 0);
      path.lineTo(0, 0);
      path.lineTo(0, size.height * 0.65);
      path.close();
    }
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant _TailPainter oldDelegate) =>
      oldDelegate.color != color || oldDelegate.own != own;
}

class _ReactionPills extends StatelessWidget {
  final List<MessageReaction> reactions;
  final String? myUserId;
  final void Function(String emoji) onTap;

  const _ReactionPills({required this.reactions, required this.myUserId, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final counts = <String, int>{};
    for (final r in reactions) {
      counts[r.emoji] = (counts[r.emoji] ?? 0) + 1;
    }
    final myEmoji =
        myUserId == null ? null : reactions.firstWhereOrNull((r) => r.userId == myUserId)?.emoji;

    return Wrap(
      spacing: 4,
      runSpacing: 4,
      children: counts.entries.map((entry) {
        final mine = entry.key == myEmoji;
        return GestureDetector(
          onTap: () => onTap(entry.key),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
            decoration: BoxDecoration(
              color: mine ? c.accent2.withValues(alpha: 0.1) : c.surfaceRaised,
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: mine ? c.accent2 : c.border),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(entry.key, style: const TextStyle(fontSize: 12)),
                if (entry.value > 1) ...[
                  const SizedBox(width: 3),
                  Text('${entry.value}', style: TextStyle(fontSize: 10, color: c.muted)),
                ],
              ],
            ),
          ),
        );
      }).toList(),
    );
  }
}
