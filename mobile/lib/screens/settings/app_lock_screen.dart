import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme.dart';
import '../../screens/lock/lock_screen.dart';
import '../../services/app_lock_store.dart';
import '../../services/biometric_service.dart';
import '../../state/app_lock_state.dart';

/// Paramètres → Sécurité → Verrouillage de l'application (sections 6-8) —
/// activer/désactiver, choisir la méthode principale (PIN/mot de passe/
/// schéma), activer la biométrie en raccourci, et la durée de verrouillage
/// automatique. Tout reste local (voir AppLockStore) : cet écran n'appelle
/// jamais ApiClient.
class AppLockScreen extends ConsumerStatefulWidget {
  const AppLockScreen({super.key});

  @override
  ConsumerState<AppLockScreen> createState() => _AppLockScreenState();
}

class _AppLockScreenState extends ConsumerState<AppLockScreen> {
  bool _biometricAvailable = false;

  @override
  void initState() {
    super.initState();
    BiometricService.instance.isAvailable().then((available) {
      if (mounted) setState(() => _biometricAvailable = available);
    });
  }

  Future<void> _startSetup() async {
    final method = await _pickMethod();
    if (method == null) return;
    if (!mounted) return;
    final secret = await _captureSecret(method);
    if (secret == null) return;
    if (!mounted) return;
    final autoLock = await _pickAutoLock(ref.read(appLockProvider).autoLock);
    if (autoLock == null) return;
    await ref.read(appLockProvider.notifier).enable(method: method, secret: secret, autoLock: autoLock);
  }

  Future<void> _changeMethod() async {
    final method = await _pickMethod();
    if (method == null) return;
    if (!mounted) return;
    final secret = await _captureSecret(method);
    if (secret == null) return;
    final autoLock = ref.read(appLockProvider).autoLock;
    await ref.read(appLockProvider.notifier).enable(method: method, secret: secret, autoLock: autoLock);
  }

