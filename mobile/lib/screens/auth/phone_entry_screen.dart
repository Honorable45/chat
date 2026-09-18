import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl_phone_field/intl_phone_field.dart';
import '../../core/config.dart';
import '../../core/theme.dart';
import '../../models/auth_flow.dart';
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
  // Renseigné par IntlPhoneField.onChanged — toujours déjà normalisé au
  // format international E.164 (indicatif + numéro), jamais reconstruit à
  // la main : voir PhoneNumber.completeNumber.
  String _phone = '';
  String? _error;
  bool _submitting = false;

  Future<void> _submit() async {
    final phone = _phone.trim();
    if (phone.isEmpty) return;
    setState(() {
      _error = null;
      _submitting = true;
    });
    try {
      final purpose = await ref.read(authProvider.notifier).requestOtp(phone);
      if (!mounted) return;

      // Bascule temporaire (voir AppConfig.registrationOtpEnabled) : pour
      // une inscription, le backend n'a de toute façon envoyé aucun SMS
      // tant qu'elle est désactivée (voir AuthService.isRegistrationOtpEnabled)
      // — passer par OtpVerifyScreen demanderait un code qui n'existe pas.
      // Le numéro est considéré vérifié tel quel ; `code` est ignoré
      // côté serveur dans ce cas (voir VerifyRegisterOtpDto). La connexion
      // (purpose == login) garde toujours son écran de code normal.
      if (purpose == OtpPurpose.register && !AppConfig.registrationOtpEnabled) {
        await ref.read(authProvider.notifier).verifyRegisterOtp(phone: phone, code: '000000');
        return;
      }

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
        'Votre compte sera créé directement si vous êtes nouveau.',
        style: TextStyle(color: c.muted),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AuthFormField(
            label: 'Numéro de téléphone',
            child: IntlPhoneField(
              initialCountryCode: 'TG',
              disableLengthCheck: true,
              textInputAction: TextInputAction.done,
              decoration: const InputDecoration(hintText: '90 00 00 00'),
              onChanged: (value) => _phone = value.completeNumber,
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
