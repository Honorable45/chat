import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import '../core/theme.dart';
import '../models/language.dart';
import '../models/message.dart';
import '../services/api_client.dart';
import '../services/audio_playback_manager.dart';

/// Port de `VoiceMessageBubble.tsx` (tranche essentielle : lecture +
/// traduction à la demande) — bouton lecture/pause, durée, puis une liste de
/// puces une par langue déjà traduite/en cours/échouée, plus un bouton pour
/// en demander une nouvelle. Pas de forme d'onde (décorative uniquement côté
/// web) ni de transcription affichée en clair pour cette première passe.
///
/// Lecture centralisée via `AudioPlaybackManager` (section 2) : jamais son
/// propre `AudioPlayer` — lancer un vocal ici arrête automatiquement tout
/// autre vocal en cours de lecture ailleurs dans l'application (même dans
/// une autre conversation).
class VoiceMessageBubbleContent extends StatefulWidget {
  final VoiceDetails voice;
  final bool own;
  final void Function(String languageCode) onRequestTranslation;

  const VoiceMessageBubbleContent({
    super.key,
    required this.voice,
    required this.own,
    required this.onRequestTranslation,
  });

  @override
  State<VoiceMessageBubbleContent> createState() => _VoiceMessageBubbleContentState();
}

class _VoiceMessageBubbleContentState extends State<VoiceMessageBubbleContent> {
  final _manager = AudioPlaybackManager.instance;
  bool _playing = false;
  Duration _position = Duration.zero;
  Duration? _duration;

  @override
  void initState() {
    super.initState();
    // `_playing`/`_position` reflètent le lecteur PARTAGÉ tel quel — filtrés
    // par URL uniquement au moment de l'affichage (le principal, ou l'une
    // des puces de traduction), jamais figés sur `voice.audioUrl` ici :
    // sinon une puce de traduction en cours de lecture ne se distinguerait
    // jamais d'un vocal à l'arrêt.
    _manager.player.positionStream.listen((p) {
      if (mounted) setState(() => _position = p);
    });
    _manager.player.playerStateStream.listen((s) {
      if (!mounted) return;
      setState(() {
        _playing = s.playing && s.processingState != ProcessingState.completed;
        _duration = _manager.player.duration;
      });
    });
    _manager.currentUrl.addListener(_onManagerChanged);
  }

  void _onManagerChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _manager.currentUrl.removeListener(_onManagerChanged);
    super.dispose();
  }

  Future<void> _toggle(String url) async {
    try {
      await _manager.toggle(url);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Lecture impossible.')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final textColor = widget.own ? c.accentContrast : c.foreground;
    final voice = widget.voice;
    final playingThis = _manager.currentUrl.value == voice.audioUrl;
    final total = playingThis ? (_duration ?? Duration(seconds: voice.durationSeconds)) : Duration(seconds: voice.durationSeconds);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            InkResponse(
              onTap: () => _toggle(voice.audioUrl),
              child: Icon(
                playingThis && _playing ? Icons.pause_circle_filled : Icons.play_circle_fill,
                color: textColor,
                size: 34,
              ),
            ),
            const SizedBox(width: 8),
            SizedBox(
              width: 100,
              child: LinearProgressIndicator(
                value: playingThis && total.inMilliseconds > 0
                    ? (_position.inMilliseconds / total.inMilliseconds).clamp(0, 1)
                    : 0,
                backgroundColor: textColor.withValues(alpha: 0.25),
                color: textColor,
                minHeight: 3,
              ),
            ),
            const SizedBox(width: 8),
            Text(
              _formatDuration(playingThis ? total - _position : total),
              style: TextStyle(color: textColor, fontSize: 11.5),
            ),
            const SizedBox(width: 4),
            // Vitesse de lecture 1x/1.5x/2x (section 2) — un seul lecteur
            // partagé : change la vitesse de lecture en cours quel que soit
            // le vocal actuellement joué, pas seulement celui-ci.
            InkResponse(
              onTap: () => _manager.cycleSpeed(),
              child: ValueListenableBuilder<double>(
                valueListenable: _manager.speed,
                builder: (context, speed, _) => Text(
                  '${speed == speed.roundToDouble() ? speed.toInt() : speed}x',
                  style: TextStyle(
                    color: textColor.withValues(alpha: 0.85),
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 4),
            InkResponse(
              onTap: () => _openLanguagePicker(context),
              child: Icon(Icons.translate, size: 18, color: textColor.withValues(alpha: 0.85)),
            ),
          ],
        ),
        if (voice.translations.isNotEmpty) ...[
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 4,
            children: voice.translations
                .map((t) => _TranslationChip(
                      translation: t,
                      own: widget.own,
                      playing: _manager.currentUrl.value == t.audioUrl && _playing,
                      onTap: () {
                        if (t.hasAudio) {
                          _toggle(t.audioUrl!);
                        } else if (t.status == TranslationStatus.failed) {
                          widget.onRequestTranslation(t.targetLanguage.code);
                        }
                      },
                    ))
                .toList(),
          ),
        ],
      ],
    );
  }

  void _openLanguagePicker(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      builder: (context) => _LanguagePickerSheet(onPicked: widget.onRequestTranslation),
    );
  }

  String _formatDuration(Duration d) {
    final total = d.isNegative ? Duration.zero : d;
    final minutes = total.inMinutes;
    final seconds = total.inSeconds % 60;
    return '$minutes:${seconds.toString().padLeft(2, '0')}';
  }
}

