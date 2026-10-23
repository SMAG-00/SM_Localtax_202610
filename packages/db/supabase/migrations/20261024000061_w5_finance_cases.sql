-- W5 2단계 — 금융 사례 템플릿과 개발금융 칼럼 (PRD-01B DF-03 · DF-05 · DF-09, docs/dev/W5_설계.md 1장 2단계 · 2장 · 11장)
-- 이 파일에 실제 사례 사실·기업 이름·소속 이름·이해관계 문구는 없다. 표 틀과 발행·승인 규칙만 정한다. 씨앗 행 0.
-- · finance_cases — 개발금융 사례 기사의 구조 기록. 금리·수수료·내부 약정 같은 미공개 조건 칸은 없다(시험이 칸 이름을 본다).
--     실명 기업 표시(named_company)면 반론 요청일·방법·답변 상태(답변·무응답·거절)가 모두 있어야 한다. 무응답은 요청일부터 finance_rebuttal_wait_days가 지나야 고른다.
--     판결문 인용(judgment_quoted)은 비실명 확인(anonymized_checked)이 있어야 한다. 반론 메모(rebuttal_note)는 내부용 — 공개 뷰에 없다.
-- · 사례 발행 검사 — 기사가 published·scheduled가 될 때: 하위 분야 finance/cases 기사는 finance_cases 기록이 있어야 하고,
--     기록이 있는 기사는 반론·비실명 규칙 + 공개 자료 근거(article_evidence, 반려 아님) 1건 이상이 있어야 한다. 이미 공개된 기사는 그대로 둔다.
-- · 편집 승인 검사 — 사례 기사의 desk_edit approve는 checklist public_scope(공개 자료 범위)와 위 규칙이 필요.
--     개발금융 칼럼(분야 finance · 유형 opinion)의 approve는 checklist not_self_promo(자사 상품 홍보 아님)가 필요.
-- · finance_column_interest_items — 개발금융 칼럼의 소속 금융사(financial_company)·신탁사(trust_company) 2항목. 항목마다 declared(내용) 또는
--     none_confirmed(필자 확인자·시각). 칼럼 발행 검사는 W4 부동산 칼럼과 같은 대상(칼럼 기록이 있거나 기능 키 tax_columns 켜짐).
-- · 공개 뷰 public_finance_cases · public_finance_column_interest_items — 키 finance 켜짐 + 공개 기사만.
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다.

-- ─────────────────────────────────────────────────────────────
-- 금융 사례 (DF-03)
-- ─────────────────────────────────────────────────────────────
create table public.finance_cases (
  article_id bigint primary key references public.articles (id) on delete cascade,
  structure_type text not null check (structure_type in ('trust', 'completion_guarantee', 'pf_stage', 'reit')),
  issues text[] not null default '{}' check (cardinality(issues) <= 8),
  outcome text check (outcome is null or char_length(btrim(outcome)) between 1 and 300),
  named_company boolean not null default false,
  rebuttal_requested_at timestamptz,
  rebuttal_method text check (rebuttal_method in ('email', 'phone', 'mail', 'other')),
  rebuttal_status text check (rebuttal_status in ('answered', 'no_response', 'declined')),
  rebuttal_note text check (rebuttal_note is null or char_length(rebuttal_note) <= 500),
  judgment_quoted boolean not null default false,
  anonymized_checked boolean not null default false,
  updated_by text not null check (length(btrim(updated_by)) > 0),
  updated_at timestamptz not null default now()
);

comment on table public.finance_cases is '개발금융 사례 구조 기록 (DF-03) — 공개 자료 범위만. 미공개 조건(금리·수수료·내부 약정) 칸 없음. 반론 메모는 내부용';
comment on column public.finance_cases.issues is '쟁점 목록 (0~8개, 항목마다 1~80자)';
comment on column public.finance_cases.named_company is '실명 기업을 다룸 — 켜면 반론 요청일·방법·답변 상태 필수';
comment on column public.finance_cases.rebuttal_note is '반론 요청·답변 내부 메모 — 공개 뷰에 없다';

create function public.finance_cases_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.articles;
  v_wait integer;
  v_issue text;
  v_texts text[];
  v_problem text;
