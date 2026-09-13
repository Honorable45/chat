import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/theme.dart';
import '../../services/api_client.dart';
import '../../state/auth_state.dart';
import '../../widgets/avatar.dart';
import 'edit_profile_screen.dart';
import 'settings_sections.dart';

/// Port de l'écran "Profil" de WhatsApp (référence fournie) : bulle de
/// statut au-dessus d'un grand avatar, nom en dessous, icône crayon dans
/// l'AppBar vers l'écran d'édition des champs (EditProfileScreen), puis les
/// mêmes sections que Paramètres en dessous ("avec paramètre en bas
/// aussi" — même redondance que le vrai WhatsApp).
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
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

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final me = ref.watch(authProvider).me;
    if (me == null) {
      return Scaffold(backgroundColor: c.background, body: const Center(child: CircularProgressIndicator()));
    }
    final statusText = me.profile?.statusText?.isNotEmpty == true
        ? me.profile!.statusText!
        : 'Salut ! J’utilise Glotta.';

    return Scaffold(
      backgroundColor: c.background,
      appBar: AppBar(
        title: const Text('Profil'),
        actions: [
          IconButton(
            icon: const Icon(Icons.edit_outlined),
            tooltip: 'Modifier le profil',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const EditProfileScreen()),
            ),
          ),
        ],
      ),
      body: ListView(
        children: [
          Container(
            width: double.infinity,
            color: c.surface,
            padding: const EdgeInsets.symmetric(vertical: 28),
            child: Column(
              children: [
                _StatusBubble(text: statusText),
                const SizedBox(height: 18),
                GestureDetector(
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
                          width: 34,
                          height: 34,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            gradient: LinearGradient(colors: [c.accent, c.accent2]),
                            border: Border.all(color: c.surface, width: 3),
                          ),
                          child: Icon(Icons.camera_alt, color: c.accentContrast, size: 16),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                Text(me.displayName, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text('@${me.username}', style: TextStyle(color: c.muted, fontSize: 13)),
              ],
            ),
          ),
          const SizedBox(height: 12),
          const SettingsSectionsList(),
        ],
      ),
    );
  }
}

class _StatusBubble extends StatelessWidget {
  final String text;

  const _StatusBubble({required this.text});

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return Column(
      children: [
        Container(
          constraints: const BoxConstraints(maxWidth: 260),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            color: c.surfaceRaised,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Text(
            text,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13.5, color: c.foreground),
          ),
        ),
        CustomPaint(size: const Size(14, 7), painter: _BubbleTailPainter(color: c.surfaceRaised)),
      ],
    );
  }
}

class _BubbleTailPainter extends CustomPainter {
  final Color color;

  const _BubbleTailPainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path()
      ..moveTo(size.width / 2 - 6, 0)
      ..lineTo(size.width / 2 + 6, 0)
      ..lineTo(size.width / 2, size.height)
      ..close();
    canvas.drawPath(path, Paint()..color = color);
  }

  @override
  bool shouldRepaint(covariant _BubbleTailPainter oldDelegate) => oldDelegate.color != color;
}
