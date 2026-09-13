import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme.dart';
import '../../services/api_client.dart';
import '../../state/auth_state.dart';
import '../../widgets/auth_shell.dart';
import 'pin_recovery_screen.dart';

/// Étape PIN de la vérification en deux étapes (section 3) — affiché
/// uniquement quand verifyLoginOtp a répondu `requiresTwoFactor: true`.
class TwoFactorPinScreen extends ConsumerStatefulWidget {
  final String phone;
  final String continuationToken;

  const TwoFactorPinScreen({super.key, required this.phone, required this.continuationToken});

  @override
  ConsumerState<TwoFactorPinScreen> createState() => _TwoFactorPinScreenState();
}

class _TwoFactorPinScreenState extends ConsumerState<TwoFactorPinScreen> {
  final _pin = TextEditingController();
  String? _error;
  bool _submitting = false;

  @override
  void dispose() {
    _pin.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final pin = _pin.text.trim();
    if (pin.isEmpty) return;
    setState(() {
      _error = null;
      _submitting = true;
    });
    try {
      await ref.read(authProvider.notifier).verifyTwoFactorPin(
            phone: widget.phone,
            continuationToken: widget.continuationToken,
            pin: pin,
          );
      // AuthState devient "authenticated" — le routeur redirige tout seul.
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return AuthShell(
      title: 'Vérification en deux étapes',
      subtitle: 'Entrez votre code PIN à 4-6 chiffres.',
      footer: GestureDetector(
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => PinRecoveryScreen(phone: widget.phone)),
        ),
        child: Text('PIN oublié ?', style: TextStyle(color: c.accent2, fontWeight: FontWeight.w600)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AuthFormField(
            label: 'PIN',
            child: TextField(
              controller: _pin,
              keyboardType: TextInputType.number,
              obscureText: true,
              maxLength: 6,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 22, letterSpacing: 8, fontWeight: FontWeight.w600),
              decoration: const InputDecoration(counterText: ''),
              onSubmitted: (_) => _submit(),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 14),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: c.danger.withValues(alpha: 0.1),
                border: Border.all(color: c.danger.withValues(alpha: 0.3)),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(_error!, style: TextStyle(color: c.danger, fontSize: 13)),
            ),
          ],
          const SizedBox(height: 20),
          AuthPrimaryButton(
            label: 'Confirmer',
            loadingLabel: 'Vérification...',
            loading: _submitting,
            onPressed: _submit,
          ),
        ],
      ),
    );
  }
}
