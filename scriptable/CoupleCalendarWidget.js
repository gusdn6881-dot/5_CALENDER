// Variables used to test the widget inside Scriptable
// To run: paste this into Scriptable app on iPhone and run.
// ==============================================================================
// 📅 부부 공유 캘린더 & 할 일 커스텀 위젯 (Scriptable 전용)
// ==============================================================================

// [1. 설정 영역] 원하는 기념일이나 설정을 자유롭게 변경하세요.
const CONFIG = {
  // 기념일 D-Day 설정 (이름과 날짜 YYYY-MM-DD)
  anniversaryName: "결혼기념일",
  anniversaryDate: "2024-05-18", // 두 분의 기념일 날짜로 변경하세요

  // 표시할 공유 캘린더 이름 (비워두면 구글/애플 모든 캘린더 자동 표시)
  // 예: "우리부부" 또는 "" (공백 시 오늘 전체 일정 자동 취합)
  targetCalendarTitle: "",

  // 표시할 공유 미리 알림 목록 이름 (비워두면 모든 미리 알림 표시)
  targetReminderList: "",

  // 테마 색상 (Hex 코드)
  accentColor: "#4A90E2", // 포인트 컬러 (블루)
  loveColor: "#FF6584",   // D-Day 포인트 컬러 (핑크)
  eventColor: "#50E3C2",  // 일정 바 컬러 (민트)
};

// [2. 메인 실행 함수]
async function createWidget() {
  const widget = new ListWidget();
  widget.setPadding(14, 16, 14, 16);

  // 다크모드 자동 감지 배경색 설정
  const isDark = Device.isUsingDarkAppearance();
  widget.backgroundColor = isDark ? new Color("#1C1C1E") : new Color("#FFFFFF");

  const now = new Date();

  // --- 상단 헤더: 오늘 날짜 + D-Day ---
  const headerStack = widget.addStack();
  headerStack.layoutHorizontally();
  headerStack.centerAlignContent();

  // 오늘 날짜 텍스트
  const dateStack = headerStack.addStack();
  dateStack.layoutVertically();

  const dfDate = new DateFormatter();
  dfDate.dateFormat = "M월 d일 EEEE";
  dfDate.locale = "ko_KR";

  const dateText = dateStack.addText(dfDate.string(now));
  dateText.font = Font.boldSystemFont(14);
  dateText.textColor = new Color(CONFIG.accentColor);

  headerStack.addSpacer();

  // D-Day 계산 및 표시
  if (CONFIG.anniversaryDate) {
    const dDayText = calculateDDay(CONFIG.anniversaryDate);
    const dDayBadge = headerStack.addStack();
    dDayBadge.backgroundColor = new Color(CONFIG.loveColor, 0.15);
    dDayBadge.cornerRadius = 6;
    dDayBadge.setPadding(3, 8, 3, 8);

    const badgeText = dDayBadge.addText(`${CONFIG.anniversaryName} ${dDayText}`);
    badgeText.font = Font.systemFont(11);
    badgeText.textColor = new Color(CONFIG.loveColor);
  }

  widget.addSpacer(8);

  // 구분선
  const divider = widget.addStack();
  divider.size = new Size(0, 1);
  divider.backgroundColor = isDark ? new Color("#2C2C2E") : new Color("#E5E5EA");

  widget.addSpacer(8);

  // --- 본문: 오늘 일정과 할 일 2열 배치 (또는 세로 배치) ---
  const contentStack = widget.addStack();
  contentStack.layoutHorizontally();

  // [왼쪽 영역] 오늘 일정
  const eventColumn = contentStack.addStack();
  eventColumn.layoutVertically();

  const eventTitleStack = eventColumn.addStack();
  const eventIcon = eventTitleStack.addText("📅 ");
  eventIcon.font = Font.systemFont(11);
  const eventHeader = eventTitleStack.addText("오늘 일정");
  eventHeader.font = Font.boldSystemFont(11);
  eventHeader.textColor = isDark ? new Color("#8E8E93") : new Color("#6C6C70");

  eventColumn.addSpacer(4);

  // iOS 캘린더에서 오늘 일정 불러오기
  const events = await getTodayEvents();
  if (events.length === 0) {
    const emptyText = eventColumn.addText("예정된 일정 없음");
    emptyText.font = Font.systemFont(11);
    emptyText.textColor = new Color("#8E8E93");
  } else {
    for (const ev of events.slice(0, 3)) {
      const row = eventColumn.addStack();
      row.layoutHorizontally();
      row.centerAlignContent();

      const timeText = row.addText(ev.isAllDay ? "종일 " : `${formatTime(ev.startDate)} `);
      timeText.font = Font.boldSystemFont(10);
      timeText.textColor = new Color(CONFIG.accentColor);

      const titleText = row.addText(ev.title);
      titleText.font = Font.systemFont(11);
      titleText.textColor = isDark ? new Color("#FFFFFF") : new Color("#000000");
      titleText.lineLimit = 1;

      eventColumn.addSpacer(3);
    }
  }

  contentStack.addSpacer(12);

  // [오른쪽 영역] 오늘 할 일 (미리 알림)
  const todoColumn = contentStack.addStack();
  todoColumn.layoutVertically();

  const todoTitleStack = todoColumn.addStack();
  const todoIcon = todoTitleStack.addText("✓ ");
  todoIcon.font = Font.systemFont(11);
  const todoHeader = todoTitleStack.addText("부부 할 일");
  todoHeader.font = Font.boldSystemFont(11);
  todoHeader.textColor = isDark ? new Color("#8E8E93") : new Color("#6C6C70");

  todoColumn.addSpacer(4);

  // iOS 미리 알림 불러오기
  const reminders = await getTodayReminders();
  if (reminders.length === 0) {
    const emptyText = todoColumn.addText("남은 할 일 없음");
    emptyText.font = Font.systemFont(11);
    emptyText.textColor = new Color("#8E8E93");
  } else {
    for (const rem of reminders.slice(0, 3)) {
      const row = todoColumn.addStack();
      row.layoutHorizontally();
      row.centerAlignContent();

      const bullet = row.addText("□ ");
      bullet.font = Font.systemFont(10);
      bullet.textColor = new Color("#8E8E93");

      const remText = row.addText(rem.title);
      remText.font = Font.systemFont(11);
      remText.textColor = isDark ? new Color("#FFFFFF") : new Color("#000000");
      remText.lineLimit = 1;

      todoColumn.addSpacer(3);
    }
  }

  return widget;
}

