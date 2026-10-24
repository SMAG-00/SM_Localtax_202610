-- W8 1단계 — 스토어 상품 · 자사 상품 연결 (PRD-01C BIZ-01 · 02 · 03, BR-11, docs/dev/W8_설계.md 1장 1단계 · 2장 · 12장)
-- 이 파일에 실제 상품·가격·판매처는 없다. 표 틀·검사·공개 뷰만 정한다. 상품·연결 씨앗 0행 (설정 기본값 두 개만).
-- · 결제는 1단계에 없다 (PG 계약·통신판매업 신고 전). 주문 경로는 existing_channel(허용 도메인의 바깥 판매처 링크) 또는 request_form(기존 문의함)뿐이다.
-- · 판매 중 = 판매 확인일·근거 기록(BIZ-01). 도서는 판차·목차가 있어야 판매 중. 할인·가격 표기는 도서정가제 감수 전 저장 거부.
-- · 구독 종류 상품은 설정 store_subscription_review 승인 전 공개 0 (정기간행물 등록·구독료 부가세 확인 기록 전 구독 신청 화면 공개 0).
-- · 자사 상품 카드 = product_links 승인 기록(상품 담당 제안 → 편집 책임자 승인)이 있을 때만. 기사당 1개·홈 1개 (BIZ-03).
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다.

-- ─────────────────────────────────────────────────────────────
-- 설정 씨앗 · 저장 검사
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value, description, updated_by) values
  ('store_order_domains', '[]'::jsonb,
   '스토어 바깥 주문 링크를 허용하는 호스트 목록 (BIZ-02) - 소문자 호스트 이름 배열, 정확히 일치한 호스트만. 씨앗은 비어 있어 바깥 주문 링크 상품은 공개되지 않는다',
   'migration:20261025000075'),
  ('store_subscription_review',
   jsonb_build_object('approved', false, 'ref', '', 'reviewed_by', null, 'reviewed_on', null),
   '구독 상품 공개 전 확인 기록 (BIZ-01 - 정기간행물 등록·구독료 부가세). approved=true는 ref·reviewed_by·reviewed_on이 모두 있어야 한다. 씨앗은 미승인',
   'migration:20261025000075')
on conflict (key) do nothing;

