-- W4 1단계 — 행정구역 적재 도구의 DB 자리 (docs/dev/W4_설계.md 1장 1단계 · 2.1 · 2.6 · 3장)
-- · regions에 칸 2개: successor_code(폐지 지역의 후속 지역) · import_run_id(그 행을 넣거나 바꾼 적재 기록)
--   기존 칸·제약·씨앗은 바꾸지 않는다. regions는 공개 참조 자료라(W2-b 표 단위 공개 읽기) 새 칸도 anon이 읽는다 — 후속 지역 안내에 쓰고,
--   import_run_id는 적재 기록(anon 0행) 번호뿐이다
-- · 폐지 규칙: 후속은 폐지(valid_to 있음) 행만 · 자기 자신 0 · 후속은 오늘(한국 날짜) 유효해야 한다 · 후속이 또 폐지면 최종 지역으로 바꿔 쓴다(연쇄 0)
--   적재 기록으로 들어오거나 바뀐 행(import_run_id 있음)의 폐지는 후속 필수. 손으로 넣은 행(W2-b 시험의 폐지 행 등)은 지금처럼 후속 없이도 된다
--   [확인 필요 — 2단계 뒤 관리 화면(region.manage)이 생기면 그 경로도 후속 필수]
-- · region_import_runs — 적재 기록(원본 파일 이름·배포일·SHA-256·행 수·분류 수·차이 수·상태·적용자). 추가만. applied는 적용자·시각 필수, 같은 원본의 applied는 하나
-- · region_slug_redirects — 옛 지역 주소 → 지역 코드 (3단계 301). 도착 지역이 폐지되면 같은 옛 주소의 도착도 최종 지역으로(연쇄 0)
-- · 두 표 모두 RLS 기본 거부, service_role만 (3장 머리). 공개 화면은 서버 함수(service_role)로 옛 주소를 찾는다

-- ─────────────────────────────────────────────────────────────
-- region_import_runs — 적재 기록 (추가만)
-- ─────────────────────────────────────────────────────────────
create table public.region_import_runs (
  id bigint generated always as identity primary key,
  file_name text not null check (length(btrim(file_name)) > 0),
  file_date date not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  rows_total integer not null check (rows_total >= 0),
  class_counts jsonb not null,
  change_counts jsonb not null,
  status text not null check (status in ('dry_run', 'applied', 'rejected')),
  applied_by text,
  applied_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  -- 분류 수 = 2.1 region_import.row_class 4개 키 정확히(0 이상 정수), 합 = 원본 행 수
  constraint region_import_runs_class_counts check (
    case when jsonb_typeof(class_counts) = 'object'
          and class_counts - array['sido', 'sigungu', 'general_gu', 'sub_district'] = '{}'::jsonb
          and jsonb_typeof(class_counts -> 'sido') = 'number' and jsonb_typeof(class_counts -> 'sigungu') = 'number'
          and jsonb_typeof(class_counts -> 'general_gu') = 'number' and jsonb_typeof(class_counts -> 'sub_district') = 'number'
         then (class_counts ->> 'sido')::numeric >= 0 and (class_counts ->> 'sido')::numeric % 1 = 0
          and (class_counts ->> 'sigungu')::numeric >= 0 and (class_counts ->> 'sigungu')::numeric % 1 = 0
          and (class_counts ->> 'general_gu')::numeric >= 0 and (class_counts ->> 'general_gu')::numeric % 1 = 0
          and (class_counts ->> 'sub_district')::numeric >= 0 and (class_counts ->> 'sub_district')::numeric % 1 = 0
          and (class_counts ->> 'sido')::numeric + (class_counts ->> 'sigungu')::numeric
            + (class_counts ->> 'general_gu')::numeric + (class_counts ->> 'sub_district')::numeric = rows_total
         else false end),
  -- 차이 수 = 2.1 region_import.change 4개 키 정확히(0 이상 정수)
  constraint region_import_runs_change_counts check (
    case when jsonb_typeof(change_counts) = 'object'
          and change_counts - array['added', 'renamed', 'retired', 'unchanged'] = '{}'::jsonb
          and jsonb_typeof(change_counts -> 'added') = 'number' and jsonb_typeof(change_counts -> 'renamed') = 'number'
          and jsonb_typeof(change_counts -> 'retired') = 'number' and jsonb_typeof(change_counts -> 'unchanged') = 'number'
         then (change_counts ->> 'added')::numeric >= 0 and (change_counts ->> 'added')::numeric % 1 = 0
          and (change_counts ->> 'renamed')::numeric >= 0 and (change_counts ->> 'renamed')::numeric % 1 = 0
          and (change_counts ->> 'retired')::numeric >= 0 and (change_counts ->> 'retired')::numeric % 1 = 0
          and (change_counts ->> 'unchanged')::numeric >= 0 and (change_counts ->> 'unchanged')::numeric % 1 = 0
         else false end),
  constraint region_import_runs_applied check (status <> 'applied' or (length(btrim(coalesce(applied_by, ''))) > 0 and applied_at is not null))
);

