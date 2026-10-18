-- W2-c 5단계 DB — 기사 생산·제휴 준비 대시보드 (NAV-13 · NAV-14, docs/dev/W2-c_설계.md 2.8·3장·8.5)
-- · news_partner_requirements — 공식 규정 버전. 숫자 기준(기사 수·비율·합격선)은 이 표의 요건 칸에만 있다(코드·설정 기본값 0 — NAV-13).
--   · 버전 번호는 플랫폼마다 1부터 트리거가 매긴다(넣은 값은 무시). 확정(confirmed)에는 원문 URL·확인일·등록 유형·적용 시작일·
--     심사 대상 기간·요건 1개 이상·승인자·승인 시각이 모두 있어야 한다(NAV-13 '없는 버전은 확정으로 바꿀 수 없다').
--   · 확정된 버전은 고치거나 지울 수 없다 — 바뀐 규정은 새 버전으로 적는다(NAV-13 '새 버전을 확정해도 이전 버전이 남는다').
--   · 적용 기간: 끝날은 시작일과 같거나 뒤. 새 버전이 앞 버전을 이어받으면(supersedes_id) 같은 플랫폼만.
-- · news_partner_checks — 실사·점검 기록(NAV-01 · NAV-07 · NAV-20 penalty_risk). 추가만(새 판은 supersedes_id 새 행) — 화면은 그 요구사항 단계가 단다.
-- · news_production_facts(p_from, p_to) — 대시보드가 부르는 읽기 함수. 세는 규칙 없이 기간 안에 처음 발행된 기사마다 사실(유형·취재 방식·
--   기획 종류·근거·권리·승인·감수·사람 반응·최근 유사도 점검)과 기간 안 정정·유사도 점검, 기자 이름, 진행 중 기획 수를 JSON 한 값으로 돌려준다.
--   규칙(공식 정의·내부 정의·기간·비교)은 apps/web/lib/readiness/*.ts 한 곳. security invoker·search_path 빈칸, service_role만 실행.
-- · 설정 씨앗 news_readiness_windows — 내부 집계 기간 정의(3·6·12개월, 완결된 달). 기준 숫자가 아니다.
-- 세 표 모두 RLS 기본 거부 — anon·authenticated 읽기 0·쓰기 0(정책·권한 없음, PRD-01A 8.2). 편집 책임자·관리자 화면은 서버가 service_role로 읽는다.

-- ─────────────────────────────────────────────────────────────
-- news_partner_requirements — 공식 규정 버전 (NAV-13)
-- ─────────────────────────────────────────────────────────────
create table public.news_partner_requirements (
  id bigint generated always as identity primary key,
  platform text not null check (platform in ('naver', 'kakao')),
  version integer not null check (version >= 1),                 -- 플랫폼마다 1부터 (트리거가 매긴다)
  title text not null check (length(btrim(title)) between 1 and 100),
  media_type text check (media_type is null or length(btrim(media_type)) between 1 and 60),             -- 매체 등록 유형 (실사로 확인한 우리 매체 유형)
  source_url text check (source_url is null or source_url ~ '^https?://[^[:space:]]+$'),               -- 공식 규정 원문 주소
  source_text_ref text check (source_text_ref is null or length(btrim(source_text_ref)) between 1 and 500), -- 원문 사본 보관 위치·조항
  checked_at date,                                                 -- 원문을 확인한 날 (한국 날짜)
  effective_from date,
  effective_to date,
  review_period jsonb,                                             -- 심사 대상 기간 {months 1~12, basis, text}
  requirements jsonb not null default '[]'::jsonb,                 -- 요건 항목 (분자·분모·제외 정의와 기준 — 설계 2.8)
  status text not null default 'unconfirmed' check (status in ('unconfirmed', 'confirmed')),
  supersedes_id bigint references public.news_partner_requirements (id),
  note text,
  created_by text not null check (length(btrim(created_by)) > 0),  -- user:<uuid> (audit_logs와 같은 형식)
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  unique (platform, version),
  constraint news_partner_requirements_effective_period check (effective_to is null or effective_from is null or effective_to >= effective_from),
  constraint news_partner_requirements_review_period_shape check (
    review_period is null or (
      jsonb_typeof(review_period) = 'object'
      and jsonb_typeof(review_period -> 'months') = 'number'
      and (review_period ->> 'months') ~ '^([1-9]|1[0-2])$'
      and coalesce(review_period ->> 'basis', '') in ('closed_months', 'including_current'))),
  constraint news_partner_requirements_items_array check (jsonb_typeof(requirements) = 'array'),
  constraint news_partner_requirements_approval check ((status = 'confirmed') = (approved_by is not null and approved_at is not null)),
  constraint news_partner_requirements_confirm_ready check (
    status <> 'confirmed' or (
      source_url is not null
      and checked_at is not null
      and media_type is not null
      and effective_from is not null
      and review_period is not null
      and jsonb_array_length(requirements) > 0
      and length(btrim(approved_by)) > 0))
);

comment on table public.news_partner_requirements is '공식 제휴 규정 버전 (NAV-13). 확정 버전은 바꿀 수 없다 — 새 버전으로. 숫자 기준은 이 표의 requirements에만 (코드 상수 0). anon 0행';

create index news_partner_requirements_platform_idx on public.news_partner_requirements (platform, status, version desc);

create function public.news_partner_requirements_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_platform text;
begin
  if tg_op = 'INSERT' then
    -- 버전 번호는 플랫폼마다 차례로 — 겹친 추가는 한 줄로 세운다
    perform pg_advisory_xact_lock(hashtext('public.news_partner_requirements:' || new.platform));
    select coalesce(max(r.version), 0) + 1 into new.version from public.news_partner_requirements r where r.platform = new.platform;
    new.created_at := now();
    new.updated_at := now();
  elsif tg_op = 'UPDATE' then
    if old.status = 'confirmed' then
      raise exception '확정된 규정 버전(% %번)은 고칠 수 없습니다 — 바뀐 규정은 새 버전으로 적으세요 (NAV-13)', old.platform, old.version
        using errcode = 'check_violation';
    end if;
    if new.platform is distinct from old.platform or new.version is distinct from old.version then
      raise exception '규정 버전의 플랫폼·버전 번호는 바꿀 수 없습니다 (NAV-13)'
        using errcode = 'check_violation';
    end if;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
  else
    if old.status = 'confirmed' then
      raise exception '확정된 규정 버전(% %번)은 지울 수 없습니다 — 이전 버전은 남깁니다 (NAV-13)', old.platform, old.version
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if new.supersedes_id is not null then
    select r.platform into v_platform from public.news_partner_requirements r where r.id = new.supersedes_id;
    if v_platform is distinct from new.platform then
      raise exception '이어받는 규정 버전은 같은 플랫폼이어야 합니다 (NAV-13)'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.news_partner_requirements_guard() from public, anon, authenticated;

create trigger news_partner_requirements_guard
  before insert or update or delete on public.news_partner_requirements
  for each row execute function public.news_partner_requirements_guard();

alter table public.news_partner_requirements enable row level security;
revoke all on table public.news_partner_requirements from anon, authenticated, service_role;
grant select, insert, update, delete on table public.news_partner_requirements to service_role;

-- ─────────────────────────────────────────────────────────────
-- news_partner_checks — 실사·점검 기록 (NAV-01 · NAV-07 · NAV-20). 추가만
-- 상태 확인(confirmed)은 근거 문서 위치 필수, 부정평가 위험(penalty_risk)은 점수·일어난 날 필수
-- ─────────────────────────────────────────────────────────────
create table public.news_partner_checks (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('registration', 'existing_partnership', 'transmission_contract', 'document', 'tech', 'security', 'mock_review', 'penalty_risk')),
  item text not null check (length(btrim(item)) between 1 and 200),
  status text not null check (status in ('confirmed', 'unconfirmed', 'not_applicable')),  -- 확인 · 미확인 · 해당 없음
  evidence_ref text,                                               -- 근거 문서 위치
  points numeric check (points is null or points >= 0),            -- 부정평가 점수 (penalty_risk)
  occurred_at timestamptz,
  checked_by text not null check (length(btrim(checked_by)) > 0),
  checked_at timestamptz not null default now(),
  requirement_id bigint references public.news_partner_requirements (id),  -- 적용 규정 버전 (PRD requirement_version)
  supersedes_id bigint references public.news_partner_checks (id),
  constraint news_partner_checks_confirmed_evidence check (status <> 'confirmed' or length(btrim(coalesce(evidence_ref, ''))) > 0),
  constraint news_partner_checks_penalty check (kind <> 'penalty_risk' or (points is not null and occurred_at is not null))
);

comment on table public.news_partner_checks is '제휴 실사·점검 기록 (NAV-01 · NAV-07 · NAV-20 penalty_risk) — 추가만, 새 판은 supersedes_id 새 행. anon 0행';

create index news_partner_checks_kind_idx on public.news_partner_checks (kind, checked_at desc);

create trigger news_partner_checks_no_update_delete
  before update or delete on public.news_partner_checks
  for each row execute function public.append_only_guard();

create trigger news_partner_checks_no_truncate
  before truncate on public.news_partner_checks
  for each statement execute function public.append_only_guard();

alter table public.news_partner_checks enable row level security;
revoke all on table public.news_partner_checks from anon, authenticated, service_role;
grant select, insert on table public.news_partner_checks to service_role;

-- ─────────────────────────────────────────────────────────────
-- news_production_facts — 기사 생산 대시보드 읽기 (NAV-14). 규칙 없이 사실만 모은다
-- ─────────────────────────────────────────────────────────────
create function public.news_production_facts(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception '기간이 틀렸습니다 (p_from < p_to)';
  end if;
  if p_to - p_from > interval '800 days' then
    raise exception '기간은 800일까지 읽습니다';
  end if;

  with arts as (
    select a.id, a.slug, a.title, a.section, a.content_type, a.reporting_method, a.origin, a.status, a.label, a.author_id,
      a.first_published_at, a.editorial_status, a.tax_review_status, sa.kind as assignment_kind, a.lead_media_id, a.body_media_ids
    from public.articles a
    left join public.story_assignments sa on sa.id = a.story_assignment_id
    where a.first_published_at >= p_from and a.first_published_at < p_to
  ),
  evidence as (
    select e.article_id,
      count(*)::int as total,
      count(*) filter (where e.verification_status = 'verified')::int as verified,
      count(*) filter (where e.rights_status = 'unconfirmed')::int as rights_unconfirmed
    from public.article_evidence e
    join arts on arts.id = e.article_id
    group by e.article_id
  ),
  media_refs as (
    select arts.id as article_id, arts.lead_media_id::text as mid from arts where arts.lead_media_id is not null
    union
    select arts.id, x.mid
    from arts
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(arts.body_media_ids) = 'array' then arts.body_media_ids else '[]'::jsonb end) as x(mid)
  ),
  media_rights as (
    select r.article_id, count(*) filter (where m.id is null or m.rights_status <> 'confirmed')::int as unconfirmed
    from media_refs r
    left join public.media m on m.id::text = r.mid
    group by r.article_id
  ),
  stats as (
    select s.article_id, sum(s.views_human)::bigint as views_human, sum(s.engaged_views)::bigint as engaged_views, sum(s.shares)::bigint as shares
    from public.article_stats s
    join arts on arts.id = s.article_id
    group by s.article_id
  ),
  last_check as (
    select distinct on (c.target_id) c.target_id, c.similarity ->> 'status' as status
    from public.seo_checks c
    join arts on c.target_type = 'article' and c.target_id = arts.id::text
    order by c.target_id, c.checked_at desc, c.id desc
  ),
  people_ids as (
    select arts.author_id as id from arts where arts.author_id is not null
    union
    select sa.reporter_id from public.story_assignments sa
    where sa.reporter_id is not null and sa.status in ('assigned', 'reporting', 'fact_check', 'review')
  )
  select jsonb_build_object(
    'articles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'slug', a.slug, 'title', a.title, 'section', a.section, 'content_type', a.content_type,
        'reporting_method', a.reporting_method, 'origin', a.origin, 'status', a.status, 'label', a.label, 'author_id', a.author_id,
        'published_at', a.first_published_at, 'assignment_kind', a.assignment_kind,
        'editorial_status', a.editorial_status, 'tax_review_status', a.tax_review_status,
        'evidence_total', coalesce(e.total, 0), 'evidence_verified', coalesce(e.verified, 0), 'evidence_rights_unconfirmed', coalesce(e.rights_unconfirmed, 0),
        'media_unconfirmed', coalesce(mr.unconfirmed, 0),
        'views_human', coalesce(st.views_human, 0), 'engaged_views', coalesce(st.engaged_views, 0), 'shares', coalesce(st.shares, 0),
        'last_similarity', lc.status
      ) order by a.first_published_at, a.id)
      from arts a
      left join evidence e on e.article_id = a.id
      left join media_rights mr on mr.article_id = a.id
      left join stats st on st.article_id = a.id
      left join last_check lc on lc.target_id = a.id::text), '[]'::jsonb),
    'corrections', coalesce((
      select jsonb_agg(jsonb_build_object('article_id', c.article_id, 'kind', c.kind, 'at', c.created_at) order by c.created_at, c.id)
      from public.article_corrections c
      where c.created_at >= p_from and c.created_at < p_to), '[]'::jsonb),
    'similarity_checks', coalesce((
      select jsonb_agg(jsonb_build_object('article_id', c.target_id::bigint, 'status', c.similarity ->> 'status', 'at', c.checked_at) order by c.checked_at, c.id)
      from public.seo_checks c
      where c.target_type = 'article' and c.target_id ~ '^[0-9]{1,15}$' and c.similarity is not null
        and c.checked_at >= p_from and c.checked_at < p_to), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'roles', to_jsonb(p.roles), 'employment', p.employment) order by p.id)
      from public.people p
      where p.id in (select people_ids.id from people_ids)), '[]'::jsonb),
    'open_assignments', coalesce((
      select jsonb_agg(jsonb_build_object('reporter_id', t.reporter_id, 'count', t.n) order by t.reporter_id)
      from (
        select sa.reporter_id, count(*)::int as n
        from public.story_assignments sa
        where sa.reporter_id is not null and sa.status in ('assigned', 'reporting', 'fact_check', 'review')
        group by sa.reporter_id) t), '[]'::jsonb))
  into v_result;
  return v_result;
end;
$$;

revoke all on function public.news_production_facts(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.news_production_facts(timestamptz, timestamptz) to service_role;

comment on function public.news_production_facts(timestamptz, timestamptz) is
  '기사 생산 대시보드(NAV-14) 읽기 — 기간 안에 처음 발행된 기사의 사실·기간 안 정정·유사도 점검·기자·진행 중 기획. 규칙은 apps/web/lib/readiness. service_role만';

-- ─────────────────────────────────────────────────────────────
-- 내부 집계 기간 정의 (설계 2.8 — 시험 tests/w2c-readiness.test.mjs가 설계 문서의 값과 대조한다). 기준 숫자가 아니다
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value, description, updated_by) values
  ('news_readiness_windows',
   '{"version":"2026-10-18.1","months":[3,6,12],"basis":"closed_months"}'::jsonb,
   '기사 생산 대시보드 내부 집계 기간 (NAV-14) — months 기간 길이(개월) 목록, basis closed_months(지난달까지 완결된 달)·including_current(이번 달 오늘까지 포함). 기준 숫자는 규정 버전에만',
   'migration:20261018000018');
