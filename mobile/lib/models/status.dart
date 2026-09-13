/// Port de `StatusDto`/`StatusView` côté backend (`StatusesService`) et de
/// `Status`/`StatusView`/`StatusAuthor` côté web (`lib/types.ts`) : statuts
/// façon "story", expirent après 24h côté serveur (jamais recalculé ici,
/// `expiresAt` sert seulement d'affichage éventuel).
enum StatusType { text, image, video, voice }

StatusType statusTypeFromJson(String value) => switch (value) {
      'TEXT' => StatusType.text,
      'IMAGE' => StatusType.image,
      'VIDEO' => StatusType.video,
      'VOICE' => StatusType.voice,
      _ => StatusType.text,
    };

String statusTypeToJson(StatusType type) => switch (type) {
      StatusType.text => 'TEXT',
      StatusType.image => 'IMAGE',
      StatusType.video => 'VIDEO',
      StatusType.voice => 'VOICE',
    };

enum StatusVisibility { everyone, contacts, nobody }

StatusVisibility statusVisibilityFromJson(String? value) => switch (value) {
      'EVERYONE' => StatusVisibility.everyone,
      'NOBODY' => StatusVisibility.nobody,
      _ => StatusVisibility.contacts,
    };

String statusVisibilityToJson(StatusVisibility visibility) => switch (visibility) {
      StatusVisibility.everyone => 'EVERYONE',
      StatusVisibility.contacts => 'CONTACTS',
      StatusVisibility.nobody => 'NOBODY',
    };

class StatusAuthor {
  final String id;
  final String username;
  final String firstName;
  final String lastName;
  final String? avatarUrl;

  const StatusAuthor({
    required this.id,
    required this.username,
    required this.firstName,
    required this.lastName,
    this.avatarUrl,
  });

  factory StatusAuthor.fromJson(Map<String, dynamic> json) => StatusAuthor(
        id: json['id'] as String,
        username: json['username'] as String,
        firstName: json['firstName'] as String,
        lastName: json['lastName'] as String,
        avatarUrl: json['avatarUrl'] as String?,
      );
}

class AppStatus {
  final String id;
  final StatusType type;
  final String? text;
  final String? mediaUrl;
  final StatusVisibility visibility;
  final StatusAuthor author;
  final bool isMine;
  final bool viewedByMe;
  final int? viewCount;
  final DateTime createdAt;
  final DateTime expiresAt;

  const AppStatus({
    required this.id,
    required this.type,
    this.text,
    this.mediaUrl,
    required this.visibility,
    required this.author,
    required this.isMine,
    required this.viewedByMe,
    this.viewCount,
    required this.createdAt,
    required this.expiresAt,
  });

  factory AppStatus.fromJson(Map<String, dynamic> json) => AppStatus(
        id: json['id'] as String,
        type: statusTypeFromJson(json['type'] as String),
        text: json['text'] as String?,
        mediaUrl: json['mediaUrl'] as String?,
        visibility: statusVisibilityFromJson(json['visibility'] as String?),
        author: StatusAuthor.fromJson(json['author'] as Map<String, dynamic>),
        isMine: json['isMine'] as bool? ?? false,
        viewedByMe: json['viewedByMe'] as bool? ?? false,
        viewCount: json['viewCount'] as int?,
        createdAt: DateTime.parse(json['createdAt'] as String),
        expiresAt: DateTime.parse(json['expiresAt'] as String),
      );
}

class StatusView {
  final DateTime viewedAt;
  final StatusAuthor viewer;

  const StatusView({required this.viewedAt, required this.viewer});

  factory StatusView.fromJson(Map<String, dynamic> json) => StatusView(
        viewedAt: DateTime.parse(json['viewedAt'] as String),
        viewer: StatusAuthor.fromJson(json['viewer'] as Map<String, dynamic>),
      );
}
