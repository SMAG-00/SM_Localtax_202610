-- W4 13단계 — 지역 연결 regional_links (PRD-01B REG1-10 · LG-14 · 데이터 표 `regional_links`, docs/dev/W4_설계.md 1장 13단계 · 2.1 · 3장 · 12장 100번~)
-- 지역 = 전문 뉴스 허브다. 관광·맛집·지도는 PRD-X — 관광 항목 종류(attraction·restaurant·tour_item)는 연결 표에 저장하지 않는다.
-- · regional_links — 출발(from)·도착(to) 종류와 번호 · 관계 · 이유 · 출처(origin — 편집자 / 같은 지역 자동 후보) · 상태 · 확인자·확인 시각.
--     종류 article(기사 번호) · official_source(공식 자료 출처 번호 — official_doc·dataset) · project(프로젝트 번호) · region(행정구역 코드 10자리) · local_event(행사 — W6, 지금은 거부).
--     확인(confirmed)은 확인자·시각·이유가 모두 있어야 하고(제약), 도착이 지금 공개된 것이어야 한다(뒤 트리거 — 공개 기사·검수 공식 자료·공개 프로젝트·오늘 유효한 지역).
--     지역에서 출발하는 연결은 그 지역 범위(시·도 = 자기 + 하위 시·군·구, 시·군·구 = 자기 — 12장 #26)의 대상만 확인한다(REG1-10 '다른 지역 태그 0').
--     출발·도착·출처는 바꾸지 않는다 — 지우고(removed) 새로 만든다. 지운 연결은 되살리지 않고, 확인된 연결은 후보로 돌리지 않는다.
-- · 같은 지역 자동 후보 regional_link_suggest(출발 종류, 번호, 찾는 사람) — 프로젝트·기사·지역에서 같은 지역의 공개 대상을 후보(candidate)로 넣는다.
--     한 번이라도 있었던 쌍(지운 것 포함)은 다시 만들지 않는다. 후보는 편집 화면(service_role)에서만 보이고 공개 뷰에는 없다.
-- · 판정 뷰 regional_link_status(service_role) — 연결마다 출발·도착이 지금 공개인지·지역 범위 안인지. 공개 뷰 public_regional_links(anon)는
--     확인된 연결 중 두 끝이 모두 지금 공개이고 범위 안인 것만(지역 끝은 기능 키 region_hubs가 켜졌을 때만) — 목적지가 비공개가 되면 다음 읽기부터 0행.
--     공개 칸 = 번호·종류·관계·확인 시각뿐(이유·확인자·출처 0).
-- · 기존 표·칸·제약·값은 바꾸지 않는다.

-- ─────────────────────────────────────────────────────────────
-- 연결 표
-- ─────────────────────────────────────────────────────────────
create table public.regional_links (
  id bigint generated always as identity primary key,
  from_type text not null,
  from_id text not null,
  to_type text not null,
  to_id text not null,
  relation text not null,
  reason text,
  origin text not null,
  status text not null default 'candidate',
  confirmed_by text,
  confirmed_at timestamptz,
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint regional_links_from_type check (from_type in ('article', 'official_source', 'project', 'region', 'local_event')),
  constraint regional_links_to_type check (to_type in ('article', 'official_source', 'project', 'region', 'local_event')),
  constraint regional_links_from_id check ((from_type = 'region' and from_id ~ '^[0-9]{10}$') or (from_type <> 'region' and from_id ~ '^[1-9][0-9]{0,17}$')),
  constraint regional_links_to_id check ((to_type = 'region' and to_id ~ '^[0-9]{10}$') or (to_type <> 'region' and to_id ~ '^[1-9][0-9]{0,17}$')),
  constraint regional_links_relation check (relation in ('same_region', 'related_tax', 'related_realestate', 'related_policy', 'related_project', 'related_event')),
  constraint regional_links_origin check (origin in ('editor', 'auto_candidate')),
  constraint regional_links_status check (status in ('candidate', 'confirmed', 'removed')),
  constraint regional_links_not_self check (from_type <> to_type or from_id <> to_id),
  constraint regional_links_reason_length check (reason is null or length(reason) <= 300),
  constraint regional_links_confirmed_record check (
    status <> 'confirmed'
    or (length(btrim(coalesce(confirmed_by, ''))) > 0 and confirmed_at is not null and length(btrim(coalesce(reason, ''))) > 0))
);

comment on table public.regional_links is '지역 연결 (REG1-10 · LG-14) — 프로젝트 ↔ 기사·칼럼·지역(행사는 W6). 관광 항목 종류 저장 거부(PRD-X). 확인된 연결만 공개(public_regional_links), 같은 지역 자동 후보는 편집 화면에만';
comment on column public.regional_links.from_id is '출발 번호 — region은 행정구역 코드 10자리, 그 밖은 표의 번호';
comment on column public.regional_links.to_id is '도착 번호 — region은 행정구역 코드 10자리, 그 밖은 표의 번호';
comment on column public.regional_links.reason is '연결 이유 (편집 메모 — 공개 뷰에 없다). 확인(confirmed)에는 필수';
comment on column public.regional_links.origin is '출처 — editor(편집자가 만든 연결) · auto_candidate(같은 지역 자동 후보)';
comment on column public.regional_links.confirmed_by is '확인자 — 확인(confirmed)에는 필수, 공개 뷰에 없다';

-- 같은 쌍의 살아 있는(후보·확인) 연결은 하나
create unique index regional_links_active_pair on public.regional_links (from_type, from_id, to_type, to_id) where status <> 'removed';
create index regional_links_from_idx on public.regional_links (from_type, from_id);
create index regional_links_to_idx on public.regional_links (to_type, to_id);

create trigger regional_links_touch before update on public.regional_links
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 연결 대상이 있는가 (저장 검사가 쓴다 — 공개 여부는 판정 뷰가 본다)
-- ─────────────────────────────────────────────────────────────
create function public.regional_link_ref_exists(p_type text, p_id text) returns boolean
language sql
stable
set search_path = ''
as $$
  select case p_type
    when 'article' then exists (select 1 from public.articles a where a.id = p_id::bigint and a.status <> 'deleted')
    when 'official_source' then exists (select 1 from public.article_sources s where s.id = p_id::bigint and s.kind in ('official_doc', 'dataset'))
    when 'project' then exists (select 1 from public.projects p where p.id = p_id::bigint)
    when 'region' then exists (select 1 from public.regions r where r.code = p_id)
    else false
  end;
$$;
revoke all on function public.regional_link_ref_exists(text, text) from public, anon, authenticated;
grant execute on function public.regional_link_ref_exists(text, text) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 저장 검사 — 관광 항목 종류 · 행사(W6) · 관계 · 번호 모양 · 대상 있음 · 바꾸지 못하는 칸 · 상태 흐름
-- ─────────────────────────────────────────────────────────────
create function public.regional_links_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_blocked constant text[] := array['attraction', 'restaurant', 'tour_item'];
  v_side record;
begin
  if new.to_type = any (c_blocked) or new.from_type = any (c_blocked) then
    raise exception '관광 항목 종류(%)는 지역 연결에 저장하지 않습니다 — 지역은 전문 뉴스 허브이고 명소·맛집·관광 정보는 만들지 않습니다 (PRD-X · REG1-10)',
      case when new.to_type = any (c_blocked) then new.to_type else new.from_type end
      using errcode = 'check_violation';
  end if;
  if new.to_type = 'local_event' or new.from_type = 'local_event' then
    raise exception '행사(local_event) 연결은 행사 표가 생기는 W6에서 엽니다' using errcode = 'check_violation';
  end if;
  if new.relation = 'related_event' then
    raise exception '관계 related_event는 행사 연결(W6)에서만 씁니다' using errcode = 'check_violation';
  end if;
  if new.relation = 'related_project' and new.from_type <> 'project' and new.to_type <> 'project' then
    raise exception '관계 related_project는 한쪽이 프로젝트인 연결에만 씁니다' using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    if (new.from_type, new.from_id, new.to_type, new.to_id, new.origin, new.created_by, new.created_at)
       is distinct from (old.from_type, old.from_id, old.to_type, old.to_id, old.origin, old.created_by, old.created_at) then
      raise exception '연결의 출발·도착·출처는 바꾸지 않습니다 — 지우고(removed) 새로 만드세요' using errcode = 'check_violation';
    end if;
    if old.status = 'removed' and new.status <> 'removed' then
      raise exception '지운 연결(%)은 되살리지 않습니다 — 새로 만드세요', old.id using errcode = 'check_violation';
    end if;
    if old.status = 'confirmed' and new.status = 'candidate' then
      raise exception '확인된 연결(%)을 후보로 돌리지 않습니다 — 지우고(removed) 새 후보를 만드세요', old.id using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- INSERT
  if new.status = 'removed' then
    raise exception '지운 상태(removed)로는 넣지 않습니다' using errcode = 'check_violation';
  end if;
  if new.origin = 'auto_candidate' and new.status <> 'candidate' then
    raise exception '자동 후보는 후보(candidate)로만 들어갑니다 — 확인은 편집자가 합니다' using errcode = 'check_violation';
  end if;
  for v_side in select * from (values (new.from_type, new.from_id), (new.to_type, new.to_id)) as x(typ, ref) loop
    if (v_side.typ = 'region' and v_side.ref !~ '^[0-9]{10}$') or (v_side.typ <> 'region' and v_side.ref !~ '^[1-9][0-9]{0,17}$') then
      raise exception '연결 번호 모양이 틀립니다 (%:%) — 지역은 10자리 코드, 그 밖은 번호', v_side.typ, v_side.ref using errcode = 'check_violation';
    end if;
    if v_side.typ in ('article', 'official_source', 'project', 'region') and not public.regional_link_ref_exists(v_side.typ, v_side.ref) then
      raise exception '연결 대상이 없습니다 (%:%)', v_side.typ, v_side.ref using errcode = 'foreign_key_violation';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.regional_links_guard() from public, anon, authenticated;
create trigger regional_links_guard
  before insert or update on public.regional_links
  for each row execute function public.regional_links_guard();

-- ─────────────────────────────────────────────────────────────
-- 권한·RLS — 표는 service_role만 (관리자 전권)
-- ─────────────────────────────────────────────────────────────
alter table public.regional_links enable row level security;
revoke all on table public.regional_links from anon, authenticated, service_role;
grant select, insert, update, delete on table public.regional_links to service_role;

-- ─────────────────────────────────────────────────────────────
-- 판정 뷰 — 연결마다 출발·도착이 지금 공개인지 · 지역 출발 연결이 그 지역 범위 안인지 (service_role만 — 편집 화면·확인 검사)
--   공개 기사 = 발행·대표 이미지 권리 확인 또는 없음·무료(W2-a 공개 읽기와 같다)
--   검수 공식 자료 = official_doc·dataset · 대체되지 않은 판 · 자료 종류(차단 4종 밖) · 원본 스냅샷 · 원문 URL·발표기관·기준일·확인일·공공누리 유형 ·
--                    공개 자체 기사(보도·해설·가이드·칼럼)의 출처 (12장 #64와 같은 칸 — 지역 태그는 보지 않는다)
--   공개 프로젝트 = public_projects(공개 + 공개 단계 1건 이상) · 지역 = 오늘(KST) 유효한 행정구역
-- ─────────────────────────────────────────────────────────────
create view public.regional_link_status as
select l.id,
       l.from_type,
       l.from_id,
       l.to_type,
       l.to_id,
       l.relation,
       l.reason,
       l.origin,
       l.status,
       l.confirmed_by,
       l.confirmed_at,
       l.created_by,
       l.created_at,
       l.updated_at,
       e.from_public,
       e.to_public,
       case
         when l.from_type <> 'region' then true
         when rs.codes is null then false
         else case l.to_type
           when 'article' then exists (select 1 from public.articles a where a.id = l.to_id::bigint and a.region_codes && rs.codes)
           when 'project' then exists (select 1 from public.projects p where p.id = l.to_id::bigint and p.region_code = any (rs.codes))
           when 'official_source' then exists (
             select 1 from public.article_sources s join public.articles a on a.id = s.article_id
              where s.id = l.to_id::bigint and a.region_codes && rs.codes)
           when 'region' then l.to_id = any (rs.codes)
           else false
         end
       end as in_scope
  from public.regional_links l
  cross join (select (now() at time zone 'Asia/Seoul')::date as today) t
  cross join lateral (
    select bool_or(x.side = 'from' and v.ok) as from_public,
           bool_or(x.side = 'to' and v.ok) as to_public
      from (values ('from', l.from_type, l.from_id), ('to', l.to_type, l.to_id)) as x(side, typ, ref)
      cross join lateral (
        select case x.typ
          when 'article' then exists (
            select 1 from public.articles a
             where a.id = x.ref::bigint and a.status = 'published' and a.lead_media_cleared and not a.is_paid)
          when 'official_source' then exists (
            select 1 from public.article_sources s join public.articles a on a.id = s.article_id
             where s.id = x.ref::bigint
               and a.status = 'published' and a.lead_media_cleared and not a.is_paid
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
               and s.license_type is not null)
          when 'project' then exists (select 1 from public.public_projects p where p.id = x.ref::bigint)
          when 'region' then exists (
            select 1 from public.regions r
             where r.code = x.ref
               and (r.valid_from is null or r.valid_from <= t.today)
               and (r.valid_to is null or r.valid_to >= t.today))
          else false
        end as ok
      ) v
  ) e
  -- 지역 출발 연결의 범위 (12장 #26) — 시·도 = 자기 + 하위(폐지된 하위 포함), 시·군·구 = 자기
  left join lateral (
    select case when r.level = 'sido'
                then array_prepend(r.code, coalesce((select array_agg(c.code order by c.code) from public.regions c where c.parent_code = r.code), '{}'::text[]))
                else array[r.code] end as codes
      from public.regions r
     where l.from_type = 'region' and r.code = l.from_id
  ) rs on true;

comment on view public.regional_link_status is '지역 연결 판정 (REG1-10) — 연결마다 출발·도착이 지금 공개인지(from_public·to_public), 지역 출발 연결이 그 지역 범위 안인지(in_scope). 렌더 때 계산. 편집 화면·확인 검사용(service_role)';
revoke all on table public.regional_link_status from public, anon, authenticated, service_role;
grant select on table public.regional_link_status to service_role;

-- ─────────────────────────────────────────────────────────────
-- 확인 검사 — 확인(confirmed)으로 넣거나 바꿀 때 도착이 지금 공개이고 지역 범위 안이어야 한다 (판정 뷰와 같은 식 — 한 곳)
-- ─────────────────────────────────────────────────────────────
create function public.regional_links_confirm_check() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to_public boolean;
  v_in_scope boolean;
begin
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    select s.to_public, s.in_scope into v_to_public, v_in_scope from public.regional_link_status s where s.id = new.id;
    if not coalesce(v_to_public, false) then
      raise exception '비공개 목적지(%:%)는 확인하지 않습니다 — 공개 기사·검수 공식 자료·공개 프로젝트·오늘 유효한 지역만 확인합니다 (REG1-10)', new.to_type, new.to_id
        using errcode = 'check_violation';
    end if;
    if not coalesce(v_in_scope, false) then
      raise exception '지역(%)에서 출발하는 연결은 그 지역 범위(시·도 = 자기 + 하위 시·군·구)의 대상만 확인합니다 — 다른 지역 태그 0 (REG1-10)', new.from_id
        using errcode = 'check_violation';
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.regional_links_confirm_check() from public, anon, authenticated;
create trigger regional_links_confirm_check
  after insert or update on public.regional_links
  for each row execute function public.regional_links_confirm_check();

-- ─────────────────────────────────────────────────────────────
-- 공개 뷰 — 확인된 연결 중 두 끝이 모두 지금 공개 · 범위 안 · 지역 끝은 region_hubs 켜짐일 때만 (번호·종류·관계·확인 시각만)
-- ─────────────────────────────────────────────────────────────
create view public.public_regional_links as
select s.id, s.from_type, s.from_id, s.to_type, s.to_id, s.relation, s.confirmed_at
  from public.regional_link_status s
 where s.status = 'confirmed'
   and s.from_public and s.to_public and s.in_scope
   and (s.from_type <> 'region' and s.to_type <> 'region'
        or coalesce((select (f.value -> 'region_hubs') = 'true'::jsonb from public.settings f where f.key = 'feature_flags'), false));

comment on view public.public_regional_links is '공개 지역 연결 (REG1-10 · LG-14) — 확인된 연결 중 출발·도착이 지금 공개인 것만(목적지가 비공개가 되면 다음 읽기부터 0행), 지역 끝은 region_hubs 켜짐일 때만. 후보·지운 연결·이유·확인자·출처 0';
revoke all on table public.public_regional_links from public, anon, authenticated, service_role;
grant select on table public.public_regional_links to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 같은 지역 자동 후보 — 편집 화면의 [같은 지역 후보 찾기]. 공개 대상만, 종류마다 최근 20건까지, 한 번이라도 있었던 쌍은 다시 만들지 않는다
--   프로젝트 → 같은 지역(시·도면 하위 포함) 공개 기사 · 프로젝트 지역 허브
--   기사     → 기사 지역 태그(시·도 태그면 하위 포함)의 공개 프로젝트 · 기사 지역 태그의 지역 허브(오늘 유효)
--   지역     → 그 지역 범위의 공개 프로젝트
-- ─────────────────────────────────────────────────────────────
create function public.regional_link_suggest(p_from_type text, p_from_id text, p_actor text) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_limit constant integer := 20;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_actor text := btrim(coalesce(p_actor, ''));
  v_id text := btrim(coalesce(p_from_id, ''));
  v_region text;
  v_codes text[];
  v_n integer := 0;
  v_rc integer;
begin
  if length(v_actor) = 0 then
    raise exception '후보를 찾는 사람이 필요합니다' using errcode = 'check_violation';
  end if;
  if p_from_type not in ('project', 'article', 'region') then
    raise exception '같은 지역 자동 후보는 프로젝트·기사·지역에서만 찾습니다 (받은 종류 %)', p_from_type using errcode = 'check_violation';
  end if;
  if (p_from_type = 'region' and v_id !~ '^[0-9]{10}$') or (p_from_type <> 'region' and v_id !~ '^[1-9][0-9]{0,17}$') then
    raise exception '번호 모양이 틀립니다 (%:%)', p_from_type, v_id using errcode = 'check_violation';
  end if;

  if p_from_type = 'project' then
    select p.region_code into v_region from public.projects p where p.id = v_id::bigint;
    if v_region is null then
      raise exception '프로젝트 %가 없습니다', v_id using errcode = 'foreign_key_violation';
    end if;
    select case when r.level = 'sido' then array_prepend(r.code, coalesce((select array_agg(c.code) from public.regions c where c.parent_code = r.code), '{}'::text[])) else array[r.code] end
      into v_codes from public.regions r where r.code = v_region;
    insert into public.regional_links (from_type, from_id, to_type, to_id, relation, origin, status, created_by)
    select 'project', v_id, 'article', a.id::text, 'same_region', 'auto_candidate', 'candidate', v_actor
      from public.articles a
     where a.status = 'published' and a.lead_media_cleared and not a.is_paid
       and a.region_codes && v_codes
       and not exists (select 1 from public.regional_links x where x.from_type = 'project' and x.from_id = v_id and x.to_type = 'article' and x.to_id = a.id::text)
     order by a.first_published_at desc nulls last, a.id desc
     limit c_limit;
    get diagnostics v_rc = row_count;
    v_n := v_n + v_rc;
    insert into public.regional_links (from_type, from_id, to_type, to_id, relation, origin, status, created_by)
    select 'project', v_id, 'region', r.code, 'same_region', 'auto_candidate', 'candidate', v_actor
      from public.regions r
     where r.code = v_region
       and (r.valid_from is null or r.valid_from <= v_today) and (r.valid_to is null or r.valid_to >= v_today)
       and not exists (select 1 from public.regional_links x where x.from_type = 'project' and x.from_id = v_id and x.to_type = 'region' and x.to_id = r.code);
    get diagnostics v_rc = row_count;
    v_n := v_n + v_rc;

  elsif p_from_type = 'article' then
    select a.region_codes into v_codes from public.articles a where a.id = v_id::bigint and a.status <> 'deleted';
    if not found then
      raise exception '기사 %가 없습니다', v_id using errcode = 'foreign_key_violation';
    end if;
    v_codes := coalesce(v_codes, '{}'::text[]);
    insert into public.regional_links (from_type, from_id, to_type, to_id, relation, origin, status, created_by)
    select 'article', v_id, 'project', p.id::text, 'same_region', 'auto_candidate', 'candidate', v_actor
      from public.public_projects p
      left join public.regions r on r.code = p.region_code
     where (p.region_code = any (v_codes) or r.parent_code = any (v_codes))
       and not exists (select 1 from public.regional_links x where x.from_type = 'article' and x.from_id = v_id and x.to_type = 'project' and x.to_id = p.id::text)
     order by p.current_stage_notice_date desc nulls last, p.id desc
     limit c_limit;
    get diagnostics v_rc = row_count;
    v_n := v_n + v_rc;
    insert into public.regional_links (from_type, from_id, to_type, to_id, relation, origin, status, created_by)
    select 'article', v_id, 'region', r.code, 'same_region', 'auto_candidate', 'candidate', v_actor
      from public.regions r
     where r.code = any (v_codes)
       and (r.valid_from is null or r.valid_from <= v_today) and (r.valid_to is null or r.valid_to >= v_today)
       and not exists (select 1 from public.regional_links x where x.from_type = 'article' and x.from_id = v_id and x.to_type = 'region' and x.to_id = r.code)
     order by r.code
     limit c_limit;
    get diagnostics v_rc = row_count;
    v_n := v_n + v_rc;

  else -- region
    select case when r.level = 'sido' then array_prepend(r.code, coalesce((select array_agg(c.code) from public.regions c where c.parent_code = r.code), '{}'::text[])) else array[r.code] end
      into v_codes from public.regions r where r.code = v_id;
    if v_codes is null then
      raise exception '지역 %가 없습니다', v_id using errcode = 'foreign_key_violation';
    end if;
    insert into public.regional_links (from_type, from_id, to_type, to_id, relation, origin, status, created_by)
    select 'region', v_id, 'project', p.id::text, 'same_region', 'auto_candidate', 'candidate', v_actor
      from public.public_projects p
     where p.region_code = any (v_codes)
       and not exists (select 1 from public.regional_links x where x.from_type = 'region' and x.from_id = v_id and x.to_type = 'project' and x.to_id = p.id::text)
     order by p.current_stage_notice_date desc nulls last, p.id desc
     limit c_limit;
    get diagnostics v_rc = row_count;
    v_n := v_n + v_rc;
  end if;
  return v_n;
end;
$$;
revoke all on function public.regional_link_suggest(text, text, text) from public, anon, authenticated;
grant execute on function public.regional_link_suggest(text, text, text) to service_role;
