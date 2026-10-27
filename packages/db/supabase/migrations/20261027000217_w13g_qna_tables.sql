-- W13-g g2 — 지방세 고민 해결 라운지 표 (PRD-05 QNA-01 · 02 · 03 · 05 · 06 · 07, docs/dev/W13-g_설계.md 2장)
-- · qna_questions · qna_answers · qna_reports · qna_sanctions. 모두 RLS 기본 거부 - anon·authenticated 직접 권한 0, service_role만 (웹 서버가 로그인한 회원 번호를 확인한 뒤 쓴다).
--   공개는 218의 공개 뷰만.
-- · 본문은 가림이 끝난 글만 저장한다 (가리기 전 값 0). 마지막 방어선으로 DB도 이메일·긴 숫자·전화·주민번호 모양이 남아 있으면 거부한다 (qna_pii_problem).
-- · 상담 유도·연락처 유도 표현은 설정 qna_detect_dictionary(법률 검토 후 PO 입력)에 걸리면 게시 보류(held)로 바뀐다. 사전이 비어 있으면 걸리는 것 0.
-- · 답변 배지(author_kind)는 서버가 정해 넣지만 DB가 다시 본다: expert = 지금 유효한 SM 전문가 연결, gov = 인증된 공공기관 메일 (qna_gov_verified).
-- · 이 표에는 상담 신청·매칭·소개 대가·건별 수수료·별점·후기·연락처 칸이 없다 (QNA-06, 스키마 시험이 검사). 라운지 글은 chunks.source_type 허용 목록에 없다 (QNA-07).
-- · 해결 사례 동의·승인 칸은 W13-h(223)가 더한다.

-- 개인정보 모양 검사 - 걸리면 true
create function public.qna_pii_problem(p_text text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_text is not null and (
    normalize(p_text, NFKC) ~ '[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}'
    or normalize(p_text, NFKC) ~ '[0-9]{10,}'
    or normalize(p_text, NFKC) ~ '[0-9]{2,4}[\s.\-][0-9]{3,4}[\s.\-][0-9]{4}'
    or normalize(p_text, NFKC) ~ '[0-9]{6}[\s\-]?[1-8][0-9]{6}'
  )
$$;

-- 검출 사전에 걸린 묶음 이름 (contact_terms | consult_terms) 또는 null
create function public.qna_hold_reason(p_text text) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dict jsonb;
  v_flat text;
  k text;
  t text;
begin
  select s.value into v_dict from public.settings s where s.key = 'qna_detect_dictionary';
  if jsonb_typeof(v_dict) is distinct from 'object' or p_text is null then
    return null;
  end if;
  v_flat := lower(regexp_replace(normalize(p_text, NFKC), '\s', '', 'g'));
  foreach k in array array['contact_terms', 'consult_terms'] loop
    if jsonb_typeof(v_dict -> k) = 'array' then
      for t in select jsonb_array_elements_text(v_dict -> k) loop
        if length(btrim(t)) > 0 and position(lower(regexp_replace(t, '\s', '', 'g')) in v_flat) > 0 then
          return k;
        end if;
      end loop;
    end if;
  end loop;
  return null;
end;
$$;

-- 라운지가 열려 있는가 - 기능 키 qna ∧ 중립성 고지 승인 (220이 둘 다 켜기 전에 확인한다)
create function public.qna_is_open() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'qna') = 'true'::jsonb)
     and exists (select 1 from public.settings n where n.key = 'qna_neutrality_notice' and (n.value -> 'approved') = 'true'::jsonb)
$$;

-- 인증 공무원 - 확인된 메일의 도메인이 설정 qna_gov_domains 목록과 정확히 일치하거나 그 하위일 때만 (notgo.kr 같은 위장 거부)
create function public.qna_gov_verified(p_user uuid) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_domains jsonb;
  d text;
begin
  select lower(u.email) into v_email from auth.users u where u.id = p_user and u.email_confirmed_at is not null;
  if v_email is null then return false; end if;
  select s.value -> 'domains' into v_domains from public.settings s where s.key = 'qna_gov_domains';
  if jsonb_typeof(v_domains) is distinct from 'array' then return false; end if;
  for d in select jsonb_array_elements_text(v_domains) loop
    if v_email ~ ('@([a-z0-9-]+\.)*' || replace(lower(d), '.', '\.') || '$') then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 제재 (QNA-05) - 질문·답변 글쓰기를 막는다. 해제는 lifted 칸만 채운다
