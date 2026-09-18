import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme.dart';
import '../../services/app_lock_store.dart';
import '../../state/app_lock_state.dart';

/// Écran plein écran affiché par AppLockGate quand l'app est verrouillée
/// (sections 8-9) — bloque toute interaction avec le reste de l'app tant que
/// `AppLockState.unlocked` n'est pas passé à `true`. Jamais poussé comme une
/// route classique : superposé par-dessus la navigation existante (voir
/// AppLockGate), pour ne jamais interférer avec les redirections de
/// go_router (phone/profile-setup/conversations).
class LockScreen extends ConsumerStatefulWidget {
  const LockScreen({super.key});

  @override
  ConsumerState<LockScreen> createState() => _LockScreenState();
}

class _LockScreenState extends ConsumerState<LockScreen> {
  final _pin = TextEditingController();
  final _password = TextEditingController();
  final List<int> _pattern = [];
  String? _error;
  bool _checking = false;
  bool _biometricTried = false;

  @override
  void dispose() {
    _pin.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Une seule tentative automatique par apparition de l'écran — jamais en
    // boucle si l'utilisateur annule la boîte de dialogue biométrique
    // native, il doit alors pouvoir se rabattre sur le secret sans que le
    // prompt biométrique ne revienne le harceler.
    if (!_biometricTried && ref.read(appLockProvider).biometricEnabled) {
      _biometricTried = true;
      WidgetsBinding.instance.addPostFrameCallback((_) => _tryBiometric());
    }
  }

  Future<void> _tryBiometric() async {
    await ref.read(appLockProvider.notifier).unlockWithBiometrics();
  }

  Future<void> _submitSecret(String secret) async {
    if (secret.isEmpty) return;
    setState(() {
      _checking = true;
      _error = null;
    });
    final ok = await ref.read(appLockProvider.notifier).unlockWithSecret(secret);
    if (!mounted) return;
    if (!ok) {
      setState(() {
        _error = 'Code incorrect.';
        _checking = false;
        _pin.clear();
        _password.clear();
        _pattern.clear();
      });
    }
  }

  void _tapPatternDot(int index) {
    if (_pattern.contains(index)) return;
    setState(() => _pattern.add(index));
  }

  void _resetPattern() => setState(() => _pattern.clear());

  Future<void> _submitPattern() async {
    if (_pattern.length < 4) {
      setState(() => _error = 'Reliez au moins 4 points.');
      return;
    }
    await _submitSecret(_pattern.join(','));
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final lock = ref.watch(appLockProvider);

    return Scaffold(
      backgroundColor: c.background,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 360),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.lock_outline, size: 40, color: c.muted),
                  const SizedBox(height: 12),
                  Text(
                    'Glotta est verrouillée',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: c.foreground),
                  ),
                  const SizedBox(height: 24),
                  _buildMethod(c, lock.method),
                  if (_error != null) ...[
                    const SizedBox(height: 14),
                    Text(_error!, style: TextStyle(color: c.danger, fontSize: 13)),
                  ],
                  if (lock.biometricEnabled) ...[
                    const SizedBox(height: 20),
                    TextButton.icon(
                      onPressed: _checking ? null : _tryBiometric,
                      icon: const Icon(Icons.fingerprint),
                      label: const Text('Utiliser la biométrie'),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildMethod(GlottaColors c, LockMethod? method) {
    switch (method) {
      case LockMethod.password:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _password,
              obscureText: true,
              autofocus: true,
              enabled: !_checking,
              decoration: const InputDecoration(hintText: 'Mot de passe'),
              onSubmitted: _submitSecret,
            ),
            const SizedBox(height: 14),
            FilledButton(
              onPressed: _checking ? null : () => _submitSecret(_password.text),
              child: const Text('Déverrouiller'),
            ),
          ],
        );
      case LockMethod.pattern:
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            PatternGrid(selected: _pattern, onTap: _checking ? null : _tapPatternDot),
            const SizedBox(height: 14),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                TextButton(onPressed: _checking ? null : _resetPattern, child: const Text('Effacer')),
                const SizedBox(width: 12),
                FilledButton(
                  onPressed: _checking ? null : _submitPattern,
                  child: const Text('Valider'),
                ),
              ],
            ),
          ],
        );
      case LockMethod.pin:
      case null:
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _pin,
              autofocus: true,
              enabled: !_checking,
              obscureText: true,
              keyboardType: TextInputType.number,
              maxLength: 6,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 22, letterSpacing: 8, fontWeight: FontWeight.w600),
              decoration: const InputDecoration(counterText: '', hintText: '••••'),
              onSubmitted: _submitSecret,
            ),
            const SizedBox(height: 14),
            FilledButton(
              onPressed: _checking ? null : () => _submitSecret(_pin.text.trim()),
              child: const Text('Déverrouiller'),
            ),
          ],
        );
    }
  }
}

/// Grille 3×3 à sélection par appui (et non par glissé continu façon
/// verrouillage Android) — même principe (une séquence spatiale mémorisée)
/// mais bien plus simple et fiable à implémenter qu'une reconnaissance de
/// geste ; l'ordre des appuis fait foi, comparé tel quel (voir
/// AppLockStore.verifySecret) au moment de l'enregistrement. Publique : aussi
/// réutilisée par AppLockScreen pour la saisie/confirmation à la création.
class PatternGrid extends StatelessWidget {
  final List<int> selected;
  final void Function(int index)? onTap;

  const PatternGrid({super.key, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return SizedBox(
      width: 240,
      height: 240,
      child: GridView.builder(
        physics: const NeverScrollableScrollPhysics(),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3),
        itemCount: 9,
        itemBuilder: (context, index) {
          final order = selected.indexOf(index);
          final isSelected = order != -1;
          return Padding(
            padding: const EdgeInsets.all(8),
            child: GestureDetector(
              onTap: onTap == null ? null : () => onTap!(index),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: isSelected ? c.accent : c.surface,
                  border: Border.all(color: isSelected ? c.accent : c.border, width: 2),
                ),
                child: Center(
                  child: isSelected
                      ? Text(
                          '${order + 1}',
                          style: TextStyle(color: c.accentContrast, fontWeight: FontWeight.w600),
                        )
                      : null,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
