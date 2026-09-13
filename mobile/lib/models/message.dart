/// Discriminant complet côté serveur (voir `MessageType` dans le schéma
/// Prisma) — seul `text` est rendu pour de vrai dans cette 1ère tranche,
/// les autres valeurs sont reconnues (pour ne pas planter le parsing d'un
/// historique existant) mais affichées comme un espace réservé générique
/// tant que leurs écrans dédiés n'existent pas côté mobile (voir
/// MessageBubble côté web pour la liste complète déjà supportée là-bas).
enum MessageType {
  text,
  voice,
  image,
  video,
  file,
  call,
  groupCall,
  mediaAlbum,
  contactShare,
  location,
  sticker,
  system,
  unknown,
}

MessageType _parseMessageType(String raw) {
  switch (raw) {
    case 'TEXT':
      return MessageType.text;
    case 'VOICE':
      return MessageType.voice;
    case 'IMAGE':
      return MessageType.image;
    case 'VIDEO':
      return MessageType.video;
    case 'FILE':
      return MessageType.file;
    case 'CALL':
      return MessageType.call;
    case 'GROUP_CALL':
      return MessageType.groupCall;
    case 'MEDIA_ALBUM':
      return MessageType.mediaAlbum;
    case 'CONTACT_SHARE':
      return MessageType.contactShare;
    case 'LOCATION':
      return MessageType.location;
    case 'STICKER':
      return MessageType.sticker;
    case 'SYSTEM':
      return MessageType.system;
    default:
      return MessageType.unknown;
  }
}

class ReplyToSummary {
  final String id;
  final String senderId;
  final MessageType type;
  final String? text;
  final DateTime? deletedAt;

  const ReplyToSummary({
    required this.id,
    required this.senderId,
    required this.type,
    this.text,
    this.deletedAt,
  });

  factory ReplyToSummary.fromJson(Map<String, dynamic> json) => ReplyToSummary(
        id: json['id'] as String,
        senderId: json['senderId'] as String,
        type: _parseMessageType(json['type'] as String),
        text: json['text'] as String?,
        deletedAt: json['deletedAt'] == null ? null : DateTime.parse(json['deletedAt'] as String),
      );
}

class MessageReaction {
  final String userId;
  final String emoji;

  const MessageReaction({required this.userId, required this.emoji});

  factory MessageReaction.fromJson(Map<String, dynamic> json) =>
      MessageReaction(userId: json['userId'] as String, emoji: json['emoji'] as String);
}

/// `TranslationStatus` du backend — porte UNIQUEMENT l'étape "traduction du
/// texte" (voir VoiceDetails.hasTranslatedAudio ci-dessous pour l'étape TTS,
/// distincte et jamais reflétée par ce statut : un échec de synthèse vocale
/// ne fait jamais redescendre un texte déjà traduit avec succès).
enum TranslationStatus { pending, processing, completed, failed }

TranslationStatus _parseTranslationStatus(String raw) {
  switch (raw) {
    case 'PENDING':
      return TranslationStatus.pending;
    case 'PROCESSING':
      return TranslationStatus.processing;
    case 'COMPLETED':
      return TranslationStatus.completed;
    case 'FAILED':
      return TranslationStatus.failed;
    default:
      return TranslationStatus.pending;
  }
}

class LanguageRef {
  final String code;
  final String name;
  final String nativeName;

  const LanguageRef({required this.code, required this.name, required this.nativeName});

  factory LanguageRef.fromJson(Map<String, dynamic> json) => LanguageRef(
        code: json['code'] as String,
        name: json['name'] as String,
        nativeName: json['nativeName'] as String,
      );
}

class VoiceTranslation {
  final LanguageRef targetLanguage;
  final TranslationStatus status;
  final String? translatedText;
  final String? audioUrl;
  final bool usedVoiceCloning;

  const VoiceTranslation({
    required this.targetLanguage,
    required this.status,
    this.translatedText,
    this.audioUrl,
    this.usedVoiceCloning = false,
  });

  /// Cf. rapport backend : `status` ne concerne que le texte — l'audio n'est
  /// prêt que si en plus `audioUrl` est renseigné (peut rester `null`
  /// indéfiniment si la synthèse vocale échoue en silence ou n'est pas
  /// configurée côté serveur, voir VoiceMessageBubble côté web).
  bool get hasAudio => status == TranslationStatus.completed && audioUrl != null;

