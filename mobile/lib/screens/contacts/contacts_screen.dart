import 'package:flutter/material.dart';
import '../../core/theme.dart';
import '../../models/public_user.dart';
import '../../services/api_client.dart';
import '../../widgets/avatar.dart';

/// Port de `ContactsPanel.tsx` : demandes reçues en attente, puis la liste
/// des contacts déjà acceptés. La recherche pour en ajouter un nouveau vit
/// maintenant dans `AddContactSheet`, ouverte depuis le bouton flottant de
/// HomeShell (demande explicite : "le bouton d'ajout de contact flottant
/// comme sur WhatsApp, en bas à droite") plutôt qu'une barre de recherche
/// toujours affichée ici.
class ContactsScreen extends StatefulWidget {
  const ContactsScreen({super.key});

  @override
  State<ContactsScreen> createState() => ContactsScreenState();
}

class ContactsScreenState extends State<ContactsScreen> {
  List<PublicUser>? _contacts;
  List<ContactRequest> _incoming = [];
  String? _error;
  final Set<String> _busyIds = {};

  @override
  void initState() {
    super.initState();
    refresh();
  }

  /// Public : rappelé par HomeShell après l'envoi d'une demande depuis
  /// `AddContactSheet` (aucun effet visible ici tant que l'autre partie n'a
  /// pas accepté, mais garde "Demandes reçues" à jour si jamais une réponse
  /// arrive vite) et par le bouton flottant lui-même au retour.
  void refresh() {
    ApiClient.instance.contacts().then((list) {
      if (mounted) setState(() => _contacts = list);
    }).catchError((e) {
      if (mounted) setState(() => _error = e is ApiException ? e.message : 'Impossible de charger les contacts.');
    });
    ApiClient.instance.contactRequests().then((list) {
      if (mounted) setState(() => _incoming = list);
    }).catchError((_) {});
  }

  Future<void> _accept(ContactRequest request) async {
    setState(() => _busyIds.add(request.id));
    try {
      await ApiClient.instance.acceptContactRequest(request.id);
      refresh();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busyIds.remove(request.id));
    }
  }

  Future<void> _decline(ContactRequest request) async {
    setState(() => _busyIds.add(request.id));
    try {
      await ApiClient.instance.declineContactRequest(request.id);
      refresh();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busyIds.remove(request.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final contacts = _contacts;

    return ListView(
      // Marge basse généreuse : le bouton flottant d'ajout (voir HomeShell)
      // ne doit jamais recouvrir la dernière ligne de la liste.
      padding: const EdgeInsets.fromLTRB(0, 8, 0, 88),
      children: [
        const Padding(
          padding: EdgeInsets.fromLTRB(16, 8, 16, 4),
          child: Text('Contacts', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
        ),
        if (_incoming.isNotEmpty) ...[
          _sectionLabel(c, 'Demandes reçues'),
          ..._incoming.map((r) => _IncomingRequestTile(
                request: r,
                busy: _busyIds.contains(r.id),
                onAccept: () => _accept(r),
                onDecline: () => _decline(r),
              )),
          const SizedBox(height: 8),
        ],
        _sectionLabel(c, 'Vos contacts'),
        if (contacts == null && _error != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            child: Text(_error!, style: TextStyle(color: c.danger)),
          )
        else if (contacts == null)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Center(child: CircularProgressIndicator()),
          )
        else if (contacts.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
            child: Text(
              "Aucun contact pour le moment. Utilisez le bouton en bas à droite pour en ajouter un.",
              style: TextStyle(color: c.muted),
            ),
          )
        else
          ...contacts.map((u) => ListTile(
                leading: GlottaAvatar(
                  firstName: u.firstName,
                  lastName: u.lastName,
                  avatarUrl: u.avatarUrl,
                  online: u.isOnline,
                  size: 40,
                ),
                title: Text(u.displayName),
                subtitle: Text(
                  u.statusText?.isNotEmpty == true ? u.statusText! : '@${u.username}',
                  style: TextStyle(color: c.muted),
                ),
              )),
      ],
    );
  }

  Widget _sectionLabel(GlottaColors c, String text) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
        child: Text(
          text.toUpperCase(),
          style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: c.muted, letterSpacing: 0.4),
        ),
      );
}

class _IncomingRequestTile extends StatelessWidget {
  final ContactRequest request;
  final bool busy;
  final VoidCallback onAccept;
  final VoidCallback onDecline;

  const _IncomingRequestTile({
    required this.request,
    required this.busy,
    required this.onAccept,
    required this.onDecline,
  });

  @override
  Widget build(BuildContext context) {
    final u = request.user;
    return ListTile(
      leading: GlottaAvatar(firstName: u.firstName, lastName: u.lastName, avatarUrl: u.avatarUrl, size: 40),
      title: Text(u.displayName),
      subtitle: Text('@${u.username}'),
      trailing: busy
          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
          : Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(icon: const Icon(Icons.close), onPressed: onDecline),
                IconButton(icon: const Icon(Icons.check), onPressed: onAccept),
              ],
            ),
    );
  }
}
