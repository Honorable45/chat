import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_slidable/flutter_slidable.dart';
import 'package:go_router/go_router.dart';
import '../../core/conversation_preview.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../models/conversation.dart';
import '../../state/auth_state.dart';
import '../../state/conversations_state.dart';
import '../../widgets/avatar.dart';
import 'create_group_screen.dart';

/// Port de `frontend/src/components/chat/ConversationList.tsx` — même
/// structure (en-tête "Messages" + compteur de non-lus, accès rapide,
/// recherche, lignes avatar/nom/aperçu/heure/badge). Contenu seul (pas de
/// Scaffold/AppBar à lui) : embarqué dans HomeShell à côté du rail
/// d'icônes, exactement comme la 2e colonne du web.
///
/// Étend le port d'origine avec l'appui long → sélection multiple (sections
/// 3-4), le swipe (section 34) et le pin/archive/mute (sections 6-8).
class ConversationListScreen extends ConsumerStatefulWidget {
  /// "groups" : n'affiche que les conversations GROUP (vue dédiée du rail,
  /// voir IconRail) — même widget, jamais dupliqué (même principe que le web).
  final bool groupsOnly;
  /// Écran "Archivées" (section 6) — même widget, juste le filtre inverse
  /// (archivées uniquement, jamais mélangées à la liste principale).
  final bool archivedOnly;

  const ConversationListScreen({super.key, this.groupsOnly = false, this.archivedOnly = false});

  @override
  ConsumerState<ConversationListScreen> createState() => _ConversationListScreenState();
}

class _ConversationListScreenState extends ConsumerState<ConversationListScreen> {
  final _query = TextEditingController();
  final Set<String> _selectedIds = {};

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  void _toggleSelection(String id) {
    setState(() {
      if (_selectedIds.contains(id)) {
        _selectedIds.remove(id);
      } else {
        _selectedIds.add(id);
      }
    });
  }

  void _clearSelection() => setState(_selectedIds.clear);

  List<Conversation> _selectedConversations(List<Conversation> all) =>
      all.where((c) => _selectedIds.contains(c.id)).toList();

