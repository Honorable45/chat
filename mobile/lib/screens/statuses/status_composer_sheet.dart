import 'dart:io';
import 'package:flutter/material.dart';
import '../../core/theme.dart';
import '../../models/status.dart';
import '../../services/api_client.dart';
import '../../services/voice_recorder.dart';

/// Port de `StatusComposer.tsx` (étape légende + visibilité + publication) —
/// image ou vocal déjà choisis/enregistrés en amont par
/// StatusComposerEntryScreen (comme le "Camera roll"/micro de l'écran
/// "Ajouter un statut" WhatsApp), ce composant se charge seulement de la
/// légende, de la visibilité et de l'appel réseau.
class StatusComposerSheet extends StatefulWidget {
  final void Function(AppStatus status) onCreated;
  final String? initialImagePath;
  final VoiceRecording? initialVoice;

  const StatusComposerSheet({
    super.key,
    required this.onCreated,
    this.initialImagePath,
    this.initialVoice,
  });

  @override
  State<StatusComposerSheet> createState() => _StatusComposerSheetState();
}

class _StatusComposerSheetState extends State<StatusComposerSheet> {
  final _text = TextEditingController();
  late String? _imagePath = widget.initialImagePath;
  late VoiceRecording? _voice = widget.initialVoice;
  StatusVisibility _visibility = StatusVisibility.contacts;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  bool get _hasContent => _text.text.trim().isNotEmpty || _imagePath != null || _voice != null;

  Future<void> _submit() async {
    if (!_hasContent) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final status = await ApiClient.instance.createStatus(
        type: _voice != null
            ? StatusType.voice
            : _imagePath != null
                ? StatusType.image
                : StatusType.text,
        text: _text.text.trim().isEmpty ? null : _text.text.trim(),
        visibility: _visibility,
        filePath: _voice?.filePath ?? _imagePath,
      );
      widget.onCreated(status);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: 16 + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text('Nouveau statut', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
              ),
              IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.of(context).pop()),
            ],
          ),
          if (_imagePath != null) ...[
            const SizedBox(height: 8),
            Stack(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Image.file(File(_imagePath!), height: 180, width: double.infinity, fit: BoxFit.cover),
                ),
                Positioned(
                  right: 6,
                  top: 6,
                  child: GestureDetector(
                    onTap: () => setState(() => _imagePath = null),
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                      child: const Icon(Icons.close, size: 16, color: Colors.white),
                    ),
                  ),
                ),
              ],
            ),
          ],
          if (_voice != null) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(color: c.surfaceRaised, borderRadius: BorderRadius.circular(12)),
              child: Row(
                children: [
                  Icon(Icons.mic, color: c.accent2),
                  const SizedBox(width: 8),
                  Text('Vocal enregistré (${_voice!.durationSeconds}s)', style: TextStyle(color: c.foreground)),
                  const Spacer(),
                  GestureDetector(
                    onTap: () => setState(() => _voice = null),
                    child: Icon(Icons.close, size: 18, color: c.muted),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 10),
          TextField(
            controller: _text,
            maxLength: 500,
            maxLines: _imagePath != null || _voice != null ? 2 : 3,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: _imagePath != null || _voice != null ? 'Ajouter une légende (optionnel)...' : 'Quoi de neuf ?',
            ),
          ),
          Row(
            children: [
              const Spacer(),
              DropdownButton<StatusVisibility>(
                value: _visibility,
                underline: const SizedBox.shrink(),
                items: const [
                  DropdownMenuItem(value: StatusVisibility.everyone, child: Text('Tout le monde')),
                  DropdownMenuItem(value: StatusVisibility.contacts, child: Text('Mes contacts')),
                ],
                onChanged: (v) {
                  if (v != null) setState(() => _visibility = v);
                },
              ),
            ],
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(_error!, style: TextStyle(color: c.danger, fontSize: 12.5)),
            ),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              onPressed: _saving || !_hasContent ? null : _submit,
              child: Text(_saving ? 'Publication...' : 'Publier'),
            ),
          ),
        ],
      ),
    );
  }
}
