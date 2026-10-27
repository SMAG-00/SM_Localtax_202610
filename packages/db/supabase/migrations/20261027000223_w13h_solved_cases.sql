-- W13-h h1 — 홈 해결 사례 (PRD-05 HOME-11, docs/dev/W13-h_설계.md 2장)
-- · qna_questions에 선택 동의 칸. 동의는 질문 등록 때만 켤 수 있고 이후에는 철회(끄기)만 된다 (결정 #17).
-- · qna_solved_cases - 편집자가 쓴 카드(상황·쟁점·결과·교훈). 승인 = 가림 확인 + 승인자 기록 + 네 칸 모두 채움. AI가 쓰는 칸 아님.
-- · 공개는 뷰 public_solved_cases뿐 - 승인됨 ∧ 지금도 동의 ∧ 원 질문 공개·채택 유지 ∧ 라운지 열림 ∧ 기능 키 solved_cases 켜짐.
--   동의를 철회하거나 질문이 숨겨지면 다음 요청부터 빠진다(읽는 순간 판정). 작성자 번호 칸 없음.
-- · 모든 함수는 service_role 전용이고 거부는 { ok:false, code }로 돌려준다 (감사 로그는 서버 라우트가 남긴다).

alter table public.qna_questions
  add column solved_consent boolean not null default false,
  add column solved_consent_at timestamptz,
  add column solved_consent_withdrawn_at timestamptz,
  add constraint qna_questions_consent_record check (
    (not solved_consent or solved_consent_at is not null) and (solved_consent_withdrawn_at is null or not solved_consent)
  );
comment on column public.qna_questions.solved_consent is '홈 해결 사례 소개 선택 동의 (HOME-11, 기본 꺼짐). 등록 때만 켤 수 있고 이후 철회만 가능';

create function public.qna_questions_consent_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.solved_consent then
      new.solved_consent_at := now();
    else
      new.solved_consent_at := null;
    end if;
    new.solved_consent_withdrawn_at := null;
  else
    if new.solved_consent and not old.solved_consent then
      raise exception '해결 사례 소개 동의는 질문을 등록할 때만 할 수 있습니다' using errcode = 'check_violation';
    end if;
    if new.solved_consent_at is distinct from old.solved_consent_at then
      raise exception '동의 시각은 고칠 수 없습니다' using errcode = 'check_violation';
    end if;
    if old.solved_consent and not new.solved_consent then
      new.solved_consent_withdrawn_at := coalesce(new.solved_consent_withdrawn_at, now());
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.qna_questions_consent_guard() from public, anon, authenticated;
create trigger qna_questions_consent_guard
  before insert or update on public.qna_questions
  for each row execute function public.qna_questions_consent_guard();

-- 켜짐 판정 - 기능 키 solved_cases ∧ 라운지 열림
create function public.solved_cases_is_open() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'solved_cases') = 'true'::jsonb)
     and (exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'qna') = 'true'::jsonb)
        and exists (select 1 from public.settings n where n.key = 'qna_neutrality_notice' and (n.value -> 'approved') = 'true'::jsonb))
$$;
revoke all on function public.solved_cases_is_open() from public, anon, authenticated;
grant execute on function public.solved_cases_is_open() to service_role;

create table public.qna_solved_cases (
  id bigint generated always as identity primary key,
  question_id bigint not null unique references public.qna_questions (id) on delete cascade,
  situation text not null default '' check (char_length(situation) <= 400),
  issue text not null default '' check (char_length(issue) <= 400),
  result text not null default '' check (char_length(result) <= 400),
  lesson text not null default '' check (char_length(lesson) <= 400),
  status text not null default 'draft' check (status in ('draft', 'approved', 'unpublished')),
  mask_confirmed_by text,
  mask_confirmed_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  unpublished_by text,
  unpublished_at timestamptz,
  unpublished_reason text check (unpublished_reason is null or char_length(unpublished_reason) <= 300),
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qna_solved_cases_no_pii check (
    not public.qna_pii_problem(situation) and not public.qna_pii_problem(issue) and not public.qna_pii_problem(result) and not public.qna_pii_problem(lesson)
  ),
  constraint qna_solved_cases_approved_record check (
    status <> 'approved' or (
      approved_by is not null and approved_at is not null and mask_confirmed_by is not null and mask_confirmed_at is not null
      and length(btrim(situation)) > 0 and length(btrim(issue)) > 0 and length(btrim(result)) > 0 and length(btrim(lesson)) > 0
    )
  ),
  constraint qna_solved_cases_unpublished_record check ((status = 'unpublished') = (unpublished_at is not null))
);
comment on table public.qna_solved_cases is '홈 해결 사례 카드 (HOME-11) - 편집자가 직접 쓴 네 칸. 승인에는 질문자 동의·가림 확인·승인자가 필요하다. 작성자 번호·연락처 칸 없음';
create index qna_solved_cases_status_idx on public.qna_solved_cases (status, approved_at desc);

alter table public.qna_solved_cases enable row level security;
revoke all on table public.qna_solved_cases from anon, authenticated, service_role;
grant select on table public.qna_solved_cases to service_role;

