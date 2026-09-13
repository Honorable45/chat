import 'package:flutter/material.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../models/auth_flow.dart';
import '../../services/api_client.dart';
import 'qr_scanner_screen.dart';

/// Paramètres → Sécurité → Appareils connectés (sections 7-10). Bouton
/// flottant "Connecter un appareil" ouvre le scanner QR ; chaque ligne
/// affiche navigateur/système (via `deviceLabel`), dernière activité, et un
/// bouton "Déconnecter" qui révoque réellement la session côté backend.
class DevicesScreen extends StatefulWidget {
  const DevicesScreen({super.key});

  @override
  State<DevicesScreen> createState() => _DevicesScreenState();
}

class _DevicesScreenState extends State<DevicesScreen> {
  List<SessionSummary>? _sessions;
  String? _error;
  final Set<String> _busyIds = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    ApiClient.instance.sessions().then((list) {
      if (mounted) setState(() => _sessions = list);
    }).catchError((e) {
      if (mounted) {
        setState(() => _error = e is ApiException ? e.message : 'Impossible de charger les appareils.');
      }
    });
  }

  Future<void> _connectDevice() async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const QrScannerScreen()));
    _load();
  }

  Future<void> _revoke(SessionSummary session) async {
    setState(() => _busyIds.add(session.id));
    try {
      await ApiClient.instance.revokeSession(session.id);
      _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busyIds.remove(session.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final sessions = _sessions;

    return Scaffold(
      backgroundColor: c.background,
      appBar: AppBar(title: const Text('Appareils connectés')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _connectDevice,
        backgroundColor: c.accent,
        icon: Icon(Icons.qr_code_scanner, color: c.accentContrast),
        label: Text('Connecter un appareil', style: TextStyle(color: c.accentContrast)),
      ),
      body: _error != null
          ? Center(child: Text(_error!, style: TextStyle(color: c.danger)))
          : sessions == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.fromLTRB(0, 8, 0, 88),
                  children: [
                    for (final s in sessions) _sessionTile(c, s),
                  ],
                ),
    );
  }

  Widget _sessionTile(GlottaColors c, SessionSummary s) {
    final busy = _busyIds.contains(s.id);
    return ListTile(
      leading: CircleAvatar(
        backgroundColor: c.surfaceRaised,
        child: Icon(
          s.type == SessionKind.web ? Icons.laptop_mac : Icons.phone_iphone,
          color: c.muted,
        ),
      ),
      title: Text(s.deviceLabel ?? (s.type == SessionKind.web ? 'Navigateur Web' : 'Cet appareil')),
      subtitle: Text(
        s.isCurrent ? 'Actif maintenant' : 'Actif ${shortRelativeTime(s.lastUsedAt)}',
        style: TextStyle(color: s.isCurrent ? c.online : c.muted),
      ),
      trailing: s.isCurrent
          ? null
          : busy
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : TextButton(
                  onPressed: () => _revoke(s),
                  child: Text('Déconnecter', style: TextStyle(color: c.danger)),
                ),
    );
  }
}
