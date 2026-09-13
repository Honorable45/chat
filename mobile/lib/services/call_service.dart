import 'dart:async';
import 'package:collection/collection.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../core/config.dart';
import '../models/call.dart';
import 'api_client.dart';
import 'token_store.dart';

enum CallPhase { idle, outgoing, incoming, active, ended }

/// Port de `frontend/src/lib/use-call.ts` — signalisation WebRTC (offre/
/// réponse SDP, candidats ICE) sur le namespace WebSocket dédié "/calls",
/// flux audio/vidéo pair-à-pair une fois la connexion établie (jamais
/// relayé par le serveur). Volontairement plus restreint que le web pour
/// cette première passe mobile : pas de traduction en direct pendant
/// l'appel (sous-titres/capture de fragments vocaux), pas d'escalade vers
/// un appel de groupe, pas de reprise depuis une notification push système
/// (aucune notification d'appel système construite côté mobile encore) —
/// juste un appel 1:1 audio/vidéo complet de bout en bout.
///
/// `ChangeNotifier` (pas un Riverpod `Notifier`) : ce service a besoin
/// d'exister et de continuer à signaler/recevoir des événements même quand
/// aucun widget ne l'observe activement (un appel entrant doit sonner quel
/// que soit l'écran affiché) — un unique singleton, exposé aux widgets via
/// `ChangeNotifierProvider` (voir state/call_state.dart), lui sert de pont.
class CallService extends ChangeNotifier {
  CallService._();
  static final CallService instance = CallService._();

  io.Socket? _socket;
  RTCPeerConnection? _pc;
  MediaStream? _localStream;
  DateTime? _answeredAt;
  Timer? _durationTimer;
  bool _renegotiationArmed = false;

  final localRenderer = RTCVideoRenderer();
  final remoteRenderer = RTCVideoRenderer();
  bool _renderersReady = false;

  CallPhase phase = CallPhase.idle;
  String? conversationId;
  String? callId;
  String? otherUserId;
  CallKind kind = CallKind.audio;
  int durationSeconds = 0;
  bool muted = false;
  bool videoEnabled = false;
  bool remoteVideoEnabled = false;
  String? error;

  /// Rappelé à chaque changement d'état persistant côté serveur (invitation,
  /// acceptation, refus, fin...) — à charge de l'appelant (HomeShell) de
  /// rafraîchir la liste de conversations pour faire apparaître ce nouveau
  /// message CALL dans l'aperçu.
  void Function(CallMessageDto message)? onCallMessage;

  Future<void> _ensureRenderers() async {
    if (_renderersReady) return;
    await localRenderer.initialize();
    await remoteRenderer.initialize();
    _renderersReady = true;
  }

  void connect() {
    if (_socket != null) return;
    final socket = io.io(
      '${AppConfig.wsBaseUrl}/calls',
      io.OptionBuilder()
          .setTransports(['websocket'])
          .enableReconnection()
          .setAuth({'token': TokenStore.instance.cachedAccessToken})
          .build(),
    );
    _socket = socket;

    socket.on('call:incoming', (data) {
      if (phase != CallPhase.idle) return;
      final message = CallMessageDto.fromJson(_asMap(data));
      _setState(
        phase: CallPhase.incoming,
        conversationId: message.conversationId,
        callId: message.call.id,
        otherUserId: message.call.callerId,
        kind: message.call.type,
        error: null,
      );
      onCallMessage?.call(message);
    });

    socket.on('call:accepted', (data) => _onAccepted(_asMap(data)));
    socket.on('call:offer', (data) => _onRemoteOffer(_asMap(data)));
    socket.on('call:answer', (data) => _onRemoteAnswer(_asMap(data)));
    socket.on('call:ice-candidate', (data) => _onRemoteIceCandidate(_asMap(data)));
    socket.on('call:video-state', (data) {
      final payload = _asMap(data);
      if (payload['callId'] != callId) return;
      final enabled = (payload['data'] as Map)['enabled'] as bool? ?? false;
      remoteVideoEnabled = enabled;
      notifyListeners();
    });

    socket.on('call:rejected', (data) => _endWithFeedback(_asMap(data), 'Appel refusé.'));
    socket.on('call:cancelled', (data) {
      final wasIncoming = phase == CallPhase.incoming;
      _endWithFeedback(_asMap(data), wasIncoming ? 'Appel manqué.' : 'Appel annulé.');
    });
    socket.on('call:ended', (data) => _endWithFeedback(_asMap(data), 'Appel terminé.'));
    socket.on('call:resolved-elsewhere', (data) {
      final message = CallMessageDto.fromJson(_asMap(data));
      if (callId != message.call.id || phase != CallPhase.incoming) return;
      onCallMessage?.call(message);
      _finishWithFeedback(
        message.call.status == 'ACTIVE' ? 'Répondu sur un autre appareil.' : 'Refusé sur un autre appareil.',
      );
    });
  }