begin
  select * into a from public.articles where id = new.article_id;
  if a.id is null or a.section is distinct from 'finance' then
    raise exception '금융 사례 기록은 개발금융(finance) 분야 기사에만 담습니다 (기사 %)', new.article_id using errcode = 'check_violation';
  end if;
  foreach v_issue in array new.issues loop
    if char_length(btrim(v_issue)) not between 1 and 80 then
      raise exception '사례 쟁점은 항목마다 1~80자입니다 (기사 %)', new.article_id using errcode = 'check_violation';
    end if;
  end loop;
  v_texts := new.issues || array[new.outcome];
  v_problem := public.finance_text_problem(array_remove(v_texts, null));
  if v_problem is not null then
    raise exception '금융 사례(기사 %) — %', new.article_id, v_problem using errcode = 'check_violation';
  end if;
  if new.rebuttal_status is not null and (new.rebuttal_requested_at is null or new.rebuttal_method is null) then
    raise exception '반론 답변 상태를 적으려면 반론 요청일과 요청 방법이 먼저 있어야 합니다 (DF-03, 기사 %)', new.article_id using errcode = 'check_violation';
  end if;
  if new.rebuttal_requested_at is not null and new.rebuttal_requested_at > now() then
    raise exception '반론 요청일이 지금보다 뒤입니다 (기사 %)', new.article_id using errcode = 'check_violation';
  end if;
  if new.rebuttal_status = 'no_response' then
    select (s.value #>> '{}')::integer into v_wait from public.settings s where s.key = 'finance_rebuttal_wait_days';
    if new.rebuttal_requested_at + make_interval(days => coalesce(v_wait, 7)) > now() then
      raise exception '반론 무응답은 요청일부터 %일이 지나야 고를 수 있습니다 (DF-03, 기사 %)', coalesce(v_wait, 7), new.article_id using errcode = 'check_violation';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.finance_cases_guard() from public, anon, authenticated;
create trigger finance_cases_guard
  before insert or update on public.finance_cases
  for each row execute function public.finance_cases_guard();

-- 사례 기사의 승인·발행 문제 (없으면 null). 반론 기록 · 비실명 확인 · 공개 자료 근거
create function public.finance_case_problem(p_article_id bigint, p_with_evidence boolean) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.finance_cases;
  v_wait integer;
begin
  select * into c from public.finance_cases where article_id = p_article_id;
  if c.article_id is null then
    if exists (select 1 from public.articles a join public.categories k on k.id = a.category_id
                where a.id = p_article_id and k.section = 'finance' and k.slug = 'cases') then
      return format('사례 기사는 금융 사례 기록(구조 유형·쟁점)이 있어야 합니다 (DF-03, 기사 %s)', p_article_id);
    end if;
    return null;
  end if;
  if c.named_company then
    if c.rebuttal_requested_at is null or c.rebuttal_method is null or c.rebuttal_status is null then
      return format('실명 기업을 다룬 사례는 반론 요청일·요청 방법·답변 상태(답변·무응답·거절)가 모두 있어야 합니다 (DF-03, 기사 %s)', p_article_id);
    end if;
    if c.rebuttal_status = 'no_response' then
      select (s.value #>> '{}')::integer into v_wait from public.settings s where s.key = 'finance_rebuttal_wait_days';
      if c.rebuttal_requested_at + make_interval(days => coalesce(v_wait, 7)) > now() then
        return format('반론 무응답은 요청일부터 %s일이 지나야 인정됩니다 (DF-03, 기사 %s)', coalesce(v_wait, 7), p_article_id);
      end if;
    end if;
  end if;
  if c.judgment_quoted and not c.anonymized_checked then
    return format('판결문을 인용한 사례는 비실명 확인이 있어야 합니다 (DF-03, 기사 %s)', p_article_id);
  end if;
  if p_with_evidence and not exists (select 1 from public.article_evidence e where e.article_id = p_article_id and e.verification_status <> 'rejected') then
    return format('사례 구조 서술에는 공개 자료 근거(판결문·공시·당국 발표 등) 연결이 1건 이상 필요합니다 (DF-03, 기사 %s)', p_article_id);
  end if;
  return null;
end;
$$;
revoke all on function public.finance_case_problem(bigint, boolean) from public, anon, authenticated;
grant execute on function public.finance_case_problem(bigint, boolean) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 개발금융 칼럼 이해관계 (DF-09)
-- ─────────────────────────────────────────────────────────────
create table public.finance_column_interest_items (
  article_id bigint not null references public.articles (id) on delete cascade,
  item text not null check (item in ('financial_company', 'trust_company')),
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

comment on table public.finance_column_interest_items is '개발금융 칼럼 소속 2항목 (DF-09) — 소속 금융사·신탁사. declared는 내용 필수, none_confirmed(없음)는 필자 확인자·시각 필수';

create function public.finance_column_interest_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.articles;
  v_problem text;
begin
  if tg_op = 'DELETE' then
    select * into a from public.articles where id = old.article_id;
    if a.id is not null and a.status in ('published', 'scheduled') then
      raise exception '발행된 개발금융 칼럼의 소속 항목은 지울 수 없습니다 — 고쳐서 남기세요 (기사 %)', old.article_id using errcode = 'check_violation';
    end if;
    return old;
  end if;
  select * into a from public.articles where id = new.article_id;
  if a.section is distinct from 'finance' or a.content_type is distinct from 'opinion' then
    raise exception '개발금융 칼럼(분야 finance · 유형 opinion)에만 소속 금융사·신탁사 항목을 담습니다 (기사 %)', new.article_id using errcode = 'check_violation';
  end if;
  v_problem := public.finance_text_problem(array[new.interest_text]);
  if v_problem is not null then
    raise exception '개발금융 칼럼 소속 항목 — %', v_problem using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.finance_column_interest_guard() from public, anon, authenticated;
create trigger finance_column_interest_guard
  before insert or update or delete on public.finance_column_interest_items
  for each row execute function public.finance_column_interest_guard();

-- 칼럼 발행 문제 (없으면 null) — W4 부동산 칼럼 검사와 같은 대상
create function public.finance_column_problem(p_article public.articles) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_flag boolean;
  v_missing text[];
begin
  if p_article.section is distinct from 'finance' or p_article.content_type is distinct from 'opinion' then
    return null;
  end if;
  select coalesce((value ->> 'tax_columns')::boolean, false) into v_flag from public.settings where key = 'feature_flags';
  if not coalesce(v_flag, false) and not exists (select 1 from public.column_meta m where m.article_id = p_article.id) then
    return null;
  end if;
  select array_agg(x.label order by x.ord) into v_missing
    from (values ('financial_company', '소속 금융사', 1), ('trust_company', '소속 신탁사', 2)) as x (item, label, ord)
   where not exists (select 1 from public.finance_column_interest_items i where i.article_id = p_article.id and i.item = x.item);
  if v_missing is null then
    return null;
  end if;
  return format('개발금융 칼럼은 소속 금융사·신탁사 2항목을 모두 밝혀야 발행할 수 있습니다 — 빠진 항목: %s. 관계가 없으면 필자 확인과 함께 ''없음''을 골라야 합니다 (DF-09, 기사 %s)', array_to_string(v_missing, '·'), p_article.id);
end;
$$;
revoke all on function public.finance_column_problem(public.articles) from public, anon, authenticated;
grant execute on function public.finance_column_problem(public.articles) to service_role;

-- 기사 발행 검사 — 사례 · 칼럼
create function public.articles_finance_gate() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem text;
begin
  if new.status not in ('published', 'scheduled') or new.section is distinct from 'finance' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status in ('published', 'scheduled') then
    return new;
  end if;
  v_problem := public.finance_case_problem(new.id, true);
  if v_problem is null then
    v_problem := public.finance_column_problem(new);
  end if;
  if v_problem is not null then
    raise exception '%', v_problem using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.articles_finance_gate() from public, anon, authenticated;
-- 이름 순서: W3 articles_column_guard(필자 검증·계약)보다 먼저 돌아 소속 2항목 문장이 앞에 나온다
create trigger articles_column_b_finance_gate
  before insert or update on public.articles
  for each row execute function public.articles_finance_gate();

-- 편집 승인 검사 — 사례(공개 자료 범위 + 반론·비실명) · 칼럼(자사 상품 홍보 아님)
create function public.editorial_reviews_finance_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.articles;
  v_problem text;
begin
  if new.kind <> 'desk_edit' or new.decision <> 'approve' then
    return new;
  end if;
  select * into a from public.articles x where x.id = new.article_id;
  if a.id is null or a.section is distinct from 'finance' then
    return new;
  end if;
  if exists (select 1 from public.finance_cases c where c.article_id = a.id)
     or exists (select 1 from public.articles x join public.categories k on k.id = x.category_id where x.id = a.id and k.section = 'finance' and k.slug = 'cases') then
    if (new.checklist -> 'public_scope') is distinct from 'true'::jsonb then
      raise exception '금융 사례 편집 승인에는 ''공개 자료 범위''(public_scope) 확인이 필요합니다 (DF-03, 기사 %)', a.id using errcode = 'check_violation';
    end if;
    v_problem := public.finance_case_problem(a.id, false);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = 'check_violation';
    end if;
  end if;
  if a.content_type = 'opinion' and (new.checklist -> 'not_self_promo') is distinct from 'true'::jsonb then
    raise exception '개발금융 칼럼 편집 승인에는 ''자사 상품 홍보 아님''(not_self_promo) 확인이 필요합니다 (DF-09, 기사 %)', a.id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.editorial_reviews_finance_guard() from public, anon, authenticated;
create trigger editorial_reviews_finance_guard
  before insert or update on public.editorial_reviews
  for each row execute function public.editorial_reviews_finance_guard();

-- ─────────────────────────────────────────────────────────────
-- 권한 · RLS · 공개 뷰
-- ─────────────────────────────────────────────────────────────
alter table public.finance_cases enable row level security;
alter table public.finance_column_interest_items enable row level security;
revoke all on table public.finance_cases, public.finance_column_interest_items from anon, authenticated, service_role;
grant select, insert, update, delete on table public.finance_cases, public.finance_column_interest_items to service_role;

create view public.public_finance_cases as
select c.article_id, c.structure_type, c.issues, c.outcome, c.named_company, c.rebuttal_status
  from public.finance_cases c
  join public.public_articles a on a.id = c.article_id
 where exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'finance') = 'true'::jsonb);

create view public.public_finance_column_interest_items as
select i.article_id, i.item, i.state,
       case when i.state = 'declared' then i.interest_text else null end as interest_text
  from public.finance_column_interest_items i
  join public.public_articles a on a.id = i.article_id
 where exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'finance') = 'true'::jsonb);

revoke all on table public.public_finance_cases, public.public_finance_column_interest_items from public, anon, authenticated, service_role;
grant select on table public.public_finance_cases, public.public_finance_column_interest_items to anon, authenticated, service_role;
