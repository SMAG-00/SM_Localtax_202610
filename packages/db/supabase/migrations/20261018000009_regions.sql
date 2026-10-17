-- W2-b 1단계 DB (docs/dev/W2-b_설계.md) — 행정구역 regions (PRD-01B REG1-01 · 5.5, PRD-01A CAT-03) · 기사 지역 태그 검사
-- · 코드 = 법정동코드 10자리 [확인 필요 — 설계 8장 #1·#2]. 단계 2종: sido(시·도) · sigungu(시·군·구)
-- · 시·도는 부모 없음, 시·군·구의 부모는 시·도. 자기 자신·자기 하위를 부모로 둔 행 거부. (parent_code, slug) unique (부모 null끼리도)
-- · slug 예약 이름(events·weekly·places·festivals·food·life) 거부 — /local/events · /local/[sido]/weekly · PRD-X 후보 경로
-- · 씨앗은 시·도 17곳만 (시·군·구 전국 적재는 01B W4). 폐지는 지우지 않고 valid_to로 한다
-- · articles.region_codes(W2-a 칸)는 regions에 있는 코드만, 새로 단 코드는 오늘(한국 날짜) 유효해야 한다 (CAT-03)

create table public.regions (
  code text primary key check (code ~ '^[0-9]{10}$'),
  parent_code text references public.regions (code),
  level text not null check (level in ('sido', 'sigungu')),
  name text not null check (length(btrim(name)) > 0),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and slug <> all (array['events', 'weekly', 'places', 'festivals', 'food', 'life'])),
  aliases text[] not null default '{}',
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint regions_parent_slug unique nulls not distinct (parent_code, slug),
  constraint regions_valid_period check (valid_from is null or valid_to is null or valid_to >= valid_from),
  constraint regions_level_parent check ((level = 'sido') = (parent_code is null)),
  constraint regions_sido_code check (level <> 'sido' or code ~ '^[0-9]{2}0{8}$'),
  constraint regions_sigungu_code check (level <> 'sigungu' or (code !~ '^[0-9]{2}0{8}$' and left(code, 2) = left(parent_code, 2)))
);

comment on table public.regions is '행정구역 (REG1-01) — 법정동코드 10자리·부모·공개 slug·별칭·유효기간. 순환·예약 slug 거부. 공개 참조 자료';

create index regions_parent_idx on public.regions (parent_code);

create trigger regions_touch before update on public.regions
  for each row execute function public.touch_updated_at();

-- 부모 규칙 — 시·군·구의 부모는 시·도, 자기 자신·자기 하위를 부모로 두면 거부, 하위가 있는 행의 단계 변경 거부
create function public.regions_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_level text;
  v_cycle boolean;
begin
  if new.parent_code is not null then
    if new.parent_code = new.code then
      raise exception '행정구역 %의 부모를 자기 자신으로 둘 수 없습니다 (REG1-01)', new.code
        using errcode = 'check_violation';
    end if;
    -- 부모의 조상 사슬에 자기 코드가 있으면 순환 (자기 하위를 부모로 둔 것)
    with recursive up(code, parent_code, depth) as (
      select r.code, r.parent_code, 1 from public.regions r where r.code = new.parent_code
      union all
      select r.code, r.parent_code, up.depth + 1 from public.regions r join up on r.code = up.parent_code where up.depth < 10
    )
    select exists (select 1 from up where up.code = new.code) into v_cycle;
    if v_cycle then
      raise exception '행정구역 %의 하위 지역(%)을 부모로 둘 수 없습니다 — 순환 관계 (REG1-01)', new.code, new.parent_code
        using errcode = 'check_violation';
    end if;
    select r.level into v_parent_level from public.regions r where r.code = new.parent_code;
    if v_parent_level is distinct from 'sido' then
      raise exception '시·군·구(%)의 부모는 시·도여야 합니다 — 지금 부모 %의 단계 % (REG1-01)', new.code, new.parent_code, coalesce(v_parent_level, '없음')
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.level is distinct from old.level
     and exists (select 1 from public.regions c where c.parent_code = old.code) then
    raise exception '하위 지역이 있는 행정구역(%)의 단계는 바꿀 수 없습니다 (REG1-01)', old.code
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.regions_guard() from public, anon, authenticated;

create trigger regions_guard
  before insert or update on public.regions
  for each row execute function public.regions_guard();

