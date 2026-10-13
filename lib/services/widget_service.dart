import 'dart:convert';
import 'package:home_widget/home_widget.dart';
import '../models/event_model.dart';
import '../models/todo_model.dart';

class WidgetService {
  static const String appGroupId = 'group.com.example.calender';
  static const String iOSWidgetName = 'CalendarWidget';
  static const String androidWidgetName = 'CalendarWidgetProvider';

  /// 위젯 서비스 초기화
  static Future<void> initialize() async {
    await HomeWidget.setAppGroupId(appGroupId);
  }

  /// 오늘 일정 및 할 일 데이터를 모바일 홈 화면 위젯 저장소로 동기화
  static Future<void> syncDataToHomeWidget({
    required List<EventModel> todayEvents,
    required List<TodoModel> todayTodos,
  }) async {
    final eventsPayload = todayEvents.map((e) => {
      'id': e.id,
      'title': e.title,
      'time': e.isAllDay
          ? '종일'
          : '${e.startTime.hour.toString().padLeft(2, '0')}:${e.startTime.minute.toString().padLeft(2, '0')}',
      'color': e.color ?? '#4A90E2',
    }).toList();

    final todosPayload = todayTodos.map((t) => {
      'id': t.id,
      'title': t.title,
      'is_completed': t.isCompleted,
      'priority': t.priority,
    }).toList();

    // 네이티브 공유 저장소(iOS App Group / Android SharedPreferences)에 저장
    await HomeWidget.saveWidgetData<String>(
      'widget_events_json',
      jsonEncode(eventsPayload),
    );
    await HomeWidget.saveWidgetData<String>(
      'widget_todos_json',
      jsonEncode(todosPayload),
    );
    await HomeWidget.saveWidgetData<String>(
      'widget_last_updated',
      DateTime.now().toIso8601String(),
    );

    // 홈 화면 위젯 뷰 리로드 요청
    await HomeWidget.updateWidget(
      name: androidWidgetName,
      iOSName: iOSWidgetName,
    );
  }
}

