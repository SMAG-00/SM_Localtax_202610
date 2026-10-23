-- W4 21단계 — 부동산 칼럼 이해관계 (PRD-01B PR-14 · TX-15, docs/dev/W4_설계.md 1장 21단계 · 11.21 · 12장 #170)
-- 이 파일에 이해관계 공개 문구나 필자·조합·시공사·신탁사 이름은 없다 — 항목 키와 발행 규칙만 정한다. 내용은 편집국이 입력한다. 씨앗 행 0.
-- · 하위 분야 realestate/columns 더하기(W2-b #48 — 칼럼 목록 /realestate/columns 가 같은 경로 규칙으로 열린다).
-- · column_interest_items — 부동산 칼럼(분야 realestate + 유형 opinion)의 조합(union)·시공사(contractor)·신탁사(trust_company) 자문 관계 3항목.
--   항목마다 declared(내용 필수) 또는 none_confirmed(필자 확인자·시각 필수 — '없음'은 필자 확인 기록과 함께만). 한 칼럼에 항목은 하나씩.
-- · 발행 검사 — 부동산 칼럼이 published·scheduled가 될 때 3항목 중 하나라도 비면 거부(빠진 항목을 문장에 담는다). 대상은 W3 칼럼 발행 검사와 같다
--   (column_meta가 있는 기사, 또는 기능 키 tax_columns가 켜진 뒤의 모든 부동산 칼럼). 이미 공개된 칼럼은 그대로 둔다. 다른 분야 칼럼은 달라지지 않는다.
-- · 공개 뷰 public_column_interest_items — 공개 기사의 항목 상태·내용만(확인자·시각 없음).
-- 기존 표·제약·값은 바꾸지 않는다.

insert into public.categories (section, slug, name, sort, visible, needs_disclaimer, needs_tax_lens) values
  ('realestate', 'columns', '칼럼', 60, true, false, true)
on conflict (section, slug) do nothing;

create table public.column_interest_items (
  article_id bigint not null references public.articles (id) on delete cascade,
  item text not null check (item in ('union', 'contractor', 'trust_company')),
  state text not null check (state in ('declared', 'none_confirmed')),
  interest_text text,
  confirmed_by text,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (article_id, item),
  check (
    (state = 'declared' and coalesce(btrim(interest_text), '') <> '')
    or (state = 'none_confirmed' and coalesce(btrim(confirmed_by), '') <> '' and confirmed_at is not null)
  )
);

comment on table public.column_interest_items is '부동산 칼럼 이해관계 3항목 (PR-14) — 조합·시공사·신탁사 자문 관계. declared는 내용 필수, none_confirmed(없음)는 필자 확인자·시각 필수';

-- 부동산 칼럼에만 담는다. 발행·예약된 칼럼의 항목은 지우지 못한다(고치기만)
create function public.column_interest_items_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.articles;
begin
  if tg_op = 'DELETE' then
    select * into a from public.articles where id = old.article_id;
    if a.id is not null and a.status in ('published', 'scheduled') then
      raise exception '발행된 부동산 칼럼의 이해관계 항목은 지울 수 없습니다 — 고쳐서 남기세요 (기사 %)', old.article_id using errcode = 'check_violation';
    end if;
    return old;
  end if;
  select * into a from public.articles where id = new.article_id;
  if a.section is distinct from 'realestate' or a.content_type is distinct from 'opinion' then
    raise exception '부동산 칼럼(분야 realestate · 유형 opinion)에만 조합·시공사·신탁사 이해관계 항목을 담습니다 (기사 %)', new.article_id using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.column_interest_items_guard() from public, anon, authenticated;
create trigger column_interest_items_guard
  before insert or update or delete on public.column_interest_items
  for each row execute function public.column_interest_items_guard();

-- 한 기사의 문제 문장(없으면 null) — 발행 서비스 @ltr/editorial checks/column-interest.ts와 같은 규칙
create function public.realestate_column_interest_problem(p_article public.articles) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_missing text[];
begin
  select array_agg(x.label order by x.ord) into v_missing
    from (values ('union', '조합 자문 관계', 1), ('contractor', '시공사 자문 관계', 2), ('trust_company', '신탁사 자문 관계', 3)) as x (item, label, ord)
   where not exists (select 1 from public.column_interest_items i where i.article_id = p_article.id and i.item = x.item);
  if v_missing is null then
    return null;
  end if;
  return format('부동산 칼럼은 조합·시공사·신탁사 자문 관계 3항목을 모두 밝혀야 발행할 수 있습니다 — 빠진 항목: %s. 관계가 없으면 필자 확인과 함께 ''없음''을 골라야 합니다 (PR-14, 기사 %s)', array_to_string(v_missing, '·'), p_article.id);
end;
$$;
revoke all on function public.realestate_column_interest_problem(public.articles) from public, anon, authenticated;

create function public.realestate_column_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_flag boolean;
  v_problem text;
begin
  if new.status not in ('published', 'scheduled') or new.content_type is distinct from 'opinion' or new.section is distinct from 'realestate' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status in ('published', 'scheduled') then
    return new;
  end if;
  select coalesce((value ->> 'tax_columns')::boolean, false) into v_flag from public.settings where key = 'feature_flags';
  if not coalesce(v_flag, false) and not exists (select 1 from public.column_meta m where m.article_id = new.id) then
    return new;
  end if;
  v_problem := public.realestate_column_interest_problem(new);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.realestate_column_guard() from public, anon, authenticated;
-- 이름 순서: W3 articles_column_guard보다 먼저 돌아 3항목 문장이 필자 검증·계약 문장보다 앞에 나온다
create trigger articles_column_a_interest_guard
  before insert or update on public.articles
  for each row execute function public.realestate_column_guard();

-- 권한·RLS: 표는 service_role만, 공개 읽기는 뷰 하나
alter table public.column_interest_items enable row level security;
revoke all on table public.column_interest_items from anon, authenticated, service_role;
grant select, insert, update, delete on table public.column_interest_items to service_role;

create view public.public_column_interest_items as
select i.article_id,
       i.item,
       i.state,
       case when i.state = 'declared' then i.interest_text else null end as interest_text
  from public.column_interest_items i
  join public.public_articles a on a.id = i.article_id;

revoke all on table public.public_column_interest_items from public, anon, authenticated, service_role;
grant select on table public.public_column_interest_items to anon, authenticated, service_role;
