import 'package:flutter/material.dart';
import '../core/theme.dart';
import '../models/user.dart';
import 'avatar.dart';

enum RailView { conversations, groups, statuses, calls, contacts, notifications }

/// Port pixel-pour-pixel de `frontend/src/components/chat/IconRail.tsx` :
/// rail vertical de 64px toujours visible tant qu'aucune conversation n'est
/// ouverte (voir HomeShell — masqué en plein écran uniquement par
/// ChatScreen, jamais par un breakpoint de largeur : le web garde ce rail
/// même à largeur mobile, contrairement à un rail "desktop-only" classique).
/// Le tout premier icône (l'avatar, en haut de cette première colonne) ouvre
/// directement ProfileScreen — demande explicite : plus de menu popup
/// intermédiaire ("Paramètres"/"Se déconnecter" y sont déjà, via
/// SettingsSectionsList intégrée à ProfileScreen).
class IconRail extends StatefulWidget {
  final Me me;
  final RailView activeView;
  final int unreadNotifications;
  final ValueChanged<RailView> onSelectView;
  final VoidCallback onNewConversation;
  final VoidCallback onOpenProfile;

  const IconRail({
    super.key,
    required this.me,
    required this.activeView,
    required this.unreadNotifications,
    required this.onSelectView,
    required this.onNewConversation,
    required this.onOpenProfile,
  });

  @override
  State<IconRail> createState() => _IconRailState();
}

class _IconRailState extends State<IconRail> {
  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return Container(
      width: 64,
      decoration: BoxDecoration(
        color: c.surface,
        border: Border(right: BorderSide(color: c.border)),
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: Column(
            children: [
              GestureDetector(
                onTap: widget.onOpenProfile,
                child: GlottaAvatar(
                  firstName: widget.me.firstName,
                  lastName: widget.me.lastName,
                  avatarUrl: widget.me.profile?.avatarUrl,
                  online: widget.me.isOnline,
                  size: 40,
                ),
              ),
              const SizedBox(height: 16),
              Container(width: 32, height: 1, color: c.border),
              const SizedBox(height: 16),
              _RailButton(
                icon: Icons.grid_view_rounded,
                label: 'Conversations',
                active: widget.activeView == RailView.conversations,
                onTap: () => widget.onSelectView(RailView.conversations),
              ),
              const SizedBox(height: 8),
              _RailButton(
                icon: Icons.groups_outlined,
                label: 'Groupes',
                active: widget.activeView == RailView.groups,
                onTap: () => widget.onSelectView(RailView.groups),
              ),
              const SizedBox(height: 8),
              _RailButton(
                icon: Icons.camera_alt_outlined,
                label: 'Statuts',
                active: widget.activeView == RailView.statuses,
                onTap: () => widget.onSelectView(RailView.statuses),
              ),
              const SizedBox(height: 8),
              _RailButton(
                icon: Icons.call_outlined,
                label: 'Appels',
                active: widget.activeView == RailView.calls,
                disabled: true,
                onTap: () => widget.onSelectView(RailView.calls),
              ),
              const SizedBox(height: 8),
              _RailButton(
                icon: Icons.people_outline,
                label: 'Contacts',
                active: widget.activeView == RailView.contacts,
                onTap: () => widget.onSelectView(RailView.contacts),
              ),
              const SizedBox(height: 8),
              _RailButton(
                icon: Icons.notifications_outlined,
                label: 'Notifications',
                active: widget.activeView == RailView.notifications,
                badge: widget.unreadNotifications,
                onTap: () => widget.onSelectView(RailView.notifications),
              ),
              const Spacer(),
              GestureDetector(
                onTap: widget.onNewConversation,
                child: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(colors: [c.accent, c.accent2]),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(Icons.add, color: c.accentContrast),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RailButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool active;
  final bool disabled;
  final int badge;
  final VoidCallback onTap;

  const _RailButton({
    required this.icon,
    required this.label,
    required this.active,
    required this.onTap,
    this.disabled = false,
    this.badge = 0,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return Tooltip(
      message: disabled ? '$label — bientôt disponible' : label,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: disabled
            ? () => ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text('$label — bientôt disponible.')),
                )
            : onTap,
        child: Opacity(
          opacity: disabled ? 0.4 : 1,
          child: Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              gradient: active ? LinearGradient(colors: [c.accent, c.accent2]) : null,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Stack(
              alignment: Alignment.center,
              children: [
                Icon(icon, size: 20, color: active ? c.accentContrast : c.muted),
                if (badge > 0)
                  Positioned(
                    top: 4,
                    right: 4,
                    child: Container(
                      padding: const EdgeInsets.all(3),
                      decoration: BoxDecoration(color: c.unread, shape: BoxShape.circle),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
