import 'package:flutter/material.dart';
import '../../core/theme.dart';
import '../../models/auth_flow.dart';
import '../../services/api_client.dart';
import 'devices_screen.dart';

/// Paramètres → Sécurité (sections 3-4-10) : vérification en deux étapes
/// (activer/modifier/désactiver le PIN), email de secours, et l'accès aux
/// appareils connectés.
class SecurityScreen extends StatefulWidget {
  const SecurityScreen({super.key});

  @override
  State<SecurityScreen> createState() => _SecurityScreenState();
}

class _SecurityScreenState extends State<SecurityScreen> {
  TwoFactorStatus? _status;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    ApiClient.instance.twoFactorStatus().then((status) {
      if (mounted) setState(() => _status = status);
    }).catchError((e) {
      if (mounted) {
        setState(() => _error = e is ApiException ? e.message : 'Impossible de charger la sécurité.');
      }
    });
  }

  Future<void> _toggleTwoFactor(bool enable) async {
    if (enable) {
      final pin = await _promptForNewPin(title: 'Créer un PIN');
      if (pin == null) return;
      try {
        await ApiClient.instance.enableTwoFactor(pin);
        _load();
      } on ApiException catch (e) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } else {
      final pin = await _promptForPin(title: 'Entrez votre PIN pour désactiver');
      if (pin == null) return;
      try {
        await ApiClient.instance.disableTwoFactor(pin);
        _load();
      } on ApiException catch (e) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  Future<void> _changePin() async {
    final currentPin = await _promptForPin(title: 'PIN actuel');
    if (currentPin == null) return;
    if (!mounted) return;
    final newPin = await _promptForNewPin(title: 'Nouveau PIN');
    if (newPin == null) return;
    try {
      await ApiClient.instance.changePin(currentPin: currentPin, newPin: newPin);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('PIN mis à jour.')));
      }
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<String?> _promptForPin({required String title}) => _promptText(
        title: title,
        obscure: true,
        keyboardType: TextInputType.number,
        maxLength: 6,
      );

  Future<String?> _promptForNewPin({required String title}) => _promptText(
        title: title,
        obscure: true,
        keyboardType: TextInputType.number,
        maxLength: 6,
        helperText: '4 à 6 chiffres',
      );

  Future<String?> _promptText({
    required String title,
    bool obscure = false,
    TextInputType? keyboardType,
    int? maxLength,
    String? helperText,
  }) {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          obscureText: obscure,
          keyboardType: keyboardType,
          maxLength: maxLength,
          autofocus: true,
          decoration: InputDecoration(helperText: helperText),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Annuler')),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(controller.text.trim()),
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }

  Future<void> _manageRecoveryEmail() async {
    final email = await _promptText(title: 'Email de secours', keyboardType: TextInputType.emailAddress);
    if (email == null || email.isEmpty) return;
    try {
      await ApiClient.instance.requestRecoveryEmail(email);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      return;
    }
    if (!mounted) return;
    final code = await _promptText(
      title: 'Code reçu par email',
      keyboardType: TextInputType.number,
      maxLength: 6,
    );
    if (code == null || code.isEmpty) return;
    try {
      await ApiClient.instance.verifyRecoveryEmail(code);
      _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final status = _status;

    return Scaffold(
      backgroundColor: c.background,
      appBar: AppBar(title: const Text('Sécurité')),
      body: status == null
          ? _error != null
              ? Center(child: Text(_error!, style: TextStyle(color: c.danger)))
              : const Center(child: CircularProgressIndicator())
          : ListView(
              children: [
                _sectionLabel(c, 'Vérification en deux étapes'),
                SwitchListTile(
                  title: const Text('Activer'),
                  subtitle: Text(
                    status.enabled
                        ? 'Un PIN sera demandé à chaque nouvelle connexion.'
                        : 'Protégez votre compte avec un code PIN supplémentaire.',
                    style: TextStyle(color: c.muted),
                  ),
                  value: status.enabled,
                  activeThumbColor: c.accent2,
                  onChanged: _toggleTwoFactor,
                ),
                if (status.enabled)
                  ListTile(
                    leading: Icon(Icons.password, color: c.muted),
                    title: const Text('Modifier le PIN'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: _changePin,
                  ),
                const SizedBox(height: 12),
                _sectionLabel(c, 'Email de secours'),
                ListTile(
                  leading: Icon(Icons.email_outlined, color: c.muted),
                  title: Text(status.hasRecoveryEmail ? 'Modifier' : 'Ajouter un email de secours'),
                  subtitle: Text(
                    status.hasRecoveryEmail
                        ? (status.recoveryEmailVerified ? 'Vérifié' : 'En attente de vérification')
                        : 'Nécessaire pour récupérer un PIN oublié.',
                    style: TextStyle(color: c.muted),
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: _manageRecoveryEmail,
                ),
                const SizedBox(height: 12),
                _sectionLabel(c, 'Appareils'),
                ListTile(
                  leading: Icon(Icons.devices_outlined, color: c.muted),
                  title: const Text('Appareils connectés'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const DevicesScreen()),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _sectionLabel(GlottaColors c, String text) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
        child: Text(
          text.toUpperCase(),
          style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: c.muted, letterSpacing: 0.4),
        ),
      );
}
