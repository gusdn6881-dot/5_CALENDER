# 📅 Calender App (아이폰 & 갤럭시 실시간 동기화 + 홈 화면 위젯)

아이폰(iOS)과 갤럭시(Android) 양쪽에서 완벽하게 동기화되고 스마트폰 첫 화면(홈 화면) 위젯을 지원하는 크로스 플랫폼 정식 캘린더 & 생산성 앱입니다.

---

## 🚀 주요 특징

1. **아이폰 & 갤럭시 완벽 동기화**:
   - Supabase(PostgreSQL) 기반 실시간(Realtime) 동기화
   - 한 기기에서 일정/할 일을 수정하면 1초 이내에 다른 기기 화면에 자동 반영
2. **모바일 첫 화면 위젯(Widget) 지원**:
   - **iOS WidgetKit** (SwiftUI) & **Android AppWidget** (Kotlin) 네이티브 지원
   - 오늘 날짜의 주요 일정 및 체크리스트(To-do)를 앱을 열지 않고도 홈 화면에서 즉시 확인
   - 위젯 터치 시 해당 일정으로 직행하는 딥링크 지원
3. **유연한 공유 모드 지원**:
   - **개인 모드**: 한 사용자가 보유한 여러 기기 간 동기화
   - **2인/소규모 공유**: 커플/가족 간 1:1 일정 및 기념일 공유
   - **다인원 그룹/팀 워크스페이스**: 팀원 초대, 역할별 권한(관리자/편집자/뷰어) 제어
4. **일정 + 할 일(To-do) + 메모 통합**:
   - 시간표 기반 일정과 실행 중심의 체크리스트를 한 화면에서 유기적으로 관리

---

## 📂 프로젝트 구조

```
.
├── lib/
│   ├── main.dart                   # 앱 엔트리포인트 및 캘린더/할 일 메인 UI
│   ├── models/
│   │   ├── calendar_model.dart     # 개인/2인/그룹 캘린더 모델
│   │   ├── event_model.dart        # 일정 및 반복 규칙 모델
│   │   └── todo_model.dart         # 할 일 및 우선순위 모델
│   └── services/
│       ├── supabase_service.dart   # 백엔드 DB 및 실시간 구독 서비스
│       └── widget_service.dart     # 홈 화면 위젯 데이터 브릿지 (home_widget)
├── supabase/
│   └── schema.sql                  # PostgreSQL DB 스키마 및 RLS 보안 정책
├── ios/
│   └── CalendarWidget/
│       └── CalendarWidget.swift    # iOS WidgetKit 위젯 구현 코드
├── android/
│   └── app/src/main/
│       ├── kotlin/.../widget/
│       │   └── CalendarWidgetProvider.kt # Android AppWidget 구현 코드
│       └── res/
│           ├── layout/calendar_widget.xml
│           └── xml/calendar_widget_info.xml
└── docs/
    ├── ARCHITECTURE.md             # 시스템 아키텍처 상세 문서
    └── SETUP_GUIDE.md              # 환경 설정, DB 연동 및 빌드 가이드
```

---

## 🛠️ 시작하기

상세한 설치 및 빌드 방법은 [docs/SETUP_GUIDE.md](docs/SETUP_GUIDE.md) 문서를 참고해 주세요.