class _TranslationChip extends StatelessWidget {
  final VoiceTranslation translation;
  final bool own;
  final bool playing;
  final VoidCallback onTap;

  const _TranslationChip({
    required this.translation,
    required this.own,
    required this.playing,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final baseColor = own ? c.accentContrast : c.foreground;
    final chipBg = own ? Colors.white.withValues(alpha: 0.18) : c.surface;

    Widget icon;
    switch (translation.status) {
      case TranslationStatus.pending:
      case TranslationStatus.processing:
        icon = SizedBox(
          width: 11,
          height: 11,
          child: CircularProgressIndicator(strokeWidth: 1.6, color: baseColor),
        );
      case TranslationStatus.failed:
        icon = Icon(Icons.refresh, size: 13, color: baseColor);
      case TranslationStatus.completed:
        icon = Icon(
          translation.hasAudio ? (playing ? Icons.pause : Icons.play_arrow) : Icons.hourglass_bottom,
          size: 13,
          color: baseColor,
        );
    }

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(color: chipBg, borderRadius: BorderRadius.circular(999)),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            icon,
            const SizedBox(width: 5),
            Text(
              translation.targetLanguage.nativeName,
              style: TextStyle(fontSize: 11, color: baseColor, fontWeight: FontWeight.w500),
            ),
          ],
        ),
      ),
    );
  }
}

class _LanguagePickerSheet extends StatefulWidget {
  final void Function(String languageCode) onPicked;
  const _LanguagePickerSheet({required this.onPicked});

  @override
  State<_LanguagePickerSheet> createState() => _LanguagePickerSheetState();
}

class _LanguagePickerSheetState extends State<_LanguagePickerSheet> {
  List<LanguageSummary>? _languages;

  @override
  void initState() {
    super.initState();
    ApiClient.instance.languages().then((list) {
      if (mounted) setState(() => _languages = list);
    }).catchError((_) {
      if (mounted) setState(() => _languages = []);
    });
  }

  @override
  Widget build(BuildContext context) {
    final languages = _languages;
    return SafeArea(
      child: SizedBox(
        height: 420,
        child: Column(
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Écouter la traduction', style: TextStyle(fontWeight: FontWeight.w600)),
            ),
            Expanded(
              child: languages == null
                  ? const Center(child: CircularProgressIndicator())
                  : ListView.builder(
                      itemCount: languages.length,
                      itemBuilder: (context, index) {
                        final l = languages[index];
                        return ListTile(
                          title: Text(l.nativeName),
                          subtitle: Text(l.name),
                          onTap: () {
                            widget.onPicked(l.code);
                            Navigator.of(context).pop();
                          },
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
