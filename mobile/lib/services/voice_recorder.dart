import 'dart:io';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

/// Port de `frontend/src/lib/use-voice-recorder.ts` : le backend accepte
/// webm/ogg/mp4/mpeg/wav (voir `ALLOWED_AUDIO_MIME_TYPES`) — AAC dans un
/// conteneur M4A (`audio/mp4` déclaré au backend) est le choix natif le plus
/// largement supporté par les deux plateformes mobiles, jamais besoin
/// d'imiter le webm/opus du navigateur ici.
class VoiceRecording {
  final String filePath;
  final int durationSeconds;
  const VoiceRecording({required this.filePath, required this.durationSeconds});
}

/// Même limite que côté web (miroir de `MAX_VOICE_DURATION_SECONDS` backend).
const int maxVoiceDurationSeconds = 300;

class VoiceRecorderService {
  final _recorder = AudioRecorder();
  DateTime? _startedAt;

  Future<bool> hasPermission() => _recorder.hasPermission();

  Future<void> start() async {
    final granted = await hasPermission();
    if (!granted) {
      throw StateError('Permission micro refusée.');
    }
    final dir = await getTemporaryDirectory();
    final path = '${dir.path}/glotta-voice-${DateTime.now().millisecondsSinceEpoch}.m4a';
    await _recorder.start(const RecordConfig(encoder: AudioEncoder.aacLc), path: path);
    _startedAt = DateTime.now();
  }

  /// `null` si l'enregistrement est trop court (<1s) ou vide — même garde-fou
  /// que côté web, pour ne jamais envoyer un vocal inutilisable.
  Future<VoiceRecording?> stop() async {
    final path = await _recorder.stop();
    final startedAt = _startedAt;
    _startedAt = null;
    if (path == null || startedAt == null) return null;

    final duration = DateTime.now().difference(startedAt).inSeconds;
    final file = File(path);
    final exists = await file.exists();
    if (!exists || duration < 1) {
      if (exists) await file.delete();
      return null;
    }
    return VoiceRecording(filePath: path, durationSeconds: duration.clamp(1, maxVoiceDurationSeconds));
  }

  Future<void> cancel() async {
    if (await _recorder.isRecording()) {
      final path = await _recorder.stop();
      _startedAt = null;
      if (path != null) {
        final file = File(path);
        if (await file.exists()) await file.delete();
      }
    }
  }

  void dispose() {
    _recorder.dispose();
  }
}
