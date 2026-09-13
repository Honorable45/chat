import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import '../../core/theme.dart';
import '../../models/conversation.dart';
import '../../models/public_user.dart';
import '../../services/api_client.dart';
import '../../state/conversations_state.dart';
import '../../widgets/avatar.dart';
import 'group_permissions_screen.dart';

/// Port de l'écran "Nouveau groupe" (référence WhatsApp fournie) : photo +
/// nom en tête, ligne "Autorisations du groupe" vers son propre écran,
/// grille de membres (avatar + nom, comme des puces) avec un bouton
/// "Ajouter" rond en dernière position, bouton flottant en bas à droite
/// pour valider — jamais un simple bouton "Créer" dans l'AppBar.
class CreateGroupScreen extends ConsumerStatefulWidget {
  const CreateGroupScreen({super.key});

  @override
  ConsumerState<CreateGroupScreen> createState() => _CreateGroupScreenState();
}

class _CreateGroupScreenState extends ConsumerState<CreateGroupScreen> {
  final _title = TextEditingController();
  List<PublicUser>? _contacts;
  final Map<String, PublicUser> _selected = {};
  String? _photoPath;
  GroupPermissions _permissions = const GroupPermissions();
  bool _creating = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    ApiClient.instance.contacts().then((list) {
      if (mounted) setState(() => _contacts = list);
    }).catchError((e) {
      if (mounted) {
        setState(() => _error = e is ApiException ? e.message : 'Impossible de charger les contacts.');
      }
    });
  }

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  Future<void> _pickPhoto() async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (picked != null && mounted) setState(() => _photoPath = picked.path);
  }

  Future<void> _openPermissions() async {
    final result = await Navigator.of(context).push<GroupPermissions>(
      MaterialPageRoute(builder: (_) => GroupPermissionsScreen(initial: _permissions)),
    );
    if (result != null && mounted) setState(() => _permissions = result);
  }

  void _openAddMembers() {
    final contacts = _contacts;
    if (contacts == null) return;
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => _AddMembersSheet(
        contacts: contacts,
        alreadySelected: _selected.keys.toSet(),
        onDone: (picked) => setState(() {
          for (final u in picked) {
            _selected[u.id] = u;
          }
        }),
      ),
    );
  }

  Future<void> _create() async {
    final title = _title.text.trim();
    if (title.isEmpty || _selected.length < 2) return;
    setState(() {
      _creating = true;
      _error = null;
    });
    try {
      var conversation = await ApiClient.instance.createGroup(
        title: title,
        memberIds: _selected.keys.toList(),
        photoPath: _photoPath,
      );
      const defaults = GroupPermissions();
      if (_permissions.editInfo != defaults.editInfo ||
          _permissions.sendMessages != defaults.sendMessages ||
          _permissions.addMembers != defaults.addMembers) {
        conversation = await ApiClient.instance.updateGroupPermissions(
          conversation.id,
          editInfo: _permissions.editInfo,
          sendMessages: _permissions.sendMessages,
          addMembers: _permissions.addMembers,
        );
      }
      await ref.read(conversationsProvider.notifier).load();
      if (!mounted) return;
      context.pop();
      context.push('/conversations/${conversation.id}');
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final canCreate = _title.text.trim().isNotEmpty && _selected.length >= 2 && !_creating;

    return Scaffold(
      backgroundColor: c.background,
      appBar: AppBar(title: const Text('Nouveau groupe')),
      floatingActionButton: FloatingActionButton(
        backgroundColor: canCreate ? null : c.muted,
        onPressed: canCreate ? _create : null,
        child: _creating
            ? SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2, color: c.accentContrast),
              )
            : Icon(Icons.check, color: c.accentContrast),
      ),
      body: ListView(
        padding: const EdgeInsets.only(bottom: 96),
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                GestureDetector(
                  onTap: _pickPhoto,
                  child: _photoPath != null
                      ? CircleAvatar(radius: 30, backgroundImage: FileImage(File(_photoPath!)))
                      : CircleAvatar(
                          radius: 30,
                          backgroundColor: c.surfaceRaised,
                          child: Icon(Icons.camera_alt_outlined, color: c.muted),
                        ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: TextField(
                    controller: _title,
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(hintText: 'Saisir le nom du groupe'),
                  ),
                ),
              ],
            ),
          ),
          ListTile(
            leading: Icon(Icons.settings_outlined, color: c.muted),
            title: const Text('Autorisations du groupe'),
            trailing: const Icon(Icons.chevron_right),
            onTap: _openPermissions,
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Text(
              _selected.isEmpty ? 'Membres : aucun' : 'Membres : ${_selected.length}',
              style: TextStyle(fontSize: 13, color: c.muted),
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Text(_error!, style: TextStyle(color: c.danger, fontSize: 12.5)),
            ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Wrap(
              spacing: 4,
              runSpacing: 12,
              children: [
                for (final u in _selected.values)
                  SizedBox(
                    width: 72,
                    child: Column(
                      children: [
                        Stack(
                          clipBehavior: Clip.none,
                          children: [
                            GlottaAvatar(firstName: u.firstName, lastName: u.lastName, avatarUrl: u.avatarUrl, size: 56),
                            Positioned(
                              right: -2,
                              top: -2,
                              child: GestureDetector(
                                onTap: () => setState(() => _selected.remove(u.id)),
                                child: Container(
                                  padding: const EdgeInsets.all(2),
                                  decoration: BoxDecoration(color: c.background, shape: BoxShape.circle),
                                  child: Icon(Icons.cancel, size: 18, color: c.muted),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          u.firstName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 11.5),
                        ),
                      ],
                    ),
                  ),
                SizedBox(
                  width: 72,
                  child: Column(
                    children: [
                      GestureDetector(
                        onTap: _openAddMembers,
                        child: CircleAvatar(
                          radius: 28,
                          backgroundColor: c.accent,
                          child: Icon(Icons.person_add_alt_1, color: c.accentContrast),
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text('Ajouter', style: TextStyle(fontSize: 11.5, color: c.muted)),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AddMembersSheet extends StatefulWidget {
  final List<PublicUser> contacts;
  final Set<String> alreadySelected;
  final void Function(List<PublicUser> picked) onDone;

  const _AddMembersSheet({
    required this.contacts,
    required this.alreadySelected,
    required this.onDone,
  });

  @override
  State<_AddMembersSheet> createState() => _AddMembersSheetState();
}

class _AddMembersSheetState extends State<_AddMembersSheet> {
  late final Set<String> _picked = {...widget.alreadySelected};

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.7,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 8, 8),
              child: Row(
                children: [
                  const Expanded(
                    child: Text('Ajouter des membres', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                  ),
                  TextButton(
                    onPressed: () {
                      widget.onDone(widget.contacts.where((u) => _picked.contains(u.id)).toList());
                      Navigator.of(context).pop();
                    },
                    child: const Text('OK'),
                  ),
                ],
              ),
            ),
            Expanded(
              child: widget.contacts.isEmpty
                  ? Center(child: Text('Aucun contact.', style: TextStyle(color: c.muted)))
                  : ListView.builder(
                      itemCount: widget.contacts.length,
                      itemBuilder: (context, index) {
                        final u = widget.contacts[index];
                        final selected = _picked.contains(u.id);
                        return CheckboxListTile(
                          value: selected,
                          onChanged: (v) => setState(() {
                            if (v == true) {
                              _picked.add(u.id);
                            } else {
                              _picked.remove(u.id);
                            }
                          }),
                          secondary: GlottaAvatar(firstName: u.firstName, lastName: u.lastName, avatarUrl: u.avatarUrl, size: 40),
                          title: Text(u.displayName),
                          subtitle: Text('@${u.username}'),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