  Future<void> _confirmDisable() async {
    final method = ref.read(appLockProvider).method;
    if (method == null) return;
    final secret = await _promptSecret(method: method, title: 'Confirmez pour désactiver');
    if (secret == null) return;
    final ok = await AppLockStore.instance.verifySecret(secret);
    if (!mounted) return;
    if (!ok) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Code incorrect.')));
      return;
    }
    await ref.read(appLockProvider.notifier).disable();
  }

  Future<void> _toggleBiometric(bool value) async {
    await ref.read(appLockProvider.notifier).setBiometricEnabled(value);
  }

  Future<LockMethod?> _pickMethod() {
    return showModalBottomSheet<LockMethod>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.pin_outlined),
              title: const Text('Code PIN'),
              onTap: () => Navigator.of(sheetContext).pop(LockMethod.pin),
            ),
            ListTile(
              leading: const Icon(Icons.password_outlined),
              title: const Text('Mot de passe'),
              onTap: () => Navigator.of(sheetContext).pop(LockMethod.password),
            ),
            ListTile(
              leading: const Icon(Icons.pattern_outlined),
              title: const Text('Schéma'),
              onTap: () => Navigator.of(sheetContext).pop(LockMethod.pattern),
            ),
          ],
        ),
      ),
    );
  }

  Future<AutoLockDuration?> _pickAutoLock(AutoLockDuration current) {
    return showModalBottomSheet<AutoLockDuration>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: AutoLockDuration.values
              .map(
                (d) => RadioListTile<AutoLockDuration>(
                  value: d,
                  groupValue: current,
                  title: Text(d.label),
                  onChanged: (value) => Navigator.of(sheetContext).pop(value),
                ),
              )
              .toList(),
        ),
      ),
    );
  }

  /// Saisie + confirmation (deux fois le même secret) — recommence en cas de
  /// désaccord plutôt que d'abandonner, jusqu'à annulation explicite.
  Future<String?> _captureSecret(LockMethod method) async {
    while (true) {
      if (!mounted) return null;
      final first = await _promptSecret(method: method, title: 'Choisissez votre code');
      if (first == null) return null;
      if (!mounted) return null;
      final second = await _promptSecret(method: method, title: 'Confirmez votre code');
      if (second == null) return null;
      if (first == second) return first;
      if (!mounted) return null;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Les deux saisies ne correspondent pas — réessayez.')),
      );
    }
  }

  Future<String?> _promptSecret({required LockMethod method, required String title}) {
    switch (method) {
      case LockMethod.pin:
        return _promptText(title: title, obscure: true, keyboardType: TextInputType.number, maxLength: 6);
      case LockMethod.password:
        return _promptText(title: title, obscure: true);
      case LockMethod.pattern:
        return _promptPattern(title: title);
    }
  }

  Future<String?> _promptText({
    required String title,
    bool obscure = false,
    TextInputType? keyboardType,
    int? maxLength,
  }) {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          autofocus: true,
          obscureText: obscure,
          keyboardType: keyboardType,
          maxLength: maxLength,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(), child: const Text('Annuler')),
          FilledButton(
            onPressed: () {
              final value = controller.text.trim();
              if (value.isEmpty) return;
              Navigator.of(dialogContext).pop(value);
            },
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }

  Future<String?> _promptPattern({required String title}) {
    final selected = <int>[];
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (sheetContext, setSheetState) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                const SizedBox(height: 16),
                PatternGrid(
                  selected: selected,
                  onTap: (index) => setSheetState(() {
                    if (!selected.contains(index)) selected.add(index);
                  }),
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      onPressed: () => setSheetState(selected.clear),
                      child: const Text('Effacer'),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(
                      onPressed: selected.length < 4
                          ? null
                          : () => Navigator.of(sheetContext).pop(selected.join(',')),
                      child: const Text('Continuer'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final lock = ref.watch(appLockProvider);

    return Scaffold(
      backgroundColor: c.background,
      appBar: AppBar(title: const Text("Verrouillage de l'application")),
      body: ListView(
        children: [
          SwitchListTile(
            title: const Text('Verrouillage de l’application'),
            subtitle: Text(
              lock.enabled
                  ? 'Un code est demandé à la réouverture de l’app.'
                  : 'Protégez l’accès à toute l’application, pas seulement une conversation.',
              style: TextStyle(color: c.muted),
            ),
            value: lock.enabled,
            activeThumbColor: c.accent2,
            onChanged: (value) => value ? _startSetup() : _confirmDisable(),
          ),
          if (lock.enabled) ...[
            const SizedBox(height: 12),
            _sectionLabel(c, 'Méthode'),
            ListTile(
              leading: Icon(_methodIcon(lock.method), color: c.muted),
              title: Text(_methodLabel(lock.method)),
              trailing: const Icon(Icons.chevron_right),
              onTap: _changeMethod,
            ),
            if (_biometricAvailable)
              SwitchListTile(
                title: const Text('Empreinte / reconnaissance faciale'),
                subtitle: Text(
                  'Raccourci rapide — le code reste toujours disponible en secours.',
                  style: TextStyle(color: c.muted),
                ),
                value: lock.biometricEnabled,
                activeThumbColor: c.accent2,
                onChanged: _toggleBiometric,
              ),
            const SizedBox(height: 12),
            _sectionLabel(c, 'Verrouillage automatique'),
            ...AutoLockDuration.values.map(
              (d) => RadioListTile<AutoLockDuration>(
                value: d,
                groupValue: lock.autoLock,
                title: Text(d.label),
                activeColor: c.accent,
                onChanged: (value) {
                  if (value != null) ref.read(appLockProvider.notifier).updateAutoLock(value);
                },
              ),
            ),
          ],
        ],
      ),
    );
  }

  IconData _methodIcon(LockMethod? method) => switch (method) {
        LockMethod.pin => Icons.pin_outlined,
        LockMethod.password => Icons.password_outlined,
        LockMethod.pattern => Icons.pattern_outlined,
        null => Icons.lock_outline,
      };

  String _methodLabel(LockMethod? method) => switch (method) {
        LockMethod.pin => 'Code PIN',
        LockMethod.password => 'Mot de passe',
        LockMethod.pattern => 'Schéma',
        null => 'Non configurée',
      };

  Widget _sectionLabel(GlottaColors c, String text) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
        child: Text(
          text.toUpperCase(),
          style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: c.muted, letterSpacing: 0.4),
        ),
      );
}
