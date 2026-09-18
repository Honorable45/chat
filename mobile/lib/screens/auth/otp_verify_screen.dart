import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme.dart';
import '../../models/auth_flow.dart';
import '../../services/api_client.dart';
import '../../state/auth_state.dart';
import '../../widgets/auth_shell.dart';
import 'two_factor_pin_screen.dart';

/// Saisie du code à 6 chiffres reçu par SMS — enchaîne sur
/// AuthNotifier.verifyRegisterOtp ou verifyLoginOtp selon `purpose`. Après une
/// inscription réussie, `AuthState.needsProfileSetup` passe à `true` et le
/// routeur (voir router.dart) redirige automatiquement vers
/// ProfileSetupScreen (nom, username, photo, bio) — rien à faire ici.
class OtpVerifyScreen extends ConsumerStatefulWidget {
  final String phone;
  final OtpPurpose purpose;

  const OtpVerifyScreen({super.key, required this.phone, required this.purpose});

  @override
  ConsumerState<OtpVerifyScreen> createState() => _OtpVerifyScreenState();
}

class _OtpVerifyScreenState extends ConsumerState<OtpVerifyScreen> {
  final _code = TextEditingController();
  String? _error;
  bool _submitting = false;
  bool _resending = false;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _resend() async {
    setState(() => _resending = true);
    try {
      await ref.read(authProvider.notifier).requestOtp(widget.phone);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Code renvoyé.')));
      }
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _resending = false);
    }
  }

  Future<void> _submit() async {
    final code = _code.text.trim();
    if (code.length != 6) return;
    setState(() {
      _error = null;
      _submitting = true;
    });
    try {
      if (widget.purpose == OtpPurpose.register) {
        await ref.read(authProvider.notifier).verifyRegisterOtp(phone: widget.phone, code: code);
        // Rien à faire ensuite : AuthState devient "authenticated" avec
        // needsProfileSetup=true, le routeur (voir router.dart) redirige tout
        // seul vers /profile-setup.
      } else {
        final result = await ref
            .read(authProvider.notifier)
            .verifyLoginOtp(phone: widget.phone, code: code);
        if (result.requiresTwoFactor) {
          if (!mounted) return;
          await Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => TwoFactorPinScreen(
                phone: widget.phone,
                continuationToken: result.continuationToken!,
              ),
            ),
          );
        }
      }
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
      title: 'Vérification',
      subtitle: 'Entrez le code à 6 chiffres envoyé au ${widget.phone}.',
      footer: Wrap(
        alignment: WrapAlignment.center,
        children: [
          const Text('Vous n’avez rien reçu ? '),
          GestureDetector(
            onTap: _resending ? null : _resend,
            child: Text(
              _resending ? 'Envoi...' : 'Renvoyer le code',
              style: TextStyle(color: c.accent2, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AuthFormField(
            label: 'Code de vérification',
            child: TextField(
              controller: _code,
              keyboardType: TextInputType.number,
              maxLength: 6,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 22, letterSpacing: 8, fontWeight: FontWeight.w600),
              decoration: const InputDecoration(counterText: '', hintText: '000000'),
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
            label: 'Vérifier',
            loadingLabel: 'Vérification...',
            loading: _submitting,
            onPressed: _submit,
          ),
        ],
      ),
    );
  }
}
