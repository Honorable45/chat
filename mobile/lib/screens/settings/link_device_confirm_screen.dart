import 'package:flutter/material.dart';
import '../../core/theme.dart';
import '../../models/auth_flow.dart';
import '../../services/api_client.dart';

/// "Connecter cet appareil ?" (section 8) — affiché après le scan, avant
/// toute création de session : la session Web n'existe QUE si l'utilisateur
/// appuie explicitement sur "Connecter" (voir DeviceLinkService.confirm côté
/// backend, jamais créée sur le seul scan).
class LinkDeviceConfirmScreen extends StatefulWidget {
  final String token;
  final ScannedLinkInfo info;

  const LinkDeviceConfirmScreen({super.key, required this.token, required this.info});

  @override
  State<LinkDeviceConfirmScreen> createState() => _LinkDeviceConfirmScreenState();
}

class _LinkDeviceConfirmScreenState extends State<LinkDeviceConfirmScreen> {
  bool _busy = false;
  String? _error;

  Future<void> _respond(bool confirm) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ApiClient.instance.confirmLinkRequest(
        token: widget.token,
        confirm: confirm,
        deviceLabel: widget.info.browserName,
      );
      if (mounted) {
        Navigator.of(context).pop(confirm);
      }
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final browser = widget.info.browserName ?? 'Navigateur inconnu';
    final os = widget.info.operatingSystem ?? 'Système inconnu';

    return Scaffold(
      backgroundColor: c.background,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(colors: [c.accent, c.accent2]),
                ),
                child: Icon(Icons.laptop_mac, color: c.accentContrast, size: 32),
              ),
              const SizedBox(height: 24),
              const Text('Connecter cet appareil ?', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(color: c.surfaceRaised, borderRadius: BorderRadius.circular(14)),
                child: Column(
                  children: [
                    _infoRow(c, Icons.public, 'Navigateur', browser),
                    const SizedBox(height: 10),
                    _infoRow(c, Icons.desktop_windows_outlined, 'Système', os),
                  ],
                ),
              ),
              if (_error != null) ...[
                const SizedBox(height: 14),
                Text(_error!, style: TextStyle(color: c.danger, fontSize: 13)),
              ],
              const SizedBox(height: 28),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: _busy ? null : () => _respond(false),
                      child: const Text('Annuler'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton(
                      onPressed: _busy ? null : () => _respond(true),
                      child: _busy
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            )
                          : const Text('Connecter'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _infoRow(GlottaColors c, IconData icon, String label, String value) => Row(
        children: [
          Icon(icon, size: 18, color: c.muted),
          const SizedBox(width: 10),
          Text(label, style: TextStyle(color: c.muted, fontSize: 13)),
          const Spacer(),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
        ],
      );
}
