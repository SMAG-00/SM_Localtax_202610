-- W10-e SM 주간 브리핑 이식: 수집 대상 설정·달력·진행 중 개정안 (docs/dev/W10-e_설계.md 7장)
-- 세 표 모두 편집자(서비스 키)만 읽고 씁니다. 수집 대상은 모두 꺼진 채(enabled=false)로 들어가고, 원천이 data_sources에서 허용·계약 확인되기 전에는 수집기가 요청을 보내지 않습니다.
-- 달력·진행 중 개정안은 빈 표입니다. 문구와 날짜는 편집자가 입력합니다(코드·시드에 실제 문구 0).

create table public.brief_collect_targets (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  source_key text not null references public.data_sources (key),
  corner_key text not null check (corner_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  api_target text not null check (length(btrim(api_target)) > 0),
  queries text[] not null default '{}',
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.brief_collect_targets is '브리핑 수집 대상 틀 (W10-e) - 어느 원천 target에 무엇을 물을지. 켜기(enabled)와 별개로 data_source_runnable(source_key)가 참이어야 수집';

insert into public.brief_collect_targets (key, source_key, corner_key, api_target, queries, params) values
  ('brief_laws', 'law_api', 'laws', 'law',
    array['지방세기본법', '지방세기본법 시행령', '지방세기본법 시행규칙', '지방세법', '지방세법 시행령', '지방세법 시행규칙',
          '지방세특례제한법', '지방세특례제한법 시행령', '지방세특례제한법 시행규칙', '지방세징수법', '지방세징수법 시행령', '지방세징수법 시행규칙'],
    '{"display": "100", "match": "exact_name"}'::jsonb),
  ('brief_admrul', 'admrul', 'admrul', 'admrul',
    array['지방세', '시가표준액', '지방세 감면', '취득세', '재산세'],
    '{"display": "100", "sort": "ddes", "ministry": "행정안전부"}'::jsonb),
  ('brief_interpretations', 'mois_interpretation', 'interpretations', 'moisCgmExpc',
    array['', '취득세', '재산세', '지방세'],
    '{"display": "100", "sort": "ddes"}'::jsonb),
  ('brief_tribunal', 'tribunal_decision', 'tribunal', 'ttSpecialDecc',
    array['취득세', '재산세'],
    '{"display": "100", "sort": "ddes", "range_param": "rslYd"}'::jsonb);

create table public.brief_calendar_items (
  id bigint generated always as identity primary key,
  text text not null check (length(btrim(text)) between 1 and 300),
  is_always boolean not null default false,
  is_yearly boolean not null default false,
  start_md text check (start_md ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  end_md text check (end_md ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  start_on date,
  end_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint brief_calendar_mode check (
    is_always
    or (is_yearly and start_md is not null)
    or (not is_yearly and start_on is not null)),
  constraint brief_calendar_range check (end_on is null or start_on is null or end_on >= start_on)
);

comment on table public.brief_calendar_items is '브리핑 "알아둘 날짜" 코너의 원천 (W10-e) - 상시 안내, 매년 반복(MM-DD), 한 번만(날짜) 세 방식. 편집자 입력';

create table public.brief_ongoing_items (
  id bigint generated always as identity primary key,
  name text not null check (length(btrim(name)) between 1 and 200),
  stage text not null check (length(btrim(stage)) between 1 and 100),
  as_of date not null,
  source text,
  source_url text check (source_url is null or source_url ~ '^https?://'),
  points text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.brief_ongoing_items is '진행 중인 개정안 목록 (W10-e) - 국회 제출·통과·공포를 확인하면 편집자가 stage·as_of를 고친다. 기준일이 오래되면 확인 대상';

alter table public.brief_collect_targets enable row level security;
alter table public.brief_calendar_items enable row level security;
alter table public.brief_ongoing_items enable row level security;
revoke all on table public.brief_collect_targets, public.brief_calendar_items, public.brief_ongoing_items from anon, authenticated, service_role;
grant select, insert, update, delete on table public.brief_collect_targets, public.brief_calendar_items, public.brief_ongoing_items to service_role;
