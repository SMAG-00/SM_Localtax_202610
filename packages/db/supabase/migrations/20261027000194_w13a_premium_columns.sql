-- W13-a a6 - 프리미엄 칼럼 틀 (PRD-05 LIB-07, 5단계 설계 5장 #7·#9)
-- 이 파일에 칼럼 글·계약 금액·약관 문구는 없다.
-- · 칼럼 본문 표 = paid_bodies에 kind 'column'을 더한다 (새 판매 표 0 - 직접 권한 0 방식 그대로). ref_key = 기사 번호 문자열.
--   프리미엄 칼럼의 기사 행(articles)에는 본문·요약을 두지 않는다(본문 [] · 요약 없음) - 기사 주소 쪽으로 전문이 새는 길 0. 전문은 paid_bodies, 읽기는 column_read(미리보기 절단은 library_preview_cut 하나).
-- · 필자 표는 people (설계의 authors). 계약 칸은 상태와 종료일뿐, 금액 칸 없음. 계약 종료일 다음 날부터 발행 불가.
-- · 발행 가드는 articles 트리거 - 직접 SQL로도 우회할 수 없다. 프리미엄 칼럼은 opinion(칼럼) 유형이고 뉴스 전송 후보(nav_candidate)가 아니다.
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다 (paid_bodies의 kind 제약·형태 제약·공개 미리보기 뷰는 값만 늘린 같은 이름으로 바꾼다).

-- ── 필자 계약 칸 (people) ─────────────────────────────────────
alter table public.people
  add column contract_status text not null default 'none' check (contract_status in ('none', 'active', 'ended')),
  add column contract_until date,
  add constraint people_contract_shape check (contract_status <> 'active' or contract_until is not null);
comment on column public.people.contract_status is '프리미엄 칼럼 필자 계약 상태 (LIB-07) - 금액 칸 없음. active + 종료일이 있어야 발행 가능';

-- ── 시리즈 ────────────────────────────────────────────────────
create table public.column_series (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  status text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.column_series is '프리미엄 칼럼 시리즈 (LIB-07) - 직접 읽기 0, 공개는 public_library_columns 뷰';
create trigger column_series_touch before update on public.column_series for each row execute function public.touch_updated_at();
alter table public.column_series enable row level security;
revoke all on table public.column_series from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.column_series to service_role;

-- ── 기사 칸 ───────────────────────────────────────────────────
alter table public.articles
  add column access_tier text not null default 'public' check (access_tier in ('public', 'premium')),
  add column series_id bigint references public.column_series (id),
  add column series_no int check (series_no is null or series_no >= 1),
  add constraint articles_premium_shape check (
    access_tier = 'public'
    or (content_type = 'opinion' and nav_candidate = false and is_paid and body = '[]'::jsonb and summary is null)),
  add constraint articles_series_premium check (series_id is null or access_tier = 'premium'),
  add constraint articles_column_series_pair check ((series_id is null) = (series_no is null));
comment on column public.articles.access_tier is '접근 등급 (LIB-07) - premium = 구독자 전용 칼럼. 본문·요약은 이 표에 두지 않고 paid_bodies(kind column)에 둔다';
create unique index articles_series_no_once on public.articles (series_id, series_no) where series_id is not null;

-- ── paid_bodies kind 확장 ─────────────────────────────────────
alter table public.paid_bodies drop constraint paid_bodies_kind_check;
alter table public.paid_bodies add constraint paid_bodies_kind_check check (kind in ('article', 'brief', 'interpretation', 'premium_report', 'column'));
alter table public.paid_bodies drop constraint paid_bodies_article_shape;
alter table public.paid_bodies add constraint paid_bodies_article_shape check ((kind in ('article', 'column')) = (article_id is not null));
alter table public.paid_bodies drop constraint paid_bodies_title_for_non_article;
alter table public.paid_bodies add constraint paid_bodies_title_for_non_article check (kind in ('article', 'column') or title is not null);
alter table public.paid_bodies add constraint paid_bodies_column_ref check (kind <> 'column' or ref_key = article_id::text);

create or replace function public.paid_bodies_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.kind in ('article', 'column') and not exists (select 1 from public.articles a where a.id = new.article_id and a.is_paid) then
    raise exception '유료 본문은 유료로 표시된(is_paid) 기사에만 연결할 수 있습니다' using errcode = 'check_violation';
  end if;
  if new.kind = 'column' and not exists (select 1 from public.articles a where a.id = new.article_id and a.access_tier = 'premium') then
    raise exception '칼럼 본문은 프리미엄 등급 기사에만 연결할 수 있습니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- 공개 미리보기 뷰: 칼럼은 제외한다 (미리보기 길이는 library_preview 설정 하나가 정하고, 저장된 미리보기 칸을 공개하지 않는다).
create or replace view public.public_paid_previews as
select b.kind, b.ref_key, b.article_id,
       coalesce(b.title, a.title) as title,
       a.slug as article_slug, a.section as article_section, a.first_published_at,
       b.preview
  from public.paid_bodies b
  left join public.articles a on a.id = b.article_id
 where b.sale_allowed
   and b.kind not in ('column', 'premium_report')
   and (b.kind <> 'article' or (a.status = 'published' and a.is_paid))
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'paywall') = 'true'::jsonb);

