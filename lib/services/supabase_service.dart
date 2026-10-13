import 'package:supabase_flutter/supabase_flutter.dart';
import '../models/calendar_model.dart';
import '../models/event_model.dart';
import '../models/todo_model.dart';
import 'widget_service.dart';

class SupabaseService {
  final SupabaseClient _client = Supabase.instance.client;

  String? get currentUserId => _client.auth.currentUser?.id;

  /// 사용자가 속한 모든 캘린더 목록 가져오기
  Future<List<CalendarModel>> fetchUserCalendars() async {
    final response = await _client.from('calendars').select();
    return (response as List).map((json) => CalendarModel.fromJson(json)).toList();
  }

  /// 특정 기간의 일정 목록 조회
  Future<List<EventModel>> fetchEvents({
    required DateTime start,
    required DateTime end,
  }) async {
    final response = await _client
        .from('events')
        .select()
        .gte('start_time', start.toIso8601String())
        .lte('end_time', end.toIso8601String())
        .order('start_time');

    return (response as List).map((json) => EventModel.fromJson(json)).toList();
  }

  /// 새 일정 추가 및 홈 위젯 즉시 갱신
  Future<void> addEvent(EventModel event) async {
    await _client.from('events').insert(event.toJson());
    await refreshHomeWidget();
  }

  /// 할 일 목록 조회
  Future<List<TodoModel>> fetchTodos() async {
    final response = await _client
        .from('todos')
        .select()
        .order('is_completed')
        .order('due_date', ascending: true);

    return (response as List).map((json) => TodoModel.fromJson(json)).toList();
  }

  /// 할 일 완료 상태 토글 및 위젯 갱신
  Future<void> toggleTodoStatus(String id, bool isCompleted) async {
    await _client.from('todos').update({
      'is_completed': isCompleted,
      'completed_at': isCompleted ? DateTime.now().toIso8601String() : null,
    }).eq('id', id);

    await refreshHomeWidget();
  }

  /// 새 할 일 추가
  Future<void> addTodo(TodoModel todo) async {
    await _client.from('todos').insert(todo.toJson());
    await refreshHomeWidget();
  }

  /// 홈 화면 위젯에 오늘 날짜의 최신 일정과 할 일 전달
  Future<void> refreshHomeWidget() async {
    final now = DateTime.now();
    final todayStart = DateTime(now.year, now.month, now.day);
    final todayEnd = DateTime(now.year, now.month, now.day, 23, 59, 59);

    final events = await fetchEvents(start: todayStart, end: todayEnd);
    final todos = await fetchTodos();
    final todayTodos = todos.where((t) {
      if (t.dueDate == null) return !t.isCompleted;
      final d = t.dueDate!;
      return d.year == now.year && d.month == now.month && d.day == now.day;
    }).toList();

    await WidgetService.syncDataToHomeWidget(
      todayEvents: events,
      todayTodos: todayTodos,
    );
  }
}