  void disconnect() {
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
    _cleanupMedia();
    _resetState();
  }

  Map<String, dynamic> _asMap(dynamic data) => Map<String, dynamic>.from(data as Map);

  Future<AckResult> _ack(String event, Map<String, dynamic> payload) {
    final completer = Completer<AckResult>();
    final socket = _socket;
    if (socket == null) {
      return Future.value(const AckResult(ok: false, error: 'Non connecté.'));
    }
    socket.emitWithAck(event, payload, ack: (response) {
      completer.complete(AckResult.fromJson(Map<String, dynamic>.from(response as Map)));
    });
    return completer.future;
  }

  Future<RTCPeerConnection> _ensurePeerConnection() async {
    if (_pc != null) return _pc!;
    final iceServers = await ApiClient.instance.iceServers().catchError((_) => <Map<String, dynamic>>[]);
    final pc = await createPeerConnection({'iceServers': iceServers});
    pc.onIceCandidate = (candidate) {
      final id = callId;
      if (id == null || candidate.candidate == null) return;
      _socket?.emit('call:ice-candidate', {
        'callId': id,
        'data': {
          'candidate': candidate.candidate,
          'sdpMid': candidate.sdpMid,
          'sdpMLineIndex': candidate.sdpMLineIndex,
        },
      });
    };
    pc.onTrack = (event) {
      if (event.streams.isNotEmpty) {
        remoteRenderer.srcObject = event.streams.first;
        notifyListeners();
      }
    };
    _pc = pc;
    return pc;
  }

  void _armRenegotiation() {
    if (_renegotiationArmed) return;
    _renegotiationArmed = true;
    _pc?.onRenegotiationNeeded = () async {
      final pc = _pc;
      final id = callId;
      if (pc == null || id == null) return;
      try {
        final offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        _socket?.emit('call:offer', {
          'callId': id,
          'data': {'sdp': offer.sdp, 'type': offer.type},
        });
      } catch (_) {
        // Best-effort — une renégociation manquée n'interrompt pas l'appel en cours.
      }
    };
  }

  /// Reprend un appel entrant après ouverture de l'app depuis l'action
  /// "Répondre" d'une notification push système (voir NotificationService)
  /// — aucun événement `call:incoming` n'a pu être reçu tant que le socket
  /// `/calls` n'existait pas (app fermée à l'invitation). Simule le même
  /// effet que ce handler à partir de l'état authoritative du serveur, sans
  /// rien réémettre — accept()/reject() suivent ensuite leur chemin normal.
  /// Même principe que `useCall.resumeIncoming` côté web.
  Future<void> resumeIncoming(String callId) async {
    if (phase != CallPhase.idle) return;
    try {
      final message = await ApiClient.instance.getCall(callId);
      if (message.call.status != 'RINGING') return;
      _setState(
        phase: CallPhase.incoming,
        conversationId: message.conversationId,
        callId: message.call.id,
        otherUserId: message.call.callerId,
        kind: message.call.type,
        error: null,
      );
    } catch (_) {
      // Appel déjà résolu (accepté/refusé/expiré) avant l'ouverture de l'app — rien à afficher.
    }
  }

