-- W7 4단계 — 신선도 검수 큐(OPT-07) · 핵심 질문 50개와 AI 검색 인용 표본(OPT-09)  (PRD-01A, docs/dev/W7_설계.md 2장)
-- 이 파일에 실제 법령·기사·질문 문장은 없다 — 표와 규칙만 만든다. 씨앗 행 0.
--
-- · freshness_review_queue — 개정 트래커에 `공포`·`시행` 기록이 들어오면(정정 기록 제외) 그 개정을 단 공개 기사(법령 기준일이 있는 것)마다 검수 큐 1건.
--   (기록, 기사) 하나에 1건 — 중복 0. 처리 결과 3종(no_change 변경 없음 · substantive 실질 수정 · correction 정정)은 기록만 하고 기사의 실질 수정일은 건드리지 않는다
--   (실질 수정일은 기사 수정 API가 실질 수정·정정으로 저장할 때만 바뀐다 — OPT-07). 처리한 큐 항목은 고치지 않는다. 공개 뷰는 열린 항목의 기사 번호만.
-- · ai_question_sets / ai_core_questions — 핵심 질문 목록. 한 버전은 정확히 50문항(1~50)이어야 활성화되고, 활성화된 버전은 고칠 수 없다(새 버전으로).
-- · ai_citation_samples — 월 1회 사람이 확인해 넣는 인용 표본. (월, 질문 버전, 질문 번호, 엔진) 하나에 1행, 기본 `unknown`(미확인 — 인용 0으로 세지 않는다).
--   자동 수집 경로 없음. 모든 표는 RLS 기본 거부, service_role만.

-- ─────────────────────────────────────────────────────────────
-- 신선도 검수 큐
-- ─────────────────────────────────────────────────────────────
create table public.freshness_review_queue (
  id bigint generated always as identity primary key,
  amendment_event_id bigint not null references public.amendment_events (id),
  article_id bigint not null references public.articles (id) on delete cascade,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  resolution text check (resolution is null or resolution in ('no_change', 'substantive', 'correction')),
  note text,
  constraint freshness_review_queue_once unique (amendment_event_id, article_id),
  constraint freshness_review_queue_resolved check (
    (resolved_at is null and resolution is null and resolved_by is null)
    or (resolved_at is not null and resolution is not null and length(btrim(coalesce(resolved_by, ''))) > 0 and length(btrim(coalesce(note, ''))) > 0))
);

comment on table public.freshness_review_queue is '법령 개정 신선도 검수 큐 (OPT-07) — 공포·시행 기록마다 그 개정을 단 공개 기사 1건씩. 처리 결과는 기록만 하고 기사 실질 수정일을 바꾸지 않는다';

create index freshness_review_queue_open_idx on public.freshness_review_queue (article_id) where resolved_at is null;

