import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../core/format.dart';
import '../../core/theme.dart';
import '../../models/notification.dart';
import '../../services/api_client.dart';

/// Port de `NotificationsPanel.tsx` — `actorName` est gravé une fois pour
/// toutes dans le payload par le backend (jamais résolu à la volée ici),
/// absent seulement pour un type sans acteur identifiable ou une
/// notification antérieure à cet enrichissement : on retombe alors sur le
/// texte générique.
String _describe(AppNotification n) {
  final actorName = n.payload['actorName'] as String?;
  final preview = n.payload['preview'] as String?;
  switch (n.type) {
    case 'NEW_MESSAGE':
      return actorName != null ? '$actorName : ${preview ?? "nouveau message"}' : (preview ?? 'Nouveau message');
    case 'NEW_VOICE_MESSAGE':
      return actorName != null ? '$actorName : 🎤 message vocal' : '🎤 Nouveau message vocal';
    case 'INCOMING_CALL':
      return '📞 Appel entrant';
    case 'MISSED_CALL':
      return actorName != null ? '📞 Appel manqué de $actorName' : '📞 Appel manqué';
    case 'TRANSLATION_COMPLETED':
      return 'Traduction terminée';
    case 'CONTACT_REQUEST':
      return actorName != null ? '$actorName souhaite vous ajouter en contact' : 'Nouvelle demande de contact';
    case 'REACTION':
      return actorName != null ? '$actorName a réagi à votre message' : 'Nouvelle réaction à votre message';
    case 'CONTACT_ACCEPTED':
      return actorName != null
          ? '$actorName a accepté votre demande de contact'
          : 'Votre demande de contact a été acceptée';
    case 'MENTION':
      return actorName != null
          ? '$actorName vous a mentionné(e) dans un groupe'
          : 'Vous avez été mentionné(e) dans un groupe';
    case 'ADDED_TO_GROUP':
      return 'Vous avez été ajouté(e) à un groupe';
    case 'REMOVED_FROM_GROUP':
      return "Vous avez été retiré(e) d'un groupe";
    case 'PROMOTED_ADMIN':
      return 'Vous êtes maintenant administrateur(rice) du groupe';
    default:
      return 'Nouvelle notification';
  }
}

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<AppNotification>? _items;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    ApiClient.instance.notifications().then((page) {
      if (mounted) setState(() => _items = page.items);
    }).catchError((e) {
      if (mounted) {
        setState(() => _error = e is ApiException ? e.message : 'Impossible de charger les notifications.');
      }
    });
  }

  Future<void> _markAllRead() async {
    final items = _items;
    if (items == null) return;
    setState(() {
      _items = items.map((n) => n.readAt == null ? n.copyWith(readAt: DateTime.now()) : n).toList();
    });
    try {
      await ApiClient.instance.markAllNotificationsRead();
    } catch (_) {
      // silencieux, comme côté web : l'utilisateur peut réessayer.
    }
  }

  Future<void> _open(AppNotification n) async {
    if (n.readAt == null) {
      setState(() {
        _items = _items?.map((x) => x.id == n.id ? x.copyWith(readAt: DateTime.now()) : x).toList();
      });
      ApiClient.instance.markNotificationRead(n.id).catchError((_) {});
    }
    final conversationId = n.payload['conversationId'] as String?;
    if (conversationId != null) context.push('/conversations/$conversationId');
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final items = _items;
    final hasUnread = items?.any((n) => n.readAt == null) ?? false;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 12, 8),
          child: Row(
            children: [
              const Expanded(
                child: Text('Notifications', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
              ),
              if (hasUnread)
                TextButton(
                  onPressed: _markAllRead,
                  child: const Text('Tout marquer lu'),
                ),
            ],
          ),
        ),
        Expanded(
          child: _error != null
              ? Center(child: Text(_error!, style: TextStyle(color: c.danger)))
              : items == null
                  ? const Center(child: CircularProgressIndicator())
                  : items.isEmpty
                      ? Center(
                          child: Text("Aucune notification pour l'instant.", style: TextStyle(color: c.muted)),
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          itemCount: items.length,
                          itemBuilder: (context, index) {
                            final n = items[index];
                            final unread = n.readAt == null;
                            return InkWell(
                              borderRadius: BorderRadius.circular(12),
                              onTap: () => _open(n),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        if (unread) ...[
                                          Container(
                                            width: 6,
                                            height: 6,
                                            decoration: BoxDecoration(color: c.unread, shape: BoxShape.circle),
                                          ),
                                          const SizedBox(width: 8),
                                        ],
                                        Expanded(
                                          child: Text(
                                            _describe(n),
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: TextStyle(
                                              fontSize: 13.5,
                                              color: unread ? c.foreground : c.muted,
                                              fontWeight: unread ? FontWeight.w500 : FontWeight.normal,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 2),
                                    Text(shortRelativeTime(n.createdAt), style: TextStyle(fontSize: 11, color: c.muted)),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
        ),
      ],
    );
  }
}