-- 카드 저장 (초안). 동의한 공개 질문 + 채택된 답변이 있어야 한다. 승인된 카드를 고치면 초안으로 돌아간다
create function public.qna_solved_case_save(p_question bigint, p_situation text, p_issue text, p_result text, p_lesson text, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q public.qna_questions%rowtype;
  v_id bigint;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then return jsonb_build_object('ok', false, 'code', 'actor_required'); end if;
  select * into v_q from public.qna_questions q where q.id = p_question;
  if not found or v_q.status <> 'open' then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not v_q.solved_consent then return jsonb_build_object('ok', false, 'code', 'no_consent'); end if;
  if v_q.accepted_answer_id is null then return jsonb_build_object('ok', false, 'code', 'not_resolved'); end if;
  begin
    insert into public.qna_solved_cases (question_id, situation, issue, result, lesson, created_by)
    values (p_question, btrim(coalesce(p_situation, '')), btrim(coalesce(p_issue, '')), btrim(coalesce(p_result, '')), btrim(coalesce(p_lesson, '')), btrim(p_actor))
    on conflict (question_id) do update
      set situation = excluded.situation, issue = excluded.issue, result = excluded.result, lesson = excluded.lesson,
          status = 'draft', mask_confirmed_by = null, mask_confirmed_at = null, approved_by = null, approved_at = null,
          unpublished_by = null, unpublished_at = null, unpublished_reason = null, updated_at = now()
    returning id into v_id;
  exception
    when check_violation then return jsonb_build_object('ok', false, 'code', 'bad_input');
  end;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- 승인 - 가림 확인 체크 + 지금도 동의 + 네 칸 채움
create function public.qna_solved_case_approve(p_id bigint, p_mask_confirmed boolean, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.qna_solved_cases%rowtype;
  v_q public.qna_questions%rowtype;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then return jsonb_build_object('ok', false, 'code', 'actor_required'); end if;
  if p_mask_confirmed is distinct from true then return jsonb_build_object('ok', false, 'code', 'mask_not_confirmed'); end if;
  select * into v_c from public.qna_solved_cases c where c.id = p_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_c.status <> 'draft' then return jsonb_build_object('ok', false, 'code', 'not_draft'); end if;
  select * into v_q from public.qna_questions q where q.id = v_c.question_id;
  if v_q.status <> 'open' or v_q.accepted_answer_id is null then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not v_q.solved_consent then return jsonb_build_object('ok', false, 'code', 'no_consent'); end if;
  if length(btrim(v_c.situation)) = 0 or length(btrim(v_c.issue)) = 0 or length(btrim(v_c.result)) = 0 or length(btrim(v_c.lesson)) = 0 then
    return jsonb_build_object('ok', false, 'code', 'incomplete');
  end if;
  update public.qna_solved_cases
     set status = 'approved', mask_confirmed_by = btrim(p_actor), mask_confirmed_at = now(), approved_by = btrim(p_actor), approved_at = now(), updated_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.qna_solved_case_unpublish(p_id bigint, p_reason text, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then return jsonb_build_object('ok', false, 'code', 'actor_required'); end if;
  if p_reason is null or length(btrim(p_reason)) = 0 or char_length(p_reason) > 300 then return jsonb_build_object('ok', false, 'code', 'reason_required'); end if;
  update public.qna_solved_cases
     set status = 'unpublished', unpublished_by = btrim(p_actor), unpublished_at = now(), unpublished_reason = btrim(p_reason), updated_at = now()
   where id = p_id and status <> 'unpublished';
  get diagnostics v_count = row_count;
  if v_count = 0 then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- 동의 철회 - 질문자 본인만. 연결된 카드는 함께 내린다 (공개 뷰는 읽는 순간 동의를 다시 보므로 철회 즉시 빠진다)
create function public.qna_solved_consent_withdraw(p_question bigint, p_user uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q public.qna_questions%rowtype;
begin
  select * into v_q from public.qna_questions q where q.id = p_question for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_q.author_id <> p_user then return jsonb_build_object('ok', false, 'code', 'not_author'); end if;
  if not v_q.solved_consent then return jsonb_build_object('ok', false, 'code', 'no_consent'); end if;
  update public.qna_questions set solved_consent = false where id = p_question;
  update public.qna_solved_cases
     set status = 'unpublished', unpublished_by = 'system', unpublished_at = now(), unpublished_reason = '질문자 동의 철회', updated_at = now()
   where question_id = p_question and status <> 'unpublished';
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.qna_solved_case_save(bigint, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.qna_solved_case_approve(bigint, boolean, text) from public, anon, authenticated;
revoke all on function public.qna_solved_case_unpublish(bigint, text, text) from public, anon, authenticated;
revoke all on function public.qna_solved_consent_withdraw(bigint, uuid) from public, anon, authenticated;
grant execute on function public.qna_solved_case_save(bigint, text, text, text, text, text) to service_role;
grant execute on function public.qna_solved_case_approve(bigint, boolean, text) to service_role;
grant execute on function public.qna_solved_case_unpublish(bigint, text, text) to service_role;
grant execute on function public.qna_solved_consent_withdraw(bigint, uuid) to service_role;

-- 공개 뷰 (224가 수락된 분류 세목을 쓰도록 다시 정의한다)
create view public.public_solved_cases as
select c.id, c.question_id, q.tax_type, c.situation, c.issue, c.result, c.lesson, c.approved_at
  from public.qna_solved_cases c
  join public.qna_questions q on q.id = c.question_id
 where c.status = 'approved' and q.solved_consent and q.status = 'open' and q.accepted_answer_id is not null
   -- 뷰 안의 함수 실행 권한은 읽는 사람(anon) 기준이라 solved_cases_is_open()을 부르지 않고 같은 조건을 직접 둔다
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'solved_cases') = 'true'::jsonb)
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'qna') = 'true'::jsonb)
   and exists (select 1 from public.settings n where n.key = 'qna_neutrality_notice' and (n.value -> 'approved') = 'true'::jsonb);
revoke all on table public.public_solved_cases from public, anon, authenticated;
grant select on table public.public_solved_cases to anon, authenticated, service_role;
