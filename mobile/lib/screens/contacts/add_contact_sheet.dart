import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/theme.dart';
import '../../models/public_user.dart';
import '../../services/api_client.dart';
import '../../services/contact_sync_service.dart';
import '../../widgets/avatar.dart';

/// Recherche + envoi de demande de contact — ouvert via le bouton flottant
/// de ContactsScreen (voir HomeShell), jamais affiché en ligne dans la
/// liste : même contenu qu'avant, juste déplacé dans une feuille modale
/// pour un bouton d'ajout flottant façon WhatsApp plutôt qu'une barre de
/// recherche toujours visible. Ajoute la synchronisation des contacts
/// téléphoniques (section 2) comme second moyen de retrouver quelqu'un,
/// explicitement opt-in — voir ContactSyncService.
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

  bool _syncEnabled = false;
  bool _syncing = false;
  List<PublicUser> _syncMatches = [];

  @override
  void initState() {
    super.initState();
    ContactSyncService.instance.isEnabled.then((enabled) {
      if (!mounted) return;
      setState(() => _syncEnabled = enabled);
      if (enabled) _runSync();
    });
  }

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

  Future<void> _toggleSync(bool value) async {
    if (!value) {
      await ContactSyncService.instance.setEnabled(false);
      setState(() {
        _syncEnabled = false;
        _syncMatches = [];
      });
      return;
    }
    final granted = await ContactSyncService.instance.requestPermission();
    if (!granted) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Accès aux contacts refusé.')),
        );
      }
      return;
    }
    await ContactSyncService.instance.setEnabled(true);
    if (!mounted) return;
    setState(() => _syncEnabled = true);
    await _runSync();
  }

  Future<void> _runSync() async {
    setState(() => _syncing = true);
    try {
      final matches = await ContactSyncService.instance.sync();
      if (mounted) setState(() => _syncMatches = matches);
    } catch (_) {
      // Best-effort — une synchro manquée n'empêche jamais la recherche par
      // username, qui reste disponible indépendamment.
    } finally {
      if (mounted) setState(() => _syncing = false);
    }
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
    final searching = _query.text.trim().length >= 2;

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
                onChanged: (v) {
                  _onQueryChanged(v);
                  setState(() {}); // Recalcule `searching` pour basculer la liste affichée.
                },
                decoration: const InputDecoration(
                  hintText: "Chercher un nom d'utilisateur...",
                  prefixIcon: Icon(Icons.search, size: 20),
                ),
              ),
            ),
            if (_searching) const Padding(padding: EdgeInsets.only(top: 8), child: LinearProgressIndicator(minHeight: 2)),
            SwitchListTile(
              dense: true,
              title: const Text('Synchroniser mes contacts'),
              subtitle: Text(
                'Retrouvez vos contacts déjà inscrits — seules des empreintes de numéros quittent votre appareil.',
                style: TextStyle(color: c.muted, fontSize: 12),
              ),
              value: _syncEnabled,
              activeThumbColor: c.accent2,
              onChanged: _toggleSync,
            ),
            const SizedBox(height: 4),
            Expanded(
              child: searching
                  ? _buildList(c, _results, emptyLabel: 'Aucun résultat.')
                  : _syncing
                      ? const Center(child: CircularProgressIndicator())
                      : _syncEnabled
                          ? _buildList(
                              c,
                              _syncMatches,
                              emptyLabel: 'Aucun de vos contacts n’utilise Glotta pour le moment.',
                              header: 'Depuis vos contacts',
                            )
                          : Center(
                              child: Text('Tapez au moins 2 caractères.', style: TextStyle(color: c.muted)),
                            ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildList(GlottaColors c, List<PublicUser> users, {required String emptyLabel, String? header}) {
    if (users.isEmpty) {
      return Center(child: Text(emptyLabel, style: TextStyle(color: c.muted)));
    }
    return ListView.builder(
      itemCount: users.length + (header != null ? 1 : 0),
      itemBuilder: (context, index) {
        if (header != null) {
          if (index == 0) {
            return Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
              child: Text(
                header.toUpperCase(),
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: c.muted, letterSpacing: 0.4),
              ),
            );
          }
          index -= 1;
        }
        final u = users[index];
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
    );
  }
}