// --- 헬퍼 함수들 ---

// 오늘 일정 가져오기
async function getTodayEvents() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  let calendars = await Calendar.forEvents();
  if (CONFIG.targetCalendarTitle) {
    calendars = calendars.filter(c => c.title === CONFIG.targetCalendarTitle);
  }

  const events = await CalendarEvent.between(startOfDay, endOfDay, calendars);
  events.sort((a, b) => a.startDate - b.startDate);
  return events;
}

// 오늘 할 일(미리 알림) 가져오기
async function getTodayReminders() {
  let lists = await Calendar.forReminders();
  if (CONFIG.targetReminderList) {
    lists = lists.filter(l => l.title === CONFIG.targetReminderList);
  }

  const reminders = await Reminder.allIncomplete(lists);
  // 마감일이 오늘 이전이거나 오늘인 것 위주로 정렬
  return reminders;
}

// 시간 포맷 (HH:mm)
function formatTime(date) {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

// D-Day 계산기
function calculateDDay(targetDateStr) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(targetDateStr);
  const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate());

  const diffTime = today - targetMidnight;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "D-Day";
  if (diffDays > 0) return `+${diffDays}일`;
  return `D${diffDays}`;
}

// Scriptable 실행 환경 처리
const widget = await createWidget();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  // 앱 내에서 테스트 미리보기 (Medium 사이즈)
  widget.presentMedium();
}
Script.complete();