comment on table public.region_import_runs is '행정구역 적재 기록 (W4 1단계 · 2.6) — 원본 파일 이름·배포일·SHA-256·행 수·분류 수·차이 수·상태(dry_run·applied·rejected)·적용자. 추가만';
comment on column public.region_import_runs.class_counts is '원본 행 분류 수 {sido, sigungu, general_gu, sub_district} — 합 = rows_total';
comment on column public.region_import_runs.change_counts is '지금 regions와의 차이 수 {added, renamed, retired, unchanged}';

-- 같은 원본(SHA-256)의 applied 기록은 하나 — 데이터 마이그레이션을 두 번 적용해도 한 벌
create unique index region_import_runs_one_applied on public.region_import_runs (sha256) where status = 'applied';

create trigger region_import_runs_no_update_delete
  before update or delete on public.region_import_runs
  for each row execute function public.append_only_guard();
create trigger region_import_runs_no_truncate
  before truncate on public.region_import_runs
  for each statement execute function public.append_only_guard();

alter table public.region_import_runs enable row level security;
revoke all on table public.region_import_runs from anon, authenticated, service_role;
grant select, insert on table public.region_import_runs to service_role;

-- ─────────────────────────────────────────────────────────────
-- regions — 후속 지역·적재 기록 칸 (더하기만)
-- ─────────────────────────────────────────────────────────────
alter table public.regions
  add column successor_code text references public.regions (code),
  add column import_run_id bigint references public.region_import_runs (id);

alter table public.regions
  add constraint regions_successor_not_self check (successor_code is null or successor_code <> code),
  add constraint regions_successor_retired_only check (successor_code is null or valid_to is not null),
  add constraint regions_import_retire_successor check (valid_to is null or import_run_id is null or successor_code is not null);

comment on column public.regions.successor_code is '폐지 지역의 후속 지역 (W4 2.6 7 — 사람 입력, 근거 고시). 늘 최종 지역(연쇄 0)';
comment on column public.regions.import_run_id is '이 행을 넣거나 바꾼 적재 기록 (region_import_runs)';

create index regions_successor_idx on public.regions (successor_code) where successor_code is not null;

-- 후속 지역 — 연쇄면 최종 지역으로 바꿔 쓰고, 최종 지역은 오늘(한국 날짜) 유효해야 한다
create function public.regions_successor_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_next text;
  v_succ public.regions%rowtype;
  v_hops integer := 0;
begin
  if new.successor_code is null or (tg_op = 'UPDATE' and new.successor_code is not distinct from old.successor_code) then
    return new;
  end if;
  loop
    select r.successor_code into v_next from public.regions r where r.code = new.successor_code;
    exit when v_next is null;
    if v_next = new.code then
      raise exception '행정구역 %의 후속 지역이 돌고 돕니다 (순환 — W4 2.6 7)', new.code
        using errcode = 'check_violation';
    end if;
    new.successor_code := v_next;
    v_hops := v_hops + 1;
    if v_hops > 20 then
      raise exception '행정구역 %의 후속 지역 사슬이 너무 깁니다 (W4 2.6 7)', new.code
        using errcode = 'check_violation';
    end if;
  end loop;
  if new.successor_code = new.code then
    raise exception '행정구역 %의 후속 지역을 자기 자신으로 둘 수 없습니다 (W4 2.6 7)', new.code
      using errcode = 'check_violation';
  end if;
  select * into v_succ from public.regions r where r.code = new.successor_code;
  if found and ((v_succ.valid_to is not null and v_succ.valid_to < v_today) or (v_succ.valid_from is not null and v_succ.valid_from > v_today)) then
    raise exception '행정구역 %의 후속 지역 %(%)이 오늘 유효하지 않습니다 (W4 3장)', new.code, v_succ.code, v_succ.name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.regions_successor_guard() from public, anon, authenticated;

