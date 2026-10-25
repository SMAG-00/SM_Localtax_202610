-- W11-f 3단계 — 프리미엄 리포트 · 유료 본문 종류 premium_report · 미리보기 공개 뷰 (PRD-03 BIZ-07)
-- 이 파일에 리포트 본문·미리보기·출처 글자는 없다 (편집국 작성 + 세무 감수 + 편집 승인 - 빈 칸). 표 틀·검사·읽기 함수만 정한다.
-- · 본문은 W10-f의 paid_bodies(anon·authenticated 권한 0)에 둔다. 읽기는 read_premium_report 하나, 권한 판정은 has_entitlement(premium_report).
-- · 개인 디지털 구독(digital)으로는 리포트 본문이 나가지 않는다 - read_paid_body와 공개 미리보기 뷰에서 premium_report 종류를 뺀다.
-- · 발행(published)은 기준일·출처 1건 이상·세무 감수 서명·편집 승인·법률(자본시장법) 검토 기록이 모두 있어야 DB가 받는다.

-- 설정 모양 검사 - premium_report_policy { preview_max_chars: 50~400 }, 비어 있으면 리포트 공개 0
create function public.premium_report_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(new.value) is distinct from 'object'
     or exists (select 1 from jsonb_object_keys(new.value) k where k <> 'preview_max_chars')
     or (new.value ? 'preview_max_chars' and (jsonb_typeof(new.value -> 'preview_max_chars') is distinct from 'number'
          or (new.value ->> 'preview_max_chars') !~ '^[0-9]+$' or (new.value ->> 'preview_max_chars')::int not between 50 and 400)) then
    raise exception '프리미엄 리포트 설정(premium_report_policy)은 { preview_max_chars: 50~400 정수 }이거나 빈 객체(리포트 공개 0)입니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.premium_report_settings_guard() from public, anon, authenticated;
create trigger settings_premium_report_settings_guard
  before insert or update on public.settings
  for each row when (new.key = 'premium_report_policy')
  execute function public.premium_report_settings_guard();

create table public.premium_reports (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  period_label text not null check (period_label ~ '^[0-9]{4}-Q[1-4]$'),
  as_of date,
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array'),
  status text not null default 'draft' check (status in ('draft', 'review', 'published')),
  tax_reviewer text check (tax_reviewer is null or char_length(btrim(tax_reviewer)) between 1 and 80),
  tax_reviewed_on date,
  editor_approved_by text check (editor_approved_by is null or char_length(btrim(editor_approved_by)) between 1 and 80),
  editor_approved_on date,
  legal_review_ref text check (legal_review_ref is null or char_length(btrim(legal_review_ref)) between 1 and 200),
  published_at timestamptz,
  edited_by text not null check (char_length(btrim(edited_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_label, title),
  constraint premium_reports_publish_record check (
    status <> 'published' or (
      as_of is not null and jsonb_array_length(sources) >= 1
      and tax_reviewer is not null and tax_reviewed_on is not null
      and editor_approved_by is not null and editor_approved_on is not null
      and legal_review_ref is not null and published_at is not null))
);
comment on table public.premium_reports is '프리미엄 리포트 메타 (BIZ-07) - 본문은 paid_bodies(kind premium_report, ref_key = slug). 기준일·출처 목록·감수 서명·편집 승인·법률 검토 기록 없이는 published 불가. anon·authenticated 0';

create function public.premium_reports_touch() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.premium_reports_touch() from public, anon, authenticated;
create trigger premium_reports_touch before update on public.premium_reports for each row execute function public.premium_reports_touch();

-- paid_bodies 종류 확장 + 리포트 가드 (미리보기 길이는 설정 premium_report_policy 이하)
alter table public.paid_bodies drop constraint paid_bodies_kind_check;
alter table public.paid_bodies add constraint paid_bodies_kind_check check (kind in ('article', 'brief', 'interpretation', 'premium_report'));

create function public.paid_bodies_report_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_max integer;
begin
  if new.kind <> 'premium_report' then return new; end if;
  if not exists (select 1 from public.premium_reports r where r.slug = new.ref_key) then
    raise exception '리포트 본문은 premium_reports에 있는 slug로만 둘 수 있습니다' using errcode = 'check_violation';
  end if;
  select (s.value ->> 'preview_max_chars')::int into v_max from public.settings s where s.key = 'premium_report_policy' and s.value ? 'preview_max_chars';
  if v_max is null then
    raise exception '미리보기 길이 설정(premium_report_policy)이 비어 있어 리포트 본문을 저장할 수 없습니다' using errcode = 'check_violation';
  end if;
  if char_length(new.preview) > v_max then
    raise exception '리포트 미리보기는 설정 길이(%자) 이하여야 합니다', v_max using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.paid_bodies_report_guard() from public, anon, authenticated;
create trigger paid_bodies_report_guard before insert or update on public.paid_bodies for each row execute function public.paid_bodies_report_guard();

alter table public.premium_reports enable row level security;
revoke all on table public.premium_reports from public, anon, authenticated, service_role;
grant select, insert, update on table public.premium_reports to service_role;

-- 개인 구독 경로에서 리포트 본문 제외 (read_paid_body·공개 뷰 둘 다 premium_report 종류를 건너뛴다)
create or replace function public.read_paid_body(p_user uuid, p_kind text, p_ref text, p_at timestamptz default now()) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select b.body
    from public.paid_bodies b
   where b.kind = p_kind and b.ref_key = p_ref and b.sale_allowed and b.kind <> 'premium_report'
     and p_user is not null and public.has_entitlement(p_user, 'digital', p_at);
$$;

create or replace view public.public_paid_previews as
select b.kind, b.ref_key, b.article_id,
       coalesce(b.title, a.title) as title,
       a.slug as article_slug, a.section as article_section, a.first_published_at,
       b.preview
  from public.paid_bodies b
  left join public.articles a on a.id = b.article_id
 where b.sale_allowed and b.kind <> 'premium_report'
   and (b.kind <> 'article' or (a.status = 'published' and a.is_paid))
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'paywall') = 'true'::jsonb);

