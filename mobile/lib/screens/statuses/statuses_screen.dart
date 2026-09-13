import 'package:cached_network_image/cached_network_image.dart';
import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/media.dart';
import '../../core/theme.dart';
import '../../models/status.dart';
import '../../services/api_client.dart';
import '../../state/auth_state.dart';
import '../../widgets/avatar.dart';
import 'status_composer_entry_screen.dart';
import 'status_viewer_screen.dart';

class _AuthorGroup {
  final StatusAuthor author;
  final List<AppStatus> statuses; // du plus ancien au plus récent
  final bool hasUnviewed;

  const _AuthorGroup({required this.author, required this.statuses, required this.hasUnviewed});

  AppStatus get latest => statuses.last;
}

List<_AuthorGroup> _groupByAuthor(List<AppStatus> statuses) {
  final byAuthor = <String, List<AppStatus>>{};
  // La liste arrive triée du plus récent au plus ancien (voir
  // StatusesService.listVisible) : on la parcourt à l'envers pour que
  // chaque groupe soit dans l'ordre chronologique attendu par le viewer.
  for (final status in statuses.reversed) {
    (byAuthor[status.author.id] ??= []).add(status);
  }
  return byAuthor.values
      .map((list) => _AuthorGroup(
            author: list.first.author,
            statuses: list,
            hasUnviewed: list.any((s) => !s.viewedByMe),
          ))
      .toList();
}

/// Port de l'écran "Statut" de WhatsApp (référence fournie) — bande
/// horizontale de tuiles rectangulaires (aperçu du dernier statut, anneau
/// coloré si non vu, avatar de l'auteur en médaillon), en tête "Ajouter un
/// statut" pour soi-même. Volontairement sans la section "Chaînes" de la
/// référence (fonctionnalité distincte, non demandée). Contenu seul (pas de
/// Scaffold/AppBar à lui), même convention que ConversationListScreen —
/// embarqué dans HomeShell à côté du rail d'icônes.
class StatusesScreen extends ConsumerStatefulWidget {
  const StatusesScreen({super.key});

  @override
  ConsumerState<StatusesScreen> createState() => _StatusesScreenState();
}

class _StatusesScreenState extends ConsumerState<StatusesScreen> {
  List<AppStatus>? _statuses;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    ApiClient.instance.statuses().then((list) {
      if (mounted) setState(() => _statuses = list);
    }).catchError((e) {
      if (mounted) {
        setState(() => _error = e is ApiException ? e.message : 'Impossible de charger les statuts.');
      }
    });
  }

  void _openComposer() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => StatusComposerEntryScreen(
          onCreated: (status) => setState(() => _statuses = [status, ...(_statuses ?? [])]),
        ),
        fullscreenDialog: true,
      ),
    );
  }

  void _openViewer(_AuthorGroup group) {
    final startIndex = group.statuses.indexWhere((s) => !s.viewedByMe);
    Navigator.of(context)
        .push(
          MaterialPageRoute(
            builder: (_) => StatusViewerScreen(
              statuses: group.statuses,
              startIndex: startIndex < 0 ? 0 : startIndex,
              onDeleted: (id) => setState(() {
                _statuses = _statuses?.where((s) => s.id != id).toList();
              }),
            ),
            fullscreenDialog: true,
          ),
        )
        .then((_) => _load());
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final me = ref.watch(authProvider).me;
    final statuses = _statuses;
    final groups = _groupByAuthor(statuses ?? []);
    final myGroup = me == null ? null : groups.where((g) => g.author.id == me.id).firstOrNull;
    final otherGroups = me == null ? groups : groups.where((g) => g.author.id != me.id).toList();

    return ListView(
      padding: const EdgeInsets.symmetric(vertical: 16),
      children: [
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 16),
          child: Text('Statut', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
        ),
        const SizedBox(height: 14),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text(_error!, style: TextStyle(color: c.danger)),
          )
        else if (statuses == null)
          const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator()))
        else
          SizedBox(
            height: 128,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: [
                if (me != null)
                  _StatusStripCard(
                    label: myGroup != null ? 'Mon statut' : 'Ajouter un statut',
                    status: myGroup?.latest,
                    fallbackAvatarUrl: me.profile?.avatarUrl,
                    fallbackFirstName: me.firstName,
                    fallbackLastName: me.lastName,
                    ring: false,
                    trailingBadge: Icons.add,
                    onTap: myGroup != null ? () => _openViewer(myGroup) : _openComposer,
                    onBadgeTap: _openComposer,
                  ),
                for (final g in otherGroups)
                  _StatusStripCard(
                    label: g.author.firstName,
                    status: g.latest,
                    fallbackAvatarUrl: g.author.avatarUrl,
                    fallbackFirstName: g.author.firstName,
                    fallbackLastName: g.author.lastName,
                    ring: g.hasUnviewed,
                    onTap: () => _openViewer(g),
                  ),
              ],
            ),
          ),
        if (statuses != null && otherGroups.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text('Aucun statut récent de vos contacts.', style: TextStyle(color: c.muted)),
          ),
      ],
    );
  }
}

