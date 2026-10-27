-- W13-d d1 - 알림 표 (docs/dev/W13-d_설계.md, PRD-05 NOTI-01)
-- · notification_prefs: 회원별 켠 알림 종류·빈도·맞춤 브리핑 받는 방법. 켜기 전(kinds 비어 있음)에는 아무것도 만들지 않는다 (opt-in)
-- · notifications: 보낼/보낸 알림 한 줄씩. (user_id, kind, content_id) 유일 - 같은 항목 한 번만 (멱등). 상세 주소·좌표·본문 칸 없음
-- · 읽기는 본인 행만 (RLS), 쓰기는 서버(service_role)만. 안내·동의 문구는 이 파일에 없다

create table public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  kinds text[] not null default '{}'::text[] check (kinds <@ array['law', 'saved_search', 'region', 'calendar']::text[] and cardinality(kinds) <= 4),
  frequency text not null default 'daily' check (frequency in ('instant', 'daily', 'weekly')),
  briefing text not null default 'off' check (briefing in ('off', 'web', 'mail')),
  enabled_at timestamptz,
  updated_at timestamptz not null default now()
);
comment on table public.notification_prefs is '알림 설정 (NOTI-01) - kinds: law 조문 개정 · saved_search 저장 검색 · region 관심 지역 · calendar 달력 기한. enabled_at = 처음 켠 시각(이 시각 이후 공개분만 알림). briefing = 맞춤 브리핑(WS-06) 받는 방법. 본인만 읽기';
create trigger notification_prefs_touch before update on public.notification_prefs for each row execute function public.touch_updated_at();

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('law', 'saved_search', 'region', 'calendar')),
  target text not null check (char_length(target) between 1 and 64 and target ~ '^[A-Za-z0-9_:.-]+$'),
  content_id text not null check (char_length(content_id) between 1 and 100 and content_id ~ '^[A-Za-z0-9_:.@-]+$'),
  label text not null check (char_length(btrim(label)) between 1 and 200),
  link text not null check (char_length(link) between 1 and 200 and link ~ '^/[^[:space:]?#]*$'),
  channel text check (channel in ('mail', 'web')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz,
  constraint notifications_once unique (user_id, kind, content_id),
  constraint notifications_sent_channel check ((sent_at is null) = (channel is null))
);
comment on table public.notifications is '알림 (NOTI-01) - target = 조문·검색 번호·지역 코드(10자리)·달력 버전, content_id = 콘텐츠 번호(article:번호 등), label = 공개 제목, link = 사이트 안 상대 경로. 주소·좌표·본문 칸 없음. (user_id, kind, content_id) 유일';
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_pending_idx on public.notifications (user_id) where sent_at is null;

alter table public.notification_prefs enable row level security;
alter table public.notifications enable row level security;
revoke all on table public.notification_prefs from public, anon, authenticated, service_role;
revoke all on table public.notifications from public, anon, authenticated, service_role;
grant select on table public.notification_prefs to authenticated;
grant select on table public.notifications to authenticated;
grant select, insert, update, delete on table public.notification_prefs to service_role;
grant select, insert, update, delete on table public.notifications to service_role;
create policy notification_prefs_own_read on public.notification_prefs for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_own_read on public.notifications for select to authenticated using (user_id = (select auth.uid()));
