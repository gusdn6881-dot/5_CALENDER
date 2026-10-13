import WidgetKit
import SwiftUI

// MARK: - 위젯 엔트리 및 데이터 모델
struct CalendarWidgetEntry: TimelineEntry {
    let date: Date
    let events: [WidgetEventItem]
    let todos: [WidgetTodoItem]
}

struct WidgetEventItem: Decodable, Identifiable {
    let id: String
    let title: String
    let time: String
    let color: String
}

struct WidgetTodoItem: Decodable, Identifiable {
    let id: String
    let title: String
    let is_completed: Bool
    let priority: Int
}

// MARK: - 타임라인 프로바이더 (App Group 데이터 로드)
struct CalendarTimelineProvider: TimelineProvider {
    let appGroupId = "group.com.example.calender"

    func placeholder(in context: Context) -> CalendarWidgetEntry {
        CalendarWidgetEntry(
            date: Date(),
            events: [WidgetEventItem(id: "1", title: "샘플 일정", time: "14:00", color: "#4A90E2")],
            todos: [WidgetTodoItem(id: "1", title: "샘플 할 일", is_completed: false, priority: 2)]
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (CalendarWidgetEntry) -> Void) {
        completion(loadData())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CalendarWidgetEntry>) -> Void) {
        let entry = loadData()
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: Date())!
        let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
        completion(timeline)
    }

    private func loadData() -> CalendarWidgetEntry {
        let sharedDefaults = UserDefaults(suiteName: appGroupId)
        var events: [WidgetEventItem] = []
        var todos: [WidgetTodoItem] = []

        if let eventsJson = sharedDefaults?.string(forKey: "widget_events_json"),
           let data = eventsJson.data(using: .utf8) {
            events = (try? JSONDecoder().decode([WidgetEventItem].self, from: data)) ?? []
        }

        if let todosJson = sharedDefaults?.string(forKey: "widget_todos_json"),
           let data = todosJson.data(using: .utf8) {
            todos = (try? JSONDecoder().decode([WidgetTodoItem].self, from: data)) ?? []
        }

        return CalendarWidgetEntry(date: Date(), events: events, todos: todos)
    }
}

// MARK: - SwiftUI 위젯 뷰
struct CalendarWidgetEntryView: View {
    var entry: CalendarTimelineProvider.Entry
    @Environment(\.widgetFamily) var family

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // 상단 날짜 헤더
            HStack {
                Text(Date(), format: .dateTime.month().day().weekday())
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(.blue)
                Spacer()
                Image(systemName: "calendar")
                    .foregroundColor(.gray)
            }

            Divider()

            // 오늘 일정 영역
            Text("오늘 일정")
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(.secondary)

            if entry.events.isEmpty {
                Text("일정 없음")
                    .font(.caption2)
                    .foregroundColor(.gray)
            } else {
                ForEach(entry.events.prefix(2)) { event in
                    HStack {
                        Circle()
                            .fill(Color(hex: event.color) ?? .blue)
                            .frame(width: 6, height: 6)
                        Text(event.time)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundColor(.secondary)
                        Text(event.title)
                            .font(.system(size: 11, weight: .semibold))
                            .lineLimit(1)
                    }
                }
            }

            // 할 일 영역 (Medium 이상)
            if family != .systemSmall {
                Divider()
                Text("오늘 할 일")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(.secondary)

                if entry.todos.isEmpty {
                    Text("남은 할 일 없음")
                        .font(.caption2)
                        .foregroundColor(.gray)
                } else {
                    ForEach(entry.todos.filter { !$0.is_completed }.prefix(2)) { todo in
                        HStack {
                            Image(systemName: "circle")
                                .font(.system(size: 10))
                                .foregroundColor(.gray)
                            Text(todo.title)
                                .font(.system(size: 11))
                                .lineLimit(1)
                        }
                    }
                }
            }

            Spacer()
        }
        .padding(12)
        .widgetURL(URL(string: "calender://home"))
    }
}

// MARK: - 위젯 메인 번들 정의
@main
struct CalendarWidget: Widget {
    let kind: String = "CalendarWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CalendarTimelineProvider()) { entry in
            CalendarWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("캘린더 & 할 일")
        .description("오늘의 주요 일정과 할 일을 홈 화면에서 한눈에 확인하세요.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

// Hex Color 변환 헬퍼
extension Color {
    init?(hex: String) {
        var hexSanitized = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        hexSanitized = hexSanitized.replacingOccurrences(of: "#", with: "")
        var rgb: UInt64 = 0
        guard Scanner(string: hexSanitized).scanHexInt64(&rgb) else { return nil }
        self.init(
            red: Double((rgb & 0xFF0000) >> 16) / 255.0,
            green: Double((rgb & 0x00FF00) >> 8) / 255.0,
            blue: Double(rgb & 0x0000FF) / 255.0
        )
    }
}

