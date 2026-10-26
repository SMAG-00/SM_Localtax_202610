-- W11-e e1 - 자치법규 tier·조례 연결·요약 숫자 검사 (PRD-03 RDV-06 · TX-13, docs/dev/W11-e_설계.md e1)
-- 이 파일에 실제 조례 문장, 감면율·세율·기한 값은 없다 - 표와 규칙만. 원문은 원문 DB(laws·law_versions·law_articles)에 한 번만 두고
-- ordinance_links는 연결·요약만 갖는다(이중 저장 금지). 조례 내용을 룰셋에 반영하는 외래키·함수·트리거는 없다(룰셋 자동 반영 0).
-- · laws.tier 에 ordinance 를 더하고 laws.region_code 칸을 더한다 - tier = ordinance 일 때만 지역 코드가 있다. 법령 뷰어(public_laws)에는 조례를 싣지 않는다.
-- · data_sources 에 ordinance_api 1행(unchecked - 이용 조건 확인 전 수집 요청 0, 편집자 수동 등록 경로만).
-- · ordinance_links - 지역·종류·조례(laws)·개정판(law_versions)·요약·서명·시행일·확인일·출처. 공개는 출처·시행일·확인일이 모두 있어야 한다.
-- · 요약의 숫자는 원문(개정판 조문) 숫자 집합에 모두 있어야 저장된다 (ordinance_summary_numbers_ok + 트리거).
-- · 공개 뷰 public_ordinance_links(요약은 서명된 것만) · public_ordinance_articles(원문 상자) - 기능 키 ordinance_texts 꺼짐이면 0행.
-- 기존 표·칸·제약 값은 바꾸지 않고 더하기만 한다 (tier 제약은 값만 늘린 같은 이름 제약으로 바꾼다).

alter table public.laws drop constraint laws_tier_check;
alter table public.laws add constraint laws_tier_check check (tier in ('statute', 'decree', 'rule', 'ordinance'));
alter table public.laws add column region_code text references public.regions (code);
alter table public.laws add constraint laws_ordinance_region check ((tier = 'ordinance') = (region_code is not null));
comment on column public.laws.region_code is '자치법규(tier ordinance)의 지역 코드 - 시·도 또는 시·군·구. 그 밖의 tier는 비어 있다 (W11-e)';

-- 법령 뷰어는 조례를 싣지 않는다 (같은 칸, 조건 하나 추가)
create or replace view public.public_laws as
select l.id, l.name, l.tier, l.scope
  from public.laws l
 where l.watch
   and l.tier <> 'ordinance'
   and exists (select 1 from public.law_versions v where v.law_id = l.id)
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'law_viewer') = 'true'::jsonb);

insert into public.data_sources (key, name, kind, api_target, priority) values
  ('ordinance_api', '국가법령정보 자치법규', 'law', 'ordin', 'p1')
on conflict (key) do nothing;

-- 확인일 경과 일수(한국 날짜 차) - 경고 판정은 일수 > 한도, 90일째 경고 없음 91일째 경고
create function public.stale_days(p_verified timestamptz, p_now timestamptz default now()) returns integer
language sql
immutable
set search_path = ''
as $$
  select case when p_verified is null then null
         else ((p_now at time zone 'Asia/Seoul')::date - (p_verified at time zone 'Asia/Seoul')::date) end;
$$;
revoke all on function public.stale_days(timestamptz, timestamptz) from public, anon, authenticated;
-- 이 함수는 service_role(작업·시험)만 부른다. 공개 뷰는 같은 계산을 식으로 풀어 쓴다(뷰 안의 함수 호출은 읽는 쪽 anon 권한으로 검사된다)
grant execute on function public.stale_days(timestamptz, timestamptz) to service_role;

