import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/theme.dart';
import '../../services/api_client.dart';
import '../../state/auth_state.dart';
import '../../widgets/auth_shell.dart';
import '../../widgets/avatar.dart';

enum _SetupStep { identity, photo, bio }

/// Étape 3 du cahier des charges ("Profil") : nom affiché + username, photo,
/// message sous le profil — affiché juste après une inscription réussie
/// (voir AuthState.needsProfileSetup / router.dart), jamais pour une
/// connexion. Photo et bio sont facultatives ("Passer"). N'appelle que des
/// endpoints déjà utilisés ailleurs (EditProfileScreen) : PATCH /users/me,
/// POST /users/me/avatar, PATCH /users/me/profile — aucun nouvel endpoint
/// backend n'est nécessaire pour cet écran.
class ProfileSetupScreen extends ConsumerStatefulWidget {
  const ProfileSetupScreen({super.key});

  @override
  ConsumerState<ProfileSetupScreen> createState() => _ProfileSetupScreenState();
}

class _ProfileSetupScreenState extends ConsumerState<ProfileSetupScreen> {
  _SetupStep _step = _SetupStep.identity;
  late final TextEditingController _displayName;
  late final TextEditingController _username;
  final _bio = TextEditingController();
  String? _avatarPath;
  String? _error;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    final me = ref.read(authProvider).me;
    _displayName = TextEditingController(text: me?.displayName ?? '');
    _username = TextEditingController(text: me?.username ?? '');
  }

  @override
  void dispose() {
    _displayName.dispose();
    _username.dispose();
    _bio.dispose();
    super.dispose();
  }

  Future<void> _saveIdentity() async {
    final name = _displayName.text.trim();
    final username = _username.text.trim();
    if (name.isEmpty || username.isEmpty) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final split = name.split(RegExp(r'\s+'));
      final firstName = split.first;
      final lastName = split.length > 1 ? split.sublist(1).join(' ') : '';
      final me = await ApiClient.instance.updateMe(
        firstName: firstName,
        lastName: lastName,
        username: username,
      );
      ref.read(authProvider.notifier).setMe(me);
      if (mounted) setState(() => _step = _SetupStep.photo);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _pickPhoto() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (picked == null) return;
    setState(() => _avatarPath = picked.path);
  }

  Future<void> _savePhotoAndContinue() async {
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final path = _avatarPath;
      if (path != null) {
        await ApiClient.instance.setAvatar(path);
        final me = await ApiClient.instance.me();
        ref.read(authProvider.notifier).setMe(me);
      }
      if (mounted) setState(() => _step = _SetupStep.bio);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _saveBioAndFinish() async {
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final bio = _bio.text.trim();
      if (bio.isNotEmpty) {
        await ApiClient.instance.updateMyProfile(statusText: bio);
      }
      ref.read(authProvider.notifier).completeProfileSetup();
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
      title: switch (_step) {
        _SetupStep.identity => 'Votre profil',
        _SetupStep.photo => 'Photo de profil',
        _SetupStep.bio => 'Un mot sur vous',
      },
      subtitle: switch (_step) {
        _SetupStep.identity => 'Choisissez votre nom et votre nom d\'utilisateur.',
        _SetupStep.photo => 'Facultatif — vous pourrez le faire plus tard.',
        _SetupStep.bio => 'Facultatif — un petit message sous votre profil.',
      },
      footer: Text(
        'Étape ${_step.index + 1} sur 3',
        style: TextStyle(color: c.muted),
      ),
      child: _buildStep(c),
    );
  }

  Widget _buildStep(GlottaColors c) {
    switch (_step) {
      case _SetupStep.identity:
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AuthFormField(
              label: 'Nom affiché',
              child: TextField(
                controller: _displayName,
                textInputAction: TextInputAction.next,
                decoration: const InputDecoration(hintText: 'Honoré'),
              ),
            ),
            const SizedBox(height: 14),
            AuthFormField(
              label: "Nom d'utilisateur",
              child: TextField(
                controller: _username,
                textInputAction: TextInputAction.done,
                decoration: const InputDecoration(hintText: 'honore'),
                onSubmitted: (_) => _saveIdentity(),
              ),
            ),
            if (_error != null) _errorBox(c),
            const SizedBox(height: 20),
            AuthPrimaryButton(
              label: 'Continuer',
              loadingLabel: 'Enregistrement...',
              loading: _submitting,
              onPressed: _saveIdentity,
            ),
          ],
        );
      case _SetupStep.photo:
        final me = ref.watch(authProvider).me;
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: GestureDetector(
                onTap: _pickPhoto,
                child: _avatarPath != null
                    ? CircleAvatar(radius: 60, backgroundImage: FileImage(File(_avatarPath!)))
                    : GlottaAvatar(
                        firstName: me?.firstName ?? '',
                        lastName: me?.lastName ?? '',
                        avatarUrl: me?.profile?.avatarUrl,
                        size: 120,
                      ),
              ),
            ),
            const SizedBox(height: 12),
            Center(
              child: TextButton(onPressed: _pickPhoto, child: const Text('Choisir une photo')),
            ),
            if (_error != null) _errorBox(c),
            const SizedBox(height: 20),
            AuthPrimaryButton(
              label: 'Continuer',
              loadingLabel: 'Enregistrement...',
              loading: _submitting,
              onPressed: _savePhotoAndContinue,
            ),
            const SizedBox(height: 8),
            Center(
              child: TextButton(
                onPressed: _submitting ? null : () => setState(() => _step = _SetupStep.bio),
                child: const Text('Passer'),
              ),
            ),
          ],
        );
      case _SetupStep.bio:
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AuthFormField(
              label: 'Message sous le profil',
              child: TextField(
                controller: _bio,
                maxLength: 140,
                decoration: const InputDecoration(hintText: 'Disponible pour discuter'),
                onSubmitted: (_) => _saveBioAndFinish(),
              ),
            ),
            if (_error != null) _errorBox(c),
            const SizedBox(height: 20),
            AuthPrimaryButton(
              label: 'Terminer',
              loadingLabel: 'Enregistrement...',
              loading: _submitting,
              onPressed: _saveBioAndFinish,
            ),
            const SizedBox(height: 8),
            Center(
              child: TextButton(
                onPressed: _submitting
                    ? null
                    : () {
                        _bio.clear();
                        _saveBioAndFinish();
                      },
                child: const Text('Passer'),
              ),
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