  VoiceTranslation copyWith({
    TranslationStatus? status,
    String? translatedText,
    String? audioUrl,
    bool? usedVoiceCloning,
  }) =>
      VoiceTranslation(
        targetLanguage: targetLanguage,
        status: status ?? this.status,
        translatedText: translatedText ?? this.translatedText,
        audioUrl: audioUrl ?? this.audioUrl,
        usedVoiceCloning: usedVoiceCloning ?? this.usedVoiceCloning,
      );

  factory VoiceTranslation.fromJson(Map<String, dynamic> json) => VoiceTranslation(
        targetLanguage: LanguageRef.fromJson(json['targetLanguage'] as Map<String, dynamic>),
        status: _parseTranslationStatus(json['status'] as String),
        translatedText: json['translatedText'] as String?,
        audioUrl: json['audioUrl'] as String?,
        usedVoiceCloning: json['usedVoiceCloning'] as bool? ?? false,
      );
}

class VoiceDetails {
  final int durationSeconds;
  final String audioUrl;
  final String? transcript;
  final LanguageRef? detectedLanguage;
  final bool languageOverridden;
  final List<VoiceTranslation> translations;

  const VoiceDetails({
    required this.durationSeconds,
    required this.audioUrl,
    this.transcript,
    this.detectedLanguage,
    this.languageOverridden = false,
    this.translations = const [],
  });

  VoiceDetails copyWith({List<VoiceTranslation>? translations, String? transcript}) => VoiceDetails(
        durationSeconds: durationSeconds,
        audioUrl: audioUrl,
        transcript: transcript ?? this.transcript,
        detectedLanguage: detectedLanguage,
        languageOverridden: languageOverridden,
        translations: translations ?? this.translations,
      );

