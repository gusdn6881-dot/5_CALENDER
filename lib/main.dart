import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:table_calendar/table_calendar.dart';
import 'models/event_model.dart';
import 'models/todo_model.dart';
import 'services/widget_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await WidgetService.initialize();

  // Supabase 초기화 (실제 배포 시 환경변수 또는 config 값 주입)
  // await Supabase.initialize(
  //   url: 'YOUR_SUPABASE_URL',
  //   anonKey: 'YOUR_SUPABASE_ANON_KEY',
  // );

  runApp(const CalenderApp());
}

class CalenderApp extends StatelessWidget {
  const CalenderApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Calender Hub',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF4A90E2),
          brightness: Brightness.light,
        ),
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF4A90E2),
          brightness: Brightness.dark,
        ),
      ),
      home: const MainHomeScreen(),
    );
  }
}

class MainHomeScreen extends StatefulWidget {
  const MainHomeScreen({super.key});

  @override
  State<MainHomeScreen> createState() => _MainHomeScreenState();
}

class _MainHomeScreenState extends State<MainHomeScreen> {
  int _currentTabIndex = 0;
  CalendarFormat _calendarFormat = CalendarFormat.month;
  DateTime _focusedDay = DateTime.now();
  DateTime? _selectedDay;

  // 로컬 데모 상태 (Supabase 연동 시 SupabaseService를 통해 실시간 동기화)
  final List<EventModel> _events = [
    EventModel(
      id: '1',
      calendarId: 'default',
      creatorId: 'user1',
      title: '프로젝트 킥오프 회의',
      startTime: DateTime.now().copyWith(hour: 14, minute: 0),
      endTime: DateTime.now().copyWith(hour: 15, minute: 30),
      color: '#4A90E2',
    ),
    EventModel(
      id: '2',
      calendarId: 'default',
      creatorId: 'user1',
      title: '저녁 약속',
      startTime: DateTime.now().copyWith(hour: 19, minute: 0),
      endTime: DateTime.now().copyWith(hour: 21, minute: 0),
      color: '#50E3C2',
    ),
  ];

  final List<TodoModel> _todos = [
    TodoModel(
      id: '1',
      calendarId: 'default',
      creatorId: 'user1',
      title: '캘린더 홈 화면 위젯 시연 테스트',
      isCompleted: false,
      priority: 3,
      dueDate: DateTime.now(),
    ),
    TodoModel(
      id: '2',
      calendarId: 'default',
      creatorId: 'user1',
      title: '아이폰 및 갤럭시 동기화 검증',
      isCompleted: true,
      priority: 2,
      dueDate: DateTime.now(),
    ),
  ];

  @override
  void initState() {
    super.initState();
    _selectedDay = _focusedDay;
    _syncWidget();
  }

