enum CalendarType { personal, pair, group }
enum MemberRole { owner, editor, viewer }

class CalendarModel {
  final String id;
  final String name;
  final String color;
  final CalendarType type;
  final String ownerId;
  final String? inviteCode;
  final DateTime createdAt;

  CalendarModel({
    required this.id,
    required this.name,
    required this.color,
    required this.type,
    required this.ownerId,
    this.inviteCode,
    required this.createdAt,
  });

  factory CalendarModel.fromJson(Map<String, dynamic> json) {
    return CalendarModel(
      id: json['id'] as String,
      name: json['name'] as String,
      color: json['color'] as String? ?? '#4A90E2',
      type: CalendarType.values.firstWhere(
        (e) => e.name == json['type'],
        orElse: () => CalendarType.personal,
      ),
      ownerId: json['owner_id'] as String,
      inviteCode: json['invite_code'] as String?,
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'color': color,
      'type': type.name,
      'owner_id': ownerId,
      'invite_code': inviteCode,
      'created_at': createdAt.toIso8601String(),
    };
  }
}