-- 경고 한도(일) - 설정 stale_check_policy 의 키(zone_days·ordinance_days). 없거나 숫자가 아니면 null(경고 계산 0)
create function public.stale_limit_days(p_key text) returns integer
language sql
stable
set search_path = ''
as $$
  select case when jsonb_typeof(s.value -> p_key) = 'number' and (s.value ->> p_key) ~ '^[0-9]+$' then (s.value ->> p_key)::integer end
    from public.settings s where s.key = 'stale_check_policy';
$$;
revoke all on function public.stale_limit_days(text) from public, anon, authenticated;
grant execute on function public.stale_limit_days(text) to service_role;

-- 요약의 숫자(천 단위 쉼표 제거, 정수·소수 토큰)가 원문 숫자 토큰 집합에 모두 있는가 - 부분 문자열이 아니라 토큰 일치
create function public.ordinance_summary_numbers_ok(p_summary text, p_source text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (
    select 1
      from regexp_matches(regexp_replace(coalesce(p_summary, ''), '(?<=[0-9]),(?=[0-9]{3})', '', 'g'), '[0-9]+(?:\.[0-9]+)?', 'g') as m(t)
     where not exists (
       select 1
         from regexp_matches(regexp_replace(coalesce(p_source, ''), '(?<=[0-9]),(?=[0-9]{3})', '', 'g'), '[0-9]+(?:\.[0-9]+)?', 'g') as s(t)
        where s.t[1] = m.t[1]));
$$;
revoke all on function public.ordinance_summary_numbers_ok(text, text) from public, anon, authenticated;
grant execute on function public.ordinance_summary_numbers_ok(text, text) to service_role;

create table public.ordinance_links (
  id bigint generated always as identity primary key,
  region_code text not null references public.regions (code),
  kind text not null check (kind in ('urban_redevelopment', 'tax_reduction', 'tax_rate')),
  law_id bigint not null references public.laws (id),
  version_id bigint not null references public.law_versions (id),
  summary text check (summary is null or length(btrim(summary)) > 0),
  summary_signed_by text,
  summary_signed_at timestamptz,
  effective_from date,
  verified_at timestamptz,
  source_url text,
  origin text not null default 'editor' check (origin in ('collector', 'editor')),
  status text not null default 'draft' check (status in ('draft', 'public', 'hidden')),
  registered_by text not null check (length(btrim(registered_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ordinance_links_once unique (region_code, kind, law_id),
  constraint ordinance_links_source_url check (source_url is null or source_url ~* '^https?://[^[:space:]]+$'),
  constraint ordinance_links_sign_pair check ((summary_signed_by is null) = (summary_signed_at is null)),
  constraint ordinance_links_sign_needs_summary check (summary_signed_by is null or summary is not null),
  constraint ordinance_links_public_evidence check (
    status <> 'public' or (source_url is not null and effective_from is not null and verified_at is not null))
);

comment on table public.ordinance_links is '조례 연결 (RDV-06 · TX-13) - 원문은 laws·law_versions·law_articles 한 곳, 여기는 연결·요약만. 요약 숫자가 원문에 없으면 저장 거부, 출처·시행일·확인일 없으면 공개 거부. 룰셋 반영 칸·함수 없음';
comment on column public.ordinance_links.summary is '편집 요약 - 숫자는 원문 개정판 조문에 있는 것만 (트리거). 서명 전에는 공개 뷰에 나가지 않는다';

create function public.ordinance_links_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_law public.laws%rowtype;
  v_ver public.law_versions%rowtype;
  v_level text;
  v_source text;
begin
  select * into v_law from public.laws where id = new.law_id;
  if v_law.tier is distinct from 'ordinance' then
    raise exception 'ordinance_link_not_ordinance' using errcode = '23514';
  end if;
  if v_law.region_code is distinct from new.region_code then
    raise exception 'ordinance_link_region_mismatch' using errcode = '23514';
  end if;
  select * into v_ver from public.law_versions where id = new.version_id;
  if v_ver.law_id is distinct from new.law_id then
    raise exception 'ordinance_link_version_mismatch' using errcode = '23514';
  end if;
  select r.level into v_level from public.regions r where r.code = new.region_code;
  if (new.kind = 'urban_redevelopment') <> (v_level = 'sido') then
    raise exception 'ordinance_link_kind_level' using errcode = '23514';
  end if;

  if new.summary is not null then
    select string_agg(a.body, ' ' order by a.article_no, a.branch_no) into v_source from public.law_articles a where a.version_id = new.version_id;
    if not public.ordinance_summary_numbers_ok(new.summary, coalesce(v_source, '')) then
      raise exception 'ordinance_summary_number_mismatch' using errcode = '23514';
    end if;
  end if;

  -- 요약이 바뀌거나 새 개정판으로 옮기면 이전 서명은 무효 (같은 갱신에서 새로 서명한 경우는 그대로)
  if tg_op = 'UPDATE'
     and (new.summary is distinct from old.summary or new.version_id is distinct from old.version_id)
     and new.summary_signed_by is not distinct from old.summary_signed_by
     and new.summary_signed_at is not distinct from old.summary_signed_at then
    new.summary_signed_by := null;
    new.summary_signed_at := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.ordinance_links_guard() from public, anon, authenticated;

create trigger ordinance_links_guard before insert or update on public.ordinance_links
  for each row execute function public.ordinance_links_guard();

alter table public.ordinance_links enable row level security;
revoke all on table public.ordinance_links from anon, authenticated, service_role;
grant select, insert, update on table public.ordinance_links to service_role;

-- 공개 뷰 - 기능 키 ordinance_texts 켜짐 + 공개 + 출처·시행일·확인일. 수집기가 넣은 연결은 원천 이용 조건이 allowed 일 때만. 요약은 서명된 것만.
create view public.public_ordinance_links as
select o.id, o.region_code, r.level as region_level, r.name as region_name, o.kind,
       l.name as ordinance_name, o.version_id, o.effective_from, o.verified_at, o.source_url,
       case when o.summary_signed_at is not null then o.summary end as summary,
       (o.summary_signed_at is not null) as summary_signed,
       o.summary_signed_at,
       -- 함수 호출은 읽는 쪽(anon) 권한으로 검사되어 막히므로(42501) 같은 계산을 식으로 풀어 쓴다 (stale_days·stale_limit_days 와 같은 뜻)
       coalesce(((now() at time zone 'Asia/Seoul')::date - (o.verified_at at time zone 'Asia/Seoul')::date)
        > (select (s.value ->> 'ordinance_days')::integer from public.settings s
            where s.key = 'stale_check_policy' and jsonb_typeof(s.value -> 'ordinance_days') = 'number' and (s.value ->> 'ordinance_days') ~ '^[0-9]+$'), false) as stale
  from public.ordinance_links o
  join public.laws l on l.id = o.law_id
  join public.regions r on r.code = o.region_code
 where o.status = 'public'
   and o.source_url is not null and o.effective_from is not null and o.verified_at is not null
   and (o.origin = 'editor' or coalesce((select s.terms_status = 'allowed' from public.data_sources s where s.key = 'ordinance_api'), false))
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'ordinance_texts') = 'true'::jsonb);

comment on view public.public_ordinance_links is '공개 조례 연결 - 서명된 요약만, 출처·시행일·확인일 없는 연결 0, 기능 키 꺼짐이면 0행. 편집 메모·등록자 칸 0';

create view public.public_ordinance_articles as
select p.id as link_id, a.article_no, a.branch_no, a.title, a.body
  from public.public_ordinance_links p
  join public.law_articles a on a.version_id = p.version_id;

comment on view public.public_ordinance_articles is '조례 원문 상자 - 원문 DB의 조문 글자 그대로 (편집 요약과 다른 상자)';

revoke all on table public.public_ordinance_links, public.public_ordinance_articles from public, anon, authenticated, service_role;
grant select on table public.public_ordinance_links, public.public_ordinance_articles to anon, authenticated, service_role;
