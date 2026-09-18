import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme.dart';
import '../../models/language.dart';
import '../../services/api_client.dart';
import '../../state/auth_state.dart';
import '../../state/theme_state.dart';
import 'security_screen.dart';

/// Sections "Apparence" / "Langues" / "Compte" — factorisées ici car elles
/// apparaissent identiques sur deux écrans : SettingsScreen (petit en-tête
/// de profil) et ProfileScreen (grand en-tête, "quand je clique sur profil,
/// c'est ça, avec paramètres en bas aussi" — même redondance que WhatsApp,
/// où le grand écran de profil réaffiche la même liste que Paramètres).
class SettingsSectionsList extends ConsumerStatefulWidget {
  const SettingsSectionsList({super.key});

  @override
  ConsumerState<SettingsSectionsList> createState() => _SettingsSectionsListState();
}

class _SettingsSectionsListState extends ConsumerState<SettingsSectionsList> {
  List<LanguageSummary>? _languages;
  bool _savingLanguage = false;

  @override
  void initState() {
    super.initState();
    ApiClient.instance.languages().then((list) {
      if (mounted) setState(() => _languages = list);
    }).catchError((_) {});
  }

  Future<void> _setPrimaryLanguage(String code) async {
    setState(() => _savingLanguage = true);
    try {
      final me = await ApiClient.instance.updateMe(primaryLanguageCode: code);
      ref.read(authProvider.notifier).setMe(me);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _savingLanguage = false);
    }
  }

  Future<void> _setReceiveLanguage(String code) async {
    setState(() => _savingLanguage = true);
    try {
      final me = await ApiClient.instance.updateMe(preferredReceiveLanguageCode: code);
      ref.read(authProvider.notifier).setMe(me);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _savingLanguage = false);
    }
  }

  Future<void> _setNotificationsEnabled(bool value) async {
    try {
      await ApiClient.instance.updateMyProfile(notificationsEnabled: value);
      await _refreshMe();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _setHideNotificationContent(bool value) async {
    try {
      await ApiClient.instance.updateMyProfile(hideNotificationContent: value);
      await _refreshMe();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Future<void> _refreshMe() async {
    final me = await ApiClient.instance.me();
    ref.read(authProvider.notifier).setMe(me);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.glotta;
    final me = ref.watch(authProvider).me;
    final themeMode = ref.watch(themeModeProvider);
    final languages = _languages;
    if (me == null) return const SizedBox.shrink();

    return Column(
      children: [
        _sectionLabel(c, 'Apparence'),
        _themeTile(c, ThemeMode.system, 'Système', themeMode),
        _themeTile(c, ThemeMode.light, 'Clair', themeMode),
        _themeTile(c, ThemeMode.dark, 'Sombre', themeMode),
        const SizedBox(height: 12),
        _sectionLabel(c, 'Langues'),
        ListTile(
          title: const Text('Ma langue'),
          subtitle: Text(me.primaryLanguage?.nativeName ?? 'Non définie'),
          trailing: _savingLanguage
              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.chevron_right),
          onTap: languages == null ? null : () => _pickLanguage(context, languages, _setPrimaryLanguage),
        ),
        ListTile(
          title: const Text('Langue de réception préférée'),
          subtitle: Text(me.preferredReceiveLanguage?.nativeName ?? 'Non définie'),
          trailing: _savingLanguage
              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.chevron_right),
          onTap: languages == null ? null : () => _pickLanguage(context, languages, _setReceiveLanguage),
        ),
        const SizedBox(height: 12),
        _sectionLabel(c, 'Notifications'),
        SwitchListTile(
          title: const Text('Notifications'),
          subtitle: Text(
            'Nouveaux messages, vocaux et appels.',
            style: TextStyle(color: c.muted),
          ),
          value: me.profile?.notificationsEnabled ?? true,
          activeThumbColor: c.accent2,
          onChanged: _setNotificationsEnabled,
        ),
        SwitchListTile(
          title: const Text('Masquer le contenu'),
          subtitle: Text(
            'Affiche "Glotta — Nouveau message" au lieu de l’aperçu (section 9).',
            style: TextStyle(color: c.muted),
          ),
          value: me.profile?.hideNotificationContent ?? false,
          activeThumbColor: c.accent2,
          onChanged: _setHideNotificationContent,
        ),
        const SizedBox(height: 12),
        _sectionLabel(c, 'Compte'),
        ListTile(
          leading: Icon(Icons.shield_outlined, color: c.muted),
          title: const Text('Sécurité'),
          subtitle: Text('Vérification en deux étapes, appareils connectés', style: TextStyle(color: c.muted)),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const SecurityScreen()),
          ),
        ),
        ListTile(
          leading: Icon(Icons.logout, color: c.danger),
          title: Text('Se déconnecter', style: TextStyle(color: c.danger)),
          onTap: () => ref.read(authProvider.notifier).logout(),
        ),
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

  Widget _themeTile(GlottaColors c, ThemeMode mode, String label, ThemeMode current) => RadioListTile<ThemeMode>(
        value: mode,
        groupValue: current,
        title: Text(label),
        activeColor: c.accent,
        onChanged: (value) {
          if (value != null) ref.read(themeModeProvider.notifier).setMode(value);
        },
      );

  void _pickLanguage(
    BuildContext context,
    List<LanguageSummary> languages,
    void Function(String code) onPicked,
  ) {
    showModalBottomSheet<void>(
      context: context,
      builder: (context) => SafeArea(
        child: SizedBox(
          height: 420,
          child: ListView.builder(
            itemCount: languages.length,
            itemBuilder: (context, index) {
              final l = languages[index];
              return ListTile(
                title: Text(l.nativeName),
                subtitle: Text(l.name),
                onTap: () {
                  Navigator.of(context).pop();
                  onPicked(l.code);
                },
              );
            },
          ),
        ),
      ),
    );
  }
}
