import 'dart:async';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:video_player/video_player.dart';
import '../../core/format.dart';
import '../../core/media.dart';
import '../../models/status.dart';
import '../../services/api_client.dart';
import '../../widgets/avatar.dart';

const _autoAdvanceDuration = Duration(seconds: 6);
const _timedTypes = {StatusType.text, StatusType.image};

/// Port de `StatusViewer.tsx` : lecteur plein écran façon "story" — barres de
/// progression en tête, avance automatique pour texte/image, sur la fin de
/// lecture réelle pour vidéo/vocal, zones tap gauche/droite pour
/// reculer/avancer, "Vu par" + suppression pour ses propres statuts.
class StatusViewerScreen extends StatefulWidget {
  /// Les statuts d'un seul auteur, du plus ancien au plus récent.
  final List<AppStatus> statuses;
  final int startIndex;
  final void Function(String statusId) onDeleted;

  const StatusViewerScreen({
    super.key,
    required this.statuses,
    required this.startIndex,
    required this.onDeleted,
  });

  @override
  State<StatusViewerScreen> createState() => _StatusViewerScreenState();
}

class _StatusViewerScreenState extends State<StatusViewerScreen> {
  late List<AppStatus> _statuses = widget.statuses;
  late int _index = widget.startIndex;
  double _progress = 0;
  bool _paused = false;
  bool _viewsOpen = false;
  Timer? _timer;
  final Set<String> _viewedIds = {};

  VideoPlayerController? _videoController;
  final _audioPlayer = AudioPlayer();

  AppStatus get _current => _statuses[_index];

  @override
  void initState() {
    super.initState();
    _audioPlayer.playerStateStream.listen((s) {
      if (s.processingState == ProcessingState.completed) _next();
    });
    _loadCurrent();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _videoController?.dispose();
    _audioPlayer.dispose();
    super.dispose();
  }

  void _loadCurrent() {
    _timer?.cancel();
    _videoController?.dispose();
    _videoController = null;
    _progress = 0;

    final current = _current;
    if (!current.isMine && !_viewedIds.contains(current.id)) {
      _viewedIds.add(current.id);
      ApiClient.instance.markStatusViewed(current.id).catchError((_) {});
    }

    if (current.type == StatusType.video && current.mediaUrl != null) {
      final url = resolveMediaUrl(current.mediaUrl!);
      final controller = VideoPlayerController.networkUrl(
        Uri.parse(url),
        httpHeaders: mediaHeaders(current.mediaUrl!),
      );
      _videoController = controller;
      controller.initialize().then((_) {
        if (!mounted) return;
        controller.play();
        setState(() {});
      });
      controller.addListener(_onVideoTick);
    } else if (current.type == StatusType.voice && current.mediaUrl != null) {
      _audioPlayer
          .setUrl(resolveMediaUrl(current.mediaUrl!), headers: mediaHeaders(current.mediaUrl!))
          .then((_) => _audioPlayer.play());
    } else if (_timedTypes.contains(current.type)) {
      _startAutoAdvance();
    }
    setState(() {});
  }

  void _onVideoTick() {
    final controller = _videoController;
    if (controller == null || !mounted) return;
    final value = controller.value;
    if (value.duration.inMilliseconds > 0) {
      setState(() => _progress = value.position.inMilliseconds / value.duration.inMilliseconds);
    }
    if (value.position >= value.duration && value.duration > Duration.zero) {
      _next();
    }
  }

  void _startAutoAdvance() {
    final start = DateTime.now().subtract(_autoAdvanceDuration * _progress);
    _timer = Timer.periodic(const Duration(milliseconds: 50), (_) {
      if (_paused || _viewsOpen) return;
      final elapsed = DateTime.now().difference(start);
      final ratio = (elapsed.inMilliseconds / _autoAdvanceDuration.inMilliseconds).clamp(0.0, 1.0);
      setState(() => _progress = ratio);
      if (ratio >= 1) _next();
    });
  }

  void _next() {
    if (_index < _statuses.length - 1) {
      setState(() {
        _index++;
        _viewsOpen = false;
      });
      _loadCurrent();
    } else {
      Navigator.of(context).pop();
    }
  }

  void _prev() {
    if (_index > 0) {
      setState(() {
        _index--;
        _viewsOpen = false;
      });
      _loadCurrent();
    }
  }

