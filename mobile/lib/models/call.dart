/// Port de `CallDto`/`CallMessageDto` (backend `CallsService`) et de
/// `CallMessagePayload` côté web (`lib/types.ts`) — reçu tel quel via les
/// événements du namespace WebSocket "/calls" (voir CallsGateway), jamais
/// reconstruit à la main.
enum CallKind { audio, video }

CallKind callKindFromJson(String? value) => value == 'VIDEO' ? CallKind.video : CallKind.audio;

String callKindToJson(CallKind kind) => kind == CallKind.video ? 'VIDEO' : 'AUDIO';

class CallDto {
  final String id;
  final String messageId;
  final String callerId;
  final String calleeId;
  final CallKind type;
  final String status;
  final String? callerLanguage;
  final String? calleeLanguage;

  const CallDto({
    required this.id,
    required this.messageId,
    required this.callerId,
    required this.calleeId,
    required this.type,
    required this.status,
    this.callerLanguage,
    this.calleeLanguage,
  });

  factory CallDto.fromJson(Map<String, dynamic> json) => CallDto(
        id: json['id'] as String,
        messageId: json['messageId'] as String,
        callerId: json['callerId'] as String,
        calleeId: json['calleeId'] as String,
        type: callKindFromJson(json['type'] as String?),
        status: json['status'] as String,
        callerLanguage: json['callerLanguage'] as String?,
        calleeLanguage: json['calleeLanguage'] as String?,
      );
}

class CallMessageDto {
  final String id;
  final String conversationId;
  final String senderId;
  final CallDto call;

  const CallMessageDto({
    required this.id,
    required this.conversationId,
    required this.senderId,
    required this.call,
  });

  factory CallMessageDto.fromJson(Map<String, dynamic> json) => CallMessageDto(
        id: json['id'] as String,
        conversationId: json['conversationId'] as String,
        senderId: json['senderId'] as String,
        call: CallDto.fromJson(json['call'] as Map<String, dynamic>),
      );
}