  void _syncWidget() {
    WidgetService.syncDataToHomeWidget(
      todayEvents: _events,
      todayTodos: _todos,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          _currentTabIndex == 0 ? '캘린더' : (_currentTabIndex == 1 ? '할 일' : '공유 관리'),
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.sync),
            tooltip: '위젯 동기화',
            onPressed: () {
              _syncWidget();
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('홈 화면 위젯에 데이터가 동기화되었습니다.')),
              );
            },
          ),
          IconButton(
            icon: const Icon(Icons.group_add),
            tooltip: '캘린더 공유 및 초대',
            onPressed: _showShareDialog,
          ),
        ],
      ),
      body: _buildCurrentTab(),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentTabIndex,
        onDestinationSelected: (index) => setState(() => _currentTabIndex = index),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.calendar_month), label: '캘린더'),
          NavigationDestination(icon: Icon(Icons.check_circle_outline), label: '할 일'),
          NavigationDestination(icon: Icon(Icons.people_outline), label: '공유 스페이스'),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _openAddDialog,
        child: const Icon(Icons.add),
      ),
    );
  }

  Widget _buildCurrentTab() {
    switch (_currentTabIndex) {
      case 0:
        return _buildCalendarTab();
      case 1:
        return _buildTodoTab();
      case 2:
        return _buildShareTab();
      default:
        return const SizedBox.shrink();
    }
  }

  Widget _buildCalendarTab() {
    final selectedEvents = _events.where((e) {
      if (_selectedDay == null) return false;
      return isSameDay(e.startTime, _selectedDay);
    }).toList();

    return Column(
      children: [
        TableCalendar(
          firstDay: DateTime.utc(2020, 1, 1),
          lastDay: DateTime.utc(2030, 12, 31),
          focusedDay: _focusedDay,
          calendarFormat: _calendarFormat,
          selectedDayPredicate: (day) => isSameDay(_selectedDay, day),
          onDaySelected: (selectedDay, focusedDay) {
            setState(() {
              _selectedDay = selectedDay;
              _focusedDay = focusedDay;
            });
          },
          onFormatChanged: (format) => setState(() => _calendarFormat = format),
          eventLoader: (day) {
            return _events.where((e) => isSameDay(e.startTime, day)).toList();
          },
          headerStyle: const HeaderStyle(
            formatButtonVisible: true,
            titleCentered: true,
          ),
        ),
        const Divider(),
        Expanded(
          child: selectedEvents.isEmpty
              ? const Center(child: Text('등록된 일정이 없습니다.'))
              : ListView.builder(
                  itemCount: selectedEvents.length,
                  itemBuilder: (context, index) {
                    final item = selectedEvents[index];
                    return Card(
                      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                      child: ListTile(
                        leading: CircleAvatar(
                          backgroundColor: const Color(0xFF4A90E2),
                          radius: 8,
                        ),
                        title: Text(item.title, style: const TextStyle(fontWeight: FontWeight.bold)),
                        subtitle: Text(
                          '${DateFormat('HH:mm').format(item.startTime)} - ${DateFormat('HH:mm').format(item.endTime)}',
                        ),
                        trailing: const Icon(Icons.chevron_right),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildTodoTab() {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _todos.length,
      itemBuilder: (context, index) {
        final todo = _todos[index];
        return Card(
          margin: const EdgeInsets.only(bottom: 8),
          child: CheckboxListTile(
            value: todo.isCompleted,
            title: Text(
              todo.title,
              style: TextStyle(
                decoration: todo.isCompleted ? TextDecoration.lineThrough : null,
                color: todo.isCompleted ? Colors.grey : null,
              ),
            ),
            subtitle: Text(todo.dueDate != null
                ? '기한: ${DateFormat('yyyy-MM-dd').format(todo.dueDate!)}'
                : '기한 없음'),
            onChanged: (val) {
              setState(() {
                _todos[index] = todo.copyWith(isCompleted: val ?? false);
              });
              _syncWidget();
            },
          ),
        );
      },
    );
  }

  Widget _buildShareTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text(
          '공유 캘린더 모드',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 12),
        Card(
          child: ListTile(
            leading: const Icon(Icons.person, color: Colors.blue),
            title: const Text('개인 캘린더'),
            subtitle: const Text('내 기기 간(아이폰, 갤럭시) 자동 연동'),
            trailing: const Chip(label: Text('기본')),
          ),
        ),
        Card(
          child: ListTile(
            leading: const Icon(Icons.favorite, color: Colors.pink),
            title: const Text('2인 공유 (커플/가족)'),
            subtitle: const Text('파트너와 일대일 일정 및 기념일 공유'),
            trailing: ElevatedButton(
              onPressed: () {},
              child: const Text('초대하기'),
            ),
          ),
        ),
        Card(
          child: ListTile(
            leading: const Icon(Icons.groups, color: Colors.green),
            title: const Text('그룹/팀 캘린더'),
            subtitle: const Text('동아리, 스터디, 회사 업무 일정 관리'),
            trailing: ElevatedButton(
              onPressed: () {},
              child: const Text('팀 생성'),
            ),
          ),
        ),
      ],
    );
  }

  void _openAddDialog() {
    showModalBottomSheet(
      context: context,
      builder: (context) => SafeArea(
        child: Wrap(
          children: [
            ListTile(
              leading: const Icon(Icons.event),
              title: const Text('새 일정 추가'),
              onTap: () {
                Navigator.pop(context);
                _showAddEventDialog();
              },
            ),
            ListTile(
              leading: const Icon(Icons.check_box_outlined),
              title: const Text('새 할 일 추가'),
              onTap: () {
                Navigator.pop(context);
                _showAddTodoDialog();
              },
            ),
          ],
        ),
      ),
    );
  }

  void _showAddEventDialog() {
    final titleController = TextEditingController();
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('일정 등록'),
        content: TextField(
          controller: titleController,
          decoration: const InputDecoration(hintText: '일정 제목을 입력하세요'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('취소')),
          FilledButton(
            onPressed: () {
              if (titleController.text.isNotEmpty) {
                setState(() {
                  _events.add(EventModel(
                    id: DateTime.now().millisecondsSinceEpoch.toString(),
                    calendarId: 'default',
                    creatorId: 'me',
                    title: titleController.text,
                    startTime: _selectedDay ?? DateTime.now(),
                    endTime: (_selectedDay ?? DateTime.now()).add(const Duration(hours: 1)),
                  ));
                });
                _syncWidget();
                Navigator.pop(context);
              }
            },
            child: const Text('등록'),
          ),
        ],
      ),
    );
  }

  void _showAddTodoDialog() {
    final titleController = TextEditingController();
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('할 일 등록'),
        content: TextField(
          controller: titleController,
          decoration: const InputDecoration(hintText: '할 일 내용을 입력하세요'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('취소')),
          FilledButton(
            onPressed: () {
              if (titleController.text.isNotEmpty) {
                setState(() {
                  _todos.add(TodoModel(
                    id: DateTime.now().millisecondsSinceEpoch.toString(),
                    calendarId: 'default',
                    creatorId: 'me',
                    title: titleController.text,
                    dueDate: _selectedDay ?? DateTime.now(),
                  ));
                });
                _syncWidget();
                Navigator.pop(context);
              }
            },
            child: const Text('등록'),
          ),
        ],
      ),
    );
  }

  void _showShareDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('캘린더 공유 초대 코드'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('아래 초대 코드를 상대방 기기에 입력하면 캘린더가 즉시 연동됩니다:'),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.grey.shade200,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const SelectableText(
                'CAL-789-SYNC',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, letterSpacing: 2),
              ),
            ),
          ],
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('확인'),
          ),
        ],
      ),
    );
  }
}

