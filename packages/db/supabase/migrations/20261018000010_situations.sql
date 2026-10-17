-- W2-b 1단계 DB — 상황 카드·상황 페이지 situations (PRD-01A UX-05 · 6.1, PRD-01B FAM-02)
-- · section 필수(4대 분야). slug 형식. 먼저 확인할 것(checks)은 3개 이하, 공개(visible)면 정확히 3개 + 세무 감수 기록
-- · 감수 대상 칸(checks·checklist·mistakes)을 고치면서 감수 기록을 새로 넣지 않으면 감수 기록이 지워진다 → 공개 행은 다시 감수해야 저장된다
-- · 허브 상황 카드 줄의 자리(hub_slot)는 1..허브 상한(settings.hub_situation_limit, 초기값 4), 같은 분야 같은 자리 중복 거부
--   → 상한 4에서 5번째 지정은 거부. 허브에 내지 않는 상황(hub_slot 없음)의 공개는 막지 않는다
-- · external_link_id는 01B official_links(TX-01·FAM-08) 행 — 그 표는 W3에서 만들고 그때 외래 키를 더한다 (articles.digest_id와 같은 방식)

-- JSON 배열의 모든 항목이 객체이고 field 칸에 빈칸 아닌 글자가 있다 (항목 모양 검사 — check 제약에서 부른다)
create function public.jsonb_items_have_text(items jsonb, field text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(items) = 'array' then not exists (
    select 1 from jsonb_array_elements(items) e
     where jsonb_typeof(e) <> 'object'
        or jsonb_typeof(e -> field) is distinct from 'string'
        or btrim(e ->> field) = '') else false end
$$;

-- 글자 배열에 빈칸만 있는 항목이 없다
create function public.text_items_nonblank(items text[]) returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (select 1 from unnest(items) x where x is null or btrim(x) = '')
$$;

-- 일반적 체크리스트 (FAM-02) — { items: 글자 1개 이상, notice: 고지 글자 }
create function public.situation_checklist_ok(checklist jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  -- check 제약은 null을 통과로 보므로 결과는 반드시 true/false (coalesce)
  select coalesce(case
    when checklist is null then true
    when jsonb_typeof(checklist) <> 'object' or jsonb_typeof(checklist -> 'items') is distinct from 'array' then false
    else jsonb_array_length(checklist -> 'items') > 0
      and not exists (
        select 1 from jsonb_array_elements(checklist -> 'items') i
         where jsonb_typeof(i) <> 'string' or btrim(i #>> '{}') = '')
      and jsonb_typeof(checklist -> 'notice') is not distinct from 'string'
      and btrim(coalesce(checklist ->> 'notice', '')) <> ''
  end, false)
$$;

revoke all on function public.jsonb_items_have_text(jsonb, text) from public, anon, authenticated;
revoke all on function public.text_items_nonblank(text[]) from public, anon, authenticated;
revoke all on function public.situation_checklist_ok(jsonb) from public, anon, authenticated;
grant execute on function public.jsonb_items_have_text(jsonb, text) to service_role;
grant execute on function public.text_items_nonblank(text[]) to service_role;
grant execute on function public.situation_checklist_ok(jsonb) to service_role;

create table public.situations (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  section text not null check (section in ('tax', 'realestate', 'finance', 'local')),
  title text not null check (length(btrim(title)) > 0),          -- 상황 한 문장 ("차를 팔았어요·폐차했어요")
  subtitle text,                                                  -- 무엇을 알 수 있는지 한 줄
  pictogram text not null check (pictogram ~ '^[a-z]+(-[a-z]+)*$'), -- packages/ui 픽토그램 이름 (PICTOGRAM_NAMES)
  checks jsonb not null default '[]'::jsonb,                      -- 먼저 확인할 것 [{ title, when?, note? }] — 공개면 정확히 3개
  checklist jsonb,                                                -- 일반적 체크리스트 { items[], notice } (FAM-02 상속·증여 상황)
  mistakes text[] not null default '{}',                          -- 자주 틀리는 점 (상태 상자 — 있을 때만, 3개 이하)
  external_link_id bigint,                                        -- 01B official_links (외부 계산기 연결 카드) — W3에서 외래 키
  article_ids bigint[] not null default '{}',                     -- 관련 기사 (화면 순서)
  solved_case_ids bigint[] not null default '{}',                 -- 해결 사례 기사
  glossary_ids bigint[] not null default '{}',                    -- 용어 칩
  tool_links jsonb not null default '[]'::jsonb,                  -- 연결 칸 [{ feature }] — 기능이 열리면(settings.feature_flags) 붙는다
  region_select boolean not null default false,                   -- 지역 선택 칩 ('집을 샀어요')
  hub_slot integer,                                               -- 분야 허브 상황 카드 줄의 자리 (없으면 허브에 내지 않는다)
  sort integer not null default 0,                                -- 검색 결과 없음 화면 등 허브 밖 목록 순서
  visible boolean not null default false,
  reviewer_id bigint references public.people (id),               -- 세무 감수 (PRD-01A 1.3 — '먼저 확인할 것' 감수 대상)
  reviewed_at timestamptz,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint situations_checks_shape check (
    case when jsonb_typeof(checks) = 'array' then jsonb_array_length(checks) <= 3 and public.jsonb_items_have_text(checks, 'title') else false end),
  constraint situations_checklist_shape check (public.situation_checklist_ok(checklist)),
  constraint situations_mistakes_shape check (cardinality(mistakes) <= 3 and public.text_items_nonblank(mistakes)),
  constraint situations_tool_links_shape check (public.jsonb_items_have_text(tool_links, 'feature')),
  constraint situations_hub_slot_positive check (hub_slot is null or hub_slot >= 1),
  constraint situations_review_pair check ((reviewer_id is null) = (reviewed_at is null)),
  constraint situations_publish_ready check (
    not visible or (jsonb_typeof(checks) = 'array' and reviewer_id is not null and (case when jsonb_typeof(checks) = 'array' then jsonb_array_length(checks) = 3 else false end)))
);

comment on table public.situations is '상황 카드·상황 페이지 (UX-05). 공개는 visible — 먼저 확인할 것 정확히 3개와 세무 감수 기록이 있어야 한다. 허브 자리는 허브 상한까지';

create unique index situations_hub_slot_unique on public.situations (section, hub_slot) where hub_slot is not null;
create index situations_section_idx on public.situations (section, visible, hub_slot);

create trigger situations_touch before update on public.situations
  for each row execute function public.touch_updated_at();

create function public.situations_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_setting jsonb;
  v_limit integer := 4;
begin
  -- 감수 대상 문장을 고쳤는데 감수 기록을 새로 넣지 않았으면 감수 기록을 지운다 (공개 행은 publish_ready 제약이 막는다)
  if tg_op = 'UPDATE'
     and (new.checks is distinct from old.checks or new.checklist is distinct from old.checklist or new.mistakes is distinct from old.mistakes)
     and new.reviewed_at is not distinct from old.reviewed_at then
    new.reviewer_id := null;
    new.reviewed_at := null;
  end if;

  -- 허브 자리는 허브 상한 이하 (UX-05 — 상한은 settings, 없거나 숫자가 아니면 4)
  if new.hub_slot is not null and (tg_op = 'INSERT' or new.hub_slot is distinct from old.hub_slot or new.section is distinct from old.section) then
    select s.value into v_setting from public.settings s where s.key = 'hub_situation_limit';
    if jsonb_typeof(v_setting) = 'number' and (v_setting #>> '{}')::numeric >= 1 then
      v_limit := floor((v_setting #>> '{}')::numeric)::integer;
    end if;
    if new.hub_slot > v_limit then
      raise exception '허브 상황 카드는 분야마다 %장까지입니다 — 자리 %는 지정할 수 없습니다 (UX-05)', v_limit, new.hub_slot
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.situations_guard() from public, anon, authenticated;

create trigger situations_guard
  before insert or update on public.situations
  for each row execute function public.situations_guard();

alter table public.situations enable row level security;
revoke all on table public.situations from anon, authenticated, service_role;
grant select, insert, update, delete on table public.situations to service_role;

insert into public.settings (key, value, description, updated_by) values
  ('hub_situation_limit', to_jsonb(4),
   '분야 허브 상황 카드 줄의 상한 (UX-05 초기값 4) — situations.hub_slot은 이 값 이하만 저장된다',
   'migration:20261018000010');
