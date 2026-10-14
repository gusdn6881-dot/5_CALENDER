# Calender 앱 개발 및 배포 환경 설정 가이드

본 가이드는 **Calender (아이폰 & 갤럭시 동기화 + 홈 화면 위젯)** 프로젝트를 로컬 개발 환경에서 실행하고, Supabase 백엔드 및 모바일 기기(iOS/Android)에 빌드하는 절차를 설명합니다.

---

## 1. 사전 요구사항 설치

1. **Flutter SDK 설치**
   - [Flutter 공식 웹사이트](https://docs.flutter.dev/get-started/install/windows)에서 Flutter SDK 최신 안정화 버전(Stable 3.x)을 다운로드하여 설치합니다.
   - 환경변수 `PATH`에 `flutter/bin` 경로를 추가합니다.
   - 터미널에서 `flutter doctor`를 실행하여 Android Toolchain 및 개발 환경 상태를 점검합니다.
2. **개발 IDE**
   - VS Code (Flutter & Dart 확장팩 설치) 또는 Android Studio
3. **기기별 빌드 도구**
   - **갤럭시 (Android)**: Android Studio 및 Android SDK, 가상 기기(AVD) 또는 USB 디버깅 연결
   - **아이폰 (iOS)**: macOS 환경, Xcode 최신 버전, CocoaPods (iOS 빌드는 애플 정책상 macOS/Xcode 필요)

---

## 2. 백엔드(Supabase) 데이터베이스 설정

1. [Supabase](https://supabase.com)에 로그인 후 새 프로젝트를 생성합니다.
2. 대시보드 좌측 메뉴의 **SQL Editor**로 이동합니다.
3. 프로젝트 내 `supabase/schema.sql` 파일의 전체 내용을 복사하여 실행(Run)합니다.
   - `profiles`, `calendars`, `calendar_members`, `events`, `todos`, `memos` 테이블 및 RLS 보안 정책이 자동 생성됩니다.
4. **Project Settings > API**에서 다음 두 값을 복사합니다:
   - `Project URL`
   - `Project API keys (anon public)`
5. `lib/main.dart`의 주석 처리된 Supabase 초기화 코드에 URL과 Key를 입력합니다:
   ```dart
   await Supabase.initialize(
     url: 'https://your-project-id.supabase.co',
     anonKey: 'your-anon-key',
   );
   ```

---

## 3. 앱 실행 방법

```bash
# 1. 의존성 패키지 설치
flutter pub get

# 2. 연결된 기기 확인
flutter devices

# 3. 앱 실행 (갤럭시 또는 에뮬레이터)
flutter run
```

---

## 4. 홈 화면 위젯(Widget) 설정 및 테스트

### A. 갤럭시 (Android) 위젯
1. `android/app/src/main/AndroidManifest.xml`의 `<application>` 태그 내에 위젯 Receiver를 등록합니다:
   ```xml
   <receiver android:name=".widget.CalendarWidgetProvider"
             android:exported="true">
       <intent-filter>
           <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
       </intent-filter>
       <meta-data
           android:name="android.appwidget.provider"
           android:resource="@xml/calendar_widget_info" />
   </receiver>
   ```
2. 앱 빌드 후 스마트폰 홈 화면을 길게 눌러 **위젯 > Calender**를 홈 화면에 추가합니다.

### B. 아이폰 (iOS) 위젯
1. Xcode에서 `ios/Runner.xcworkspace`를 엽니다.
2. **File > New > Target... > Widget Extension**을 선택하고 이름으로 `CalendarWidget`을 생성합니다.
3. 메인 타깃(Runner)과 위젯 타깃(CalendarWidget) 양쪽에 **Signing & Capabilities > + Capability > App Groups**를 추가하고 동일한 그룹 ID(`group.com.example.calender`)를 지정합니다.
4. `ios/CalendarWidget/CalendarWidget.swift` 코드를 해당 위젯 타깃에 적용합니다.

