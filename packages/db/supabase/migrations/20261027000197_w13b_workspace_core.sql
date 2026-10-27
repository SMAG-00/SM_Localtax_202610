-- W13-b b1 - 워크스페이스 표: 개인 설정(모드·위젯)·폴더·메모·스크랩 (docs/dev/W13-b_설계.md, PRD-05 WS-01·02·03)
-- 이 파일에 법령·세무 글은 없다 (표 구조·검사뿐). 시험 자료는 시험용 표시 + 지어낸 글로만 넣는다.
-- · 저장하는 것은 대상 종류 + 번호 + 원문 버전 표지뿐이다 - 프리미엄 본문 사본 칸은 없다 (label은 제목 한 줄, 200자)
-- · 읽기: authenticated는 본인 행만 (RLS user_id = auth.uid()). anon은 권한 0. 쓰기는 서버(service_role)만 - 권한(workspace) 판정은 서버가 has_entitlement로 한다
-- · 구독이 끝나도 지우지 않는다 (PO 결정 #10) - 이 표에는 만료·삭제 경로가 없고 계정 탈퇴(auth.users 삭제)의 연쇄 삭제만 있다
-- 기존 표 칸·제약·값은 바꾸지 않는다.

create table public.workspace_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  mode text not null default 'general' check (mode in ('general', 'expert')),
  widgets jsonb not null default '{}'::jsonb check (jsonb_typeof(widgets) = 'object' and pg_column_size(widgets) <= 2000),
  updated_at timestamptz not null default now()
);
comment on table public.workspace_prefs is '워크스페이스 개인 설정 (WS-01·02) - 모드는 표현 밀도 선호일 뿐 권한 판정에 쓰지 않는다. 위젯 순서·숨김은 widgets {order:[], hidden:[]}';
create trigger workspace_prefs_touch before update on public.workspace_prefs for each row execute function public.touch_updated_at();

create table public.folders (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
comment on table public.folders is '메모·스크랩 폴더 (WS-03) - 본인만';
create index folders_user_idx on public.folders (user_id);

create table public.notes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  folder_id bigint references public.folders (id) on delete set null,
  title text check (title is null or char_length(btrim(title)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  target_kind text check (target_kind in ('node', 'issue', 'issue_article', 'column', 'article', 'law_article', 'legal_doc', 'agent_answer', 'copilot_result')),
  target_id text check (target_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  ai_draft boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notes_target_pair check ((target_kind is null) = (target_id is null))
);
comment on table public.notes is '메모 (WS-03) - 본인만. 대상(종류+번호)을 붙일 수 있다. ai_draft = 코파일럿·AI 유래 메모 (내보낼 때 "AI 초안" 표기). 구독이 끝나도 지우지 않는다';
create index notes_user_idx on public.notes (user_id, updated_at desc);
create trigger notes_touch before update on public.notes for each row execute function public.touch_updated_at();

create table public.scraps (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  folder_id bigint references public.folders (id) on delete set null,
  target_kind text not null check (target_kind in ('node', 'issue', 'issue_article', 'column', 'article', 'law_article', 'legal_doc', 'agent_answer', 'copilot_result')),
  target_id text not null check (target_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  label text not null check (char_length(btrim(label)) between 1 and 200),
  source_version text not null check (char_length(source_version) between 1 and 100),
  checked_on date not null default ((now() at time zone 'Asia/Seoul')::date),
  created_at timestamptz not null default now(),
  unique (user_id, target_kind, target_id),
  constraint scraps_target_shape check (
    (target_kind in ('agent_answer', 'copilot_result'))
    or target_id ~ '^[0-9]{1,18}$')
);
comment on table public.scraps is '스크랩 (WS-03) - 대상 종류+번호+원문 버전 표지(source_version, 서버가 읽은 값)만. 본문 사본 칸 없음. 지금 버전과 다르면 "개정됨"';
create index scraps_user_idx on public.scraps (user_id, created_at desc);

-- 폴더는 본인 것만 가리킬 수 있다
create function public.workspace_folder_owner_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.folder_id is not null and not exists (select 1 from public.folders f where f.id = new.folder_id and f.user_id = new.user_id) then
    raise exception '다른 회원의 폴더에는 넣을 수 없습니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.workspace_folder_owner_guard() from public, anon, authenticated;
create trigger notes_folder_owner before insert or update on public.notes for each row execute function public.workspace_folder_owner_guard();
create trigger scraps_folder_owner before insert or update on public.scraps for each row execute function public.workspace_folder_owner_guard();

-- 소유자는 바꿀 수 없다
create function public.workspace_user_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id <> old.user_id then
    raise exception '소유자는 바꿀 수 없습니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.workspace_user_immutable() from public, anon, authenticated;
create trigger folders_user_fixed before update on public.folders for each row execute function public.workspace_user_immutable();
create trigger notes_user_fixed before update on public.notes for each row execute function public.workspace_user_immutable();
create trigger scraps_user_fixed before update on public.scraps for each row execute function public.workspace_user_immutable();

-- ── 권한: 읽기는 본인 행만, 쓰기는 서비스 역할만 ───────────────
alter table public.workspace_prefs enable row level security;
alter table public.folders enable row level security;
alter table public.notes enable row level security;
alter table public.scraps enable row level security;
revoke all on table public.workspace_prefs, public.folders, public.notes, public.scraps from public, anon, authenticated, service_role;
grant select on table public.workspace_prefs, public.folders, public.notes, public.scraps to authenticated;
grant select, insert, update, delete on table public.workspace_prefs, public.folders, public.notes, public.scraps to service_role;
create policy workspace_prefs_own_read on public.workspace_prefs for select to authenticated using (user_id = (select auth.uid()));
create policy folders_own_read on public.folders for select to authenticated using (user_id = (select auth.uid()));
create policy notes_own_read on public.notes for select to authenticated using (user_id = (select auth.uid()));
create policy scraps_own_read on public.scraps for select to authenticated using (user_id = (select auth.uid()));