  factory VoiceDetails.fromJson(Map<String, dynamic> json) => VoiceDetails(
        durationSeconds: json['durationSeconds'] as int,
        audioUrl: json['audioUrl'] as String,
        transcript: json['transcript'] as String?,
        detectedLanguage: json['detectedLanguage'] == null
            ? null
            : LanguageRef.fromJson(json['detectedLanguage'] as Map<String, dynamic>),
        languageOverridden: json['languageOverridden'] as bool? ?? false,
        translations: (json['translations'] as List<dynamic>? ?? [])
            .map((e) => VoiceTranslation.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class LocationDetails {
  final double latitude;
  final double longitude;
  final bool isLive;
  final DateTime? expiresAt;
  final DateTime? endedAt;

  const LocationDetails({
    required this.latitude,
    required this.longitude,
    this.isLive = false,
    this.expiresAt,
    this.endedAt,
  });

  factory LocationDetails.fromJson(Map<String, dynamic> json) => LocationDetails(
        latitude: (json['latitude'] as num).toDouble(),
        longitude: (json['longitude'] as num).toDouble(),
        isLive: json['isLive'] as bool? ?? false,
        expiresAt: json['expiresAt'] == null ? null : DateTime.parse(json['expiresAt'] as String),
        endedAt: json['endedAt'] == null ? null : DateTime.parse(json['endedAt'] as String),
      );
}

enum AttachmentType { image, video }

AttachmentType _parseAttachmentType(String raw) =>
    raw == 'VIDEO' ? AttachmentType.video : AttachmentType.image;

class MessageAttachment {
  final String id;
  final String url;
  final String mimeType;
  final int sizeBytes;
  final AttachmentType type;
  final String? fileName;
  final int? durationSeconds;
  final int? width;
  final int? height;

  const MessageAttachment({
    required this.id,
    required this.url,
    required this.mimeType,
    required this.sizeBytes,
    required this.type,
    this.fileName,
    this.durationSeconds,
    this.width,
    this.height,
  });

  factory MessageAttachment.fromJson(Map<String, dynamic> json) => MessageAttachment(
        id: json['id'] as String,
        url: json['url'] as String,
        mimeType: json['mimeType'] as String,
        sizeBytes: json['sizeBytes'] as int,
        type: _parseAttachmentType(json['type'] as String),
        fileName: json['fileName'] as String?,
        durationSeconds: json['durationSeconds'] as int?,
        width: json['width'] as int?,
        height: json['height'] as int?,
      );
}

class Message {
  final String id;
  final String conversationId;
  final String senderId;
  final MessageType type;
  final String? text;
  final String? systemAction;
  final String? systemTargetUserId;
  final String? replyToId;
  final ReplyToSummary? replyTo;
  final DateTime? editedAt;
  final DateTime? deletedAt;
  final DateTime sentAt;
  final DateTime? deliveredAt;
  final DateTime? readAt;
  final DateTime createdAt;
  final List<MessageReaction> reactions;
  final List<String> mentions;
  final bool mentionsEveryone;
  final VoiceDetails? voice;
  final List<MessageAttachment> attachments;
  final LocationDetails? location;

  const Message({
    required this.id,
    required this.conversationId,
    required this.senderId,
    required this.type,
    this.text,
    this.systemAction,
    this.systemTargetUserId,
    this.replyToId,
    this.replyTo,
    this.editedAt,
    this.deletedAt,
    required this.sentAt,
    this.deliveredAt,
    this.readAt,
    required this.createdAt,
    this.reactions = const [],
    this.mentions = const [],
    this.mentionsEveryone = false,
    this.voice,
    this.attachments = const [],
    this.location,
  });

  Message copyWith({
    DateTime? deliveredAt,
    DateTime? readAt,
    List<MessageReaction>? reactions,
    VoiceDetails? voice,
  }) =>
      Message(
        id: id,
        conversationId: conversationId,
        senderId: senderId,
        type: type,
        text: text,
        systemAction: systemAction,
        systemTargetUserId: systemTargetUserId,
        replyToId: replyToId,
        replyTo: replyTo,
        editedAt: editedAt,
        deletedAt: deletedAt,
        sentAt: sentAt,
        deliveredAt: deliveredAt ?? this.deliveredAt,
        readAt: readAt ?? this.readAt,
        createdAt: createdAt,
        reactions: reactions ?? this.reactions,
        mentions: mentions,
        mentionsEveryone: mentionsEveryone,
        voice: voice ?? this.voice,
        attachments: attachments,
        location: location,
      );

  factory Message.fromJson(Map<String, dynamic> json) => Message(
        id: json['id'] as String,
        conversationId: json['conversationId'] as String,
        senderId: json['senderId'] as String,
        type: _parseMessageType(json['type'] as String),
        text: json['text'] as String?,
        systemAction: json['systemAction'] as String?,
        systemTargetUserId: json['systemTargetUserId'] as String?,
        replyToId: json['replyToId'] as String?,
        replyTo: json['replyTo'] == null
            ? null
            : ReplyToSummary.fromJson(json['replyTo'] as Map<String, dynamic>),
        editedAt: json['editedAt'] == null ? null : DateTime.parse(json['editedAt'] as String),
        deletedAt: json['deletedAt'] == null ? null : DateTime.parse(json['deletedAt'] as String),
        sentAt: DateTime.parse(json['sentAt'] as String),
        deliveredAt:
            json['deliveredAt'] == null ? null : DateTime.parse(json['deliveredAt'] as String),
        readAt: json['readAt'] == null ? null : DateTime.parse(json['readAt'] as String),
        createdAt: DateTime.parse(json['createdAt'] as String),
        reactions: (json['reactions'] as List<dynamic>? ?? [])
            .map((e) => MessageReaction.fromJson(e as Map<String, dynamic>))
            .toList(),
        mentions: (json['mentions'] as List<dynamic>? ?? []).map((e) => e as String).toList(),
        mentionsEveryone: json['mentionsEveryone'] as bool? ?? false,
        voice: json['voice'] == null ? null : VoiceDetails.fromJson(json['voice'] as Map<String, dynamic>),
        attachments: (json['attachments'] as List<dynamic>? ?? [])
            .map((e) => MessageAttachment.fromJson(e as Map<String, dynamic>))
            .toList(),
        location:
            json['location'] == null ? null : LocationDetails.fromJson(json['location'] as Map<String, dynamic>),
      );

  /// La création (`POST /voice/messages`) et l'hydratation (`GET
  /// /voice/:messageId`) renvoient un `VoiceMessageDto` plus mince qu'un
  /// `Message` générique (pas de `text`/`readAt`/`reactions`/`mentions`,
  /// voir le rapport backend) — mêmes champs d'identité, les champs
  /// génériques absents prennent leur valeur par défaut, comme
  /// `normalizeIncomingMessage` côté web.
  factory Message.fromVoiceJson(Map<String, dynamic> json) => Message(
        id: json['id'] as String,
        conversationId: json['conversationId'] as String,
        senderId: json['senderId'] as String,
        type: MessageType.voice,
        replyToId: json['replyToId'] as String?,
        deletedAt: json['deletedAt'] == null ? null : DateTime.parse(json['deletedAt'] as String),
        sentAt: DateTime.parse(json['sentAt'] as String),
        deliveredAt:
            json['deliveredAt'] == null ? null : DateTime.parse(json['deliveredAt'] as String),
        createdAt: DateTime.parse(json['createdAt'] as String),
        voice: json['voice'] == null ? null : VoiceDetails.fromJson(json['voice'] as Map<String, dynamic>),
      );
}
