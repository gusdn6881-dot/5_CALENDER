-- ==============================================================================
-- CALENDER APP: Supabase / PostgreSQL Database Schema
-- 지원 기능: 개인 / 2인(커플, 가족) / 다인원 그룹 캘린더 + 일정/할 일(To-do)/메모 통합
-- ==============================================================================

-- 1. 확장 기능 활성화
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. 사용자 프로필 테이블 (auth.users 연동)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 캘린더 테이블
-- type: 'personal' (개인용), 'pair' (2인 공유/커플/가족), 'group' (다인원 팀/모임)
CREATE TABLE IF NOT EXISTS public.calendars (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    color TEXT DEFAULT '#4A90E2',
    type TEXT NOT NULL CHECK (type IN ('personal', 'pair', 'group')),
    owner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    invite_code TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 캘린더 멤버십 테이블 (역할 및 권한 관리)
-- role: 'owner' (소유자/관리자), 'editor' (일정 등록/수정 가능), 'viewer' (읽기 전용)
CREATE TABLE IF NOT EXISTS public.calendar_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    calendar_id UUID NOT NULL REFERENCES public.calendars(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor', 'viewer')),
    custom_color TEXT,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(calendar_id, user_id)
);

-- 5. 일정(Events) 테이블
CREATE TABLE IF NOT EXISTS public.events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    calendar_id UUID NOT NULL REFERENCES public.calendars(id) ON DELETE CASCADE,
    creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    location TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    is_all_day BOOLEAN DEFAULT FALSE,
    recurrence_rule TEXT, -- iCalendar 표준 RRULE 형식 (예: FREQ=WEEKLY;BYDAY=MO,WE)
    color TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_time_range CHECK (end_time >= start_time)
);

-- 6. 할 일(To-dos) 테이블
-- priority: 1 (낮음), 2 (보통), 3 (높음)
CREATE TABLE IF NOT EXISTS public.todos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    calendar_id UUID NOT NULL REFERENCES public.calendars(id) ON DELETE CASCADE,
    creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    is_completed BOOLEAN DEFAULT FALSE,
    due_date DATE,
    priority INT DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
    event_id UUID REFERENCES public.events(id) ON DELETE SET NULL, -- 일정과 연계 가능
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 7. 날짜별/일정별 메모(Memos) 테이블
CREATE TABLE IF NOT EXISTS public.memos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    calendar_id UUID NOT NULL REFERENCES public.calendars(id) ON DELETE CASCADE,
    creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    target_date DATE NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Row Level Security (RLS) 정책 설정
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memos ENABLE ROW LEVEL SECURITY;

-- 캘린더 멤버 여부 확인 헬퍼 함수
CREATE OR REPLACE FUNCTION public.is_calendar_member(target_calendar_id UUID, user_uid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.calendar_members
        WHERE calendar_id = target_calendar_id AND user_id = user_uid
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 캘린더 편집 가능 여부 확인 헬퍼 함수
CREATE OR REPLACE FUNCTION public.can_edit_calendar(target_calendar_id UUID, user_uid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.calendar_members
        WHERE calendar_id = target_calendar_id
          AND user_id = user_uid
          AND role IN ('owner', 'editor')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS 정책: profiles
CREATE POLICY "Users can view all profiles" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- RLS 정책: calendars (멤버인 캘린더만 조회/접근)
CREATE POLICY "Members can view calendars" ON public.calendars FOR SELECT
    USING (public.is_calendar_member(id, auth.uid()));
CREATE POLICY "Users can create calendars" ON public.calendars FOR INSERT
    WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Owners can update calendars" ON public.calendars FOR UPDATE
    USING (auth.uid() = owner_id);
CREATE POLICY "Owners can delete calendars" ON public.calendars FOR DELETE
    USING (auth.uid() = owner_id);

-- RLS 정책: calendar_members
CREATE POLICY "Members can view members in same calendar" ON public.calendar_members FOR SELECT
    USING (public.is_calendar_member(calendar_id, auth.uid()));
CREATE POLICY "Calendar owners can manage members" ON public.calendar_members FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.calendars WHERE id = calendar_id AND owner_id = auth.uid()
    ));

-- RLS 정책: events
CREATE POLICY "Members can view events" ON public.events FOR SELECT
    USING (public.is_calendar_member(calendar_id, auth.uid()));
CREATE POLICY "Editors can insert events" ON public.events FOR INSERT
    WITH CHECK (public.can_edit_calendar(calendar_id, auth.uid()));
CREATE POLICY "Editors can update events" ON public.events FOR UPDATE
    USING (public.can_edit_calendar(calendar_id, auth.uid()));
CREATE POLICY "Editors can delete events" ON public.events FOR DELETE
    USING (public.can_edit_calendar(calendar_id, auth.uid()));

-- RLS 정책: todos
CREATE POLICY "Members can view todos" ON public.todos FOR SELECT
    USING (public.is_calendar_member(calendar_id, auth.uid()));
CREATE POLICY "Editors can manage todos" ON public.todos FOR ALL
    USING (public.can_edit_calendar(calendar_id, auth.uid()));

-- RLS 정책: memos
CREATE POLICY "Members can view memos" ON public.memos FOR SELECT
    USING (public.is_calendar_member(calendar_id, auth.uid()));
CREATE POLICY "Editors can manage memos" ON public.memos FOR ALL
    USING (public.can_edit_calendar(calendar_id, auth.uid()));

-- 9. Realtime Publication 추가 (실시간 기기 간 동기화)
ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.todos;
ALTER PUBLICATION supabase_realtime ADD TABLE public.calendars;
ALTER PUBLICATION supabase_realtime ADD TABLE public.calendar_members;

-- 10. Data API 접근 권한 (GRANT)
-- 2026-10-30부터 public 스키마에 새로 생성되는 테이블은 Data API(supabase-js/PostgREST/GraphQL)
-- 접근을 위해 명시적 GRANT가 필요합니다. RLS 정책만으로는 부족하며, 테이블 단위 권한이
-- 없으면 'permission denied' 오류가 발생합니다. 앞으로 테이블을 추가하면 이 섹션에도
-- 해당 테이블의 GRANT를 함께 넣어주세요.
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO service_role;

GRANT SELECT ON public.calendars TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendars TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendars TO service_role;

GRANT SELECT ON public.calendar_members TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_members TO service_role;

GRANT SELECT ON public.events TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO service_role;

GRANT SELECT ON public.todos TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.todos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.todos TO service_role;

GRANT SELECT ON public.memos TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memos TO service_role;
