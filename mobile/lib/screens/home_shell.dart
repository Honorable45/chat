import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/theme.dart';
import '../state/auth_state.dart';
import '../state/conversations_state.dart';
import 'calls/call_screen.dart';
import 'chat/conversation_list_screen.dart';
import 'chat/new_conversation_screen.dart';
import 'contacts/add_contact_sheet.dart';
import 'contacts/contacts_screen.dart';
import 'notifications/notifications_screen.dart';
import 'settings/profile_screen.dart';
import 'statuses/statuses_screen.dart';
import '../services/api_client.dart';
import '../services/call_service.dart';
import '../widgets/icon_rail.dart';

/// Port de la structure générale de `chat/page.tsx` : rail d'icônes à
/// gauche (voir IconRail) + un panneau de contenu qui change selon
/// `activeView`, jamais deux écrans séparés — le rail reste affiché quelle
/// que soit la largeur tant qu'aucune conversation n'est ouverte (voir
/// ChatScreen, poussé par-dessus en plein écran, qui masque tout ça).
class HomeShell extends ConsumerStatefulWidget {
  const HomeShell({super.key});

  @override
  ConsumerState<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends ConsumerState<HomeShell> {
  RailView _activeView = RailView.conversations;
  int _unreadNotifications = 0;
  final _contactsKey = GlobalKey<ContactsScreenState>();

  CallPhase _lastCallPhase = CallPhase.idle;
  bool _callScreenOpen = false;

  @override
  void initState() {
    super.initState();
    _refreshUnreadCount();
    // Fait apparaître ce nouveau message CALL dans l'aperçu de la
    // conversation concernée — même rôle que `onCallMessage` côté web (voir
    // call_service.dart), simplifié en un rechargement complet plutôt qu'un
    // correctif incrémental (les appels restent des événements rares).
    CallService.instance.onCallMessage = (_) => ref.read(conversationsProvider.notifier).load();
    CallService.instance.addListener(_onCallServiceChanged);
  }

  @override
  void dispose() {
    CallService.instance.removeListener(_onCallServiceChanged);
    super.dispose();
  }

  /// Ouvre/ferme CallScreen en plein écran selon les transitions de phase —
  /// jamais via `ref.listen(callServiceProvider, ...)` : `CallService` étant
  /// un `ChangeNotifier` muté en place, `previous`/`next` y pointeraient vers
  /// le même objet (déjà muté) au moment de l'appel, rendant tout diff
  /// impossible. On écoute directement le singleton et on garde la dernière
  /// phase connue nous-mêmes.
  void _onCallServiceChanged() {
    if (!mounted) return;
    final phase = CallService.instance.phase;
    if (_lastCallPhase == CallPhase.idle && phase != CallPhase.idle && !_callScreenOpen) {
      _callScreenOpen = true;
      Navigator.of(context)
          .push(MaterialPageRoute(builder: (_) => const CallScreen(), fullscreenDialog: true))
          .then((_) => _callScreenOpen = false);
    } else if (_lastCallPhase != CallPhase.idle && phase == CallPhase.idle && _callScreenOpen) {
      Navigator.of(context).maybePop();
    }
    _lastCallPhase = phase;
  }

  bool get _showAddContactFab =>
      _activeView == RailView.conversations ||
      _activeView == RailView.groups ||
      _activeView == RailView.contacts;

  void _refreshUnreadCount() {
    ApiClient.instance.unreadNotificationCount().then((count) {
      if (mounted) setState(() => _unreadNotifications = count);
    }).catchError((_) {});
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
      // Bouton flottant WhatsApp ("+ ajouter un contact") — visible sur les
      // vues "liste" (Conversations/Groupes/Contacts), pas seulement sur
      // Contacts : demande explicite de l'utilisateur, "le bouton doit
      // rester là, pas besoin d'aller sur Contacts d'abord". Absent sur
      // Notifications (rien à y ajouter).
      floatingActionButton: _showAddContactFab
          ? FloatingActionButton(
              onPressed: () => showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                builder: (_) => AddContactSheet(
                  onRequestSent: () => _contactsKey.currentState?.refresh(),
                ),
              ),
              backgroundColor: c.accent,
              child: Icon(Icons.person_add_alt_1, color: c.accentContrast),
            )
          : null,
      body: SafeArea(
        child: Row(
          children: [
            IconRail(
              me: me,
              activeView: _activeView,
              unreadNotifications: _unreadNotifications,
              onSelectView: (view) {
                setState(() => _activeView = view);
                // Pas de mise à jour en direct par socket pour l'instant
                // (voir NotificationsScreen) — un rafraîchissement à chaque
                // changement d'onglet reste correct (avant ET après une
                // visite de Notifications, où des éléments viennent d'être
                // marqués lus), juste pas instantané.
                _refreshUnreadCount();
              },
              onNewConversation: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const NewConversationScreen()),
              ),
              // Premier icône du rail (l'avatar) → écran de profil WhatsApp
              // directement, plus de menu popup intermédiaire.
              onOpenProfile: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const ProfileScreen()),
              ),
            ),
            Expanded(child: _content()),
          ],
        ),
      ),
    );
  }

  Widget _content() {
    switch (_activeView) {
      case RailView.conversations:
        return const ConversationListScreen();
      case RailView.groups:
        return const ConversationListScreen(groupsOnly: true);
      case RailView.contacts:
        return ContactsScreen(key: _contactsKey);
      case RailView.notifications:
        return const NotificationsScreen();
      case RailView.statuses:
        return const StatusesScreen();
      case RailView.calls:
        return const ConversationListScreen();
    }
  }
}