create function public.store_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
begin
  if new.key = 'store_order_domains' then
    if jsonb_typeof(new.value) is distinct from 'array' or jsonb_array_length(new.value) > 30 then
      raise exception '스토어 주문 허용 도메인(store_order_domains)은 30개 이하의 호스트 이름 배열입니다' using errcode = 'check_violation';
    end if;
    for v_item in select x.value from jsonb_array_elements(new.value) as x loop
      if jsonb_typeof(v_item) is distinct from 'string'
         or (v_item #>> '{}') !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
         or char_length(v_item #>> '{}') > 253 then
        raise exception '허용 도메인은 소문자 호스트 이름(예: shop.example.test)이어야 합니다 (BIZ-02)' using errcode = 'check_violation';
      end if;
    end loop;
    if (select count(distinct x) from jsonb_array_elements_text(new.value) x) <> jsonb_array_length(new.value) then
      raise exception '허용 도메인이 겹칩니다' using errcode = 'check_violation';
    end if;
  elsif new.key = 'store_subscription_review' then
    if jsonb_typeof(new.value) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(new.value) k where k not in ('approved', 'ref', 'reviewed_by', 'reviewed_on'))
       or jsonb_typeof(new.value -> 'approved') is distinct from 'boolean'
       or jsonb_typeof(new.value -> 'ref') is distinct from 'string'
       or char_length(new.value ->> 'ref') > 200 then
      raise exception '구독 확인 기록(store_subscription_review)은 { approved, ref(200자 이하), reviewed_by, reviewed_on }입니다' using errcode = 'check_violation';
    end if;
    if (new.value -> 'approved') = 'true'::jsonb
       and (char_length(btrim(new.value ->> 'ref')) = 0
            or char_length(btrim(coalesce(new.value ->> 'reviewed_by', ''))) = 0
            or coalesce(new.value ->> 'reviewed_on', '') !~ '^\d{4}-\d{2}-\d{2}$') then
      raise exception '구독 확인 기록 승인에는 근거 위치·확인자·확인일이 모두 필요합니다 (BIZ-01)' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.store_settings_guard() from public, anon, authenticated;
create trigger settings_store_settings_guard
  before insert or update on public.settings
  for each row when (new.key in ('store_order_domains', 'store_subscription_review'))
  execute function public.store_settings_guard();

-- ─────────────────────────────────────────────────────────────
-- 상품 (BIZ-01 · 02)
-- ─────────────────────────────────────────────────────────────
create table public.products (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  title text not null check (char_length(btrim(title)) between 1 and 80),
  kind text not null check (kind in ('book', 'education', 'subscription')),
  summary text not null default '' check (char_length(summary) <= 200),
  audience text not null default '' check (char_length(audience) <= 80),
  edition text check (edition is null or char_length(btrim(edition)) between 1 and 100),
  toc text[] not null default '{}' check (cardinality(toc) <= 60),
  order_mode text not null check (order_mode in ('existing_channel', 'request_form')),
  order_url text check (order_url is null or (char_length(order_url) <= 500 and order_url ~ '^https://[a-z0-9][a-z0-9.-]*(:[0-9]+)?(/[^[:space:]]*)?$')),
  verified_on date,
  verified_ref text check (verified_ref is null or char_length(verified_ref) <= 200),
  status text not null default 'draft' check (status in ('draft', 'on_sale', 'stopped')),
  edited_by text not null check (length(btrim(edited_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_order_shape check ((order_mode = 'existing_channel') = (order_url is not null)),
  constraint products_on_sale_verified check (
    status <> 'on_sale' or (verified_on is not null and char_length(btrim(coalesce(verified_ref, ''))) > 0)),
  constraint products_book_on_sale check (
    status <> 'on_sale' or kind <> 'book' or (char_length(btrim(coalesce(edition, ''))) > 0 and cardinality(toc) > 0))
);
comment on table public.products is '스토어 상품 (BIZ-01·02) - 실사 확인일·근거가 있어야 판매 중. 도서는 판차·목차 필수. 결제·재고 칸 없음, 1단계는 바깥 링크 또는 문의함. 상품 정보 칸에 할인 표기 거부';
create index products_status_idx on public.products (status);

create function public.products_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host text;
begin
  new.updated_at := now();
  -- 할인·가격 표기 거부 (도서정가제 감수 전 - BIZ-01 [감수 필요])
  if concat_ws(' ', new.title, new.summary, new.audience, new.edition, array_to_string(new.toc, ' ')) ~ '(할인|최저가|특가|[0-9][0-9,]*[[:space:]]*원|[0-9]+[[:space:]]*%)' then
    raise exception '상품 문구에 할인·가격 표기를 쓸 수 없습니다 - 전자상거래법·도서정가제 감수 전입니다 (BIZ-01)' using errcode = 'check_violation';
  end if;
  if exists (select 1 from unnest(new.toc) t where char_length(btrim(t)) not between 1 and 100) then
    raise exception '목차 항목은 1~100자입니다' using errcode = 'check_violation';
  end if;
  -- 바깥 주문 링크는 허용 도메인의 https 주소 (주소/방식이 바뀔 때만 - 이미 저장된 상품을 도메인 정리로 막지 않고, 공개 뷰가 읽을 때 다시 판정한다)
  if new.order_url is not null and (tg_op = 'INSERT' or new.order_url is distinct from old.order_url) then
    v_host := lower(substring(new.order_url from '^https://([^/?#:@]+)'));
    if v_host is null or not exists (
         select 1 from public.settings d, jsonb_array_elements_text(d.value) h
          where d.key = 'store_order_domains' and jsonb_typeof(d.value) = 'array' and h = v_host) then
      raise exception '주문 주소의 도메인(%)이 허용 목록(store_order_domains)에 없습니다 (BIZ-02)', coalesce(v_host, '-') using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.products_guard() from public, anon, authenticated;
create trigger products_guard
  before insert or update on public.products
  for each row execute function public.products_guard();

-- ─────────────────────────────────────────────────────────────
-- 자사 상품 연결 (BIZ-03 · BR-11) - 제안 → 승인. 기사당 승인 1개, 홈 승인 1개
-- ─────────────────────────────────────────────────────────────
create table public.product_links (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products (id),
  placement text not null check (placement in ('article', 'home')),
  article_id bigint references public.articles (id),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'revoked')),
  proposed_by text not null check (length(btrim(proposed_by)) > 0),
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_links_placement_shape check ((placement = 'article') = (article_id is not null)),
  -- 승인된 연결은 승인자·시각이 있다. 철회해도 누가 승인했는지는 남긴다. 제안 상태에는 승인 기록이 없다
  constraint product_links_approved_record check (
    (status <> 'approved' or (approved_at is not null and length(btrim(coalesce(approved_by, ''))) > 0))
    and (status <> 'proposed' or (approved_at is null and approved_by is null)))
);
comment on table public.product_links is '자사 상품 카드 연결 (BIZ-03·BR-11) - 상품 담당 제안 → 편집 책임자 승인. 승인 기록이 있는 연결만 카드로 보인다. 기사당 승인 1개·홈 승인 1개';
create unique index product_links_one_article on public.product_links (article_id) where status = 'approved' and placement = 'article';
create unique index product_links_one_home on public.product_links (placement) where status = 'approved' and placement = 'home';
create index product_links_product_idx on public.product_links (product_id);

create function public.product_links_touch() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.product_links_touch() from public, anon, authenticated;
create trigger product_links_touch
  before update on public.product_links
  for each row execute function public.product_links_touch();

-- ─────────────────────────────────────────────────────────────
-- 권한 · 공개 뷰
-- ─────────────────────────────────────────────────────────────
alter table public.products enable row level security;
alter table public.product_links enable row level security;
revoke all on table public.products, public.product_links from anon, authenticated, service_role;
grant select, insert, update on table public.products to service_role;
grant select, insert, update on table public.product_links to service_role;

-- 공개 상품 - 모든 공개 조건을 한 곳에서: 기능 키 store + 판매 중 + 확인일·근거 + 주문 도메인 허용 + (구독이면) 구독 확인 기록 승인
create view public.public_store_products as
select p.id, p.slug, p.title, p.kind, p.summary, p.audience, p.edition, p.toc, p.order_mode, p.order_url, p.verified_on
  from public.products p
 where p.status = 'on_sale'
   and p.verified_on is not null
   and char_length(btrim(coalesce(p.verified_ref, ''))) > 0
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'store') = 'true'::jsonb)
   and (p.kind <> 'subscription'
        or exists (select 1 from public.settings r where r.key = 'store_subscription_review' and (r.value -> 'approved') = 'true'::jsonb))
   and (p.order_mode = 'request_form'
        or exists (select 1 from public.settings d, jsonb_array_elements_text(d.value) h
                    where d.key = 'store_order_domains' and jsonb_typeof(d.value) = 'array'
                      and h = lower(substring(p.order_url from '^https://([^/?#:@]+)'))));

-- 공개 연결 - 승인된 연결과 공개 상품 칸. 상품이 중지되거나 키가 꺼지면 다음 요청부터 0행
create view public.public_product_links as
select l.id as link_id, l.placement, l.article_id,
       p.id, p.slug, p.title, p.kind, p.summary, p.audience, p.edition, p.toc, p.order_mode, p.order_url, p.verified_on
  from public.product_links l
  join public.public_store_products p on p.id = l.product_id
 where l.status = 'approved';

revoke all on table public.public_store_products, public.public_product_links from public, anon, authenticated, service_role;
grant select on table public.public_store_products, public.public_product_links to anon, authenticated, service_role;
