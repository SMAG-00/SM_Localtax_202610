-- W13-h h3 — O5 질문 분류 (PRD-05 AIOPS-15 · QNA-03, docs/dev/W13-h_설계.md 2장)
-- · 정규식 분류 제안 + 운영자 큐. AI 분류 단계는 4단계 AI 공통 기반 운영 뒤에 켠다 - 그때까지 source는 regex만 허용한다 (AI 우회 경로 0).
-- · 제안은 "참고"일 뿐이다. 운영자가 수락해야 최종 세목(final_tax_type)이 정해지고, 해결 사례 카드 세목에만 쓰인다.
--   질문 본문·세목은 DB 규칙상 고치지 않는다.
-- · 함수는 service_role 전용, 거부는 { ok:false, code }.

create table public.qna_classifications (
  id bigint generated always as identity primary key,
  question_id bigint not null unique references public.qna_questions (id) on delete cascade,
  source text not null default 'regex' check (source = 'regex'),
  proposed_tax_types text[] not null default '{}' check (cardinality(proposed_tax_types) <= 5),
  pii_suspected boolean not null default false,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'rejected')),
  final_tax_type text check (final_tax_type is null or char_length(btrim(final_tax_type)) between 1 and 30),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint qna_classifications_review_record check (
    (status = 'proposed') = (reviewed_by is null and reviewed_at is null)
    and ((status = 'accepted') = (final_tax_type is not null))
  )
);
comment on table public.qna_classifications is '질문 분류 제안 큐 (AIOPS-15) - 정규식 제안, 운영자 수락/거절. source=regex만 허용(AI 단계는 4단계 기반 운영 뒤)';
create index qna_classifications_status_idx on public.qna_classifications (status, created_at);
alter table public.qna_classifications enable row level security;
revoke all on table public.qna_classifications from anon, authenticated, service_role;
grant select on table public.qna_classifications to service_role;

create function public.qna_classify_propose(p_question bigint, p_tax_types text[], p_pii_suspected boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.qna_questions q where q.id = p_question) then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  begin
    insert into public.qna_classifications (question_id, proposed_tax_types, pii_suspected)
    values (p_question, coalesce(p_tax_types, '{}'), coalesce(p_pii_suspected, false))
    on conflict (question_id) do nothing;
  exception
    when check_violation then return jsonb_build_object('ok', false, 'code', 'bad_input');
  end;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.qna_classify_review(p_id bigint, p_decision text, p_final_tax_type text, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then return jsonb_build_object('ok', false, 'code', 'actor_required'); end if;
  if p_decision not in ('accepted', 'rejected') then return jsonb_build_object('ok', false, 'code', 'bad_decision'); end if;
  if p_decision = 'accepted' and (p_final_tax_type is null or char_length(btrim(p_final_tax_type)) not between 1 and 30) then
    return jsonb_build_object('ok', false, 'code', 'tax_type_required');
  end if;
  if p_decision = 'rejected' and p_final_tax_type is not null then return jsonb_build_object('ok', false, 'code', 'reject_has_tax_type'); end if;
  update public.qna_classifications
     set status = p_decision, final_tax_type = case when p_decision = 'accepted' then btrim(p_final_tax_type) end, reviewed_by = btrim(p_actor), reviewed_at = now()
   where id = p_id and status = 'proposed';
  get diagnostics v_count = row_count;
  if v_count = 0 then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.qna_classify_propose(bigint, text[], boolean) from public, anon, authenticated;
revoke all on function public.qna_classify_review(bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.qna_classify_propose(bigint, text[], boolean) to service_role;
grant execute on function public.qna_classify_review(bigint, text, text, text) to service_role;

-- 공개 뷰 재정의 - 수락된 분류 세목이 있으면 그것을 쓴다 (열 목록·순서는 223과 같다)
create or replace view public.public_solved_cases as
select c.id, c.question_id, coalesce(k.final_tax_type, q.tax_type) as tax_type, c.situation, c.issue, c.result, c.lesson, c.approved_at
  from public.qna_solved_cases c
  join public.qna_questions q on q.id = c.question_id
  left join public.qna_classifications k on k.question_id = q.id and k.status = 'accepted'
 where c.status = 'approved' and q.solved_consent and q.status = 'open' and q.accepted_answer_id is not null
   -- 223과 같은 이유로 함수 대신 조건을 직접 둔다 (뷰 안의 함수 실행 권한은 읽는 사람 기준)
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'solved_cases') = 'true'::jsonb)
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'qna') = 'true'::jsonb)
   and exists (select 1 from public.settings n where n.key = 'qna_neutrality_notice' and (n.value -> 'approved') = 'true'::jsonb);
