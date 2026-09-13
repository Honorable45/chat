import 'package:flutter/material.dart';
import '../../core/theme.dart';
import '../../services/api_client.dart';
import '../../widgets/auth_shell.dart';

enum _RecoveryStep { requestPhone, verifyPhone, resetPin, done }

/// "PIN oublié" (section 4) : numéro → SMS de reconfirmation → code envoyé à
/// l'email de secours déjà vérifié → nouveau PIN. Un seul écran, 3 étapes
/// locales — chaque étape appelle réellement l'endpoint correspondant,
/// jamais simulée.
class PinRecoveryScreen extends StatefulWidget {
  final String phone;

  const PinRecoveryScreen({super.key, required this.phone});

  @override
  State<PinRecoveryScreen> createState() => _PinRecoveryScreenState();
}

class _PinRecoveryScreenState extends State<PinRecoveryScreen> {
  _RecoveryStep _step = _RecoveryStep.requestPhone;
  final _phoneCode = TextEditingController();
  final _emailCode = TextEditingController();
  final _newPin = TextEditingController();
  String? _continuationToken;
  String? _error;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _requestPhoneOtp();
  }

  @override
  void dispose() {
    _phoneCode.dispose();
    _emailCode.dispose();
    _newPin.dispose();
    super.dispose();
  }

  Future<void> _requestPhoneOtp() async {
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ApiClient.instance.recoveryRequest(widget.phone);
      if (mounted) setState(() => _step = _RecoveryStep.verifyPhone);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _verifyPhone() async {
    if (_phoneCode.text.trim().length != 6) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final token = await ApiClient.instance.recoveryVerifyPhone(
        phone: widget.phone,
        code: _phoneCode.text.trim(),
      );
      _continuationToken = token;
      if (mounted) setState(() => _step = _RecoveryStep.resetPin);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _resetPin() async {
    if (_emailCode.text.trim().length != 6 || _newPin.text.trim().isEmpty) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ApiClient.instance.recoveryResetPin(
        phone: widget.phone,
        continuationToken: _continuationToken!,
        emailCode: _emailCode.text.trim(),
        newPin: _newPin.text.trim(),
      );
      if (mounted) setState(() => _step = _RecoveryStep.done);
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
      title: 'Récupération du PIN',
      subtitle: switch (_step) {
        _RecoveryStep.requestPhone => 'Envoi du code de reconfirmation...',
        _RecoveryStep.verifyPhone => 'Entrez le code SMS reçu au ${widget.phone}.',
        _RecoveryStep.resetPin => 'Entrez le code reçu par email et votre nouveau PIN.',
        _RecoveryStep.done => 'PIN mis à jour.',
      },
      footer: Text(
        _step == _RecoveryStep.done
            ? 'Vous pouvez maintenant vous connecter avec ce nouveau PIN.'
            : "La récupération nécessite un email de secours déjà vérifié dans Paramètres → Sécurité.",
        style: TextStyle(color: c.muted),
      ),
      child: _buildStep(c),
    );
  }

  Widget _buildStep(GlottaColors c) {
    switch (_step) {
      case _RecoveryStep.requestPhone:
        return const Padding(
          padding: EdgeInsets.symmetric(vertical: 24),
          child: Center(child: CircularProgressIndicator()),
        );
      case _RecoveryStep.verifyPhone:
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AuthFormField(
              label: 'Code SMS',
              child: TextField(
                controller: _phoneCode,
                keyboardType: TextInputType.number,
                maxLength: 6,
                textAlign: TextAlign.center,
                decoration: const InputDecoration(counterText: ''),
              ),
            ),
            if (_error != null) _errorBox(c),
            const SizedBox(height: 20),
            AuthPrimaryButton(
              label: 'Continuer',
              loadingLabel: 'Vérification...',
              loading: _submitting,
              onPressed: _verifyPhone,
            ),
          ],
        );
      case _RecoveryStep.resetPin:
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AuthFormField(
              label: 'Code reçu par email',
              child: TextField(
                controller: _emailCode,
                keyboardType: TextInputType.number,
                maxLength: 6,
                textAlign: TextAlign.center,
                decoration: const InputDecoration(counterText: ''),
              ),
            ),
            const SizedBox(height: 14),
            AuthFormField(
              label: 'Nouveau PIN',
              child: TextField(
                controller: _newPin,
                keyboardType: TextInputType.number,
                obscureText: true,
                maxLength: 6,
                textAlign: TextAlign.center,
                decoration: const InputDecoration(counterText: ''),
              ),
            ),
            if (_error != null) _errorBox(c),
            const SizedBox(height: 20),
            AuthPrimaryButton(
              label: 'Réinitialiser le PIN',
              loadingLabel: 'Enregistrement...',
              loading: _submitting,
              onPressed: _resetPin,
            ),
          ],
        );
      case _RecoveryStep.done:
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Icon(Icons.check_circle, color: c.online, size: 48),
            const SizedBox(height: 16),
            AuthPrimaryButton(
              label: 'Retour à la connexion',
              loadingLabel: '',
              loading: false,
              onPressed: () => Navigator.of(context).popUntil((route) => route.isFirst),
            ),
          ],
        );
    }
  }

  Widget _errorBox(GlottaColors c) => Padding(
        padding: const EdgeInsets.only(top: 14),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: c.danger.withValues(alpha: 0.1),
            border: Border.all(color: c.danger.withValues(alpha: 0.3)),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Text(_error!, style: TextStyle(color: c.danger, fontSize: 13)),
        ),
      );
}
