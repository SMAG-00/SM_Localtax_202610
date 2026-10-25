-- W10-b 6단계 — 위택스 바로가기 wetax_links(+점검 기록) · official_links 종류 확장 · 계산기 공개 읽기 뷰 3개
-- (PRD-02 WETAX-01 · FAM-04 · CALC-08/14 화면 읽기, docs/dev/W10-b_설계.md 3장)
-- 이 파일에 실제 위택스 주소·세율·기한은 없다 — 주소는 관리자가 입력하는 설정값이고 씨앗 행은 모두 주소 비움(확인 필요). 주소가 비면 화면은 첫 화면 주소로 대체하고, 그것도 없으면 안내 문장만 보인다.
--
-- · wetax_links — 위택스 메뉴(신고·납부·환급금 조회)·첫 화면·스마트 위택스 앱 주소. 주소에는 쿼리(?)·조각(#)·사용자 정보(@)를 둘 수 없다(입력값이 실릴 틈 막기).
--   fail_count — 점검이 연속으로 실패한 횟수. 2회 연속 실패하면 앱의 점검 배치가 status를 broken으로 바꾼다(WETAX-01). 성공하면 0.
-- · official_links.kind — 국세청 안내(nts_guide)·법령정보센터(law_center)·교육원(edu_site) 추가. 이 표의 기존 행·점검 동작은 그대로.
-- · 공개 읽기 뷰 — public_active_ruleset(활성=서명·승인된 룰셋 본문) · public_active_determination(활성 판정표 본문) · public_calc_gate(세목·원인 묶음 게이트 숫자).
--   브라우저 계산기가 본문을 받아 가야 하므로 활성 행만 칸을 좁혀 연다. 초안·서명 전 본문은 열리지 않는다.

-- ─────────────────────────────────────────────────────────────
-- official_links 종류 확장
-- ─────────────────────────────────────────────────────────────
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.official_links'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%sm_calculator%'
  loop
    execute format('alter table public.official_links drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.official_links
  add constraint official_links_kind_check
  check (kind in ('sm_calculator', 'external_calculator', 'fallback', 'nts_guide', 'law_center', 'edu_site'));

insert into public.official_links (kind, key, label, sort) values
  ('nts_guide', 'nts_guide', '국세청 공식 안내', 90),
  ('law_center', 'law_info_center', '국가법령정보센터', 100),
  ('edu_site', 'edu', '교육원 사이트', 110)
on conflict (kind, key) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 위택스 바로가기
-- ─────────────────────────────────────────────────────────────
create table public.wetax_links (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  kind text not null check (kind in ('home', 'filing', 'payment', 'refund', 'app')),
  tax_kind text not null check (tax_kind in ('all', 'acquisition', 'property', 'comprehensive', 'vehicle', 'refund')),
  label text not null check (char_length(label) between 1 and 80),
  url text check (url is null or url ~* '^https?://[^[:space:]?#@]+$'),
  status text not null default 'unchecked' check (status in ('ok', 'broken', 'unchecked')),
  fail_count integer not null default 0 check (fail_count between 0 and 99),
  fallback_key text references public.wetax_links (key),
  checked_at timestamptz,
  last_ok_at timestamptz,
  check_method text check (check_method is null or check_method in ('auto', 'manual')),
  checked_by text,
  active boolean not null default true,
  sort integer not null default 0,
  constraint wetax_links_fallback_not_self check (fallback_key is null or fallback_key <> key)
);

comment on table public.wetax_links is '위택스 메뉴·첫 화면·앱 주소 (WETAX-01) - 주소는 설정값(관리자 입력), 씨앗은 주소 비움. 주소에 쿼리·조각·사용자 정보 불가. 점검 배치가 확인일·상태 갱신';
comment on column public.wetax_links.fail_count is '연속 점검 실패 횟수 - 2회 연속이면 앱 배치가 broken으로, 성공하면 0';

insert into public.wetax_links (key, kind, tax_kind, label, sort, fallback_key) values
  ('wetax_home', 'home', 'all', '위택스(행정안전부 공식)', 10, null);
insert into public.wetax_links (key, kind, tax_kind, label, sort, fallback_key) values
  ('wetax_acquisition_filing', 'filing', 'acquisition', '위택스 취득세 신고', 20, 'wetax_home'),
  ('wetax_property_payment', 'payment', 'property', '위택스 재산세 납부', 30, 'wetax_home'),
  ('wetax_comprehensive_payment', 'payment', 'comprehensive', '위택스 종합부동산세 납부', 40, 'wetax_home'),
  ('wetax_vehicle_payment', 'payment', 'vehicle', '위택스 자동차세 납부', 50, 'wetax_home'),
  ('wetax_refund_lookup', 'refund', 'refund', '위택스 환급금 조회', 60, 'wetax_home'),
  ('wetax_app', 'app', 'all', '스마트 위택스 앱 안내', 70, 'wetax_home');

create table public.wetax_link_checks (
  id bigint generated always as identity primary key,
  link_key text not null references public.wetax_links (key) on delete cascade,
  run_key text not null check (char_length(run_key) between 1 and 40),
  result text not null check (result in ('ok', 'broken')),
  http_status integer,
  method text not null check (method in ('auto', 'manual')),
  by text,
  at timestamptz not null default now(),
  unique (link_key, run_key)
);

comment on table public.wetax_link_checks is '위택스 링크 점검 기록 - 추가만. 같은 실행 키로 두 번 돌려도 한 벌';

alter table public.wetax_links enable row level security;
alter table public.wetax_link_checks enable row level security;
revoke all on table public.wetax_links, public.wetax_link_checks from anon, authenticated, service_role;
grant select, insert, update, delete on table public.wetax_links to service_role;
grant select, insert on table public.wetax_link_checks to service_role;
grant select (key, kind, tax_kind, label, url, status, fail_count, fallback_key, checked_at, last_ok_at, active, sort) on table public.wetax_links to anon, authenticated;

create policy wetax_links_public_read on public.wetax_links
  for select to anon, authenticated
  using (active and url is not null);

-- ─────────────────────────────────────────────────────────────
-- 계산기 공개 읽기 뷰 - 활성 행만, 칸을 좁혀서
-- ─────────────────────────────────────────────────────────────
create view public.public_active_ruleset as
select version, body, body_sha256, signed_at, activated_at
  from public.rulesets
 where status = 'active';
comment on view public.public_active_ruleset is '활성(서명·승인된) 룰셋 본문 - 브라우저 계산기가 받아 간다 (CALC-08). 초안·서명 전 본문은 열리지 않는다';

create view public.public_active_determination as
select kind, version, body, body_sha256, signed_at, activated_at
  from public.determination_tables
 where status = 'active';
comment on view public.public_active_determination is '활성(서명·승인된) 판정표 본문 - 환급 진단·감면 점검 (CALC-04·13). 서명 전 표는 열리지 않는다';

create view public.public_calc_gate as
select tax_kind, cause_group, ruleset_version, run_at, engine_hash,
       official_cases, official_matched, sample_cases, sample_matched, is_open
  from public.calc_gate_status;
comment on view public.public_calc_gate is '세목·원인 묶음별 공개 게이트 숫자 (CALC-14·FAM-07) - 건수와 공개 여부뿐, 사례 내용 0. 값은 calc_gate_status 뷰 그대로이고 수동 칸 없음';

revoke all on table public.public_active_ruleset, public.public_active_determination, public.public_calc_gate from public, anon, authenticated, service_role;
grant select on table public.public_active_ruleset, public.public_active_determination, public.public_calc_gate to anon, authenticated, service_role;
