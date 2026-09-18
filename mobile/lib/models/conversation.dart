enum ConversationType { direct, group }

ConversationType _parseConversationType(String raw) =>
    raw == 'GROUP' ? ConversationType.group : ConversationType.direct;

/// `GroupPermission` (schéma Prisma) — n'a de sens que pour un groupe,
/// toujours `EVERYONE` côté serveur pour une conversation DIRECT.
enum GroupPermission { everyone, adminOnly }

GroupPermission _parseGroupPermission(String? raw) =>
    raw == 'ADMIN_ONLY' ? GroupPermission.adminOnly : GroupPermission.everyone;

String groupPermissionToJson(GroupPermission p) => p == GroupPermission.adminOnly ? 'ADMIN_ONLY' : 'EVERYONE';

class GroupPermissions {
  final GroupPermission editInfo;
  final GroupPermission sendMessages;
  final GroupPermission addMembers;
  final GroupPermission sendMedia;
  final GroupPermission mentionEveryone;

  const GroupPermissions({
    this.editInfo = GroupPermission.everyone,
    this.sendMessages = GroupPermission.everyone,
    this.addMembers = GroupPermission.everyone,
    this.sendMedia = GroupPermission.everyone,
    this.mentionEveryone = GroupPermission.adminOnly,
  });

  GroupPermissions copyWith({
    GroupPermission? editInfo,
    GroupPermission? sendMessages,
    GroupPermission? addMembers,
  }) =>
      GroupPermissions(
        editInfo: editInfo ?? this.editInfo,
        sendMessages: sendMessages ?? this.sendMessages,
        addMembers: addMembers ?? this.addMembers,
        sendMedia: sendMedia,
        mentionEveryone: mentionEveryone,
      );

  factory GroupPermissions.fromJson(Map<String, dynamic> json) => GroupPermissions(
        editInfo: _parseGroupPermission(json['editInfoPermission'] as String?),
        sendMessages: _parseGroupPermission(json['sendMessagesPermission'] as String?),
        addMembers: _parseGroupPermission(json['addMembersPermission'] as String?),
        sendMedia: _parseGroupPermission(json['sendMediaPermission'] as String?),
        mentionEveryone: _parseGroupPermission(json['mentionEveryonePermission'] as String?),
      );
}

class ConversationParticipant {
  final String id;
  final String username;
  final String firstName;
  final String lastName;
  final String? avatarUrl;
  final String? statusText;
  final bool isOnline;
  final DateTime? lastSeenAt;
  final String role;

  const ConversationParticipant({
    required this.id,
    required this.username,
    required this.firstName,
    required this.lastName,
    this.avatarUrl,
    this.statusText,
    required this.isOnline,
    this.lastSeenAt,
    required this.role,
  });

  String get displayName {
    final full = '$firstName $lastName'.trim();
    return full.isEmpty ? username : full;
  }

  factory ConversationParticipant.fromJson(Map<String, dynamic> json) => ConversationParticipant(
        id: json['id'] as String,
        username: json['username'] as String,
        firstName: json['firstName'] as String,
        lastName: json['lastName'] as String,
        avatarUrl: json['avatarUrl'] as String?,
        statusText: json['statusText'] as String?,
        isOnline: json['isOnline'] as bool? ?? false,
        lastSeenAt:
            json['lastSeenAt'] == null ? null : DateTime.parse(json['lastSeenAt'] as String),
        role: json['role'] as String? ?? 'MEMBER',
      );
}

/// Résumé du dernier message — champs génériques uniquement pour la 1ère
/// tranche (texte) ; les champs spécifiques (appel, média...) sont gardés en
/// bruts (`Map`) pour un typage plus tard, jamais interprétés ici (voir
/// `ConversationList.preview()` côté web pour l'équivalent complet).
class ConversationLastMessage {
  final String id;
  final String type;
  final String? text;
  final String senderId;
  final DateTime sentAt;

  const ConversationLastMessage({
    required this.id,
    required this.type,
    this.text,
    required this.senderId,
    required this.sentAt,
  });

  factory ConversationLastMessage.fromJson(Map<String, dynamic> json) => ConversationLastMessage(
        id: json['id'] as String,
        type: json['type'] as String,
        text: json['text'] as String?,
        senderId: json['senderId'] as String,
        sentAt: DateTime.parse(json['sentAt'] as String),
      );
}

class ConversationMembership {
  final bool isArchived;
  final bool isMuted;
  final bool isPinned;
  final DateTime? lastReadAt;
  final String role;

  const ConversationMembership({
    required this.isArchived,
    required this.isMuted,
    this.isPinned = false,
    this.lastReadAt,
    required this.role,
  });

  factory ConversationMembership.fromJson(Map<String, dynamic> json) => ConversationMembership(
        isArchived: json['isArchived'] as bool? ?? false,
        isMuted: json['isMuted'] as bool? ?? false,
        isPinned: json['isPinned'] as bool? ?? false,
        lastReadAt:
            json['lastReadAt'] == null ? null : DateTime.parse(json['lastReadAt'] as String),
        role: json['role'] as String? ?? 'MEMBER',
      );
}

class Conversation {
  final String id;
  final ConversationType type;
  final String? title;
  final String? photoUrl;
  final ConversationParticipant? otherParticipant;
  final List<ConversationParticipant> members;
  final ConversationMembership myMembership;
  final ConversationLastMessage? lastMessage;
  final int unreadCount;
  final DateTime updatedAt;
  final GroupPermissions permissions;

  const Conversation({
    required this.id,
    required this.type,
    this.title,
    this.photoUrl,
    this.otherParticipant,
    required this.members,
    required this.myMembership,
    this.lastMessage,
    required this.unreadCount,
    required this.updatedAt,
    this.permissions = const GroupPermissions(),
  });

  /// Même règle que `displayName()` côté web (ConversationList.tsx) : le
  /// titre choisi prime toujours (utile pour les groupes), sinon le nom de
  /// l'autre participant pour une conversation directe.
  String displayTitle(String fallback) {
    if (title != null && title!.isNotEmpty) return title!;
    if (otherParticipant != null) return otherParticipant!.displayName;
    return fallback;
  }

  factory Conversation.fromJson(Map<String, dynamic> json) => Conversation(
        id: json['id'] as String,
        type: _parseConversationType(json['type'] as String),
        title: json['title'] as String?,
        photoUrl: json['photoUrl'] as String?,
        otherParticipant: json['otherParticipant'] == null
            ? null
            : ConversationParticipant.fromJson(json['otherParticipant'] as Map<String, dynamic>),
        members: (json['members'] as List<dynamic>? ?? [])
            .map((e) => ConversationParticipant.fromJson(e as Map<String, dynamic>))
            .toList(),
        myMembership: ConversationMembership.fromJson(
            (json['myMembership'] as Map<String, dynamic>?) ?? const {}),
        lastMessage: json['lastMessage'] == null
            ? null
            : ConversationLastMessage.fromJson(json['lastMessage'] as Map<String, dynamic>),
        unreadCount: json['unreadCount'] as int? ?? 0,
        updatedAt: DateTime.parse(json['updatedAt'] as String),
        permissions: GroupPermissions.fromJson(json),
      );
}

class Page<T> {
  final List<T> items;
  final String? nextCursor;

  const Page({required this.items, this.nextCursor});

  factory Page.fromJson(Map<String, dynamic> json, T Function(Map<String, dynamic>) fromJson) =>
      Page(
        items: (json['items'] as List<dynamic>)
            .map((e) => fromJson(e as Map<String, dynamic>))
            .toList(),
        nextCursor: json['nextCursor'] as String?,
      );
}