create function public.freshness_queue_from_event() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stage in ('promulgated', 'effective') and not new.skipped and new.correction_of is null then
    insert into public.freshness_review_queue (amendment_event_id, article_id)
    select new.id, a.id
      from public.articles a
     where a.amendment_id = new.amendment_id and a.status = 'published' and a.legal_basis_date is not null
    on conflict (amendment_event_id, article_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.freshness_queue_from_event() from public, anon, authenticated;

create trigger amendment_events_freshness_queue after insert on public.amendment_events
  for each row execute function public.freshness_queue_from_event();

create function public.freshness_queue_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '신선도 검수 항목은 지울 수 없습니다 (OPT-07)' using errcode = 'check_violation';
  end if;
  if old.resolved_at is not null then
    raise exception '처리한 신선도 검수 항목은 고칠 수 없습니다 (OPT-07)' using errcode = 'check_violation';
  end if;
  if new.amendment_event_id is distinct from old.amendment_event_id or new.article_id is distinct from old.article_id or new.created_at is distinct from old.created_at then
    raise exception '신선도 검수 항목의 기록·기사·생성 시각은 바꿀 수 없습니다 (OPT-07)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.freshness_queue_guard() from public, anon, authenticated;

create trigger freshness_queue_guard before update or delete on public.freshness_review_queue
  for each row execute function public.freshness_queue_guard();

alter table public.freshness_review_queue enable row level security;
revoke all on table public.freshness_review_queue from anon, authenticated, service_role;
grant select, update on table public.freshness_review_queue to service_role;

-- 기사 화면 '검토 중' 표시 원본 — 열린 항목이 있는 공개 기사 번호만 (개정·법령 이름 없음)
create view public.public_freshness_reviews as
select distinct q.article_id
  from public.freshness_review_queue q
  join public.articles a on a.id = q.article_id
 where q.resolved_at is null and a.status = 'published';

comment on view public.public_freshness_reviews is '신선도 검수 중인 공개 기사 번호 (OPT-07) — 기사 화면 검토 중 표시';
revoke all on table public.public_freshness_reviews from public, anon, authenticated, service_role;
grant select on table public.public_freshness_reviews to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 핵심 질문 50개 (OPT-09)
-- ─────────────────────────────────────────────────────────────
create table public.ai_question_sets (
  version integer primary key check (version >= 1),
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  activated_at timestamptz
);

create table public.ai_core_questions (
  version integer not null references public.ai_question_sets (version),
  question_no integer not null check (question_no between 1 and 50),
  text text not null check (length(btrim(text)) between 1 and 200),
  primary key (version, question_no)
);

comment on table public.ai_question_sets is '핵심 질문 목록의 버전 (OPT-09) — 활성화는 정확히 50문항일 때만, 활성화 뒤에는 고칠 수 없다';

create function public.ai_question_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
begin
  v_version := case when tg_op = 'DELETE' then old.version else new.version end;
  if exists (select 1 from public.ai_question_sets s where s.version = v_version and s.activated_at is not null) then
    raise exception '활성화된 핵심 질문 목록(버전 %)은 고칠 수 없습니다 — 새 버전으로 만드세요 (OPT-09)', v_version using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.ai_question_guard() from public, anon, authenticated;

create trigger ai_core_questions_guard before insert or update or delete on public.ai_core_questions
  for each row execute function public.ai_question_guard();

create function public.ai_question_set_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if tg_op = 'DELETE' then
    if old.activated_at is not null then
      raise exception '활성화된 핵심 질문 목록은 지울 수 없습니다 (OPT-09)' using errcode = 'check_violation';
    end if;
    delete from public.ai_core_questions where version = old.version;
    return old;
  end if;
  if old.activated_at is not null then
    raise exception '활성화된 핵심 질문 목록(버전 %)은 고칠 수 없습니다 (OPT-09)', old.version using errcode = 'check_violation';
  end if;
  if new.activated_at is not null then
    select count(*) into v_count from public.ai_core_questions q where q.version = new.version;
    if v_count <> 50 or (select count(distinct q.question_no) from public.ai_core_questions q where q.version = new.version) <> 50 then
      raise exception '핵심 질문은 한 버전에 정확히 50문항(1~50번)이어야 활성화됩니다 (지금 %문항)', v_count using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.ai_question_set_guard() from public, anon, authenticated;

create trigger ai_question_sets_guard before update or delete on public.ai_question_sets
  for each row execute function public.ai_question_set_guard();

-- ─────────────────────────────────────────────────────────────
-- 월 인용 표본 (OPT-09) — 사람이 화면에서 확인해 입력한다. 자동 수집 0
-- ─────────────────────────────────────────────────────────────
create table public.ai_citation_samples (
  id bigint generated always as identity primary key,
  month date not null check (month = date_trunc('month', month)::date),
  question_set_version integer not null,
  question_no integer not null,
  engine text not null check (length(btrim(engine)) between 1 and 40),
  cited text not null default 'unknown' check (cited in ('yes', 'no', 'unknown')),
  cited_url text check (cited_url is null or cited_url ~ '^https?://[^[:space:]]+$'),
  expected_page text check (expected_page is null or length(btrim(expected_page)) between 1 and 300),
  checker_id text,
  note text check (note is null or char_length(note) <= 500),
  checked_at timestamptz,
  constraint ai_citation_samples_question foreign key (question_set_version, question_no) references public.ai_core_questions (version, question_no),
  constraint ai_citation_samples_once unique (month, question_set_version, question_no, engine),
  constraint ai_citation_samples_checked check (
    (cited = 'unknown' and checked_at is null)
    or (cited <> 'unknown' and checked_at is not null and length(btrim(coalesce(checker_id, ''))) > 0)),
  constraint ai_citation_samples_yes_url check (cited <> 'yes' or cited_url is not null)
);

comment on table public.ai_citation_samples is 'AI 답변 엔진 인용 표본 (OPT-09) — 월 1회 사람이 확인해 입력. unknown은 인용 0으로 세지 않는다';

create index ai_citation_samples_month_idx on public.ai_citation_samples (month, question_set_version);

-- 한 달 표본 만들기 — 활성화된 버전의 50문항 × 엔진 수만큼 `unknown` 행 (이미 있으면 건너뜀 — 멱등). 만든 행 수를 돌려준다
create function public.ai_citation_month_init(p_month date, p_version integer, p_engines text[]) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_month <> date_trunc('month', p_month)::date then
    raise exception '표본 달은 그 달 1일이어야 합니다' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.ai_question_sets s where s.version = p_version and s.activated_at is not null) then
    raise exception '활성화된 핵심 질문 목록(버전 %)이 아닙니다', p_version using errcode = 'check_violation';
  end if;
  if p_engines is null or cardinality(p_engines) = 0 then
    raise exception '확인할 엔진을 하나 이상 적어 주세요' using errcode = 'check_violation';
  end if;
  insert into public.ai_citation_samples (month, question_set_version, question_no, engine)
  select p_month, p_version, q.question_no, btrim(e)
    from public.ai_core_questions q, unnest(p_engines) as e
   where q.version = p_version and length(btrim(e)) between 1 and 40
  on conflict (month, question_set_version, question_no, engine) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.ai_citation_month_init(date, integer, text[]) from public, anon, authenticated;
grant execute on function public.ai_citation_month_init(date, integer, text[]) to service_role;

alter table public.ai_question_sets enable row level security;
alter table public.ai_core_questions enable row level security;
alter table public.ai_citation_samples enable row level security;
revoke all on table public.ai_question_sets from anon, authenticated, service_role;
revoke all on table public.ai_core_questions from anon, authenticated, service_role;
revoke all on table public.ai_citation_samples from anon, authenticated, service_role;
grant select, insert, update, delete on table public.ai_question_sets to service_role;
grant select, insert, update, delete on table public.ai_core_questions to service_role;
grant select, insert, update on table public.ai_citation_samples to service_role;