create trigger regions_successor_guard
  before insert or update of successor_code on public.regions
  for each row execute function public.regions_successor_guard();

-- 어떤 지역이 폐지되어 후속이 정해지면 — 그 지역을 후속으로 둔 행과 그 지역으로 가는 옛 주소를 최종 지역으로 (연쇄 0)
create function public.regions_successor_cascade() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.successor_code is not null and (tg_op = 'INSERT' or new.successor_code is distinct from old.successor_code) then
    update public.regions r set successor_code = new.successor_code
      where r.successor_code = new.code and r.code <> new.successor_code;
    update public.region_slug_redirects s set region_code = new.successor_code
      where s.region_code = new.code;
  end if;
  return null;
end;
$$;

revoke all on function public.regions_successor_cascade() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- region_slug_redirects — 옛 지역 주소 → 지역 코드 (3단계 301)
-- ─────────────────────────────────────────────────────────────
create table public.region_slug_redirects (
  old_path text primary key check (old_path ~ '^/local/[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)?$'),
  region_code text not null references public.regions (code),
  reason text not null check (reason in ('retired', 'renamed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.region_slug_redirects is '옛 지역 주소(/local/시·도[/시·군·구]) → 지역 코드 (W4 3단계 301 한 번). 도착은 늘 최종 지역(연쇄 0)';

create index region_slug_redirects_region_idx on public.region_slug_redirects (region_code);

create trigger region_slug_redirects_touch before update on public.region_slug_redirects
  for each row execute function public.touch_updated_at();

-- 도착 — 폐지 지역이면 최종 후속 지역으로 바꿔 쓰고, 최종 지역은 오늘 유효해야 한다 · 도착 지역의 지금 주소와 같은 옛 주소 0(제자리 301)
create function public.region_slug_redirects_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_region public.regions%rowtype;
  v_parent_slug text;
begin
  select * into v_region from public.regions r where r.code = new.region_code;
  if not found then
    return new; -- 외래 키가 거부한다
  end if;
  if v_region.successor_code is not null then
    new.region_code := v_region.successor_code;
    select * into v_region from public.regions r where r.code = new.region_code;
  end if;
  if (v_region.valid_to is not null and v_region.valid_to < v_today) or (v_region.valid_from is not null and v_region.valid_from > v_today) then
    raise exception '옛 주소 %의 도착 지역 %(%)이 오늘 유효하지 않습니다 (W4 3장)', new.old_path, v_region.code, v_region.name
      using errcode = 'check_violation';
  end if;
  select p.slug into v_parent_slug from public.regions p where p.code = v_region.parent_code;
  if new.old_path = '/local/' || coalesce(v_parent_slug || '/', '') || v_region.slug then
    raise exception '옛 주소 %가 도착 지역 %의 지금 주소와 같습니다 (제자리 301)', new.old_path, v_region.code
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.region_slug_redirects_guard() from public, anon, authenticated;

create trigger region_slug_redirects_guard
  before insert or update on public.region_slug_redirects
  for each row execute function public.region_slug_redirects_guard();

-- 후속 연쇄 고쳐 쓰기 트리거는 옛 주소 표가 생긴 뒤에 건다 (함수가 그 표를 고친다)
create trigger regions_successor_cascade
  after insert or update of successor_code on public.regions
  for each row execute function public.regions_successor_cascade();

alter table public.region_slug_redirects enable row level security;
revoke all on table public.region_slug_redirects from anon, authenticated, service_role;
grant select, insert, update, delete on table public.region_slug_redirects to service_role;
