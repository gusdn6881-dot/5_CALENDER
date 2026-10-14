class TodoModel {
  final String id;
  final String calendarId;
  final String creatorId;
  final String title;
  final bool isCompleted;
  final DateTime? dueDate;
  final int priority; // 1: Low, 2: Medium, 3: High
  final String? eventId;

  TodoModel({
    required this.id,
    required this.calendarId,
    required this.creatorId,
    required this.title,
    this.isCompleted = false,
    this.dueDate,
    this.priority = 2,
    this.eventId,
  });

  factory TodoModel.fromJson(Map<String, dynamic> json) {
    return TodoModel(
      id: json['id'] as String,
      calendarId: json['calendar_id'] as String,
      creatorId: json['creator_id'] as String,
      title: json['title'] as String,
      isCompleted: json['is_completed'] as bool? ?? false,
      dueDate: json['due_date'] != null ? DateTime.parse(json['due_date'] as String) : null,
      priority: json['priority'] as int? ?? 2,
      eventId: json['event_id'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'calendar_id': calendarId,
      'creator_id': creatorId,
      'title': title,
      'is_completed': isCompleted,
      'due_date': dueDate?.toIso8601String().split('T').first,
      'priority': priority,
      'event_id': eventId,
    };
  }

  TodoModel copyWith({
    bool? isCompleted,
    String? title,
    DateTime? dueDate,
    int? priority,
  }) {
    return TodoModel(
      id: id,
      calendarId: calendarId,
      creatorId: creatorId,
      title: title ?? this.title,
      isCompleted: isCompleted ?? this.isCompleted,
      dueDate: dueDate ?? this.dueDate,
      priority: priority ?? this.priority,
      eventId: eventId,
    );
  }
}

