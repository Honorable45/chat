import 'package:flutter_riverpod/legacy.dart';
import '../services/call_service.dart';

/// Pont Riverpod vers le singleton `CallService` (un `ChangeNotifier`
/// classique, pas un `Notifier`) — voir call_service.dart pour le pourquoi
/// du singleton. `ChangeNotifierProvider` republie ses `notifyListeners()`
/// comme des rebuilds Riverpod normaux pour les écrans qui l'observent
/// (HomeShell pour l'overlay d'appel, ChatScreen pour démarrer un appel).
final callServiceProvider = ChangeNotifierProvider<CallService>((ref) => CallService.instance);
