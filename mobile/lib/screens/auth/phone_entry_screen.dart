import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme.dart';
import '../../services/api_client.dart';
import '../../state/auth_state.dart';
import '../../widgets/auth_shell.dart';
import 'otp_verify_screen.dart';

/// Port de l'écran d'accueil WhatsApp : un seul champ "numéro de téléphone",
/// aucune mention d'inscription/connexion — le backend décide lui-même
/// (voir AuthService.requestOtp) et cet écran enchaîne simplement sur
/// OtpVerifyScreen avec le `purpose` renvoyé.
class PhoneEntryScreen extends ConsumerStatefulWidget {
  const PhoneEntryScreen({super.key});

  @override
  ConsumerState<PhoneEntryScreen> createState() => _PhoneEntryScreenState();
}

class _PhoneEntryScreenState extends ConsumerState<PhoneEntryScreen> {
  final _phone = TextEditingController();
  String? _error;
  bool _submitting = false;

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final phone = _phone.text.trim();
    if (phone.isEmpty) return;
    setState(() {
      _error = null;
      _submitting = true;
    });
    try {
      final purpose = await ref.read(authProvider.notifier).requestOtp(phone);
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => OtpVerifyScreen(phone: phone, purpose: purpose)),
      );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Impossible d’envoyer le code. Réessayez.');
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return AuthShell(
      title: 'Bienvenue sur Glotta',
      subtitle: 'Entrez votre numéro de téléphone pour commencer.',
      footer: Text(
        'Un code de vérification vous sera envoyé par SMS.',
        style: TextStyle(color: c.muted),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AuthFormField(
            label: 'Numéro de téléphone',
            child: TextField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              autofillHints: const [AutofillHints.telephoneNumber],
              textInputAction: TextInputAction.done,
              decoration: const InputDecoration(hintText: '+228 90 00 00 00'),
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
            label: 'Continuer',
            loadingLabel: 'Envoi du code...',
            loading: _submitting,
            onPressed: _submit,
          ),
        ],
      ),
    );
  }
}
