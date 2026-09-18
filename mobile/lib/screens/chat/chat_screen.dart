import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/theme.dart';
import '../../models/call.dart';
import '../../models/conversation.dart';
import '../../models/message.dart';
import '../../services/call_service.dart';
import '../../services/voice_recorder.dart';
import '../../state/auth_state.dart';
import '../../state/chat_state.dart';
import '../../state/conversations_state.dart';
import '../../widgets/avatar.dart';
import '../../widgets/message_bubble.dart';
import '../../widgets/sticker_picker.dart';

/// Port de `ChatWindow.tsx` (tranche texte + vocal + image) : en-tête
/// (retour, avatar, nom + statut, actions), séparateurs de date, avatar
/// affiché seulement au changement d'expéditeur (voir `_buildRows`), champ
/// de saisie avec les mêmes 4 boutons que le web (photo/position/sticker/
/// micro, toujours visibles, jamais substitués l'un à l'autre). Appel,
/// recherche dans la conversation et panneau d'info suivent le même patron
/// que le rail (`IconRail`) pour les fonctionnalités pas encore portées :
/// bouton visible mais désactivé, jamais retiré ni simulé.
class ChatScreen extends ConsumerStatefulWidget {
  final String conversationId;
  const ChatScreen({super.key, required this.conversationId});

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatRow {
  final Message message;
  final String? dayLabel;
  final bool showAvatar;
  const _ChatRow({required this.message, this.dayLabel, required this.showAvatar});
}

String _dayLabel(DateTime date) {
  final now = DateTime.now();
  final d = date.toLocal();
  bool sameDay(DateTime a, DateTime b) => a.year == b.year && a.month == b.month && a.day == b.day;
  if (sameDay(d, now)) return "Aujourd'hui";
  final yesterday = now.subtract(const Duration(days: 1));
  if (sameDay(d, yesterday)) return 'Hier';
  const weekdays = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  if (now.difference(d).inDays < 7) return weekdays[d.weekday - 1];
  return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}/${d.year}';
}

List<_ChatRow> _buildRows(List<Message> messages) {
  final rows = <_ChatRow>[];
  Message? prev;
  for (final m in messages) {
    final needsDaySeparator = prev == null || !_sameLocalDay(prev.sentAt, m.sentAt);
    rows.add(_ChatRow(
      message: m,
      dayLabel: needsDaySeparator ? _dayLabel(m.sentAt) : null,
      showAvatar: prev == null || prev.senderId != m.senderId,
    ));
    prev = m;
  }
  return rows;
}

