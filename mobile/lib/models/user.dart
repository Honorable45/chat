import 'language.dart';

/// Utilisateur minimal (voir `SafeUser`/`PublicUser` côté web) — embarqué
/// dans `AuthResponse`, et champ de base commun à `Me`/`ConversationParticipant`.
class SafeUser {
  final String id;
  final String username;
  final String firstName;
  final String lastName;
  final String? email;
  final String? phone;

  const SafeUser({
    required this.id,
    required this.username,
    required this.firstName,
    required this.lastName,
    this.email,
    this.phone,
  });

  factory SafeUser.fromJson(Map<String, dynamic> json) => SafeUser(
        id: json['id'] as String,
        username: json['username'] as String,
        firstName: json['firstName'] as String,
        lastName: json['lastName'] as String,
        email: json['email'] as String?,
        phone: json['phone'] as String?,
      );

  String get displayName {
    final full = '$firstName $lastName'.trim();
    return full.isEmpty ? username : full;
  }
}

class MeProfile {
  final String? avatarUrl;
  final bool avatarUploaded;
  final String? statusText;
  final bool showLastSeen;
  final bool showOnlineStatus;
  final bool showReadReceipts;
  final String whoCanMessageMe;
  final String whoCanSeeMyStatus;
  final bool notificationsEnabled;
  final bool hideNotificationContent;
  final bool voiceCloningConsent;
  final bool voiceModelRegistered;

  const MeProfile({
    this.avatarUrl,
    required this.avatarUploaded,
    this.statusText,
    required this.showLastSeen,
    required this.showOnlineStatus,
    required this.showReadReceipts,
    required this.whoCanMessageMe,
    required this.whoCanSeeMyStatus,
    required this.notificationsEnabled,
    required this.hideNotificationContent,
    required this.voiceCloningConsent,
    required this.voiceModelRegistered,
  });

  factory MeProfile.fromJson(Map<String, dynamic> json) => MeProfile(
        avatarUrl: json['avatarUrl'] as String?,
        avatarUploaded: json['avatarUploaded'] as bool? ?? false,
        statusText: json['statusText'] as String?,
        showLastSeen: json['showLastSeen'] as bool? ?? true,
        showOnlineStatus: json['showOnlineStatus'] as bool? ?? true,
        showReadReceipts: json['showReadReceipts'] as bool? ?? true,
        whoCanMessageMe: json['whoCanMessageMe'] as String? ?? 'EVERYONE',
        whoCanSeeMyStatus: json['whoCanSeeMyStatus'] as String? ?? 'EVERYONE',
        notificationsEnabled: json['notificationsEnabled'] as bool? ?? true,
        hideNotificationContent: json['hideNotificationContent'] as bool? ?? false,
        voiceCloningConsent: json['voiceCloningConsent'] as bool? ?? false,
        voiceModelRegistered: json['voiceModelRegistered'] as bool? ?? false,
      );
}

class Me {
  final String id;
  final String username;
  final String firstName;
  final String lastName;
  final String? email;
  final String? phone;
  final bool isOnline;
  final DateTime? lastSeenAt;
  final LanguageSummary? primaryLanguage;
  final LanguageSummary? preferredReceiveLanguage;
  final List<LanguageSummary> spokenLanguages;
  final MeProfile? profile;
  final DateTime createdAt;

  const Me({
    required this.id,
    required this.username,
    required this.firstName,
    required this.lastName,
    this.email,
    this.phone,
    required this.isOnline,
    this.lastSeenAt,
    this.primaryLanguage,
    this.preferredReceiveLanguage,
    required this.spokenLanguages,
    this.profile,
    required this.createdAt,
  });

  String get displayName {
    final full = '$firstName $lastName'.trim();
    return full.isEmpty ? username : full;
  }

  factory Me.fromJson(Map<String, dynamic> json) => Me(
        id: json['id'] as String,
        username: json['username'] as String,
        firstName: json['firstName'] as String,
        lastName: json['lastName'] as String,
        email: json['email'] as String?,
        phone: json['phone'] as String?,
        isOnline: json['isOnline'] as bool? ?? false,
        lastSeenAt:
            json['lastSeenAt'] == null ? null : DateTime.parse(json['lastSeenAt'] as String),
        primaryLanguage: json['primaryLanguage'] == null
            ? null
            : LanguageSummary.fromJson(json['primaryLanguage'] as Map<String, dynamic>),
        preferredReceiveLanguage: json['preferredReceiveLanguage'] == null
            ? null
            : LanguageSummary.fromJson(json['preferredReceiveLanguage'] as Map<String, dynamic>),
        spokenLanguages: (json['spokenLanguages'] as List<dynamic>? ?? [])
            .map((e) => LanguageSummary.fromJson(e as Map<String, dynamic>))
            .toList(),
        profile:
            json['profile'] == null ? null : MeProfile.fromJson(json['profile'] as Map<String, dynamic>),
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}

class AuthResponse {
  final String accessToken;
  final String refreshToken;
  final SafeUser user;

  const AuthResponse({required this.accessToken, required this.refreshToken, required this.user});

  factory AuthResponse.fromJson(Map<String, dynamic> json) => AuthResponse(
        accessToken: json['accessToken'] as String,
        refreshToken: json['refreshToken'] as String,
        user: SafeUser.fromJson(json['user'] as Map<String, dynamic>),
      );
}
