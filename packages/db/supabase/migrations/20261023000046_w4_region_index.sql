-- W4 11단계 — 얇은 페이지·시범 지역·최소선 리포트 (REG-09 · REG1-12 · PRD-01B 9.2, docs/dev/W4_설계.md 1장 11단계 · 2.2 · 3장 · 12장 #6·#26·#35·#81~)
-- · region_index_threshold (settings) — 지역 허브 색인 임계값. 모양 = { "reported_news": 정수, "official_sources": 정수 } (초기값 9.2 최소선 — 1·1).
--     두 칸 정확히 · 정수 1~1000(0은 빈 지역을 색인하게 되므로 거부 — REG1-01 '빈 페이지는 색인하지 않는다'). 바꾸면 배포 없이 다음 렌더부터 판정이 바뀐다.
--     공개(anon) 읽기 정책은 열지 않는다 — 판정은 아래 뷰가 계산해 결과만 낸다.
-- · pilot_regions (settings) — 시범 취재 지역(9.2 · 12장 #6) 법정동코드 목록. 씨앗 = PO 승인(2026-10-22) 서울특별시·부산광역시(W2-b 씨앗 코드).
--     목록 · 0~20개 · 10자리 숫자 · 같은 코드 두 번 0 · 새로 넣는 코드는 regions에 있고 오늘(한국 날짜) 유효해야 한다(이미 있던 코드는 폐지돼도 남는다 — 리포트가 폐지를 보인다).
--     공개 읽기 — anon이 이 키 한 줄만 읽는 정책(/local 시·도 카드 '시범 지역' 표시). 기존 settings_public_read는 그대로
-- · region_index_status (뷰, service_role만) — 지역별 색인 판정. 렌더 때 계산한다(regions에 상태 칸을 두지 않는다 — W2-b #5).
--     범위(12장 #26) = 시·도 → 자기 + 하위 시·군·구 태그(폐지된 하위 포함), 시·군·구 → 자기 태그.
--     자체 취재 수 = 그 범위 태그 + 편집 분야 + 지자체뉴스 분야(허브 ②③에 보이는 기사)의 공개 보도기사 중 편집 승인(reported_approved)이고
--       마지막 발행 기록에 보도자료 재게시 경고(reg1_14.press-release-repost — 8단계)가 없는 것. held·별도 상품 큐 원고는 공개되지 않아 0,
--       금주 핫뉴스(digest)·칼럼(opinion)·행사·분양 정보는 보도기사가 아니라 0 (9.2 표 '세지 않는다' 줄)
--     공식 자료 수 = 그 범위 공개 지역 기사(태그 + 편집 분야 + 보도·해설·가이드·칼럼 — 분야 상관없이, ⑤와 같은 범위)에 쓰인 공식 자료(official_doc·dataset) 중
--       대체되지 않은 판 · 자료 종류 있음(차단 4종 밖) · 원본 스냅샷 · 원문 URL(http/https)·발표기관·기준일·확인일·공공누리 유형 모두 있음 (9.2 · REG1-07·09·13 — ⑤ 카드와 같은 조건).
--       같은 원문 주소는 하나로 센다(⑤ 카드 한 장과 같다)
--     판정(indexable) = 오늘 유효한 지역 + 임계값을 읽었고 두 수 모두 임계값 이상. 임계값이 없거나 모양이 틀리면 미달(닫힌 쪽)
-- · public_region_index (뷰, anon) — 사이트맵 원본(W7 사이트맵 파일이 읽는다 — 파일은 W7). 판정이 색인 대상인 지역만 + 기능 키 region_hubs가 켜졌을 때만
--     (꺼지면 지역 허브가 404라 0행). 칸 = 코드·단계·이름·주소·두 수·최신 자체 취재 발행 시각. 지역 허브 화면의 noindex 판정과 /local '색인 대상' 표시가 같은 뷰를 읽는다.
--     SITE_INDEXING(운영 전환 게이트 — 환경변수)은 화면·사이트맵 파일 쪽이 본다(DB는 모른다)
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다 (설정 두 줄 · 트리거 · 정책 하나 · 뷰 둘).

-- ─────────────────────────────────────────────────────────────
-- 설정 씨앗 (설계 2.2)
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value, description, updated_by) values
  ('region_index_threshold',
   '{"reported_news": 1, "official_sources": 1}'::jsonb,
   '지역 허브 색인 임계값 (REG-09 · REG1-12 — 초기값 PRD-01B 9.2 최소선) — 자체 취재 기사 수(reported_news)·검수 공식 자료 수(official_sources)가 모두 이 값 이상인 지역만 색인·사이트맵 원본. 정수 1~1000',
   'migration:20261023000046'),
  ('pilot_regions',
   '["1100000000", "2600000000"]'::jsonb,
   '시범 취재 지역 (PRD-01B 9.2 · W4 12장 #6 — PO 승인 2026-10-22 서울특별시·부산광역시) — 법정동코드 목록. 최소선 판정 리포트(/admin/regions/report)가 지역마다 수와 최소선을, 서로 다른 시·도 2곳 이상인지를 보인다',
   'migration:20261023000046')
on conflict (key) do nothing;

create function public.region_index_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- 설계 2.2 · TypeScript lib/server/public/region-index-logic.ts REGION_INDEX_LIMITS와 같다
  c_threshold_keys constant text[] := array['reported_news', 'official_sources'];
  c_min constant integer := 1;
  c_max constant integer := 1000;
  c_pilots constant integer := 20;
  v_key text;
  v_num jsonb;
  v_code jsonb;
  v_seen text[] := '{}';
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if new.key = 'region_index_threshold' then
    if jsonb_typeof(new.value) is distinct from 'object' then
      raise exception '지역 색인 임계값(region_index_threshold)은 {"reported_news": 정수, "official_sources": 정수} 객체여야 합니다 (REG-09)' using errcode = 'check_violation';
    end if;
    if exists (select 1 from jsonb_object_keys(new.value) k where k <> all (c_threshold_keys)) then
      raise exception '지역 색인 임계값의 칸은 reported_news(자체 취재 기사)·official_sources(검수 공식 자료)뿐입니다' using errcode = 'check_violation';
    end if;
    foreach v_key in array c_threshold_keys loop
      v_num := new.value -> v_key;
      if v_num is null or jsonb_typeof(v_num) is distinct from 'number'
         or (v_num #>> '{}')::numeric <> trunc((v_num #>> '{}')::numeric)
         or (v_num #>> '{}')::numeric not between c_min and c_max then
        raise exception '지역 색인 임계값 %는 %~% 정수여야 합니다 — 0이면 빈 지역이 색인됩니다 (REG1-01)', v_key, c_min, c_max using errcode = 'check_violation';
      end if;
    end loop;
    return new;
  end if;

  -- pilot_regions
  if jsonb_typeof(new.value) is distinct from 'array' or jsonb_array_length(new.value) > c_pilots then
    raise exception '시범 지역(pilot_regions)은 법정동코드 0~%개 목록입니다 — ["1100000000", …]', c_pilots using errcode = 'check_violation';
  end if;
  for v_code in select x.value from jsonb_array_elements(new.value) as x loop
    if jsonb_typeof(v_code) is distinct from 'string' or (v_code #>> '{}') !~ '^[0-9]{10}$' then
      raise exception '시범 지역 코드는 10자리 숫자 글자입니다 (지금 %)', v_code using errcode = 'check_violation';
    end if;
    if (v_code #>> '{}') = any (v_seen) then
      raise exception '시범 지역 %가 두 번 있습니다', v_code #>> '{}' using errcode = 'check_violation';
    end if;
    v_seen := v_seen || (v_code #>> '{}');
    -- 새로 넣는 코드만 — 이미 있던 코드는 폐지돼도 남는다(리포트가 폐지를 보인다)
    if tg_op = 'INSERT' or not coalesce(jsonb_typeof(old.value) = 'array' and old.value ? (v_code #>> '{}'), false) then
      if not exists (
        select 1 from public.regions r
         where r.code = (v_code #>> '{}')
           and (r.valid_from is null or r.valid_from <= v_today)
           and (r.valid_to is null or r.valid_to >= v_today)
      ) then
        raise exception '시범 지역 %는 오늘 유효한 행정구역(regions)이 아닙니다', v_code #>> '{}' using errcode = 'check_violation';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.region_index_settings_guard() from public, anon, authenticated;
create trigger settings_region_index_guard
  before insert or update on public.settings
  for each row when (new.key in ('region_index_threshold', 'pilot_regions'))
  execute function public.region_index_settings_guard();

-- 공개 읽기 — 시범 지역 한 줄 (/local 시·도 카드 '시범 지역'). 임계값은 열지 않는다(판정은 뷰가 낸다)
create policy settings_public_pilot_regions on public.settings
  for select to anon, authenticated
  using (key = 'pilot_regions');

-- ─────────────────────────────────────────────────────────────
-- region_index_status — 지역별 색인 판정 (관리용 — 최소선 판정 리포트)
-- ─────────────────────────────────────────────────────────────
create view public.region_index_status as
select r.code,
       r.level,
       r.parent_code,
       r.name,
       '/local/' || coalesce(p.slug || '/', '') || r.slug as path,
       ((r.valid_from is null or r.valid_from <= t.today) and (r.valid_to is null or r.valid_to >= t.today)) as current,
       coalesce(t.pilots ? r.code, false) as pilot,
       own.n as own_reported,
       own.last_at as last_published_at,
       off.n as official_sources,
       t.min_reported,
       t.min_official,
       coalesce(own.n >= t.min_reported, false) as reported_ok,
       coalesce(off.n >= t.min_official, false) as official_ok,
       ((r.valid_from is null or r.valid_from <= t.today) and (r.valid_to is null or r.valid_to >= t.today)
         and coalesce(own.n >= t.min_reported, false) and coalesce(off.n >= t.min_official, false)) as indexable
  from public.regions r
  left join public.regions p on p.code = r.parent_code
  cross join (
    select (select case when jsonb_typeof(s.value -> 'reported_news') = 'number' and (s.value ->> 'reported_news')::numeric >= 1
                        then (s.value ->> 'reported_news')::numeric end
              from public.settings s where s.key = 'region_index_threshold') as min_reported,
           (select case when jsonb_typeof(s.value -> 'official_sources') = 'number' and (s.value ->> 'official_sources')::numeric >= 1
                        then (s.value ->> 'official_sources')::numeric end
              from public.settings s where s.key = 'region_index_threshold') as min_official,
           coalesce((select case when jsonb_typeof(s.value) = 'array' then s.value end from public.settings s where s.key = 'pilot_regions'), '[]'::jsonb) as pilots,
           (now() at time zone 'Asia/Seoul')::date as today
  ) t
  -- 범위 (12장 #26) — 시·도 = 자기 + 하위(폐지된 하위 포함), 시·군·구 = 자기
  cross join lateral (
    select case when r.level = 'sido'
                then array_prepend(r.code, coalesce((select array_agg(c.code order by c.code) from public.regions c where c.parent_code = r.code), '{}'::text[]))
                else array[r.code] end as codes
  ) sc
  -- 자체 취재 기사 (9.2 1줄)
  cross join lateral (
    select count(*)::integer as n, max(a.first_published_at) as last_at
      from public.articles a
     where a.region_codes && sc.codes
       and a.status = 'published' and a.lead_media_cleared and not a.is_paid
       and a.section = 'local'
       and a.editorial_field is not null
       and a.reported_approved
       and not coalesce((a.check_log -> 'publish' -> 'warnings') ? 'reg1_14.press-release-repost', false)
  ) own
  -- 검수 공식 자료 (9.2 2줄) — 같은 원문 주소는 하나로
  cross join lateral (
    select count(distinct btrim(s.source_url))::integer as n
      from public.articles a
      join public.article_sources s on s.article_id = a.id
     where a.region_codes && sc.codes
       and a.status = 'published' and a.lead_media_cleared and not a.is_paid
       and a.editorial_field is not null
       and a.content_type in ('reported_news', 'explainer', 'guide', 'opinion')
       and s.kind in ('official_doc', 'dataset')
       and not exists (select 1 from public.article_sources n where n.supersedes_id = s.id)
       and s.snapshot_id is not null
       and length(btrim(coalesce(s.source_type, ''))) > 0
       and btrim(s.source_type) not in ('transport', 'tourism', 'restaurant', 'living_guide')
       and btrim(coalesce(s.source_url, '')) ~* '^https?://'
       and length(btrim(coalesce(s.source_name, ''))) > 0
       and s.reference_date is not null
       and s.last_verified_at is not null
       and s.license_type is not null
  ) off;
comment on view public.region_index_status is '지역별 색인 판정 (REG-09 · REG1-12 · 9.2) — 자체 취재 수·검수 공식 자료 수·임계값·시범 여부·판정. 렌더 때 계산. 관리용(service_role)';
revoke all on table public.region_index_status from public, anon, authenticated, service_role;
grant select on table public.region_index_status to service_role;

-- ─────────────────────────────────────────────────────────────
-- public_region_index — 사이트맵 원본 (색인 대상 지역만, region_hubs 켜짐일 때만)
-- ─────────────────────────────────────────────────────────────
create view public.public_region_index as
select s.code, s.level, s.name, s.path, s.own_reported, s.official_sources, s.last_published_at
  from public.region_index_status s
 where s.indexable
   and coalesce((select (f.value -> 'region_hubs') = 'true'::jsonb from public.settings f where f.key = 'feature_flags'), false);
comment on view public.public_region_index is '지역 허브 사이트맵 원본 (REG-09 · REG1-12) — 최소선 이상인 오늘 유효한 지역만, 기능 키 region_hubs가 켜졌을 때만. 지역 허브 noindex 판정·/local 색인 대상 표시가 같은 뷰를 읽는다';
revoke all on table public.public_region_index from public, anon, authenticated, service_role;
grant select on table public.public_region_index to anon, authenticated, service_role;