-- ── 발행 가능 판정 (LIB-07) ───────────────────────────────────
create function public.column_publish_check(p_article bigint, p_today date default ((now() at time zone 'Asia/Seoul')::date)) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare a record; p record;
begin
  select * into a from public.articles where id = p_article;
  if not found then return jsonb_build_object('ok', false, 'code', 'no_article'); end if;
  if a.access_tier <> 'premium' then return jsonb_build_object('ok', false, 'code', 'not_premium'); end if;
  if a.author_id is null then return jsonb_build_object('ok', false, 'code', 'no_author'); end if;
  select * into p from public.people where id = a.author_id;
  if p.contract_status <> 'active' then return jsonb_build_object('ok', false, 'code', 'contract_none'); end if;
  if p.contract_until is null or p_today > p.contract_until then return jsonb_build_object('ok', false, 'code', 'contract_ended'); end if;
  if not exists (select 1 from public.paid_bodies b where b.kind = 'column' and b.article_id = a.id and b.sale_allowed) then
    return jsonb_build_object('ok', false, 'code', 'no_body');
  end if;
  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;
revoke all on function public.column_publish_check(bigint, date) from public, anon, authenticated;
grant execute on function public.column_publish_check(bigint, date) to service_role;

create function public.articles_premium_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r jsonb;
begin
  if tg_op = 'UPDATE' and old.status = 'published' and new.access_tier is distinct from old.access_tier then
    raise exception '발행된 기사의 접근 등급은 바꿀 수 없습니다' using errcode = 'check_violation';
  end if;
  if new.access_tier = 'premium' and new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    r := public.column_publish_check(new.id);
    if tg_op = 'INSERT' then
      raise exception '프리미엄 칼럼은 초안으로 먼저 만들어야 합니다' using errcode = 'check_violation';
    end if;
    if r ->> 'ok' <> 'true' then
      raise exception '프리미엄 칼럼을 발행할 수 없습니다 (%)', r ->> 'code' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.articles_premium_guard() from public, anon, authenticated;
create trigger articles_premium_guard before insert or update on public.articles for each row execute function public.articles_premium_guard();

-- ── 칼럼 읽기 (서버 전용) ─────────────────────────────────────
create function public.column_read(p_user uuid, p_article bigint, p_at timestamptz default now()) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_title text; v_body text; v_entitled boolean;
begin
  if not exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'library_premium') = 'true'::jsonb) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select a.title, b.body into v_title, v_body
    from public.articles a join public.paid_bodies b on b.kind = 'column' and b.article_id = a.id and b.sale_allowed
   where a.id = p_article and a.access_tier = 'premium' and a.status = 'published';
  if v_title is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  v_entitled := p_user is not null and public.has_entitlement(p_user, 'library', p_at);
  if v_entitled then
    return jsonb_build_object('ok', true, 'code', 'ok', 'title', v_title, 'tier', 'premium', 'full', true, 'text', v_body);
  end if;
  return jsonb_build_object('ok', true, 'code', 'ok', 'title', v_title, 'tier', 'premium', 'full', false, 'text', public.library_preview_cut(v_body),
    'locked', true, 'reason', case when p_user is null then 'login' else 'subscribe' end);
end;
$$;
comment on function public.column_read(uuid, bigint, timestamptz) is '프리미엄 칼럼 절단 읽기 - 서버(service_role)만 부른다. 비구독자는 설정 길이 미리보기만';
revoke all on function public.column_read(uuid, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.column_read(uuid, bigint, timestamptz) to service_role;

-- ── 공개 뷰: 칼럼 목록 (본문·요약 칸 없음) ────────────────────
create view public.public_library_columns as
select a.id, a.slug, a.title, a.author_id as author_person_id, a.series_id, s.title as series_title, a.series_no, a.first_published_at
  from public.articles a
  left join public.column_series s on s.id = a.series_id
 where a.access_tier = 'premium' and a.status = 'published'
   and exists (select 1 from public.paid_bodies b where b.kind = 'column' and b.article_id = a.id and b.sale_allowed)
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'library_premium') = 'true'::jsonb);
revoke all on table public.public_library_columns from public, anon, authenticated, service_role;
grant select on table public.public_library_columns to anon, authenticated, service_role;
