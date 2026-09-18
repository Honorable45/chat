import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../screens/lock/lock_screen.dart';
import '../services/app_lock_store.dart';
import '../state/app_lock_state.dart';

/// Verrouillage automatique (section 8) : superpose LockScreen par-dessus le
/// reste de l'app dès que `AppLockState.enabled && !unlocked`. Branché via
/// `MaterialApp.router(builder:)` dans main.dart — au-dessus du Navigator de
/// go_router plutôt qu'une route dédiée, pour rester totalement orthogonal
/// aux redirections existantes (phone/profile-setup/conversations, voir
/// router.dart) : aucune des deux logiques n'a besoin de connaître l'autre.
class AppLockGate extends ConsumerStatefulWidget {
  final Widget child;

  const AppLockGate({super.key, required this.child});

  @override
  ConsumerState<AppLockGate> createState() => _AppLockGateState();
}

class _AppLockGateState extends ConsumerState<AppLockGate> with WidgetsBindingObserver {
  DateTime? _pausedAt;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final lock = ref.read(appLockProvider);
    if (!lock.enabled) return;

    if (state == AppLifecycleState.paused || state == AppLifecycleState.inactive) {
      // `inactive` seul (ex. tiroir de notifications, sélecteur de partage)
      // ne doit jamais compter comme un passage en arrière-plan réel — on
      // n'horodate qu'au premier signal, jamais réécrasé par les suivants
      // avant un vrai retour au premier plan (`resumed`).
      _pausedAt ??= DateTime.now();
      return;
    }
    if (state != AppLifecycleState.resumed) return;

    final pausedAt = _pausedAt;
    _pausedAt = null;
    if (pausedAt == null || !lock.unlocked) return;

    final threshold = lock.autoLock.threshold;
    // `onAppClose` (threshold null) : jamais verrouillé au simple retour au
    // premier plan, voir AppLockNotifier._hydrate pour le raisonnement.
    if (threshold == null) return;
    if (DateTime.now().difference(pausedAt) >= threshold) {
      ref.read(appLockProvider.notifier).lock();
    }
  }

  @override
  Widget build(BuildContext context) {
    final lock = ref.watch(appLockProvider);
    final locked = lock.enabled && !lock.unlocked;
    return Stack(
      children: [
        // Toujours monté (jamais retiré de l'arbre) : un Navigator démonté
        // perdrait sa pile de routes, ce qu'un simple verrouillage temporaire
        // ne doit jamais provoquer.
        widget.child,
        if (locked)
          const Positioned.fill(
            child: LockScreen(),
          ),
      ],
    );
  }
}
