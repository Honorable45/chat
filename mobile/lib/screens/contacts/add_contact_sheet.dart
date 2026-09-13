import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/theme.dart';
import '../../models/public_user.dart';
import '../../services/api_client.dart';
import '../../widgets/avatar.dart';

/// Recherche + envoi de demande de contact — ouvert via le bouton flottant
/// de ContactsScreen (voir HomeShell), jamais affiché en ligne dans la
/// liste : même contenu qu'avant, juste déplacé dans une feuille modale
/// pour un bouton d'ajout flottant façon WhatsApp plutôt qu'une barre de
/// recherche toujours visible.
class AddContactSheet extends StatefulWidget {
  final VoidCallback onRequestSent;

  const AddContactSheet({super.key, required this.onRequestSent});

  @override
  State<AddContactSheet> createState() => _AddContactSheetState();
}

class _AddContactSheetState extends State<AddContactSheet> {
  final _query = TextEditingController();
  List<PublicUser> _results = [];
  bool _searching = false;
  final Set<String> _busyIds = {};
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    super.dispose();
  }

  void _onQueryChanged(String value) {
    _debounce?.cancel();
    final q = value.trim();
    if (q.length < 2) {
      setState(() => _results = []);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 300), () async {
      setState(() => _searching = true);
      try {
        final results = await ApiClient.instance.searchUsers(q);
        if (mounted) setState(() => _results = results);
      } catch (_) {
      } finally {
        if (mounted) setState(() => _searching = false);
      }
    });
  }

  Future<void> _sendRequest(PublicUser user) async {
    setState(() => _busyIds.add(user.id));
    try {
      await ApiClient.instance.sendContactRequest(user.id);
      widget.onRequestSent();
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Demande envoyée à ${user.displayName}.')));
      }
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busyIds.remove(user.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.of(context).size.height * 0.75,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
              child: Row(
                children: [
                  const Expanded(
                    child: Text('Ajouter un contact', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
                  ),
                  IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.of(context).pop()),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                controller: _query,
                autofocus: true,
                onChanged: _onQueryChanged,
                decoration: const InputDecoration(
                  hintText: "Chercher un nom d'utilisateur...",
                  prefixIcon: Icon(Icons.search, size: 20),
                ),
              ),
            ),
            if (_searching) const Padding(padding: EdgeInsets.only(top: 8), child: LinearProgressIndicator(minHeight: 2)),
            const SizedBox(height: 8),
            Expanded(
              child: _results.isEmpty
                  ? Center(
                      child: Text(
                        _query.text.trim().length < 2 ? 'Tapez au moins 2 caractères.' : 'Aucun résultat.',
                        style: TextStyle(color: c.muted),
                      ),
                    )
                  : ListView.builder(
                      itemCount: _results.length,
                      itemBuilder: (context, index) {
                        final u = _results[index];
                        final busy = _busyIds.contains(u.id);
                        return ListTile(
                          leading: GlottaAvatar(firstName: u.firstName, lastName: u.lastName, avatarUrl: u.avatarUrl, size: 40),
                          title: Text(u.displayName),
                          subtitle: Text('@${u.username}', style: TextStyle(color: c.muted)),
                          trailing: busy
                              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                              : IconButton(
                                  icon: Icon(Icons.person_add_alt_1, color: c.accent),
                                  onPressed: () => _sendRequest(u),
                                ),
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
