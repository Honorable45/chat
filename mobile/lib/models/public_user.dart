import 'language.dart';

class PublicUser {
  final String id;
  final String username;
  final String firstName;
  final String lastName;
  final String? avatarUrl;
  final String? statusText;
  final bool isOnline;
  final DateTime? lastSeenAt;
  final LanguageSummary? primaryLanguage;
  final List<LanguageSummary> spokenLanguages;

  const PublicUser({
    required this.id,
    required this.username,
    required this.firstName,
    required this.lastName,
    this.avatarUrl,
    this.statusText,
    this.isOnline = false,
    this.lastSeenAt,
    this.primaryLanguage,
    this.spokenLanguages = const [],
  });

  String get displayName {
    final full = '$firstName $lastName'.trim();
    return full.isEmpty ? username : full;
  }

  factory PublicUser.fromJson(Map<String, dynamic> json) => PublicUser(
        id: json['id'] as String,
        username: json['username'] as String,
        firstName: json['firstName'] as String,
        lastName: json['lastName'] as String,
        avatarUrl: json['avatarUrl'] as String?,
        statusText: json['statusText'] as String?,
        isOnline: json['isOnline'] as bool? ?? false,
        lastSeenAt:
            json['lastSeenAt'] == null ? null : DateTime.parse(json['lastSeenAt'] as String),
        primaryLanguage: json['primaryLanguage'] == null
            ? null
            : LanguageSummary.fromJson(json['primaryLanguage'] as Map<String, dynamic>),
        spokenLanguages: (json['spokenLanguages'] as List<dynamic>? ?? [])
            .map((e) => LanguageSummary.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

enum ContactRequestStatus { pending, accepted, declined, blocked }

ContactRequestStatus _parseContactRequestStatus(String raw) {
  switch (raw) {
    case 'ACCEPTED':
      return ContactRequestStatus.accepted;
    case 'DECLINED':
      return ContactRequestStatus.declined;
    case 'BLOCKED':
      return ContactRequestStatus.blocked;
    default:
      return ContactRequestStatus.pending;
  }
}

class ContactRequest {
  final String id;
  final ContactRequestStatus status;
  final PublicUser user;
  final DateTime createdAt;
  final DateTime updatedAt;

  const ContactRequest({
    required this.id,
    required this.status,
    required this.user,
    required this.createdAt,
    required this.updatedAt,
  });

  factory ContactRequest.fromJson(Map<String, dynamic> json) => ContactRequest(
        id: json['id'] as String,
        status: _parseContactRequestStatus(json['status'] as String),
        user: PublicUser.fromJson(json['user'] as Map<String, dynamic>),
        createdAt: DateTime.parse(json['createdAt'] as String),
        updatedAt: DateTime.parse(json['updatedAt'] as String),
      );
}