bool _sameLocalDay(DateTime a, DateTime b) {
  final la = a.toLocal();
  final lb = b.toLocal();
  return la.year == lb.year && la.month == lb.month && la.day == lb.day;
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  final _recorder = VoiceRecorderService();
  bool _hasText = false;
  bool _recording = false;
  int _recordSeconds = 0;
  Timer? _recordTicker;

  @override
  void initState() {
    super.initState();
    _input.addListener(() {
      final has = _input.text.trim().isNotEmpty;
      if (has != _hasText) setState(() => _hasText = has);
    });
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    _recordTicker?.cancel();
    _recorder.dispose();
    super.dispose();
  }

  void _notAvailable(String label) {
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text('$label — bientôt disponible.')));
  }

  /// CallScreen s'ouvre tout seul dès que `CallService.phase` quitte "idle"
  /// (voir HomeShell, monté une seule fois au-dessus de tout le rail —
  /// jamais poussé directement d'ici, un appel entrant doit pouvoir sonner
  /// quel que soit l'écran affiché).
  void _startCall(String calleeId, CallKind kind) {
    CallService.instance.start(widget.conversationId, calleeId, kind);
  }

  Future<void> _startRecording() async {
    try {
      await _recorder.start();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Micro inaccessible — vérifiez les autorisations.')),
        );
      }
      return;
    }
    setState(() {
      _recording = true;
      _recordSeconds = 0;
    });
    _recordTicker = Timer.periodic(const Duration(seconds: 1), (_) {
      setState(() => _recordSeconds++);
      if (_recordSeconds >= maxVoiceDurationSeconds) _stopRecordingAndSend();
    });
  }

  Future<void> _stopRecordingAndSend() async {
    if (!_recording) return;
    _recordTicker?.cancel();
    setState(() => _recording = false);
    final result = await _recorder.stop();
    if (result != null) {
      ref
          .read(chatProvider(widget.conversationId).notifier)
          .sendVoice(result.filePath, result.durationSeconds);
      _scrollToBottomSoon();
    }
  }

  Future<void> _cancelRecording() async {
    _recordTicker?.cancel();
    setState(() => _recording = false);
    await _recorder.cancel();
  }

  Future<void> _pickImage(ImageSource source) async {
    final picked = await ImagePicker().pickImage(source: source, imageQuality: 85);
    if (picked == null) return;
    final caption = _input.text.trim();
    _input.clear();
    ref.read(chatProvider(widget.conversationId).notifier).sendImage(
          picked.path,
          text: caption.isEmpty ? null : caption,
        );
    _scrollToBottomSoon();
  }

  Future<void> _shareCurrentLocation() async {
    try {
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        _notAvailable('Accès à la position refusé');
        return;
      }
      if (!await Geolocator.isLocationServiceEnabled()) {
        _notAvailable('Position désactivée sur cet appareil');
        return;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.medium),
      );
      ref
          .read(chatProvider(widget.conversationId).notifier)
          .sendLocation(position.latitude, position.longitude);
      _scrollToBottomSoon();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Impossible de récupérer votre position.')));
      }
    }
  }

  void _openStickerPicker() {
    showModalBottomSheet<void>(
      context: context,
      builder: (sheetContext) => StickerPickerSheet(
        onSelect: (emoji) {
          Navigator.of(sheetContext).pop();
          ref.read(chatProvider(widget.conversationId).notifier).sendSticker(emoji);
          _scrollToBottomSoon();
        },
      ),
    );
  }

  void _openAttachSheet() {
    showModalBottomSheet<void>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Prendre une photo'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                _pickImage(ImageSource.camera);
              },
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choisir dans la galerie'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                _pickImage(ImageSource.gallery);
              },
            ),
            ListTile(
              leading: const Icon(Icons.location_on_outlined),
              title: const Text('Position'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                _shareCurrentLocation();
              },
            ),
          ],
        ),
      ),
    );
  }

  void _scrollToBottomSoon() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    });
  }

  void _send() {
    final text = _input.text;
    if (text.trim().isEmpty) return;
    _input.clear();
    ref.read(chatProvider(widget.conversationId).notifier).send(text);
    _scrollToBottomSoon();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final chat = ref.watch(chatProvider(widget.conversationId));
    final me = ref.watch(authProvider).me;
    final conversations = ref.watch(conversationsProvider).items;
    final Conversation? conversation =
        conversations.where((cv) => cv.id == widget.conversationId).firstOrNull;
    final other = conversation?.otherParticipant;
    final title = conversation?.displayTitle('Conversation') ?? 'Conversation';
    final isGroup = conversation?.type == ConversationType.group;

    ref.listen(chatProvider(widget.conversationId), (previous, next) {
      if ((previous?.messages.length ?? 0) < next.messages.length) _scrollToBottomSoon();
    });

    final isTyping = chat.typingUserIds.isNotEmpty;
    final rows = _buildRows(chat.messages);

    return Scaffold(
      backgroundColor: c.background,
      appBar: AppBar(
        titleSpacing: 0,
        leadingWidth: 40,
        title: Row(
          children: [
            if (other != null)
              GlottaAvatar(
                firstName: other.firstName,
                lastName: other.lastName,
                avatarUrl: other.avatarUrl,
                online: other.isOnline,
                size: 36,
              )
            else
              GlottaAvatar(firstName: title, avatarUrl: conversation?.photoUrl, size: 36),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                  ),
                  Text(
                    isTyping
                        ? "en train d'écrire..."
                        : other?.isOnline == true
                            ? 'en ligne'
                            : '',
                    style: TextStyle(fontSize: 11.5, color: isTyping ? c.accent2 : c.muted),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.call_outlined, size: 20),
            onPressed: other == null ? () => _notAvailable('Appel de groupe') : () => _startCall(other.id, CallKind.audio),
          ),
          IconButton(
            icon: const Icon(Icons.videocam_outlined, size: 20),
            onPressed: other == null ? () => _notAvailable('Appel vidéo de groupe') : () => _startCall(other.id, CallKind.video),
          ),
          IconButton(
            icon: const Icon(Icons.search, size: 20),
            onPressed: () => _notAvailable('Recherche dans la conversation'),
          ),
          IconButton(
            icon: const Icon(Icons.grid_view_outlined, size: 20),
            onPressed: () => _notAvailable('Infos de la conversation'),
          ),
        ],
      ),
      body: Column(
        children: [
          if (chat.pinnedMessages.isNotEmpty) _pinnedBanner(c, chat.pinnedMessages),
          Expanded(
            child: chat.loading
                ? const Center(child: CircularProgressIndicator())
                : chat.messages.isEmpty
                    ? Center(
                        child: Text('Aucun message. Dites bonjour !', style: TextStyle(color: c.muted)),
                      )
                    : NotificationListener<ScrollNotification>(
                        onNotification: (notification) {
                          if (notification is ScrollUpdateNotification &&
                              _scroll.position.pixels <= 40 &&
                              chat.nextCursor != null) {
                            ref.read(chatProvider(widget.conversationId).notifier).loadMore();
                          }
                          return false;
                        },
                        child: ListView.builder(
                          controller: _scroll,
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                          itemCount: rows.length,
                          itemBuilder: (context, index) {
                            final row = rows[index];
                            return Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                if (row.dayLabel != null)
                                  Padding(
                                    padding: const EdgeInsets.symmetric(vertical: 10),
                                    child: Center(
                                      child: Container(
                                        padding:
                                            const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                                        decoration: BoxDecoration(
                                          color: c.surfaceRaised,
                                          borderRadius: BorderRadius.circular(999),
                                        ),
                                        child: Text(
                                          row.dayLabel!,
                                          style: TextStyle(fontSize: 11.5, color: c.muted),
                                        ),
                                      ),
                                    ),
                                  ),
                                MessageBubbleWidget(
                                  message: row.message,
                                  own: row.message.senderId == me?.id,
                                  showAvatar: row.showAvatar,
                                  isGroup: isGroup,
                                  sender: row.message.senderId == other?.id ? other : null,
                                  myUserId: me?.id,
                                  onRequestTranslation: (messageId, languageCode) => ref
                                      .read(chatProvider(widget.conversationId).notifier)
                                      .requestTranslation(messageId, languageCode),
                                  onReact: (messageId, emoji) {
                                    if (me != null) {
                                      ref
                                          .read(chatProvider(widget.conversationId).notifier)
                                          .toggleReaction(messageId, emoji, me.id);
                                    }
                                  },
                                  onReply: (message) => ref
                                      .read(chatProvider(widget.conversationId).notifier)
                                      .setReplyingTo(message),
                                  onDeleteForMe: (messageId) => ref
                                      .read(chatProvider(widget.conversationId).notifier)
                                      .deleteForMe(messageId),
                                  onDeleteForEveryone: (messageId) => ref
                                      .read(chatProvider(widget.conversationId).notifier)
                                      .deleteForEveryone(messageId),
                                  onTogglePin: (messageId, currentlyPinned) => ref
                                      .read(chatProvider(widget.conversationId).notifier)
                                      .togglePin(messageId, currentlyPinned),
                                  onRetry: (messageId) => ref
                                      .read(chatProvider(widget.conversationId).notifier)
                                      .retry(messageId),
                                ),
                              ],
                            );
                          },
                        ),
                      ),
          ),
          if (chat.replyingTo != null) _replyPreviewBar(c, chat.replyingTo!, me?.id),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(6, 8, 10, 8),
              child: _recording ? _recordingRow(c) : _composerRow(c),
            ),
          ),
        ],
      ),
    );
  }

  /// "Messages épinglés" (section 20) — affiche le plus récemment épinglé,
  /// un tap saute à son emplacement dans l'historique (voir
  /// ChatNotifier.jumpToMessage, réutilise l'endpoint déjà construit pour
  /// sauter à un résultat de recherche).
  Widget _pinnedBanner(GlottaColors c, List<Message> pinned) {
    final top = pinned.first;
    String preview;
    switch (top.type) {
      case MessageType.voice:
        preview = '🎤 Message vocal';
      case MessageType.image:
        preview = '📷 Photo';
      default:
        preview = top.text ?? 'Message épinglé';
    }
    return InkWell(
      onTap: () =>
          ref.read(chatProvider(widget.conversationId).notifier).jumpToMessage(top.id),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: c.surfaceRaised.withValues(alpha: 0.6),
          border: Border(bottom: BorderSide(color: c.border)),
        ),
        child: Row(
          children: [
            Icon(Icons.push_pin, size: 15, color: c.accent2),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    pinned.length > 1 ? '${pinned.length} messages épinglés' : 'Message épinglé',
                    style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: c.accent2),
                  ),
                  Text(
                    preview,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 11.5, color: c.muted),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _replyPreviewBar(GlottaColors c, Message replyingTo, String? myUserId) {
    final label = replyingTo.senderId == myUserId ? 'Vous' : 'Réponse';
    String preview;
    switch (replyingTo.type) {
      case MessageType.voice:
        preview = '🎤 Message vocal';
      case MessageType.image:
        preview = '📷 Photo';
      default:
        preview = replyingTo.text ?? 'Message';
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: c.surfaceRaised.withValues(alpha: 0.6),
        border: Border(top: BorderSide(color: c.border)),
      ),
      child: Row(
        children: [
          Icon(Icons.reply, size: 16, color: c.accent2),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: c.accent2)),
                Text(preview, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 11.5, color: c.muted)),
              ],
            ),
          ),
          IconButton(
            icon: Icon(Icons.close, size: 16, color: c.muted),
            onPressed: () => ref.read(chatProvider(widget.conversationId).notifier).setReplyingTo(null),
          ),
        ],
      ),
    );
  }

  Widget _recordingRow(GlottaColors c) => Row(
        children: [
          IconButton(
            icon: Icon(Icons.close, color: c.muted),
            onPressed: _cancelRecording,
          ),
          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                color: c.surfaceRaised,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: c.border),
              ),
              child: Row(
                children: [
                  Container(
                    width: 9,
                    height: 9,
                    decoration: BoxDecoration(color: c.danger, shape: BoxShape.circle),
                  ),
                  const SizedBox(width: 8),
                  Text('Enregistrement...', style: TextStyle(color: c.foreground, fontSize: 13.5)),
                  const Spacer(),
                  Text(
                    '${_recordSeconds ~/ 60}:${(_recordSeconds % 60).toString().padLeft(2, '0')}',
                    style: TextStyle(color: c.muted, fontSize: 13),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 8),
          DecoratedBox(
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(colors: [c.accent, c.accent2]),
            ),
            child: IconButton(
              icon: Icon(Icons.send, size: 16, color: c.accentContrast),
              onPressed: _stopRecordingAndSend,
            ),
          ),
        ],
      );

  /// Barre de saisie façon WhatsApp : une seule pastille arrondie contenant
  /// [émoji][champ de texte][trombone][caméra], puis un bouton circulaire
  /// séparé (micro tenu appuyé pour enregistrer / envoi dès qu'il y a du
  /// texte) — jamais 4 icônes alignées à égalité comme sur le web, qui
  /// n'est plus la référence demandée pour cet écran précis.
  Widget _composerRow(GlottaColors c) => Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Container(
              padding: const EdgeInsets.only(left: 4, right: 4),
              decoration: BoxDecoration(
                color: c.surfaceRaised,
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: c.border),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  IconButton(
                    icon: Icon(Icons.emoji_emotions_outlined, size: 22, color: c.muted),
                    onPressed: _openStickerPicker,
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: TextField(
                        controller: _input,
                        minLines: 1,
                        maxLines: 5,
                        textCapitalization: TextCapitalization.sentences,
                        onChanged: (_) =>
                            ref.read(chatProvider(widget.conversationId).notifier).emitTyping(),
                        decoration: const InputDecoration(
                          hintText: 'Message',
                          isCollapsed: true,
                          border: InputBorder.none,
                          contentPadding: EdgeInsets.zero,
                        ),
                      ),
                    ),
                  ),
                  IconButton(
                    icon: Icon(Icons.attach_file, size: 20, color: c.muted),
                    onPressed: _openAttachSheet,
                  ),
                  IconButton(
                    icon: Icon(Icons.photo_camera_outlined, size: 20, color: c.muted),
                    onPressed: () => _pickImage(ImageSource.camera),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 6),
          DecoratedBox(
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(colors: [c.accent, c.accent2]),
            ),
            child: _hasText
                ? IconButton(
                    icon: Icon(Icons.send, size: 18, color: c.accentContrast),
                    onPressed: _send,
                  )
                : GestureDetector(
                    onLongPressStart: (_) => _startRecording(),
                    onLongPressEnd: (_) => _stopRecordingAndSend(),
                    child: IconButton(
                      icon: Icon(Icons.mic, size: 18, color: c.accentContrast),
                      onPressed: () {},
                    ),
                  ),
          ),
        ],
      );
}

extension _FirstOrNull<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}
