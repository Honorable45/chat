import 'package:audio_session/audio_session.dart';
import 'package:flutter/foundation.dart';
import 'package:just_audio/just_audio.dart';
import '../core/media.dart';

/// Un seul vocal peut jouer à la fois dans toute l'application (section 2) —
/// un unique `AudioPlayer` partagé plutôt qu'une instance par bulle : lancer
/// la lecture d'une URL différente arrête automatiquement la précédente,
/// entre conversations, en changeant d'écran, ou en revenant sur une
/// conversation déjà ouverte. Reprend la position quand on revient sur un
/// vocal déjà partiellement écouté (`_lastPosition`) — sauf s'il vient de se
/// terminer naturellement, où il repart du début comme WhatsApp.
///
/// Notifie via `ValueNotifier` (jamais Riverpod) : la position progresse à
/// haute fréquence pendant la lecture, un `Notifier` Riverpod déclencherait
/// une reconstruction de l'arbre entier à chaque tick — chaque bulle vocale
/// écoute directement les streams du lecteur partagé et filtre elle-même
/// sur `currentUrl.value == sa propre URL`.
class AudioPlaybackManager {
  AudioPlaybackManager._() {
    _configureSession();
    player.playerStateStream.listen((state) {
      if (state.processingState == ProcessingState.completed) {
        final url = currentUrl.value;
        if (url != null) _lastPosition.remove(url);
        player.pause();
        player.seek(Duration.zero);
      }
    });
  }

  static final AudioPlaybackManager instance = AudioPlaybackManager._();

  final AudioPlayer player = AudioPlayer();
  final ValueNotifier<String?> currentUrl = ValueNotifier(null);
  final ValueNotifier<double> speed = ValueNotifier(1.0);
  final Map<String, Duration> _lastPosition = {};

  Future<void> _configureSession() async {
    try {
      final session = await AudioSession.instance;
      // "speech" : mixe proprement avec un appel WebRTC en cours (voir
      // CallService) plutôt que de le couper — jamais prioritaire sur lui.
      await session.configure(const AudioSessionConfiguration.speech());
    } catch (_) {
      // Best-effort — une session audio mal configurée ne doit jamais
      // empêcher la lecture elle-même.
    }
  }

  bool get isPlaying => player.playing;

  /// Lecture/pause de `url` — bascule en pause si déjà en cours de lecture,
  /// sinon arrête tout ce qui joue ailleurs avant de démarrer celui-ci.
  Future<void> toggle(String url) async {
    if (currentUrl.value == url) {
      if (player.playing) {
        _lastPosition[url] = player.position;
        await player.pause();
      } else {
        await player.play();
      }
      return;
    }

    final previous = currentUrl.value;
    if (previous != null) {
      _lastPosition[previous] = player.position;
    }
    currentUrl.value = url;
    try {
      await player.setUrl(resolveMediaUrl(url), headers: mediaHeaders(url));
    } catch (_) {
      currentUrl.value = previous;
      rethrow;
    }
    final resume = _lastPosition[url];
    if (resume != null && resume > Duration.zero) {
      await player.seek(resume);
    }
    await player.setSpeed(speed.value);
    await player.play();
  }

  Future<void> setSpeed(double value) async {
    speed.value = value;
    await player.setSpeed(value);
  }

  /// Cycle 1x → 1.5x → 2x → 1x, affiché à côté du bouton lecture (section 2).
  Future<void> cycleSpeed() async {
    final next = switch (speed.value) {
      1.0 => 1.5,
      1.5 => 2.0,
      _ => 1.0,
    };
    await setSpeed(next);
  }

  /// Message supprimé pendant sa lecture (section 2) — arrête et nettoie.
  void stopIfPlaying(String url) {
    if (currentUrl.value == url) {
      player.stop();
      _lastPosition.remove(url);
      currentUrl.value = null;
    }
  }

  void dispose() {
    player.dispose();
  }
}
