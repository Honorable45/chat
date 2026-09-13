import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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
class ConversationListScreen extends ConsumerStatefulWidget {
  /// "groups" : n'affiche que les conversations GROUP (vue dédiée du rail,
  /// voir IconRail) — même widget, jamais dupliqué (même principe que le web).
  final bool groupsOnly;

  const ConversationListScreen({super.key, this.groupsOnly = false});

  @override
  ConsumerState<ConversationListScreen> createState() => _ConversationListScreenState();
}

class _ConversationListScreenState extends ConsumerState<ConversationListScreen> {
  final _query = TextEditingController();

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final state = ref.watch(conversationsProvider);
    final me = ref.watch(authProvider).me;
    final myUserId = me?.id ?? '';

    final base = widget.groupsOnly
        ? state.items.where((cv) => cv.type == ConversationType.group).toList()
        : state.items;

    final q = _query.text.trim().toLowerCase();
    final filtered = q.isEmpty
        ? base
        : base.where((conv) {
            final name = conv.displayTitle('Conversation').toLowerCase();
            return name.contains(q) || (conv.otherParticipant?.username.toLowerCase().contains(q) ?? false);
          }).toList();

    final totalUnread = base.fold<int>(0, (sum, c) => sum + c.unreadCount);
    final quickAccess =
        widget.groupsOnly ? const <Conversation>[] : base.where((c) => c.otherParticipant != null).take(6).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 12, 8),
          child: Row(
            children: [
              Expanded(
                child: Row(
                  children: [
                    Text(
                      widget.groupsOnly ? 'Groupes' : 'Messages',
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
                                    ? (widget.groupsOnly
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
                          return _ConversationRow(conversation: filtered[index - 1], myUserId: myUserId);
                        },
                      ),
          ),
        ),
      ],
    );
  }
}

class _ConversationRow extends StatelessWidget {
  final Conversation conversation;
  final String myUserId;

  const _ConversationRow({required this.conversation, required this.myUserId});

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final other = conversation.otherParticipant;
    final name = conversation.displayTitle('Conversation');
    final last = conversation.lastMessage;
    final missed = last != null && conversation.unreadCount > 0 && isMissedCallForMe(last, myUserId);

    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => context.push('/conversations/${conversation.id}'),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        child: Row(
          children: [
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
    );
  }
}