-- 기사가 쓰는 코드는 지우지 않는다 — 폐지는 valid_to로 (CAT-03 '이미 단 코드는 남는다')
create function public.regions_no_delete_in_use() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.articles a where a.region_codes @> array[old.code]) then
    raise exception '기사에 태그된 행정구역(%)은 지울 수 없습니다 — 폐지는 valid_to로 표시하세요 (CAT-03)', old.code
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

revoke all on function public.regions_no_delete_in_use() from public, anon, authenticated;

create trigger regions_no_delete_in_use
  before delete on public.regions
  for each row execute function public.regions_no_delete_in_use();

alter table public.regions enable row level security;
revoke all on table public.regions from anon, authenticated, service_role;
grant select, insert, update, delete on table public.regions to service_role;

-- 씨앗: 시·도 17곳 — 법정동코드 시·도 단위 (출처 행정표준코드관리시스템 code.go.kr) [확인 필요 — 설계 8장 #2·#3]
-- 순서 = 코드 순. 별칭은 짧은 이름과 옛 공식 이름(강원도·전라북도)만 — 다른 지역과 겹치는 별칭(예: 광주시 — 경기도 광주시)은 넣지 않는다
insert into public.regions (code, parent_code, level, name, slug, aliases) values
  ('1100000000', null, 'sido', '서울특별시',     'seoul',     array['서울']),
  ('2600000000', null, 'sido', '부산광역시',     'busan',     array['부산']),
  ('2700000000', null, 'sido', '대구광역시',     'daegu',     array['대구']),
  ('2800000000', null, 'sido', '인천광역시',     'incheon',   array['인천']),
  ('2900000000', null, 'sido', '광주광역시',     'gwangju',   array['광주']),
  ('3000000000', null, 'sido', '대전광역시',     'daejeon',   array['대전']),
  ('3100000000', null, 'sido', '울산광역시',     'ulsan',     array['울산']),
  ('3600000000', null, 'sido', '세종특별자치시', 'sejong',    array['세종', '세종시']),
  ('4100000000', null, 'sido', '경기도',         'gyeonggi',  array['경기']),
  ('4300000000', null, 'sido', '충청북도',       'chungbuk',  array['충북']),
  ('4400000000', null, 'sido', '충청남도',       'chungnam',  array['충남']),
  ('4600000000', null, 'sido', '전라남도',       'jeonnam',   array['전남']),
  ('4700000000', null, 'sido', '경상북도',       'gyeongbuk', array['경북']),
  ('4800000000', null, 'sido', '경상남도',       'gyeongnam', array['경남']),
  ('5000000000', null, 'sido', '제주특별자치도', 'jeju',      array['제주']),
  ('5100000000', null, 'sido', '강원특별자치도', 'gangwon',   array['강원', '강원도']),
  ('5200000000', null, 'sido', '전북특별자치도', 'jeonbuk',   array['전북', '전라북도']);

-- ─────────────────────────────────────────────────────────────
-- 기사 지역 태그 (articles.region_codes — W2-a 칸) 검사 (CAT-03)
-- 배열이라 외래 키를 걸 수 없어 트리거로 막는다. 이미 단 코드는 나중에 폐지돼도 남고, 새로 다는 코드만 유효 기간을 본다
-- ─────────────────────────────────────────────────────────────
create function public.articles_region_codes_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_code text;
  v_region public.regions%rowtype;
begin
  foreach v_code in array coalesce(new.region_codes, '{}'::text[]) loop
    select * into v_region from public.regions r where r.code = v_code;
    if not found then
      raise exception '없는 행정구역 코드입니다: % (CAT-03 — regions에 있는 코드만 태그합니다)', v_code
        using errcode = 'check_violation';
    end if;
    if tg_op = 'INSERT' or not (coalesce(old.region_codes, '{}'::text[]) @> array[v_code]) then
      if (v_region.valid_to is not null and v_region.valid_to < v_today) or (v_region.valid_from is not null and v_region.valid_from > v_today) then
        raise exception '유효하지 않은 행정구역 코드입니다: % (%) — 폐지되었거나 시작 전인 코드는 새로 태그할 수 없습니다 (CAT-03)', v_code, v_region.name
          using errcode = 'check_violation';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.articles_region_codes_guard() from public, anon, authenticated;

create trigger articles_region_codes_guard
  before insert or update of region_codes on public.articles
  for each row execute function public.articles_region_codes_guard();

-- 지역 목록(시·군·구 태그 기사가 상위 시·도 목록에도 — CAT-03)이 배열 겹침으로 찾는다
create index articles_region_codes_idx on public.articles using gin (region_codes);
