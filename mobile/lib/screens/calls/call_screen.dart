import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../../models/call.dart';
import '../../models/conversation.dart';
import '../../services/call_service.dart';
import '../../state/call_state.dart';
import '../../state/conversations_state.dart';
import '../../widgets/avatar.dart';

/// Port réduit de `CallOverlay.tsx` (traduction en direct/escalade vers un
/// appel de groupe non repris pour cette première passe mobile — voir
/// call_service.dart) : plein écran, réagit à `call.phase`, correspondant
/// résolu depuis les conversations déjà chargées (même principe que
/// `callPeer` dans `chat/page.tsx`).
class CallScreen extends ConsumerWidget {
  const CallScreen({super.key});

  ConversationParticipant? _resolvePeer(WidgetRef ref, CallService call) {
    final conversations = ref.watch(conversationsProvider).items;
    final conversation = conversations.where((c) => c.id == call.conversationId).firstOrNull;
    if (conversation?.otherParticipant != null) return conversation!.otherParticipant;
    if (call.otherUserId == null) return null;
    for (final c in conversations) {
      final match = c.members.where((m) => m.id == call.otherUserId).firstOrNull;
      if (match != null) return match;
    }
    return null;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final call = ref.watch(callServiceProvider);
    final peer = _resolvePeer(ref, call);
    final showVideo = call.kind == CallKind.video && call.phase == CallPhase.active;

    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: Colors.black,
        body: SafeArea(
          child: Stack(
            children: [
              if (showVideo)
                Positioned.fill(
                  child: RTCVideoView(call.remoteRenderer, objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover),
                ),
              Column(
                mainAxisAlignment: showVideo ? MainAxisAlignment.end : MainAxisAlignment.center,
                children: [
                  if (!showVideo) ...[
                    const Spacer(),
                    GlottaAvatar(
                      firstName: peer?.firstName ?? '',
                      lastName: peer?.lastName ?? '',
                      avatarUrl: peer?.avatarUrl,
                      size: 120,
                    ),
                    const SizedBox(height: 20),
                    Text(
                      peer?.displayName ?? 'Correspondant',
                      style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 8),
                  ],
                  Text(_statusLabel(call), style: TextStyle(color: Colors.white.withValues(alpha: 0.75), fontSize: 14)),
                  if (!showVideo) const Spacer(),
                  if (showVideo)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Text(
                        peer?.displayName ?? 'Correspondant',
                        style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600),
                      ),
                    ),
                  const SizedBox(height: 24),
                  _controls(call),
                  const SizedBox(height: 40),
                ],
              ),
              if (call.videoEnabled && call.phase == CallPhase.active)
                Positioned(
                  top: 12,
                  right: 12,
                  width: 100,
                  height: 140,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: RTCVideoView(call.localRenderer, mirror: true, objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  String _statusLabel(CallService call) {
    switch (call.phase) {
      case CallPhase.outgoing:
        return "Appel en cours...";
      case CallPhase.incoming:
        return call.kind == CallKind.video ? 'Appel vidéo entrant...' : 'Appel entrant...';
      case CallPhase.active:
        return _formatDuration(call.durationSeconds);
      case CallPhase.ended:
        return call.error ?? 'Appel terminé.';
      case CallPhase.idle:
        return '';
    }
  }

  String _formatDuration(int totalSeconds) {
    final minutes = totalSeconds ~/ 60;
    final seconds = totalSeconds % 60;
    return '$minutes:${seconds.toString().padLeft(2, '0')}';
  }

  Widget _controls(CallService call) {
    switch (call.phase) {
      case CallPhase.incoming:
        return Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _roundButton(icon: Icons.call_end, color: Colors.red, onTap: call.reject),
            const SizedBox(width: 48),
            _roundButton(icon: Icons.call, color: Colors.green, onTap: call.accept),
          ],
        );
      case CallPhase.outgoing:
        return _roundButton(icon: Icons.call_end, color: Colors.red, onTap: call.hangUp);
      case CallPhase.active:
        return Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _roundButton(
              icon: call.muted ? Icons.mic_off : Icons.mic,
              color: Colors.white24,
              onTap: call.toggleMute,
              small: true,
            ),
            const SizedBox(width: 20),
            _roundButton(
              icon: call.videoEnabled ? Icons.videocam : Icons.videocam_off,
              color: Colors.white24,
              onTap: call.toggleVideo,
              small: true,
            ),
            const SizedBox(width: 20),
            _roundButton(icon: Icons.call_end, color: Colors.red, onTap: call.hangUp),
          ],
        );
      case CallPhase.ended:
      case CallPhase.idle:
        return const SizedBox.shrink();
    }
  }

  Widget _roundButton({
    required IconData icon,
    required Color color,
    required VoidCallback onTap,
    bool small = false,
  }) {
    final size = small ? 52.0 : 64.0;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(shape: BoxShape.circle, color: color),
        child: Icon(icon, color: Colors.white, size: small ? 24 : 28),
      ),
    );
  }
}
