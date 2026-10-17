-- W2-a 1단계 DB — 편집 승인·세무 감수 기록 editorial_reviews · 문의함 inquiries · 정정 이력 article_corrections · 점검 결과 seo_checks
-- · 작성 기자와 같은 사람의 desk_edit(편집 승인)는 거부 (NAV-12) — 관리자(PO)도 예외 없음 (PRD-00 6장, 2026-10-17 PO 결정)
-- · desk_edit와 tax_review는 서로를 대신하지 않는다: 기사의 editorial_status는 desk_edit 기록에서만,
--   tax_review_status는 tax_review 기록에서만 계산된다. 기록 없이 상태 칸만 approved로 바꾸면 거부
-- · article_corrections · seo_checks는 추가만 (W2-a 설계 3장)

create table public.editorial_reviews (
  id bigint generated always as identity primary key,
  article_id bigint not null references public.articles (id) on delete cascade,
  version integer not null default 1 check (version >= 1),   -- 검토한 기사 버전
  kind text not null check (kind in ('desk_edit', 'tax_review', 'sponsor_check')),
  reviewer_id bigint not null references public.people (id),
  decision text not null check (decision in ('approve', 'reject', 'hold')),
  checklist jsonb not null default '{}'::jsonb check (jsonb_typeof(checklist) = 'object'), -- 지역 기사 desk_edit 3항목은 01B REG1-17
  reason text,
  at timestamptz not null default now()
);

comment on table public.editorial_reviews is '편집 승인(desk_edit)·세무 감수(tax_review)·광고 표기 확인 기록 — 서로 다른 행. 작성 기자 본인의 desk_edit 거부 (NAV-12). anon 0행';

create index editorial_reviews_article_idx on public.editorial_reviews (article_id, kind, at desc, id desc);

create function public.editorial_reviews_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_author bigint;
begin
  if new.kind = 'desk_edit' then
    select a.author_id into v_author from public.articles a where a.id = new.article_id;
    if v_author is not null and v_author = new.reviewer_id then
      raise exception '작성 기자 본인의 편집 승인(desk_edit)은 거부합니다 (NAV-12 — 기사 %, 인물 %)', new.article_id, new.reviewer_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- 기사의 편집 승인·세무 감수 상태를 각자 종류의 최근 기록으로 다시 계산한다
create function public.editorial_reviews_sync() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_article bigint;
  v_desk text;
  v_tax text;
begin
  for v_article in
    select distinct x from unnest(array[
      case when tg_op in ('INSERT', 'UPDATE') then new.article_id end,
      case when tg_op in ('UPDATE', 'DELETE') then old.article_id end]) as x where x is not null
  loop
    select r.decision into v_desk from public.editorial_reviews r
     where r.article_id = v_article and r.kind = 'desk_edit' order by r.at desc, r.id desc limit 1;
    select r.decision into v_tax from public.editorial_reviews r
     where r.article_id = v_article and r.kind = 'tax_review' order by r.at desc, r.id desc limit 1;
    update public.articles a set
      editorial_status = case v_desk when 'approve' then 'approved' when 'reject' then 'rejected' when 'hold' then 'held' else 'pending' end,
      tax_review_status = case v_tax
        when 'approve' then 'approved' when 'reject' then 'rejected' when 'hold' then 'held'
        else case when a.tax_review_status in ('not_required', 'pending') then a.tax_review_status else 'pending' end
      end
     where a.id = v_article;
  end loop;
  return null;
end;
$$;

revoke all on function public.editorial_reviews_guard() from public, anon, authenticated;
revoke all on function public.editorial_reviews_sync() from public, anon, authenticated;

create trigger editorial_reviews_guard
  before insert or update on public.editorial_reviews
  for each row execute function public.editorial_reviews_guard();

create trigger editorial_reviews_sync
  after insert or update or delete on public.editorial_reviews
  for each row execute function public.editorial_reviews_sync();

alter table public.editorial_reviews enable row level security;
revoke all on table public.editorial_reviews from anon, authenticated, service_role;
grant select, insert, update, delete on table public.editorial_reviews to service_role;

