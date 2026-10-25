-- W10-f 4단계 — 유료 본문 분리 · 미리보기 공개 뷰 · 본문 읽기 함수 (PRD-02 BIZ-04, BRIEF-05 권한·페이월, PAY-03)
-- 이 파일에 실제 본문·미리보기·가격은 없다. 표 틀·검사만 정한다.
-- · 유료 본문(paid_bodies.body)은 anon·authenticated 권한 0 — 공개 뷰·검색·RSS·OG·구조화 데이터·AI 도우미가 읽는 경로에 구조적으로 없다.
-- · 본문은 read_paid_body(회원, 종류, 키) 함수로만 나가고, 이 함수는 has_entitlement(권한 판정 하나)가 참일 때만 본문을 준다.
-- · 공개되는 것은 미리보기(preview, 400자 이하)뿐이고 공개 뷰 public_paid_previews가 칸을 지정해 낸다.
-- 기존 표 칸·제약·값은 바꾸지 않는다 (public_digital_plans 뷰만 조건을 하나 더한다).

create table public.paid_bodies (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('article', 'brief', 'interpretation')),
  ref_key text not null check (char_length(btrim(ref_key)) between 1 and 80),
  article_id bigint references public.articles (id),
  title text check (title is null or char_length(btrim(title)) between 1 and 120),
  preview text not null check (char_length(btrim(preview)) between 1 and 400),
  body text not null check (char_length(btrim(body)) between 1 and 200000),
  sale_allowed boolean not null default false,
  rights_ref text check (rights_ref is null or char_length(rights_ref) <= 200),
  sale_confirmed_on date,
  edited_by text not null check (length(btrim(edited_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, ref_key),
  constraint paid_bodies_article_shape check ((kind = 'article') = (article_id is not null)),
  constraint paid_bodies_longer_than_preview check (char_length(body) > char_length(preview)),
  constraint paid_bodies_sale_record check (
    not sale_allowed or (char_length(btrim(coalesce(rights_ref, ''))) > 0 and sale_confirmed_on is not null)),
  constraint paid_bodies_title_for_non_article check (kind = 'article' or title is not null)
);
comment on table public.paid_bodies is '유료 본문 (BIZ-04) - anon·authenticated 권한 0. sale_allowed(판매 권리 확인, 근거·확인일 필수)인 것만 구독자에게 나간다. 미리보기만 public_paid_previews로 공개';
create index paid_bodies_article_idx on public.paid_bodies (article_id) where article_id is not null;

create function public.paid_bodies_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.kind = 'article' and not exists (select 1 from public.articles a where a.id = new.article_id and a.is_paid) then
    raise exception '유료 본문은 유료로 표시된(is_paid) 기사에만 연결할 수 있습니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.paid_bodies_guard() from public, anon, authenticated;
create trigger paid_bodies_guard before insert or update on public.paid_bodies for each row execute function public.paid_bodies_guard();

alter table public.paid_bodies enable row level security;
revoke all on table public.paid_bodies from public, anon, authenticated, service_role;
grant select, insert, update on table public.paid_bodies to service_role;

-- 공개 미리보기 - 기능 키 paywall 켜짐 + 판매 권리 확인 + (기사면) 발행된 유료 기사. 본문 칸 없음
create view public.public_paid_previews as
select b.kind, b.ref_key, b.article_id,
       coalesce(b.title, a.title) as title,
       a.slug as article_slug, a.section as article_section, a.first_published_at,
       b.preview
  from public.paid_bodies b
  left join public.articles a on a.id = b.article_id
 where b.sale_allowed
   and (b.kind <> 'article' or (a.status = 'published' and a.is_paid))
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'paywall') = 'true'::jsonb);
revoke all on table public.public_paid_previews from public, anon, authenticated, service_role;
grant select on table public.public_paid_previews to anon, authenticated, service_role;

-- 공개 요금표는 판매 권리가 확인된 유료 본문이 하나 이상 있을 때만 (PO 준비물 #23 - 권리 목록 없으면 디지털 구독 공개 보류)
create or replace view public.public_digital_plans as
select pl.id as plan_id, pl.plan_key, pl.title as plan_title, pl.period_months, pl.amount, pl.currency, pl.sort_order,
       p.id as product_id, p.slug, p.title as product_title, p.summary
  from public.product_plans pl
  join public.products p on p.id = pl.product_id
 where pl.status = 'active' and p.status = 'on_sale' and p.kind = 'digital_subscription' and p.billing_mode = 'pg'
   and p.verified_on is not null and char_length(btrim(coalesce(p.verified_ref, ''))) > 0
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object'
                and (f.value -> 'billing') = 'true'::jsonb and (f.value -> 'digital_subscription') = 'true'::jsonb)
   and exists (select 1 from public.paid_bodies b where b.sale_allowed);

-- 본문 읽기 - 권한 판정(has_entitlement) 하나를 지난 요청에만 본문. 판매 권리 미확인이면 구독자에게도 null
create function public.read_paid_body(p_user uuid, p_kind text, p_ref text, p_at timestamptz default now()) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select b.body
    from public.paid_bodies b
   where b.kind = p_kind and b.ref_key = p_ref and b.sale_allowed
     and p_user is not null and public.has_entitlement(p_user, 'digital', p_at);
$$;
comment on function public.read_paid_body(uuid, text, text, timestamptz) is '유료 본문 반환 - 서버(service_role)만 부른다. 회원 번호는 서버가 세션에서 정한 값이다(클라이언트 값 아님)';
revoke all on function public.read_paid_body(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.read_paid_body(uuid, text, text, timestamptz) to service_role;