/// Tuile rectangulaire façon WhatsApp : aperçu du dernier statut (image si
/// disponible, sinon fond dégradé + icône selon le type), anneau coloré si
/// au moins un statut du groupe n'est pas encore vu, médaillon de l'auteur
/// en haut à gauche, nom en dessous.
class _StatusStripCard extends StatelessWidget {
  final String label;
  final AppStatus? status;
  final String? fallbackAvatarUrl;
  final String fallbackFirstName;
  final String fallbackLastName;
  final bool ring;
  final IconData? trailingBadge;
  final VoidCallback onTap;
  final VoidCallback? onBadgeTap;

  const _StatusStripCard({
    required this.label,
    required this.status,
    required this.fallbackAvatarUrl,
    required this.fallbackFirstName,
    required this.fallbackLastName,
    required this.ring,
    required this.onTap,
    this.trailingBadge,
    this.onBadgeTap,
  });

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 84,
        margin: const EdgeInsets.only(right: 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  width: 78,
                  height: 96,
                  padding: const EdgeInsets.all(2.5),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    gradient: ring ? LinearGradient(colors: [c.accent, c.accent2]) : null,
                    color: ring ? null : c.border,
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: _buildThumbnail(c),
                  ),
                ),
                Positioned(
                  left: 6,
                  top: 6,
                  child: Container(
                    padding: const EdgeInsets.all(2),
                    decoration: BoxDecoration(shape: BoxShape.circle, color: c.background),
                    child: GlottaAvatar(
                      firstName: fallbackFirstName,
                      lastName: fallbackLastName,
                      avatarUrl: fallbackAvatarUrl,
                      size: 26,
                    ),
                  ),
                ),
                if (trailingBadge != null)
                  Positioned(
                    right: -2,
                    bottom: -2,
                    child: GestureDetector(
                      onTap: onBadgeTap ?? onTap,
                      child: Container(
                        width: 22,
                        height: 22,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          gradient: LinearGradient(colors: [c.accent, c.accent2]),
                          border: Border.all(color: c.background, width: 2),
                        ),
                        child: Icon(trailingBadge, size: 13, color: c.accentContrast),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 11.5, color: c.muted),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildThumbnail(GlottaColors c) {
    final s = status;
    if (s == null) {
      return DecoratedBox(
        decoration: BoxDecoration(gradient: LinearGradient(colors: [c.accent.withValues(alpha: 0.5), c.accent2.withValues(alpha: 0.5)])),
        child: const Center(child: Icon(Icons.person, color: Colors.white70, size: 28)),
      );
    }
    if (s.type == StatusType.image && s.mediaUrl != null) {
      return CachedNetworkImage(
        imageUrl: resolveMediaUrl(s.mediaUrl!),
        httpHeaders: mediaHeaders(s.mediaUrl!),
        fit: BoxFit.cover,
        errorWidget: (context, url, error) => Container(color: c.border),
      );
    }
    final icon = switch (s.type) {
      StatusType.video => Icons.videocam,
      StatusType.voice => Icons.mic,
      StatusType.text || StatusType.image => Icons.format_quote,
    };
    return Container(
      decoration: BoxDecoration(gradient: LinearGradient(colors: [c.accent, c.accent2])),
      padding: const EdgeInsets.all(8),
      alignment: Alignment.center,
      child: s.type == StatusType.text && s.text != null
          ? Text(
              s.text!,
              maxLines: 4,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: TextStyle(color: c.accentContrast, fontSize: 11, fontWeight: FontWeight.w500),
            )
          : Icon(icon, color: c.accentContrast, size: 26),
    );
  }
}