-- 기사 쪽 검사: 상태 칸은 자기 종류의 최근 기록이 approve일 때만 approved, 승인한 편집자를 작성자로 바꾸는 우회 거부
create function public.articles_review_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_latest text;
begin
  if new.editorial_status = 'approved' and (tg_op = 'INSERT' or old.editorial_status is distinct from 'approved') then
    v_latest := null;
    if tg_op = 'UPDATE' then
      select r.decision into v_latest from public.editorial_reviews r
       where r.article_id = new.id and r.kind = 'desk_edit' order by r.at desc, r.id desc limit 1;
    end if;
    if v_latest is distinct from 'approve' then
      raise exception '편집 승인 상태(editorial_status)는 편집 승인 기록(desk_edit approve)으로만 approved가 됩니다 — 세무 감수로 대신할 수 없습니다 (NAV-03)'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.tax_review_status = 'approved' and (tg_op = 'INSERT' or old.tax_review_status is distinct from 'approved') then
    v_latest := null;
    if tg_op = 'UPDATE' then
      select r.decision into v_latest from public.editorial_reviews r
       where r.article_id = new.id and r.kind = 'tax_review' order by r.at desc, r.id desc limit 1;
    end if;
    if v_latest is distinct from 'approve' then
      raise exception '세무 감수 상태(tax_review_status)는 세무 감수 기록(tax_review approve)으로만 approved가 됩니다 — 편집 승인으로 대신할 수 없습니다 (NAV-03)'
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.author_id is not null and new.author_id is distinct from old.author_id then
    if exists (select 1 from public.editorial_reviews r
                where r.article_id = new.id and r.kind = 'desk_edit' and r.reviewer_id = new.author_id) then
      raise exception '이 기사를 편집 승인(desk_edit)한 사람을 작성자로 바꿀 수 없습니다 (NAV-12)'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.articles_review_guard() from public, anon, authenticated;

create trigger articles_review_guard
  before insert or update on public.articles
  for each row execute function public.articles_review_guard();

-- ─────────────────────────────────────────────────────────────
-- inquiries — 문의함 (HELP-01 · ADM-03 · NAV-03 정정 요청 창구). 최소 칸 — 01C가 상품·도우미 쪽 칸을 더한다
-- 정정·반론(correction)은 처리 결과(정정 게재·반론 게재·기각)와 사유 없이 완료로 바꿀 수 없다
-- ─────────────────────────────────────────────────────────────
create table public.inquiries (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('tip', 'subscription', 'advertising', 'reader_submission', 'correction', 'product', 'assistant_report')),
  body text not null check (length(btrim(body)) > 0),          -- 도우미에서 넘어온 항목은 마스킹 요약만 (01C)
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  status text not null default 'received' check (status in ('received', 'in_progress', 'done')),
  assignee uuid references auth.users (id) on delete set null,
  memo text,
  related_article_id bigint references public.articles (id) on delete set null,
  product_key text,
  resolution text,
  resolution_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inquiries_correction_resolution_values check (
    kind <> 'correction' or resolution is null or resolution in ('correction_published', 'rebuttal_published', 'dismissed')),
  constraint inquiries_correction_done check (
    kind <> 'correction' or status <> 'done' or (resolution is not null and length(btrim(coalesce(resolution_reason, ''))) > 0))
);

comment on table public.inquiries is '문의함 (ADM-03) — 고객센터 4종·정정·반론·상품 문의·도우미 정정·제보. 전문가 연락 요청은 여기 두지 않는다 (01C EXPL)';

create index inquiries_kind_status_idx on public.inquiries (kind, status, created_at desc);

create trigger inquiries_touch before update on public.inquiries
  for each row execute function public.touch_updated_at();

alter table public.inquiries enable row level security;
revoke all on table public.inquiries from anon, authenticated, service_role;
grant select, insert, update, delete on table public.inquiries to service_role;

