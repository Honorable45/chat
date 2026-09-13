import 'dart:async';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/theme.dart';
import '../../models/status.dart';
import '../../services/voice_recorder.dart';
import 'status_composer_sheet.dart';

/// Port de l'écran "Ajouter un statut" de WhatsApp (référence fournie) :
/// rangée d'actions (Texte/Musique/Composition/Vocal) puis les tuiles
/// Caméra/Galerie — "Musique" et "Composition" n'ont pas d'équivalent
/// backend (voir `StatusType`, qui ne connaît que TEXT/IMAGE/VIDEO/VOICE) et
/// restent donc affichées mais désactivées, même convention que le rail
/// d'icônes pour une fonctionnalité pas encore construite plutôt que
/// simulée. Le grand tableau "Récents" du navigateur de photos n'est pas
/// reproduit (nécessiterait un accès direct à la galerie du téléphone) :
/// Caméra et Galerie ouvrent chacun le sélecteur natif habituel.
class StatusComposerEntryScreen extends StatefulWidget {
  final void Function(AppStatus status) onCreated;

  const StatusComposerEntryScreen({super.key, required this.onCreated});

  @override
  State<StatusComposerEntryScreen> createState() => _StatusComposerEntryScreenState();
}

class _StatusComposerEntryScreenState extends State<StatusComposerEntryScreen> {
  final _recorder = VoiceRecorderService();
  bool _recording = false;
  int _recordSeconds = 0;
  Timer? _ticker;

  @override
  void dispose() {
    _ticker?.cancel();
    _recorder.dispose();
    super.dispose();
  }

  void _notAvailable(String label) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$label — bientôt disponible.')));
  }

  Future<void> _openDetails({String? imagePath, VoiceRecording? voice}) async {
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => StatusComposerSheet(
        initialImagePath: imagePath,
        initialVoice: voice,
        onCreated: (status) {
          Navigator.of(context).pop();
          widget.onCreated(status);
        },
      ),
    );
  }

  void _openTextComposer() => _openDetails();

  Future<void> _pickImage(ImageSource source) async {
    final picked = await ImagePicker().pickImage(source: source, imageQuality: 85);
    if (picked != null) _openDetails(imagePath: picked.path);
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
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      setState(() => _recordSeconds++);
      if (_recordSeconds >= maxVoiceDurationSeconds) _stopRecording();
    });
  }

  Future<void> _stopRecording() async {
    if (!_recording) return;
    _ticker?.cancel();
    setState(() => _recording = false);
    final result = await _recorder.stop();
    if (result != null) _openDetails(voice: result);
  }

  Future<void> _cancelRecording() async {
    _ticker?.cancel();
    setState(() => _recording = false);
    await _recorder.cancel();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return Scaffold(
      backgroundColor: c.background,
      appBar: AppBar(
        leading: IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.of(context).pop()),
        title: const Text('Ajouter un statut'),
        centerTitle: true,
      ),
      body: Column(
        children: [
          const SizedBox(height: 8),
          if (_recording)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(color: c.surfaceRaised, borderRadius: BorderRadius.circular(14)),
                child: Row(
                  children: [
                    Container(
                      width: 10,
                      height: 10,
                      decoration: BoxDecoration(color: c.danger, shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 10),
                    const Text('Enregistrement...'),
                    const Spacer(),
                    Text('${_recordSeconds}s', style: TextStyle(color: c.muted)),
                    const SizedBox(width: 12),
                    TextButton(onPressed: _cancelRecording, child: const Text('Annuler')),
                    FilledButton(onPressed: _stopRecording, child: const Text('Terminer')),
                  ],
                ),
              ),
            )
          else
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _ActionButton(icon: Icons.edit_outlined, label: 'Texte', onTap: _openTextComposer),
                _ActionButton(icon: Icons.music_note_outlined, label: 'Musique', onTap: () => _notAvailable('Musique')),
                _ActionButton(
                  icon: Icons.dashboard_customize_outlined,
                  label: 'Composition',
                  onTap: () => _notAvailable('Composition'),
                ),
                _ActionButton(icon: Icons.mic_none, label: 'Vocal', onTap: _startRecording),
              ],
            ),
          const SizedBox(height: 20),
          Expanded(
            child: GridView.count(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              crossAxisCount: 3,
              mainAxisSpacing: 4,
              crossAxisSpacing: 4,
              children: [
                _GridTile(
                  icon: Icons.camera_alt,
                  label: 'Caméra',
                  onTap: () => _pickImage(ImageSource.camera),
                ),
                _GridTile(
                  icon: Icons.photo_outlined,
                  label: 'Galerie',
                  onTap: () => _pickImage(ImageSource.gallery),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _ActionButton({required this.icon, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: BoxDecoration(color: c.surfaceRaised, shape: BoxShape.circle),
            child: Icon(icon, color: c.foreground),
          ),
          const SizedBox(height: 6),
          Text(label, style: TextStyle(fontSize: 12, color: c.muted)),
        ],
      ),
    );
  }
}

class _GridTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _GridTile({required this.icon, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return InkWell(
      onTap: onTap,
      child: Container(
        color: c.surfaceRaised,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: c.muted, size: 28),
            const SizedBox(height: 6),
            Text(label, style: TextStyle(fontSize: 12.5, color: c.muted)),
          ],
        ),
      ),
    );
  }
}