-- ─────────────────────────────────────────────────────────────
create table public.qna_sanctions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 1 and 300),
  report_id bigint,
  started_at timestamptz not null default now(),
  ends_at timestamptz,
  lifted_at timestamptz,
  lifted_by text,
  created_by text not null check (length(btrim(created_by)) > 0),
  constraint qna_sanctions_end_after_start check (ends_at is null or ends_at > started_at),
  constraint qna_sanctions_lift_record check ((lifted_at is null) = (lifted_by is null))
);
comment on table public.qna_sanctions is '라운지 제재 이력 (QNA-05) - 글쓰기 금지 기간. 활동 전문가 띠에서 제재 중·기간 안 제재 이력이 있는 전문가를 뺀다 (QNA-08)';
create index qna_sanctions_user_idx on public.qna_sanctions (user_id);

create function public.qna_user_sanctioned(p_user uuid, p_at timestamptz default now()) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.qna_sanctions s
                  where s.user_id = p_user and s.started_at <= p_at
                    and (s.lifted_at is null or s.lifted_at > p_at)
                    and (s.ends_at is null or s.ends_at > p_at))
$$;

create function public.qna_sanctions_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.reason <> old.reason or (new.report_id is distinct from old.report_id and new.report_id is not null)
       or new.started_at <> old.started_at or new.ends_at is distinct from old.ends_at or new.created_by <> old.created_by
       or old.lifted_at is not null then
      raise exception '제재는 해제 칸 외에는 고칠 수 없습니다' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.qna_sanctions_guard() from public, anon, authenticated;
create trigger qna_sanctions_guard
  before update on public.qna_sanctions
  for each row execute function public.qna_sanctions_guard();

