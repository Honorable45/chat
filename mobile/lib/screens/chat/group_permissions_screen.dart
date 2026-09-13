import 'package:flutter/material.dart';
import '../../core/theme.dart';
import '../../models/conversation.dart';

/// Port de l'écran "Autorisations du groupe" (référence WhatsApp fournie) —
/// seules les 3 premières bascules correspondent à un vrai champ côté
/// backend (`GroupPermission` sur `editInfo`/`sendMessages`/`addMembers`,
/// voir UpdateGroupDto) ; "Inviter via un lien" et "Approuver les nouveaux
/// membres" n'ont pas d'équivalent dans ce backend — affichées mais
/// désactivées, même convention que le rail pour une fonctionnalité pas
/// encore construite plutôt que simulée.
class GroupPermissionsScreen extends StatefulWidget {
  final GroupPermissions initial;

  const GroupPermissionsScreen({super.key, required this.initial});

  @override
  State<GroupPermissionsScreen> createState() => _GroupPermissionsScreenState();
}

class _GroupPermissionsScreenState extends State<GroupPermissionsScreen> {
  late GroupPermissions _permissions = widget.initial;

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return Scaffold(
      backgroundColor: c.background,
      appBar: AppBar(
        title: const Text('Autorisations du groupe'),
        leading: BackButton(onPressed: () => Navigator.of(context).pop(_permissions)),
      ),
      body: ListView(
        children: [
          _sectionLabel(c, 'Les membres peuvent :'),
          _permissionTile(
            c,
            icon: Icons.edit_outlined,
            title: 'Modifier les paramètres du groupe',
            subtitle: 'Le nom, la photo et la description du groupe.',
            value: _permissions.editInfo == GroupPermission.everyone,
            onChanged: (v) => setState(() => _permissions = _permissions.copyWith(
                  editInfo: v ? GroupPermission.everyone : GroupPermission.adminOnly,
                )),
          ),
          _permissionTile(
            c,
            icon: Icons.chat_bubble_outline,
            title: 'Envoyer de nouveaux messages',
            value: _permissions.sendMessages == GroupPermission.everyone,
            onChanged: (v) => setState(() => _permissions = _permissions.copyWith(
                  sendMessages: v ? GroupPermission.everyone : GroupPermission.adminOnly,
                )),
          ),
          _permissionTile(
            c,
            icon: Icons.person_add_alt_outlined,
            title: "Ajouter d'autres membres",
            value: _permissions.addMembers == GroupPermission.everyone,
            onChanged: (v) => setState(() => _permissions = _permissions.copyWith(
                  addMembers: v ? GroupPermission.everyone : GroupPermission.adminOnly,
                )),
          ),
          _permissionTile(
            c,
            icon: Icons.link,
            title: 'Inviter via un lien ou un code QR',
            value: false,
            onChanged: null,
          ),
          const SizedBox(height: 8),
          _sectionLabel(c, 'Les admins peuvent :'),
          _permissionTile(
            c,
            icon: Icons.pending_actions_outlined,
            title: 'Approuver les nouveaux membres',
            subtitle: 'Lorsque cette option est activée, les admins doivent approuver toute demande d\'adhésion.',
            value: false,
            onChanged: null,
          ),
        ],
      ),
    );
  }

  Widget _sectionLabel(GlottaColors c, String text) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
        child: Text(text, style: TextStyle(fontSize: 12.5, color: c.muted)),
      );

  Widget _permissionTile(
    GlottaColors c, {
    required IconData icon,
    required String title,
    String? subtitle,
    required bool value,
    required ValueChanged<bool>? onChanged,
  }) {
    final disabled = onChanged == null;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Icon(icon, size: 20, color: disabled ? c.muted.withValues(alpha: 0.5) : c.muted),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 14.5,
                    color: disabled ? c.muted : c.foreground,
                  ),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 3),
                  Text(subtitle, style: TextStyle(fontSize: 12, color: c.muted)),
                ],
              ],
            ),
          ),
          Switch(value: value, onChanged: onChanged, activeThumbColor: c.accent2),
        ],
      ),
    );
  }
}