create or replace view public.public_digital_plans as
select pl.id as plan_id, pl.plan_key, pl.title as plan_title, pl.period_months, pl.amount, pl.currency, pl.sort_order,
       p.id as product_id, p.slug, p.title as product_title, p.summary
  from public.product_plans pl
  join public.products p on p.id = pl.product_id
 where pl.status = 'active' and p.status = 'on_sale' and p.kind = 'digital_subscription' and p.billing_mode = 'pg'
   and p.verified_on is not null and char_length(btrim(coalesce(p.verified_ref, ''))) > 0
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object'
                and (f.value -> 'billing') = 'true'::jsonb and (f.value -> 'digital_subscription') = 'true'::jsonb)
   and exists (select 1 from public.paid_bodies b where b.sale_allowed and b.kind <> 'premium_report');

-- 리포트 본문 읽기 - 발행됨 + 판매 권리 확인 + has_entitlement(premium_report). 개인 구독(digital)으로는 null
create function public.read_premium_report(p_user uuid, p_slug text, p_at timestamptz default now()) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select b.body
    from public.paid_bodies b
    join public.premium_reports r on r.slug = b.ref_key and r.status = 'published'
   where b.kind = 'premium_report' and b.ref_key = p_slug and b.sale_allowed
     and p_user is not null and public.has_entitlement(p_user, 'premium_report', p_at);
$$;
comment on function public.read_premium_report(uuid, text, timestamptz) is '리포트 본문 반환 - 서버(service_role)만 부른다. 회원 번호는 서버가 세션에서 정한 값(클라이언트 값 아님)';
revoke all on function public.read_premium_report(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.read_premium_report(uuid, text, timestamptz) to service_role;

-- 공개 미리보기 - 기능 키 premium_reports 켜짐 + 정책 길이 설정 + 발행됨 + 판매 권리 확인. 본문 칸 없음, 길이는 정책 이하만
create view public.public_premium_report_previews as
select r.slug, r.title, r.period_label, r.as_of, r.sources, r.tax_reviewer, r.tax_reviewed_on, r.published_at, b.preview
  from public.premium_reports r
  join public.paid_bodies b on b.kind = 'premium_report' and b.ref_key = r.slug
 where r.status = 'published' and b.sale_allowed
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'premium_reports') = 'true'::jsonb)
   and exists (select 1 from public.settings p where p.key = 'premium_report_policy' and p.value ? 'preview_max_chars'
                and char_length(b.preview) <= (p.value ->> 'preview_max_chars')::int);
revoke all on table public.public_premium_report_previews from public, anon, authenticated, service_role;
grant select on table public.public_premium_report_previews to anon, authenticated, service_role;
