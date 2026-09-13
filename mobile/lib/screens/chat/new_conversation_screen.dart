import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../core/theme.dart';
import '../../models/public_user.dart';
import '../../services/api_client.dart';
import '../../state/conversations_state.dart';
import '../../widgets/avatar.dart';

/// Port simplifié de `NewConversationModal.tsx` : recherche d'utilisateurs
/// par nom d'utilisateur, tape sur un résultat → `POST /conversations`
/// (idempotent côté backend : renvoie la conversation existante si elle
/// l'est déjà) puis navigation directe vers le fil.
class NewConversationScreen extends ConsumerStatefulWidget {
  const NewConversationScreen({super.key});

  @override
  ConsumerState<NewConversationScreen> createState() => _NewConversationScreenState();
}

class _NewConversationScreenState extends ConsumerState<NewConversationScreen> {
  final _query = TextEditingController();
  List<PublicUser> _results = [];
  bool _searching = false;
  String? _startingUserId;
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
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
        // silencieux, comme côté web
      } finally {
        if (mounted) setState(() => _searching = false);
      }
    });
  }

  Future<void> _start(PublicUser user) async {
    setState(() => _startingUserId = user.id);
    try {
      final conversation = await ApiClient.instance.createDirectConversation(user.id);
      await ref.read(conversationsProvider.notifier).load();
      if (!mounted) return;
      Navigator.of(context).pop();
      context.push('/conversations/${conversation.id}');
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _startingUserId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return Scaffold(
      backgroundColor: c.background,
      appBar: AppBar(title: const Text('Nouvelle conversation')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              controller: _query,
              autofocus: true,
              onChanged: _onChanged,
              decoration: const InputDecoration(
                hintText: "Nom d'utilisateur...",
                prefixIcon: Icon(Icons.search, size: 20),
              ),
            ),
          ),
          if (_searching) const LinearProgressIndicator(minHeight: 2),
          Expanded(
            child: _results.isEmpty
                ? Center(
                    child: Text(
                      _query.text.trim().length < 2
                          ? 'Tapez au moins 2 caractères.'
                          : 'Aucun résultat.',
                      style: TextStyle(color: c.muted),
                    ),
                  )
                : ListView.builder(
                    itemCount: _results.length,
                    itemBuilder: (context, index) {
                      final u = _results[index];
                      final starting = _startingUserId == u.id;
                      return ListTile(
                        leading: GlottaAvatar(
                          firstName: u.firstName,
                          lastName: u.lastName,
                          avatarUrl: u.avatarUrl,
                          size: 40,
                        ),
                        title: Text(u.displayName),
                        subtitle: Text('@${u.username}', style: TextStyle(color: c.muted)),
                        trailing: starting
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : null,
                        onTap: starting ? null : () => _start(u),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
