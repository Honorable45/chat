import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/theme.dart';
import '../../services/api_client.dart';
import '../../state/auth_state.dart';
import '../../widgets/avatar.dart';

/// Port de l'écran "Modifier le profil" de WhatsApp (référence fournie) —
/// ouvert via l'icône crayon de ProfileScreen, jamais affiché seul : avatar
/// centré avec pastille appareil-photo, puis les lignes Nom / Infos / Nom
/// d'utilisateur / Téléphone, chacune ouvrant une feuille d'édition —
/// "Liens" n'a pas d'équivalent backend et n'est donc pas affiché (jamais
/// de champ qui ne fait rien).
class EditProfileScreen extends ConsumerStatefulWidget {
  const EditProfileScreen({super.key});

  @override
  ConsumerState<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends ConsumerState<EditProfileScreen> {
  bool _uploadingAvatar = false;

  Future<void> _refreshMe() async {
    final me = await ApiClient.instance.me();
    ref.read(authProvider.notifier).setMe(me);
  }

  Future<void> _changePhoto() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (picked == null) return;
    setState(() => _uploadingAvatar = true);
    try {
      await ApiClient.instance.setAvatar(picked.path);
      await _refreshMe();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _uploadingAvatar = false);
    }
  }

  Future<void> _removePhoto() async {
    setState(() => _uploadingAvatar = true);
    try {
      await ApiClient.instance.removeAvatar();
      await _refreshMe();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _uploadingAvatar = false);
    }
  }

  void _showPhotoSheet() {
    final me = ref.read(authProvider).me;
    showModalBottomSheet<void>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_outlined),
              title: const Text('Changer la photo'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                _changePhoto();
              },
            ),
            if (me?.profile?.avatarUploaded == true)
              ListTile(
                leading: const Icon(Icons.delete_outline),
                title: const Text('Supprimer la photo'),
                onTap: () {
                  Navigator.of(sheetContext).pop();
                  _removePhoto();
                },
              ),
          ],
        ),
      ),
    );
  }

  /// Changement de numéro (section 4) : obligatoirement OTP-gated côté
  /// backend (POST auth/phone/request-change puis auth/phone/verify-change)
  /// — jamais un simple updateMe(phone:), qui n'accepte plus ce champ.
  Future<void> _changePhone() async {
    final newPhone = await _promptText(title: 'Nouveau numéro', hint: '+22890000000');
    if (newPhone == null || newPhone.isEmpty) return;
    try {
      await ApiClient.instance.requestPhoneChangeOtp(newPhone);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      return;
    }
    if (!mounted) return;
    final code = await _promptText(
      title: 'Code reçu par SMS',
      maxLength: 6,
      keyboardType: TextInputType.number,
    );
    if (code == null || code.isEmpty) return;
    try {
      await ApiClient.instance.verifyPhoneChangeOtp(newPhone: newPhone, code: code);
      await _refreshMe();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<String?> _promptText({
    required String title,
    String? hint,
    int? maxLength,
    TextInputType? keyboardType,
  }) {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: maxLength,
          keyboardType: keyboardType,
          decoration: InputDecoration(hintText: hint),
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

  Future<void> _editText({
    required String title,
    required String initial,
    required int maxLength,
    required Future<void> Function(String value) onSave,
  }) async {
    final controller = TextEditingController(text: initial);
    final result = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => Padding(
        padding: EdgeInsets.only(
          left: 16,
          right: 16,
          top: 16,
          bottom: 16 + MediaQuery.of(sheetContext).viewInsets.bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: 12),
            TextField(controller: controller, autofocus: true, maxLength: maxLength),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton(
                onPressed: () => Navigator.of(sheetContext).pop(controller.text.trim()),
                child: const Text('Enregistrer'),
              ),
            ),
          ],
        ),
      ),
    );
    if (result == null || result == initial) return;
    try {
      await onSave(result);
      await _refreshMe();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final me = ref.watch(authProvider).me;
    if (me == null) {
      return Scaffold(backgroundColor: c.background, body: const Center(child: CircularProgressIndicator()));
    }

    return Scaffold(
      backgroundColor: c.background,
      appBar: AppBar(title: const Text('Modifier le profil')),
      body: ListView(
        children: [
          const SizedBox(height: 24),
          Center(
            child: GestureDetector(
              onTap: _uploadingAvatar ? null : _showPhotoSheet,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Opacity(
                    opacity: _uploadingAvatar ? 0.5 : 1,
                    child: GlottaAvatar(
                      firstName: me.firstName,
                      lastName: me.lastName,
                      avatarUrl: me.profile?.avatarUrl,
                      size: 140,
                    ),
                  ),
                  if (_uploadingAvatar)
                    const Positioned.fill(child: Center(child: CircularProgressIndicator())),
                  Positioned(
                    right: 4,
                    bottom: 4,
                    child: Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: LinearGradient(colors: [c.accent, c.accent2]),
                        border: Border.all(color: c.background, width: 3),
                      ),
                      child: Icon(Icons.camera_alt, color: c.accentContrast, size: 17),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 32),
          _profileRow(
            c,
            icon: Icons.person_outline,
            label: 'Nom',
            value: me.displayName,
            onTap: () => _editText(
              title: 'Nom',
              initial: '${me.firstName} ${me.lastName}'.trim(),
              maxLength: 80,
              onSave: (value) async {
                final split = value.trim().split(RegExp(r'\s+'));
                final firstName = split.first;
                final lastName = split.length > 1 ? split.sublist(1).join(' ') : '';
                await ApiClient.instance.updateMe(firstName: firstName, lastName: lastName);
              },
            ),
          ),
          _divider(c),
          _profileRow(
            c,
            icon: Icons.info_outline,
            label: 'Infos',
            value: me.profile?.statusText?.isNotEmpty == true ? me.profile!.statusText! : 'Salut ! J’utilise Glotta.',
            onTap: () => _editText(
              title: 'Infos',
              initial: me.profile?.statusText ?? '',
              maxLength: 140,
              onSave: (value) => ApiClient.instance.updateMyProfile(statusText: value),
            ),
          ),
          _divider(c),
          _profileRow(
            c,
            icon: Icons.alternate_email,
            label: "Nom d'utilisateur",
            value: '@${me.username}',
            onTap: () => _editText(
              title: "Nom d'utilisateur",
              initial: me.username,
              maxLength: 32,
              onSave: (value) => ApiClient.instance.updateMe(username: value),
            ),
          ),
          _divider(c),
          _profileRow(
            c,
            icon: Icons.phone_outlined,
            label: 'Téléphone',
            value: me.phone?.isNotEmpty == true ? me.phone! : 'Ajouter un numéro',
            onTap: _changePhone,
          ),
        ],
      ),
    );
  }

  Widget _divider(GlottaColors c) => Padding(
        padding: const EdgeInsets.only(left: 56),
        child: Divider(height: 1, color: c.border),
      );

  Widget _profileRow(
    GlottaColors c, {
    required IconData icon,
    required String label,
    required String value,
    required VoidCallback onTap,
  }) {
    return ListTile(
      leading: Icon(icon, color: c.muted),
      title: Text(label, style: TextStyle(fontSize: 12.5, color: c.muted)),
      subtitle: Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Text(value, style: const TextStyle(fontSize: 16)),
      ),
      trailing: const Icon(Icons.chevron_right),
      onTap: onTap,
    );
  }
}