  Future<void> start(String conversationId, String calleeId, CallKind kind) async {
    if (phase != CallPhase.idle) return;
    await _ensureRenderers();
    error = null;

    MediaStream stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        'audio': true,
        'video': kind == CallKind.video ? {'facingMode': 'user'} : false,
      });
    } catch (_) {
      error = kind == CallKind.video
          ? 'Caméra/micro inaccessibles — vérifiez les autorisations.'
          : 'Micro inaccessible — vérifiez les autorisations.';
      notifyListeners();
      return;
    }
    _localStream = stream;
    localRenderer.srcObject = stream;

    final pc = await _ensurePeerConnection();
    for (final track in stream.getTracks()) {
      await pc.addTrack(track, stream);
    }

    final res = await _ack('call:invite', {
      'conversationId': conversationId,
      'calleeId': calleeId,
      'type': callKindToJson(kind),
    });
    if (!res.ok) {
      _cleanupMedia();
      error = res.error ?? "Impossible de démarrer cet appel.";
      notifyListeners();
      return;
    }
    if (res.busy) {
      _cleanupMedia();
      _finishWithFeedback('Occupé.');
      return;
    }
    _setState(
      phase: CallPhase.outgoing,
      conversationId: conversationId,
      callId: res.callMessage!.call.id,
      otherUserId: calleeId,
      kind: kind,
      videoEnabled: kind == CallKind.video,
    );
    onCallMessage?.call(res.callMessage!);
  }

  Future<void> _onAccepted(Map<String, dynamic> data) async {
    final message = CallMessageDto.fromJson(data);
    if (callId != message.call.id || _pc == null) return;
    final pc = _pc!;
    try {
      final offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      _socket?.emit('call:offer', {
        'callId': message.call.id,
        'data': {'sdp': offer.sdp, 'type': offer.type},
      });
      _armRenegotiation();
      _answeredAt = DateTime.now();
      phase = CallPhase.active;
      durationSeconds = 0;
      remoteVideoEnabled = kind == CallKind.video;
      _startDurationTimer();
      notifyListeners();
      onCallMessage?.call(message);
    } catch (_) {
      error = 'La connexion a échoué.';
      await _ack('call:end', {'callId': message.call.id});
      _cleanupMedia();
      _resetState();
    }
  }

  Future<void> accept() async {
    final id = callId;
    if (id == null || phase != CallPhase.incoming) return;
    await _ensureRenderers();

    MediaStream stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        'audio': true,
        'video': kind == CallKind.video ? {'facingMode': 'user'} : false,
      });
    } catch (_) {
      error = kind == CallKind.video
          ? 'Caméra/micro inaccessibles — vérifiez les autorisations.'
          : 'Micro inaccessible — vérifiez les autorisations.';
      await _ack('call:reject', {'callId': id});
      _cleanupMedia();
      _resetState();
      return;
    }
    _localStream = stream;
    localRenderer.srcObject = stream;

    final pc = await _ensurePeerConnection();
    for (final track in stream.getTracks()) {
      await pc.addTrack(track, stream);
    }

    final res = await _ack('call:accept', {'callId': id});
    if (!res.ok) {
      _cleanupMedia();
      error = res.error ?? "Impossible de répondre à cet appel.";
      notifyListeners();
      _resetState();
      return;
    }
    _answeredAt = DateTime.now();
    phase = CallPhase.active;
    durationSeconds = 0;
    videoEnabled = kind == CallKind.video;
    remoteVideoEnabled = kind == CallKind.video;
    _startDurationTimer();
    notifyListeners();
    if (res.callMessage != null) onCallMessage?.call(res.callMessage!);
  }

  Future<void> _onRemoteOffer(Map<String, dynamic> payload) async {
    if (callId != payload['callId'] || _pc == null) return;
    final pc = _pc!;
    final data = Map<String, dynamic>.from(payload['data'] as Map);
    await pc.setRemoteDescription(RTCSessionDescription(data['sdp'] as String, data['type'] as String));
    final answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    _socket?.emit('call:answer', {
      'callId': payload['callId'],
      'data': {'sdp': answer.sdp, 'type': answer.type},
    });
    _armRenegotiation();
  }

  Future<void> _onRemoteAnswer(Map<String, dynamic> payload) async {
    if (callId != payload['callId'] || _pc == null) return;
    final data = Map<String, dynamic>.from(payload['data'] as Map);
    await _pc!.setRemoteDescription(RTCSessionDescription(data['sdp'] as String, data['type'] as String));
  }

  Future<void> _onRemoteIceCandidate(Map<String, dynamic> payload) async {
    if (callId != payload['callId'] || _pc == null) return;
    final data = Map<String, dynamic>.from(payload['data'] as Map);
    await _pc!.addCandidate(RTCIceCandidate(
      data['candidate'] as String?,
      data['sdpMid'] as String?,
      data['sdpMLineIndex'] as int?,
    ));
  }

  Future<void> reject() async {
    final id = callId;
    if (id == null || phase != CallPhase.incoming) return;
    final res = await _ack('call:reject', {'callId': id});
    if (res.callMessage != null) onCallMessage?.call(res.callMessage!);
    _cleanupMedia();
    _resetState();
  }

  Future<void> hangUp() async {
    final id = callId;
    if (id == null) return;
    final event = phase == CallPhase.active ? 'call:end' : 'call:cancel';
    final res = await _ack(event, {'callId': id});
    if (res.callMessage != null) onCallMessage?.call(res.callMessage!);
    _cleanupMedia();
    _resetState();
  }

  void toggleMute() {
    final tracks = _localStream?.getAudioTracks() ?? [];
    final nextMuted = !muted;
    for (final track in tracks) {
      track.enabled = !nextMuted;
    }
    muted = nextMuted;
    notifyListeners();
  }

  Future<void> toggleVideo() async {
    final pc = _pc;
    final id = callId;
    if (pc == null || id == null) return;

    final existing = _localStream?.getVideoTracks().firstOrNull;
    if (existing != null) {
      final nextEnabled = !existing.enabled;
      existing.enabled = nextEnabled;
      videoEnabled = nextEnabled;
      notifyListeners();
      _socket?.emit('call:video-state', {
        'callId': id,
        'data': {'enabled': nextEnabled},
      });
      return;
    }

    try {
      final camStream = await navigator.mediaDevices.getUserMedia({'video': {'facingMode': 'user'}});
      final track = camStream.getVideoTracks().first;
      if (_localStream == null) {
        _localStream = camStream;
      } else {
        await _localStream!.addTrack(track);
      }
      localRenderer.srcObject = _localStream;
      await pc.addTrack(track, _localStream!);
      videoEnabled = true;
      notifyListeners();
      _socket?.emit('call:video-state', {
        'callId': id,
        'data': {'enabled': true},
      });
    } catch (_) {
      error = 'Caméra inaccessible — vérifiez les autorisations.';
      notifyListeners();
    }
  }

  void _startDurationTimer() {
    _durationTimer?.cancel();
    final startedAt = _answeredAt;
    if (startedAt == null) return;
    _durationTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      durationSeconds = DateTime.now().difference(startedAt).inSeconds;
      notifyListeners();
    });
  }

  void _endWithFeedback(Map<String, dynamic> data, String message) {
    final callMessage = CallMessageDto.fromJson(data);
    if (callId != callMessage.call.id) return;
    onCallMessage?.call(callMessage);
    _finishWithFeedback(message);
  }

  void _finishWithFeedback(String message) {
    _cleanupMedia();
    phase = CallPhase.ended;
    error = message;
    notifyListeners();
    Timer(const Duration(milliseconds: 2500), () {
      if (phase == CallPhase.ended) _resetState();
    });
  }

  void _cleanupMedia() {
    _durationTimer?.cancel();
    _durationTimer = null;
    _renegotiationArmed = false;
    _pc?.close();
    _pc = null;
    for (final track in _localStream?.getTracks() ?? <MediaStreamTrack>[]) {
      track.stop();
    }
    _localStream?.dispose();
    _localStream = null;
    _answeredAt = null;
    if (_renderersReady) {
      localRenderer.srcObject = null;
      remoteRenderer.srcObject = null;
    }
  }

  void _resetState() {
    phase = CallPhase.idle;
    conversationId = null;
    callId = null;
    otherUserId = null;
    kind = CallKind.audio;
    durationSeconds = 0;
    muted = false;
    videoEnabled = false;
    remoteVideoEnabled = false;
    error = null;
    notifyListeners();
  }

  void _setState({
    required CallPhase phase,
    String? conversationId,
    String? callId,
    String? otherUserId,
    CallKind? kind,
    bool? videoEnabled,
    String? error,
  }) {
    this.phase = phase;
    if (conversationId != null) this.conversationId = conversationId;
    if (callId != null) this.callId = callId;
    if (otherUserId != null) this.otherUserId = otherUserId;
    if (kind != null) this.kind = kind;
    if (videoEnabled != null) this.videoEnabled = videoEnabled;
    this.error = error;
    notifyListeners();
  }
}

class AckResult {
  final bool ok;
  final String? error;
  final bool busy;
  final CallMessageDto? callMessage;

  const AckResult({required this.ok, this.error, this.busy = false, this.callMessage});

  factory AckResult.fromJson(Map<String, dynamic> json) => AckResult(
        ok: json['ok'] as bool? ?? false,
        error: json['error'] as String?,
        busy: json['busy'] as bool? ?? false,
        callMessage: json['callMessage'] == null
            ? null
            : CallMessageDto.fromJson(Map<String, dynamic>.from(json['callMessage'] as Map)),
      );
}