  Future<void> _confirmAndHideSelected(List<Conversation> selected) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Supprimer la conversation ?'),
        content: Text(
          selected.length > 1
              ? 'Ces ${selected.length} conversations seront supprimées de votre liste.'
              : 'Cette conversation sera supprimée de votre liste.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(dialogContext).pop(false), child: const Text('Annuler')),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Supprimer'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final notifier = ref.read(conversationsProvider.notifier);
    for (final c in selected) {
      await notifier.hide(c.id);
    }
    _clearSelection();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final state = ref.watch(conversationsProvider);
    final me = ref.watch(authProvider).me;
    final myUserId = me?.id ?? '';

    final byArchive = state.items.where((cv) => cv.myMembership.isArchived == widget.archivedOnly);
    final base = widget.groupsOnly
        ? byArchive.where((cv) => cv.type == ConversationType.group).toList()
        : byArchive.toList();
    final archivedCount =
        widget.archivedOnly ? 0 : state.items.where((cv) => cv.myMembership.isArchived).length;

    final q = _query.text.trim().toLowerCase();
    final filtered = q.isEmpty
        ? base
        : base.where((conv) {
            final name = conv.displayTitle('Conversation').toLowerCase();
            return name.contains(q) || (conv.otherParticipant?.username.toLowerCase().contains(q) ?? false);
          }).toList();

    final totalUnread = base.fold<int>(0, (sum, c) => sum + c.unreadCount);
    final quickAccess = widget.groupsOnly || widget.archivedOnly
        ? const <Conversation>[]
        : base.where((c) => c.otherParticipant != null).take(6).toList();

    final selected = _selectedConversations(state.items);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (_selectedIds.isNotEmpty)
          _selectionBar(c, selected)
        else ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 12, 8),
            child: Row(
              children: [
                Expanded(
                  child: Row(
                    children: [
                      Text(
                        widget.archivedOnly
                            ? 'Archivées'
                            : widget.groupsOnly
                                ? 'Groupes'
                                : 'Messages',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
                      ),
                      if (totalUnread > 0) ...[
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: c.unread.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            '$totalUnread nouveau${totalUnread > 1 ? 'x' : ''}',
                            style: TextStyle(color: c.unread, fontSize: 12, fontWeight: FontWeight.w600),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                if (!widget.archivedOnly)
                  IconButton(
                    tooltip: 'Créer un groupe',
                    icon: Icon(Icons.people_outline, size: 20, color: c.muted),
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const CreateGroupScreen()),
                    ),
                  ),
              ],
            ),
          ),
          if (quickAccess.isNotEmpty)
            SizedBox(
              height: 66,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                itemCount: quickAccess.length,
                separatorBuilder: (context, index) => const SizedBox(width: 12),
                itemBuilder: (context, index) {
                  final conv = quickAccess[index];
                  final other = conv.otherParticipant!;
                  return GestureDetector(
                    onTap: () => context.push('/conversations/${conv.id}'),
                    child: GlottaAvatar(
                      firstName: other.firstName,
                      lastName: other.lastName,
                      avatarUrl: other.avatarUrl,
                      online: other.isOnline,
                      size: 44,
                    ),
                  );
                },
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: TextField(
              controller: _query,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                hintText: 'Chercher un nom...',
                prefixIcon: Icon(Icons.search, size: 20),
              ),
            ),
          ),
          if (archivedCount > 0)
            ListTile(
              leading: Icon(Icons.archive_outlined, color: c.muted),
              title: Text('Archivées', style: TextStyle(color: c.foreground)),
              trailing: Text('$archivedCount', style: TextStyle(color: c.muted)),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const ConversationListScreen(archivedOnly: true)),
              ),
            ),
        ],
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => ref.read(conversationsProvider.notifier).load(),
            child: state.loading
                ? const Center(child: CircularProgressIndicator())
                : filtered.isEmpty
                    ? ListView(
                        children: [
                          Padding(
                            padding: const EdgeInsets.only(top: 64),
                            child: Center(
                              child: Text(
                                base.isEmpty
                                    ? (widget.archivedOnly
                                        ? 'Aucune conversation archivée.'
                                        : widget.groupsOnly
                                            ? "Vous ne faites partie d'aucun groupe."
                                            : 'Aucune conversation. Lancez-en une avec le bouton en bas du rail.')
                                    : 'Aucun résultat.',
                                textAlign: TextAlign.center,
                                style: TextStyle(color: c.muted),
                              ),
                            ),
                          ),
                        ],
                      )
                    : ListView.builder(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        itemCount: filtered.length + 1,
                        itemBuilder: (context, index) {
                          if (index == 0) {
                            return Padding(
                              padding: const EdgeInsets.fromLTRB(10, 2, 10, 4),
                              child: Text(
                                (widget.groupsOnly ? 'Tous les groupes' : 'Toutes les conversations').toUpperCase(),
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                  color: c.muted,
                                  letterSpacing: 0.4,
                                ),
                              ),
                            );
                          }
                          final conv = filtered[index - 1];
                          return _ConversationRow(
                            key: ValueKey(conv.id),
                            conversation: conv,
                            myUserId: myUserId,
                            selected: _selectedIds.contains(conv.id),
                            selectionMode: _selectedIds.isNotEmpty,
                            onTap: () => _selectedIds.isNotEmpty
                                ? _toggleSelection(conv.id)
                                : context.push('/conversations/${conv.id}'),
                            onLongPress: () => _toggleSelection(conv.id),
                          );
                        },
                      ),
          ),
        ),
      ],
    );
  }

  Widget _selectionBar(GlottaColors c, List<Conversation> selected) {
    final notifier = ref.read(conversationsProvider.notifier);
    final anyUnread = selected.any((cv) => cv.unreadCount > 0);
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 12, 12, 8),
      child: Row(
        children: [
          IconButton(icon: const Icon(Icons.close), onPressed: _clearSelection),
          Expanded(
            child: Text(
              '${selected.length} sélectionnée${selected.length > 1 ? 's' : ''}',
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
            ),
          ),
          if (selected.length == 1)
            IconButton(
              tooltip: selected.first.myMembership.isPinned ? 'Désépingler' : 'Épingler',
              icon: Icon(selected.first.myMembership.isPinned ? Icons.push_pin : Icons.push_pin_outlined),
              onPressed: () {
                notifier.togglePin(selected.first.id, selected.first.myMembership.isPinned);
                _clearSelection();
              },
            ),
          IconButton(
            tooltip: anyUnread ? 'Marquer comme lu' : 'Marquer comme non lu',
            icon: Icon(anyUnread ? Icons.mark_chat_read_outlined : Icons.mark_chat_unread_outlined),
            onPressed: () {
              for (final cv in selected) {
                if (anyUnread) {
                  notifier.markAsRead(cv.id);
                } else {
                  notifier.markAsUnread(cv.id);
                }
              }
              _clearSelection();
            },
          ),
          IconButton(
            tooltip: widget.archivedOnly ? 'Désarchiver' : 'Archiver',
            icon: Icon(widget.archivedOnly ? Icons.unarchive_outlined : Icons.archive_outlined),
            onPressed: () {
              for (final cv in selected) {
                notifier.toggleArchive(cv.id, cv.myMembership.isArchived);
              }
              _clearSelection();
            },
          ),
          IconButton(
            tooltip: selected.every((cv) => cv.myMembership.isMuted) ? 'Réactiver les notifications' : 'Mettre en sourdine',
            icon: Icon(
              selected.every((cv) => cv.myMembership.isMuted)
                  ? Icons.notifications_active_outlined
                  : Icons.notifications_off_outlined,
            ),
            onPressed: () {
              final allMuted = selected.every((cv) => cv.myMembership.isMuted);
              for (final cv in selected) {
                notifier.toggleMute(cv.id, allMuted ? true : cv.myMembership.isMuted);
              }
              _clearSelection();
            },
          ),
          IconButton(
            tooltip: 'Supprimer',
            icon: Icon(Icons.delete_outline, color: c.danger),
            onPressed: () => _confirmAndHideSelected(selected),
          ),
        ],
      ),
    );
  }
}