-- ─────────────────────────────────────────────────────────────
-- 질문 (QNA-01 · 03)
-- ─────────────────────────────────────────────────────────────
create table public.qna_questions (
  id bigint generated always as identity primary key,
  author_id uuid not null references auth.users (id) on delete cascade,
  tax_type text not null check (char_length(btrim(tax_type)) between 1 and 30),
  title text not null check (char_length(btrim(title)) between 2 and 120),
  body text not null check (char_length(btrim(body)) between 2 and 4000),
  status text not null default 'open' check (status in ('open', 'held', 'hidden')),
  hold_reason text check (hold_reason is null or hold_reason in ('pii', 'contact_terms', 'consult_terms')),
  masked_kinds text[] not null default '{}' check (cardinality(masked_kinds) <= 10),
  accepted_answer_id bigint,
  accepted_at timestamptz,
  hidden_at timestamptz,
  hidden_reason text check (hidden_reason is null or char_length(hidden_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qna_questions_hold_record check ((status = 'held') = (hold_reason is not null)),
  constraint qna_questions_hidden_record check ((status = 'hidden') = (hidden_at is not null)),
  constraint qna_questions_no_pii check (not public.qna_pii_problem(title) and not public.qna_pii_problem(body))
);
comment on table public.qna_questions is '라운지 질문 (QNA-01) - 가림이 끝난 본문만 저장(masked_kinds는 가린 종류 이름뿐). 상담 신청·매칭·소개 대가·연락처 칸 없음. 지방세봇 색인 대상 아님 (chunks.source_type 허용 목록 밖, QNA-07)';
create index qna_questions_status_created_idx on public.qna_questions (status, created_at desc);
create index qna_questions_author_idx on public.qna_questions (author_id);

-- ─────────────────────────────────────────────────────────────
-- 답변 (QNA-02)
-- ─────────────────────────────────────────────────────────────
create table public.qna_answers (
  id bigint generated always as identity primary key,
  question_id bigint not null references public.qna_questions (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  author_kind text not null check (author_kind in ('expert', 'gov', 'member')),
  expert_profile_id bigint references public.expert_profiles (id),
  body text not null check (char_length(btrim(body)) between 2 and 4000),
  status text not null default 'published' check (status in ('published', 'held', 'hidden')),
  hold_reason text check (hold_reason is null or hold_reason in ('pii', 'contact_terms', 'consult_terms')),
  masked_kinds text[] not null default '{}' check (cardinality(masked_kinds) <= 10),
  accepted_at timestamptz,
  hidden_at timestamptz,
  hidden_reason text check (hidden_reason is null or char_length(hidden_reason) <= 300),
  created_at timestamptz not null default now(),
  constraint qna_answers_expert_pair check ((author_kind = 'expert') = (expert_profile_id is not null)),
  constraint qna_answers_hold_record check ((status = 'held') = (hold_reason is not null)),
  constraint qna_answers_hidden_record check ((status = 'hidden') = (hidden_at is not null)),
  constraint qna_answers_no_pii check (not public.qna_pii_problem(body))
);
comment on table public.qna_answers is '라운지 답변 (QNA-02) - author_kind expert는 쓰는 순간 유효한 SM 전문가 연결이 있어야 하고(트리거), 화면 배지는 읽는 순간 다시 판정한다(만료·해제 뒤 배지 0). 답변자 대가·수수료 칸 없음';
create index qna_answers_question_idx on public.qna_answers (question_id, created_at);
create index qna_answers_expert_idx on public.qna_answers (expert_profile_id, created_at) where expert_profile_id is not null;
create index qna_answers_author_idx on public.qna_answers (author_id);

alter table public.qna_questions
  add constraint qna_questions_accepted_answer_fk foreign key (accepted_answer_id) references public.qna_answers (id) on delete set null;

-- 질문 쓰기 규칙
create function public.qna_questions_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hold text;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if new.status not in ('open', 'held') then
      raise exception '새 질문은 공개 또는 게시 보류로만 만들 수 있습니다' using errcode = 'check_violation';
    end if;
    if public.qna_user_sanctioned(new.author_id) then
      raise exception '제재 중인 계정은 글을 쓸 수 없습니다 (QNA-05)' using errcode = 'check_violation';
    end if;
    v_hold := public.qna_hold_reason(new.title || ' ' || new.body);
    if v_hold is not null and new.status = 'open' then
      new.status := 'held';
      new.hold_reason := v_hold;
    end if;
  else
    if new.author_id <> old.author_id or new.tax_type <> old.tax_type or new.title <> old.title or new.body <> old.body
       or new.masked_kinds <> old.masked_kinds or new.created_at <> old.created_at then
      raise exception '질문 본문·작성자·세목은 고칠 수 없습니다' using errcode = 'check_violation';
    end if;
    if old.accepted_answer_id is not null and new.accepted_answer_id is distinct from old.accepted_answer_id and new.accepted_answer_id is not null then
      raise exception '채택은 한 번만 할 수 있습니다' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.qna_questions_guard() from public, anon, authenticated;
create trigger qna_questions_guard
  before insert or update on public.qna_questions
  for each row execute function public.qna_questions_guard();

-- 답변 쓰기 규칙
create function public.qna_answers_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hold text;
  v_profile bigint;
  v_qstatus text;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('published', 'held') then
      raise exception '새 답변은 공개 또는 게시 보류로만 만들 수 있습니다' using errcode = 'check_violation';
    end if;
    select q.status into v_qstatus from public.qna_questions q where q.id = new.question_id;
    if v_qstatus is distinct from 'open' then
      raise exception '공개 중인 질문에만 답할 수 있습니다' using errcode = 'check_violation';
    end if;
    if public.qna_user_sanctioned(new.author_id) then
      raise exception '제재 중인 계정은 글을 쓸 수 없습니다 (QNA-05)' using errcode = 'check_violation';
    end if;
    if new.author_kind = 'expert' then
      v_profile := public.expert_badge_valid(new.author_id);
      if v_profile is null or v_profile is distinct from new.expert_profile_id then
        raise exception '전문가 답변 배지는 지금 유효한 SM 전문가 연결이 있는 계정에만 붙습니다 (EXP-01·QNA-02)' using errcode = 'check_violation';
      end if;
    elsif new.author_kind = 'gov' and not public.qna_gov_verified(new.author_id) then
      raise exception '공무원 인증 표시는 인증된 공공기관 메일 계정에만 붙습니다 (EXP-01)' using errcode = 'check_violation';
    end if;
    v_hold := public.qna_hold_reason(new.body);
    if v_hold is not null and new.status = 'published' then
      new.status := 'held';
      new.hold_reason := v_hold;
    end if;
  else
    if new.question_id <> old.question_id or new.author_id <> old.author_id or new.author_kind <> old.author_kind
       or new.expert_profile_id is distinct from old.expert_profile_id or new.body <> old.body
       or new.masked_kinds <> old.masked_kinds or new.created_at <> old.created_at then
      raise exception '답변 본문·작성자·배지 종류는 고칠 수 없습니다' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.qna_answers_guard() from public, anon, authenticated;
create trigger qna_answers_guard
  before insert or update on public.qna_answers
  for each row execute function public.qna_answers_guard();

-- ─────────────────────────────────────────────────────────────
-- 신고 (QNA-05) - 처리 목표 1영업일 (due_at은 서버가 영업일 규칙으로 계산해 넣는다)
-- ─────────────────────────────────────────────────────────────
create table public.qna_reports (
  id bigint generated always as identity primary key,
  target_type text not null check (target_type in ('question', 'answer')),
  target_id bigint not null,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reason text not null check (reason in ('ad', 'pii', 'abuse', 'other')),
  note text not null default '' check (char_length(note) <= 200 and not public.qna_pii_problem(note)),
  status text not null default 'received' check (status in ('received', 'upheld', 'dismissed')),
  due_at timestamptz not null,
  handled_by text,
  handled_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 300),
  created_at timestamptz not null default now(),
  constraint qna_reports_handled_record check (
    (status = 'received') = (handled_at is null)
    and (status = 'received' or length(btrim(coalesce(handled_by, ''))) > 0)),
  constraint qna_reports_unique_per_reporter unique (reporter_id, target_type, target_id)
);
comment on table public.qna_reports is '라운지 신고 (QNA-05) - 광고성·개인정보·욕설. 처리 목표 1영업일(due_at). 신고자 한 명이 같은 글을 두 번 신고할 수 없다';
create index qna_reports_status_due_idx on public.qna_reports (status, due_at);
alter table public.qna_sanctions
  add constraint qna_sanctions_report_fk foreign key (report_id) references public.qna_reports (id) on delete set null;

-- 채택 (QNA-02) - 질문자만, 공개 중인 남의 답변 하나, 한 번만
create function public.qna_accept(p_question bigint, p_answer bigint, p_user uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q public.qna_questions%rowtype;
  v_a public.qna_answers%rowtype;
begin
  select * into v_q from public.qna_questions q where q.id = p_question for update;
  if not found or v_q.status <> 'open' then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_q.author_id <> p_user then return jsonb_build_object('ok', false, 'code', 'not_author'); end if;
  if v_q.accepted_answer_id is not null then return jsonb_build_object('ok', false, 'code', 'already_accepted'); end if;
  select * into v_a from public.qna_answers a where a.id = p_answer and a.question_id = p_question;
  if not found or v_a.status <> 'published' then return jsonb_build_object('ok', false, 'code', 'answer_not_found'); end if;
  if v_a.author_id = p_user then return jsonb_build_object('ok', false, 'code', 'self_accept'); end if;
  update public.qna_answers set accepted_at = now() where id = p_answer;
  update public.qna_questions set accepted_answer_id = p_answer, accepted_at = now() where id = p_question;
  return jsonb_build_object('ok', true);
end;
$$;

alter table public.qna_questions enable row level security;
alter table public.qna_answers enable row level security;
alter table public.qna_reports enable row level security;
alter table public.qna_sanctions enable row level security;
revoke all on table public.qna_questions, public.qna_answers, public.qna_reports, public.qna_sanctions from anon, authenticated, service_role;
grant select, insert on table public.qna_questions, public.qna_answers, public.qna_reports, public.qna_sanctions to service_role;
grant update (status, hold_reason, accepted_answer_id, accepted_at, hidden_at, hidden_reason) on table public.qna_questions to service_role;
grant update (status, hold_reason, accepted_at, hidden_at, hidden_reason) on table public.qna_answers to service_role;
grant update (status, handled_by, handled_at, resolution_note) on table public.qna_reports to service_role;
grant update (lifted_at, lifted_by) on table public.qna_sanctions to service_role;

revoke all on function public.qna_pii_problem(text) from public, anon, authenticated;
revoke all on function public.qna_hold_reason(text) from public, anon, authenticated;
revoke all on function public.qna_is_open() from public, anon, authenticated;
revoke all on function public.qna_gov_verified(uuid) from public, anon, authenticated;
revoke all on function public.qna_user_sanctioned(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.qna_accept(bigint, bigint, uuid) from public, anon, authenticated;
grant execute on function public.qna_pii_problem(text) to service_role;
grant execute on function public.qna_hold_reason(text) to service_role;
grant execute on function public.qna_is_open() to service_role;
grant execute on function public.qna_gov_verified(uuid) to service_role;
grant execute on function public.qna_user_sanctioned(uuid, timestamptz) to service_role;
grant execute on function public.qna_accept(bigint, bigint, uuid) to service_role;
