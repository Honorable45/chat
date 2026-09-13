class AppNotification {
  final String id;
  final String type;
  final Map<String, dynamic> payload;
  final DateTime? readAt;
  final DateTime createdAt;

  const AppNotification({
    required this.id,
    required this.type,
    required this.payload,
    this.readAt,
    required this.createdAt,
  });

  AppNotification copyWith({DateTime? readAt}) => AppNotification(
        id: id,
        type: type,
        payload: payload,
        readAt: readAt ?? this.readAt,
        createdAt: createdAt,
      );

  factory AppNotification.fromJson(Map<String, dynamic> json) => AppNotification(
        id: json['id'] as String,
        type: json['type'] as String,
        payload: (json['payload'] as Map<String, dynamic>?) ?? const {},
        readAt: json['readAt'] == null ? null : DateTime.parse(json['readAt'] as String),
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}