class _ConversationRow extends ConsumerWidget {
  final Conversation conversation;
  final String myUserId;
  final bool selected;
  final bool selectionMode;
  final VoidCallback onTap;
  final VoidCallback onLongPress;

  const _ConversationRow({
    super.key,
    required this.conversation,
    required this.myUserId,
    required this.selected,
    required this.selectionMode,
    required this.onTap,
    required this.onLongPress,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.glotta;
    final other = conversation.otherParticipant;
    final name = conversation.displayTitle('Conversation');
    final last = conversation.lastMessage;
    final missed = last != null && conversation.unreadCount > 0 && isMissedCallForMe(last, myUserId);
    final membership = conversation.myMembership;

    return Slidable(
      key: ValueKey(conversation.id),
      // Swipe droite (section 34) : lu/non lu selon l'état actuel.
      startActionPane: ActionPane(
        motion: const ScrollMotion(),
        extentRatio: 0.28,
        children: [
          SlidableAction(
            onPressed: (_) => conversation.unreadCount > 0
                ? ref.read(conversationsProvider.notifier).markAsRead(conversation.id)
                : ref.read(conversationsProvider.notifier).markAsUnread(conversation.id),
            backgroundColor: c.accent2,
            foregroundColor: Colors.white,
            icon: conversation.unreadCount > 0 ? Icons.mark_chat_read : Icons.mark_chat_unread,
            label: conversation.unreadCount > 0 ? 'Lu' : 'Non lu',
          ),
        ],
      ),
      // Swipe gauche (section 34) : épingler/archiver/muet.
      endActionPane: ActionPane(
        motion: const ScrollMotion(),
        extentRatio: 0.6,
        children: [
          SlidableAction(
            onPressed: (_) => ref
                .read(conversationsProvider.notifier)
                .togglePin(conversation.id, membership.isPinned),
            backgroundColor: c.accent,
            foregroundColor: Colors.white,
            icon: membership.isPinned ? Icons.push_pin : Icons.push_pin_outlined,
            label: membership.isPinned ? 'Désépingler' : 'Épingler',
          ),
          SlidableAction(
            onPressed: (_) => ref
                .read(conversationsProvider.notifier)
                .toggleMute(conversation.id, membership.isMuted),
            backgroundColor: c.muted,
            foregroundColor: Colors.white,
            icon: membership.isMuted ? Icons.notifications_active_outlined : Icons.notifications_off_outlined,
            label: membership.isMuted ? 'Son' : 'Muet',
          ),
          SlidableAction(
            onPressed: (_) => ref
                .read(conversationsProvider.notifier)
                .toggleArchive(conversation.id, membership.isArchived),
            backgroundColor: c.danger,
            foregroundColor: Colors.white,
            icon: membership.isArchived ? Icons.unarchive_outlined : Icons.archive_outlined,
            label: membership.isArchived ? 'Désarchiver' : 'Archiver',
          ),
        ],
      ),
      child: Material(
        color: selected ? c.accent2.withValues(alpha: 0.12) : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          onLongPress: onLongPress,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
            child: Row(
              children: [
                if (selectionMode)
                  Padding(
                    padding: const EdgeInsets.only(right: 4),
                    child: Icon(
                      selected ? Icons.check_circle : Icons.radio_button_unchecked,
                      color: selected ? c.accent2 : c.muted,
                      size: 22,
                    ),
                  ),
                other != null
                    ? GlottaAvatar(
                        firstName: other.firstName,
                        lastName: other.lastName,
                        avatarUrl: other.avatarUrl,
                        online: other.isOnline,
                        size: 46,
                      )
                    : GlottaAvatar(firstName: name, avatarUrl: conversation.photoUrl, size: 46),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          if (membership.isPinned) ...[
                            Icon(Icons.push_pin, size: 13, color: c.muted),
                            const SizedBox(width: 3),
                          ],
                          Expanded(
                            child: Text(
                              name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5, color: c.foreground),
                            ),
                          ),
                          if (last != null)
                            Text(
                              shortRelativeTime(last.sentAt),
                              style: TextStyle(fontSize: 11, color: c.muted),
                            ),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          if (membership.isMuted) ...[
                            Icon(Icons.notifications_off_outlined, size: 13, color: c.muted),
                            const SizedBox(width: 4),
                          ],
                          Expanded(
                            child: Text(
                              conversationPreview(conversation, myUserId),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(fontSize: 12.5, color: missed ? c.danger : c.muted),
                            ),
                          ),
                          if (conversation.unreadCount > 0)
                            Container(
                              margin: const EdgeInsets.only(left: 6),
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              constraints: const BoxConstraints(minWidth: 20),
                              decoration: BoxDecoration(color: c.unread, borderRadius: BorderRadius.circular(999)),
                              child: Text(
                                '${conversation.unreadCount}',
                                textAlign: TextAlign.center,
                                style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600),
                              ),
                            ),
                        ],
                      ),
                    ],
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