  Future<void> _delete() async {
    final id = _current.id;
    try {
      await ApiClient.instance.deleteStatus(id);
      widget.onDeleted(id);
      final remaining = _statuses.where((s) => s.id != id).toList();
      if (remaining.isEmpty) {
        if (mounted) Navigator.of(context).pop();
        return;
      }
      setState(() {
        _statuses = remaining;
        _index = _index.clamp(0, _statuses.length - 1);
      });
      _loadCurrent();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _openViews() async {
    setState(() {
      _paused = true;
      _viewsOpen = true;
    });
    final id = _current.id;
    try {
      final views = await ApiClient.instance.statusViews(id);
      if (mounted && _current.id == id) setState(() => _views = views);
    } catch (_) {
      if (mounted) setState(() => _views = const []);
    }
  }

  List<StatusView>? _views;

  @override
  Widget build(BuildContext context) {
    final current = _current;
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(
          children: [
            GestureDetector(
              onTapDown: (details) {
                final width = MediaQuery.of(context).size.width;
                if (details.globalPosition.dx < width / 2) {
                  _prev();
                } else {
                  _next();
                }
              },
              onLongPressStart: (_) => setState(() => _paused = true),
              onLongPressEnd: (_) => setState(() => _paused = false),
              child: Container(
                width: double.infinity,
                height: double.infinity,
                color: Colors.black,
                child: Center(child: _buildContent(current)),
              ),
            ),
            Positioned(
              top: 8,
              left: 8,
              right: 8,
              child: Row(
                children: [
                  for (var i = 0; i < _statuses.length; i++) ...[
                    if (i > 0) const SizedBox(width: 4),
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(2),
                        child: LinearProgressIndicator(
                          value: i < _index
                              ? 1
                              : i == _index
                                  ? (_timedTypes.contains(current.type) ? _progress : 1)
                                  : 0,
                          minHeight: 3,
                          backgroundColor: Colors.white24,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
            Positioned(
              top: 24,
              left: 12,
              right: 12,
              child: Row(
                children: [
                  GlottaAvatar(
                    firstName: current.author.firstName,
                    lastName: current.author.lastName,
                    avatarUrl: current.author.avatarUrl,
                    size: 36,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          current.author.displayName,
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13.5),
                        ),
                        Text(
                          shortRelativeTime(current.createdAt),
                          style: const TextStyle(color: Colors.white70, fontSize: 11.5),
                        ),
                      ],
                    ),
                  ),
                  if (current.isMine)
                    TextButton(
                      onPressed: _delete,
                      child: const Text('Supprimer', style: TextStyle(color: Colors.white70)),
                    ),
                  IconButton(
                    icon: const Icon(Icons.close, color: Colors.white),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),
            if (current.isMine && current.viewCount != null)
              Positioned(
                left: 12,
                right: 12,
                bottom: 16,
                child: GestureDetector(
                  onTap: _openViews,
                  child: Container(
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    decoration: BoxDecoration(color: Colors.black45, borderRadius: BorderRadius.circular(999)),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.remove_red_eye_outlined, size: 15, color: Colors.white),
                        const SizedBox(width: 6),
                        Text(
                          '${current.viewCount} vue${current.viewCount == 1 ? '' : 's'}',
                          style: const TextStyle(color: Colors.white, fontSize: 13),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            if (_viewsOpen)
              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                child: GestureDetector(
                  onTap: () {},
                  child: Container(
                    constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.55),
                    padding: const EdgeInsets.all(16),
                    decoration: const BoxDecoration(
                      color: Color(0xFF1E1E22),
                      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            const Expanded(
                              child: Text('Vu par', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                            ),
                            IconButton(
                              icon: const Icon(Icons.close, color: Colors.white70, size: 18),
                              onPressed: () => setState(() {
                                _viewsOpen = false;
                                _paused = false;
                              }),
                            ),
                          ],
                        ),
                        Flexible(
                          child: _views == null
                              ? const Padding(
                                  padding: EdgeInsets.symmetric(vertical: 16),
                                  child: Center(child: CircularProgressIndicator()),
                                )
                              : _views!.isEmpty
                                  ? const Padding(
                                      padding: EdgeInsets.symmetric(vertical: 16),
                                      child: Text('Personne pour l’instant.', style: TextStyle(color: Colors.white70)),
                                    )
                                  : ListView.builder(
                                      shrinkWrap: true,
                                      itemCount: _views!.length,
                                      itemBuilder: (context, i) {
                                        final v = _views![i];
                                        return Padding(
                                          padding: const EdgeInsets.symmetric(vertical: 6),
                                          child: Row(
                                            children: [
                                              GlottaAvatar(
                                                firstName: v.viewer.firstName,
                                                lastName: v.viewer.lastName,
                                                avatarUrl: v.viewer.avatarUrl,
                                                size: 32,
                                              ),
                                              const SizedBox(width: 10),
                                              Expanded(
                                                child: Text(
                                                  v.viewer.displayName,
                                                  style: const TextStyle(color: Colors.white, fontSize: 13.5),
                                                ),
                                              ),
                                              Text(
                                                shortRelativeTime(v.viewedAt),
                                                style: const TextStyle(color: Colors.white54, fontSize: 11.5),
                                              ),
                                            ],
                                          ),
                                        );
                                      },
                                    ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildContent(AppStatus current) {
    switch (current.type) {
      case StatusType.text:
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Text(
            current.text ?? '',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w600),
          ),
        );
      case StatusType.image:
        if (current.mediaUrl == null) return const _EmptyContent();
        final url = resolveMediaUrl(current.mediaUrl!);
        return Stack(
          alignment: Alignment.bottomCenter,
          children: [
            CachedNetworkImage(
              imageUrl: url,
              httpHeaders: mediaHeaders(current.mediaUrl!),
              fit: BoxFit.contain,
              errorWidget: (context, url, error) =>
                  const Icon(Icons.broken_image_outlined, color: Colors.white38, size: 48),
            ),
            if (current.text != null && current.text!.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 64, left: 16, right: 16),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(color: Colors.black45, borderRadius: BorderRadius.circular(12)),
                  child: Text(current.text!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white)),
                ),
              ),
          ],
        );
      case StatusType.video:
        final controller = _videoController;
        if (controller == null || !controller.value.isInitialized) {
          return const CircularProgressIndicator(color: Colors.white);
        }
        return AspectRatio(aspectRatio: controller.value.aspectRatio, child: VideoPlayer(controller));
      case StatusType.voice:
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.graphic_eq, color: Colors.white, size: 64),
            if (current.text != null && current.text!.isNotEmpty) ...[
              const SizedBox(height: 16),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 32),
                child: Text(current.text!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70)),
              ),
            ],
          ],
        );
    }
  }
}

class _EmptyContent extends StatelessWidget {
  const _EmptyContent();

  @override
  Widget build(BuildContext context) {
    return const Text('Ce statut n’a pas de contenu.', style: TextStyle(color: Colors.white70));
  }
}

extension on StatusAuthor {
  String get displayName {
    final full = '$firstName $lastName'.trim();
    return full.isEmpty ? username : full;
  }
}