-- ─────────────────────────────────────────────────────────────
-- article_corrections — 정정 이력 블록의 원본 (NAV-06). 추가만
-- 이유 필수. 정정·제목 변경은 전후 버전, 삭제는 전 버전 필수. 버전은 같은 기사의 것만 (짝 외래 키)
-- ─────────────────────────────────────────────────────────────
create table public.article_corrections (
  id bigint generated always as identity primary key,
  article_id bigint not null references public.articles (id),
  kind text not null check (kind in ('correction', 'rebuttal', 'follow_up', 'deletion', 'title_change')),
  before_revision_id bigint,
  after_revision_id bigint,
  reason text not null check (length(btrim(reason)) > 0),
  inquiry_id bigint references public.inquiries (id),
  decided_by text not null check (length(btrim(decided_by)) > 0),   -- user:<uuid> · admin:<이메일>
  published_at timestamptz,
  reader_notice text,                                              -- 독자 표시 문구
  created_at timestamptz not null default now(),
  constraint article_corrections_before_revision foreign key (before_revision_id, article_id) references public.article_revisions (id, article_id),
  constraint article_corrections_after_revision foreign key (after_revision_id, article_id) references public.article_revisions (id, article_id),
  constraint article_corrections_versions check (
    (kind not in ('correction', 'title_change') or (before_revision_id is not null and after_revision_id is not null))
    and (kind <> 'deletion' or before_revision_id is not null))
);

comment on table public.article_corrections is '정정·반론·추후보도·삭제·제목 변경 이력 (NAV-06) — 추가만';

create index article_corrections_article_idx on public.article_corrections (article_id, created_at);

create trigger article_corrections_no_update_delete
  before update or delete on public.article_corrections
  for each row execute function public.append_only_guard();

create trigger article_corrections_no_truncate
  before truncate on public.article_corrections
  for each statement execute function public.append_only_guard();

alter table public.article_corrections enable row level security;
revoke all on table public.article_corrections from anon, authenticated, service_role;
grant select, insert on table public.article_corrections to service_role;

-- ─────────────────────────────────────────────────────────────
-- seo_checks — 점검 결과 이력 (PRD-01A 6.2, OPT-03·06). 추가만. 점수는 내부 품질 지표 — 공개 API 0
-- ─────────────────────────────────────────────────────────────
create table public.seo_checks (
  id bigint generated always as identity primary key,
  target_type text not null check (target_type in ('article', 'page')),
  target_id text not null check (length(btrim(target_id)) > 0),
  target_version integer,
  rules_version text not null check (length(btrim(rules_version)) > 0),
  engine_version text not null check (length(btrim(engine_version)) > 0),
  scores jsonb not null check (
    jsonb_typeof(scores) = 'object'
    and scores ?& array['seo', 'aeo', 'geo', 'common']
    and (scores - array['seo', 'aeo', 'geo', 'common']) = '{}'::jsonb
    and not jsonb_path_exists(scores, '$.* ? (@.type() != "number" || @ < 0 || @ > 100)')),
  blocking_failures jsonb not null default '[]'::jsonb check (jsonb_typeof(blocking_failures) = 'array'),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  similarity jsonb,              -- 최고 문장 비율·기사 비율·비교 원문 ID·기준 출처(규정/내부)
  checked_at timestamptz not null default now(),
  checked_by text not null check (checked_by in ('editor', 'system')),
  published_with_warnings boolean not null default false
);

comment on table public.seo_checks is '점검 결과 이력 (OPT-03) — 추가만. 축별 점수 0~100(seo·aeo·geo·common)·차단 항목·경고·유사도';

create index seo_checks_target_idx on public.seo_checks (target_type, target_id, checked_at desc);

create trigger seo_checks_no_update_delete
  before update or delete on public.seo_checks
  for each row execute function public.append_only_guard();

create trigger seo_checks_no_truncate
  before truncate on public.seo_checks
  for each statement execute function public.append_only_guard();

alter table public.seo_checks enable row level security;
revoke all on table public.seo_checks from anon, authenticated, service_role;
grant select, insert on table public.seo_checks to service_role;
