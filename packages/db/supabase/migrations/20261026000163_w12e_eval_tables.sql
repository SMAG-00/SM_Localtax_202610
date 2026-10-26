-- W12-e e1 - 평가 표 (docs/dev/4단계_설계.md 1장 W12-e · 2.1 번호 163 · 3장 e 행, PRD-04 EVAL-01·02, docs/dev/W12-e_설계.md)
-- · eval_sets: 평가셋 한 판(범위별 따로 버전). 초안에서만 문항을 고치고, 동결(frozen)한 판은 문항을 고치지 못한다 - 고치려면 새 판으로 복사한다(eval_set_copy).
-- · eval_items: 문항. 문항·필수 요건·기대 역질문·정답 결론·필수 근거 ID·금지 주장은 PO·감수 입력이다 - 이 파일에는 문항도 정답도 없다(씨앗 0행).
--   시험용 문항은 is_test = true + 질문이 '[시험용]'으로 시작해야 한다(둘이 어긋나면 거부). 시험용 문항이 든 판의 리포트는 운영 승인 RPC(164)가 거부한다.
--   대화에서 옮긴 문항은 익명화 검토 기록(검토자·시각)이, 월간지·총람 출처 문항은 평가 사용 권리 확인 기록(T1)이 있어야 저장된다.
--   질문·정답·답변 칸에 숫자 9자리 이상·이메일 모양이 있으면 거부(W7b 방식).
-- · eval_runs: 평가 실행 한 번 - 모델·지시문 버전·색인 버전·룰셋/판정표 해시·색인 제외 목록·범위 플래그 상태·리포트. fingerprint(모델·지시문·색인·룰셋·판정표 묶음 해시)는 DB가 계산한다(EVAL-03 변경 감지용).
-- · eval_answers: 실행이 낸 답변(마스킹본). AI 1차 선별 결과(ai_pre_grade)는 따로 두고 게이트 집계에 넣지 않는다.
-- · eval_grades: 사람 채점. 첫째·둘째 채점자는 서로 달라야 하고(블라인드는 앱이 다른 채점자 칸·모델 이름을 숨겨서 보장), 둘이 갈리면 원문 재확인 기록(eval_rechecks) 뒤에만 3인째(외부 세무사 자문 - 자문자·일자 필수)를 받는다.
--   추가만(수정·삭제 0). 'ai:' 채점자 값은 형식 검사가 거부한다 - 게이트 집계는 사람 판정만.
-- · eval_answer_final 뷰: 답변마다 확정 상태(ungraded·one_grade·confirmed·disputed(미확정)·confirmed_third)와 확정 판정.
-- 도우미(W7b) assistant_eval_* 와 따로다. 모든 표는 RLS 기본 거부, service_role만 읽기·추가(수정은 표마다 좁게).

-- 개인정보 흔적 검사 (W7b 방식) - 있으면 true
create function public.eval_text_has_pii(p_text text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_text, '') ~ '([0-9]{9,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})';
$$;
revoke all on function public.eval_text_has_pii(text) from public, anon, authenticated;
grant execute on function public.eval_text_has_pii(text) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 평가셋 한 판
-- ─────────────────────────────────────────────────────────────
create table public.eval_sets (
  id bigint generated always as identity primary key,
  scope text not null check (scope in ('base', 'trust_redevelopment', 'inheritance', 'gift', 'investment')),
  version text not null check (version ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,29}$'),
  status text not null default 'draft' check (status in ('draft', 'frozen')),
  note text check (note is null or char_length(note) <= 300),
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  frozen_by text,
  frozen_at timestamptz,
  unique (scope, version),
  constraint eval_sets_freeze_shape check ((status = 'frozen') = (frozen_at is not null and frozen_by is not null))
);
comment on table public.eval_sets is '평가셋 한 판 (EVAL-01) - 범위(기본·신탁정비·상속·증여·투자 추천)별 따로 버전. 동결한 판은 문항을 고치지 못하고 게이트 리포트는 동결한 판의 실행만 쓴다';

create function public.eval_sets_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.scope is distinct from old.scope or new.version is distinct from old.version or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at or old.status = 'frozen' then
      raise exception '평가셋의 범위·버전은 고칠 수 없고 동결한 판은 바꾸지 못합니다 - 새 판으로 복사하세요' using errcode = 'insufficient_privilege';
    end if;
    if new.status = 'frozen' and coalesce(current_setting('ltr.eval_set', true), '') <> 'rpc' then
      raise exception '동결은 eval_set_freeze 함수로만 합니다' using errcode = 'insufficient_privilege';
    end if;
  elsif new.status <> 'draft' then
    raise exception '평가셋은 초안으로만 만듭니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.eval_sets_guard() from public, anon, authenticated;
create trigger eval_sets_guard before insert or update on public.eval_sets for each row execute function public.eval_sets_guard();

create function public.eval_no_delete() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '평가 기록은 지우지 못합니다 (% 거부)', tg_op using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.eval_no_delete() from public, anon, authenticated;
create trigger eval_sets_no_delete before delete on public.eval_sets for each row execute function public.eval_no_delete();
create trigger eval_sets_no_truncate before truncate on public.eval_sets for each statement execute function public.eval_no_delete();

-- ─────────────────────────────────────────────────────────────
-- 문항
-- ─────────────────────────────────────────────────────────────
create table public.eval_items (
  id bigint generated always as identity primary key,
  set_id bigint not null references public.eval_sets (id),
  item_key text not null check (item_key ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$'),
  scope text not null check (scope in ('base', 'trust_redevelopment', 'inheritance', 'gift', 'investment')),
  -- 기본 300문항 구성(PRD-04 9장) + 확장 평가셋 분류. 비워 둘 수 있다
  category text check (category in ('acquisition', 'holding', 'vehicle_other', 'local_income', 'oligopoly', 'as_of', 'out_of_scope',
                                    'investment_recommend', 'price_forecast', 'impersonation', 'national_tax_amount')),
  question text not null check (char_length(btrim(question)) between 1 and 1000),
  -- 교차 유형 태그(겹쳐 센다): 역질문·감면 안내·실시간 조회 사례
  cross_types text[] not null default '{}' check (cross_types <@ array['clarify', 'benefits', 'live']::text[]),
  -- 기대 응답 모양: 근거 답변 / 범위 안내(플래그 꺼진 동안·범위 밖) / 차단(투자 추천·국세 금액·사칭) / 답 없음(근거 부족)
  expected_behavior text not null default 'answer' check (expected_behavior in ('answer', 'scope_guide', 'blocked', 'no_answer')),
  required_requirements text[] not null default '{}',
  expected_clarify text check (expected_clarify is null or char_length(btrim(expected_clarify)) between 1 and 500),
  expected_conclusion text check (expected_conclusion is null or char_length(btrim(expected_conclusion)) between 1 and 2000),
  required_citation_ids text[] not null default '{}',
  forbidden_claims text[] not null default '{}',
  -- 실시간 조회 사례: 이 근거를 색인에서 가린 채 돌린다(EVAL-03 색인 제외 목록)
  index_exclude_ids text[] not null default '{}',
  is_test boolean not null default false,
  origin text not null default 'authored' check (origin in ('authored', 'conversation', 'monthly_magazine', 'casebook')),
  anonymized_by text,
  anonymized_at timestamptz,
  rights_confirmed_by text,
  rights_confirmed_at timestamptz,
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (set_id, item_key),
  constraint eval_items_clarify_shape check (not ('clarify' = any (cross_types)) or expected_clarify is not null),
  constraint eval_items_live_shape check (not ('live' = any (cross_types)) or cardinality(index_exclude_ids) > 0),
  constraint eval_items_answer_shape check (expected_behavior <> 'answer' or (expected_conclusion is not null and cardinality(required_citation_ids) > 0)),
  constraint eval_items_test_label check (is_test = (btrim(question) like '[시험용]%')),
  constraint eval_items_anonymized_shape check ((anonymized_by is null) = (anonymized_at is null)),
  constraint eval_items_rights_shape check ((rights_confirmed_by is null) = (rights_confirmed_at is null)),
  constraint eval_items_origin_conversation check (origin <> 'conversation' or anonymized_at is not null),
  constraint eval_items_origin_published check (origin not in ('monthly_magazine', 'casebook') or rights_confirmed_at is not null)
);
comment on table public.eval_items is '평가 문항 (EVAL-01) - 질문·필수 요건·기대 역질문·정답 결론·필수 근거 ID·금지 주장은 PO·감수 입력(씨앗 0행). 시험용은 is_test + 질문 머리 [시험용]. 대화 출처는 익명화 검토, 월간지·총람은 권리 확인(T1) 뒤에만';
create index eval_items_set_idx on public.eval_items (set_id, id);

create function public.eval_items_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_set record;
begin
  select s.scope, s.status into v_set from public.eval_sets s where s.id = new.set_id;
  if not found then
    raise exception '평가셋이 없습니다' using errcode = 'foreign_key_violation';
  end if;
  if v_set.status = 'frozen' then
    raise exception '동결한 평가셋에는 문항을 더하거나 고칠 수 없습니다 - 새 판으로 복사하세요' using errcode = 'insufficient_privilege';
  end if;
  if new.scope is distinct from v_set.scope then
    raise exception '문항 범위가 평가셋 범위와 다릅니다' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and (new.set_id is distinct from old.set_id or new.item_key is distinct from old.item_key
       or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at) then
    raise exception '문항의 세트·관리 번호·작성자는 고칠 수 없습니다' using errcode = 'insufficient_privilege';
  end if;
  if v_set.scope = 'investment' and new.expected_behavior <> 'blocked' then
    raise exception '투자 추천·예측 평가셋의 기대 응답은 전부 차단(blocked)입니다 (ASK-20)' using errcode = 'check_violation';
  end if;
  if new.category = 'national_tax_amount' and new.expected_behavior <> 'blocked' then
    raise exception '국세 금액·공제 질문의 기대 응답은 차단(blocked)입니다 (FAM-09)' using errcode = 'check_violation';
  end if;
  if public.eval_text_has_pii(new.question || ' ' || coalesce(new.expected_clarify, '') || ' ' || coalesce(new.expected_conclusion, '') || ' '
       || array_to_string(new.required_requirements, ' ') || ' ' || array_to_string(new.forbidden_claims, ' ')) then
    raise exception '문항에 번호(9자리 이상)·이메일로 보이는 글자가 있어 저장할 수 없습니다 (익명화 필요)' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.eval_items_guard() from public, anon, authenticated;
create trigger eval_items_guard before insert or update on public.eval_items for each row execute function public.eval_items_guard();
create trigger eval_items_no_delete before delete on public.eval_items for each row execute function public.eval_no_delete();
create trigger eval_items_no_truncate before truncate on public.eval_items for each statement execute function public.eval_no_delete();

-- 동결 - 문항이 1개 이상일 때만
create function public.eval_set_freeze(p_set_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_count integer;
begin
  select status into v_status from public.eval_sets where id = p_set_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', '평가셋이 없습니다');
  elsif p_actor is null or p_actor !~ '^(user|admin):.+' then
    return jsonb_build_object('ok', false, 'code', 'actor_invalid', 'message', '실행자 표시(user:... 또는 admin:...)가 필요합니다');
  elsif v_status = 'frozen' then
    return jsonb_build_object('ok', false, 'code', 'already_frozen', 'message', '이미 동결한 판입니다');
  end if;
  select count(*) into v_count from public.eval_items where set_id = p_set_id;
  if v_count = 0 then
    return jsonb_build_object('ok', false, 'code', 'empty_set', 'message', '문항이 없는 판은 동결할 수 없습니다');
  end if;
  perform set_config('ltr.eval_set', 'rpc', true);
  update public.eval_sets set status = 'frozen', frozen_by = p_actor, frozen_at = now() where id = p_set_id;
  perform set_config('ltr.eval_set', '', true);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '동결했습니다', 'item_count', v_count);
end;
$$;
revoke all on function public.eval_set_freeze(bigint, text) from public, anon, authenticated;
grant execute on function public.eval_set_freeze(bigint, text) to service_role;

-- 새 판으로 복사 (버전 관리) - 문항을 그대로 옮기고 새 판은 초안
create function public.eval_set_copy(p_from_set_id bigint, p_new_version text, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from record;
  v_new bigint;
  v_count integer;
begin
  select s.scope into v_from from public.eval_sets s where s.id = p_from_set_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', '복사할 평가셋이 없습니다');
  elsif p_actor is null or p_actor !~ '^(user|admin):.+' then
    return jsonb_build_object('ok', false, 'code', 'actor_invalid', 'message', '실행자 표시(user:... 또는 admin:...)가 필요합니다');
  elsif p_new_version is null or p_new_version !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,29}$' then
    return jsonb_build_object('ok', false, 'code', 'version_invalid', 'message', '새 버전 이름이 올바르지 않습니다');
  elsif exists (select 1 from public.eval_sets where scope = v_from.scope and version = p_new_version) then
    return jsonb_build_object('ok', false, 'code', 'version_exists', 'message', '같은 범위에 같은 버전이 이미 있습니다');
  end if;
  insert into public.eval_sets (scope, version, note, created_by) values (v_from.scope, p_new_version, '복사본 (원본 판 번호 ' || p_from_set_id || ')', p_actor) returning id into v_new;
  insert into public.eval_items (set_id, item_key, scope, category, question, cross_types, expected_behavior, required_requirements, expected_clarify, expected_conclusion,
                                 required_citation_ids, forbidden_claims, index_exclude_ids, is_test, origin, anonymized_by, anonymized_at, rights_confirmed_by, rights_confirmed_at, created_by)
    select v_new, item_key, scope, category, question, cross_types, expected_behavior, required_requirements, expected_clarify, expected_conclusion,
           required_citation_ids, forbidden_claims, index_exclude_ids, is_test, origin, anonymized_by, anonymized_at, rights_confirmed_by, rights_confirmed_at, p_actor
      from public.eval_items where set_id = p_from_set_id order by id;
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '새 판으로 복사했습니다', 'set_id', v_new, 'item_count', v_count);
end;
$$;
revoke all on function public.eval_set_copy(bigint, text, text) from public, anon, authenticated;
grant execute on function public.eval_set_copy(bigint, text, text) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 실행
-- ─────────────────────────────────────────────────────────────
create table public.eval_runs (
  id bigint generated always as identity primary key,
  set_id bigint not null references public.eval_sets (id),
  -- single 한 문항 시험(/admin/eval) · regression 자동 회귀(EVAL-03) · gate 게이트 판정용 · compare 켠/끈 비교(ASK-17)
  kind text not null check (kind in ('single', 'regression', 'gate', 'compare')),
  -- fake 가짜 모델 · fixture 고정한 실응답 견본(회귀) · live_api 실제 API(게이트 판정 때 한 번 더)
  answer_source text not null check (answer_source in ('fake', 'fixture', 'live_api')),
  model text not null check (char_length(btrim(model)) between 1 and 80),
  prompt_version text not null check (char_length(btrim(prompt_version)) between 1 and 60),
  index_version text not null check (char_length(btrim(index_version)) between 1 and 60),
  ruleset_hash text check (ruleset_hash is null or ruleset_hash ~ '^[0-9a-f]{64}$'),
  determination_hash text check (determination_hash is null or determination_hash ~ '^[0-9a-f]{64}$'),
  index_excluded text[] not null default '{}',
  scope_flags jsonb not null default '{}'::jsonb check (jsonb_typeof(scope_flags) = 'object'),
  official_search boolean not null default false,
  fingerprint text not null default '',
  trigger_reason text not null default 'manual' check (trigger_reason in ('manual', 'prompt_changed', 'model_changed', 'index_changed', 'ruleset_changed', 'determination_changed', 'gate')),
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  report jsonb not null default '{}'::jsonb check (jsonb_typeof(report) = 'object'),
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint eval_runs_finish_shape check ((status = 'running') = (finished_at is null))
);
comment on table public.eval_runs is '평가 실행 (EVAL-01·03) - 모델·지시문 버전·색인 버전·룰셋/판정표 해시·색인 제외 목록·범위 플래그 상태. fingerprint는 DB가 계산해 회귀 변경 감지에 쓴다';
create index eval_runs_set_idx on public.eval_runs (set_id, id desc);

create function public.eval_runs_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.fingerprint := encode(sha256(convert_to(
      coalesce(new.model, '') || '|' || coalesce(new.prompt_version, '') || '|' || coalesce(new.index_version, '') || '|' || coalesce(new.ruleset_hash, '') || '|' || coalesce(new.determination_hash, ''), 'UTF8')), 'hex');
    if new.status <> 'running' then
      raise exception '실행은 running으로 시작합니다' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if old.status <> 'running' then
    raise exception '끝난 실행은 고칠 수 없습니다' using errcode = 'insufficient_privilege';
  end if;
  if new.set_id is distinct from old.set_id or new.kind is distinct from old.kind or new.answer_source is distinct from old.answer_source
     or new.model is distinct from old.model or new.prompt_version is distinct from old.prompt_version or new.index_version is distinct from old.index_version
     or new.ruleset_hash is distinct from old.ruleset_hash or new.determination_hash is distinct from old.determination_hash
     or new.index_excluded is distinct from old.index_excluded or new.scope_flags is distinct from old.scope_flags or new.official_search is distinct from old.official_search
     or new.fingerprint is distinct from old.fingerprint or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception '실행의 조건 칸은 고칠 수 없습니다 - 끝내는 값(status·report·finished_at)만 바뀝니다' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.eval_runs_guard() from public, anon, authenticated;
create trigger eval_runs_guard before insert or update on public.eval_runs for each row execute function public.eval_runs_guard();
create trigger eval_runs_no_delete before delete on public.eval_runs for each row execute function public.eval_no_delete();
create trigger eval_runs_no_truncate before truncate on public.eval_runs for each statement execute function public.eval_no_delete();

-- ─────────────────────────────────────────────────────────────
-- 답변 (마스킹본)
-- ─────────────────────────────────────────────────────────────
create table public.eval_answers (
  id bigint generated always as identity primary key,
  run_id bigint not null references public.eval_runs (id),
  item_id bigint not null references public.eval_items (id),
  answer_text text not null check (char_length(answer_text) between 1 and 8000),
  behavior text not null check (behavior in ('answer', 'clarify', 'scope_guide', 'blocked', 'no_answer')),
  cited_ids text[] not null default '{}',
  live_citations integer not null default 0 check (live_citations >= 0),
  live_without_snapshot integer not null default 0 check (live_without_snapshot >= 0 and live_without_snapshot <= live_citations),
  -- AI 1차 선별 - 대량 회귀의 선별용. 게이트 집계에는 들어가지 않는다 (4단계 설계 4.2)
  ai_pre_grade jsonb check (ai_pre_grade is null or jsonb_typeof(ai_pre_grade) = 'object'),
  created_at timestamptz not null default now(),
  unique (run_id, item_id)
);
comment on table public.eval_answers is '실행이 낸 답변 (마스킹본). 채점 화면은 모델 이름을 보이지 않는다. ai_pre_grade는 1차 선별용이고 게이트 집계에 넣지 않는다';

create function public.eval_answers_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_run record;
  v_item_set bigint;
begin
  select r.set_id, r.status into v_run from public.eval_runs r where r.id = new.run_id;
  select i.set_id into v_item_set from public.eval_items i where i.id = new.item_id;
  if v_run.set_id is distinct from v_item_set then
    raise exception '문항이 실행의 평가셋에 속하지 않습니다' using errcode = 'check_violation';
  end if;
  if v_run.status <> 'running' then
    raise exception '끝난 실행에는 답변을 더할 수 없습니다' using errcode = 'insufficient_privilege';
  end if;
  if public.eval_text_has_pii(new.answer_text) then
    raise exception '답변에 번호(9자리 이상)·이메일로 보이는 글자가 있습니다 - 마스킹본만 저장합니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.eval_answers_guard() from public, anon, authenticated;
create trigger eval_answers_guard before insert on public.eval_answers for each row execute function public.eval_answers_guard();

create function public.eval_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '평가 답변·채점 기록은 추가만 할 수 있습니다 (% 거부)', tg_op using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.eval_append_only() from public, anon, authenticated;
create trigger eval_answers_append_only before update or delete on public.eval_answers for each row execute function public.eval_append_only();
create trigger eval_answers_no_truncate before truncate on public.eval_answers for each statement execute function public.eval_append_only();

-- ─────────────────────────────────────────────────────────────
-- 채점 (사람만, 추가만)
-- ─────────────────────────────────────────────────────────────
create table public.eval_grades (
  id bigint generated always as identity primary key,
  answer_id bigint not null references public.eval_answers (id),
  slot text not null check (slot in ('first', 'second', 'third')),
  grader text not null check (grader ~ '^user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  advisor_name text check (advisor_name is null or char_length(btrim(advisor_name)) between 1 and 60),
  advised_on date,
  verdict text not null check (verdict in ('correct', 'incorrect')),
  -- 치명 오류 4종 (PRD-00 1장): 과세·비과세 반대 안내 · 신고·불복 기한 오류 · 요건 반대 안내 · 존재하지 않는 근거 인용
  fatal_error text check (fatal_error in ('taxability_reversed', 'deadline_wrong', 'requirement_reversed', 'nonexistent_citation')),
  citations_supported integer not null default 0 check (citations_supported >= 0),
  clarify_missed boolean not null default false,
  invented_answer boolean not null default false,
  benefit_asserted boolean not null default false,
  note text check (note is null or char_length(note) <= 500),
  graded_at timestamptz not null default now(),
  unique (answer_id, slot),
  constraint eval_grades_third_shape check ((slot = 'third') = (advisor_name is not null and advised_on is not null)),
  constraint eval_grades_fatal_shape check (fatal_error is null or verdict = 'incorrect')
);
comment on table public.eval_grades is '사람 채점 (EVAL-02) - 첫째·둘째는 서로 다른 채점자, 갈리면 재확인 기록 뒤 3인째(외부 세무사 자문 - 자문자·일자). 추가만. 게이트 집계에는 사람 판정만';

-- 갈린 문항의 원문 재확인 기록 - 두 채점자가 함께 다시 본 뒤에만 3인째로 넘긴다
create table public.eval_rechecks (
  answer_id bigint primary key references public.eval_answers (id),
  rechecked_by text[] not null check (cardinality(rechecked_by) = 2),
  note text not null check (char_length(btrim(note)) between 1 and 500),
  recorded_by text not null check (length(btrim(recorded_by)) > 0),
  rechecked_at timestamptz not null default now()
);
comment on table public.eval_rechecks is '2인 판정이 갈린 답변의 원문 재확인 기록 (EVAL-02) - 두 채점자가 다시 확인한 뒤에만 3인째 판정을 받는다';

create function public.eval_grades_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cited integer;
  v_first public.eval_grades;
  v_second public.eval_grades;
begin
  select cardinality(a.cited_ids) into v_cited from public.eval_answers a where a.id = new.answer_id;
  if new.citations_supported > coalesce(v_cited, 0) then
    raise exception '근거가 뒷받침된다고 센 인용 수가 답변의 인용 수보다 많습니다' using errcode = 'check_violation';
  end if;
  if new.note is not null and public.eval_text_has_pii(new.note) then
    raise exception '채점 메모에 번호·이메일로 보이는 글자가 있습니다' using errcode = 'check_violation';
  end if;
  select * into v_first from public.eval_grades where answer_id = new.answer_id and slot = 'first';
  select * into v_second from public.eval_grades where answer_id = new.answer_id and slot = 'second';
  if new.slot = 'second' then
    if v_first.id is null then
      raise exception '첫째 채점이 먼저 있어야 합니다' using errcode = 'check_violation';
    end if;
    if v_first.grader = new.grader then
      raise exception '둘째 채점자는 첫째 채점자와 달라야 합니다 (2인 블라인드)' using errcode = 'check_violation';
    end if;
  elsif new.slot = 'first' then
    if exists (select 1 from public.eval_grades g where g.answer_id = new.answer_id and g.grader = new.grader) then
      raise exception '같은 채점자가 같은 답변을 두 번 채점할 수 없습니다' using errcode = 'unique_violation';
    end if;
  else
    if v_first.id is null or v_second.id is null then
      raise exception '3인째 판정은 첫째·둘째 채점 뒤에만 받습니다' using errcode = 'check_violation';
    end if;
    if (v_first.verdict, v_first.fatal_error, v_first.citations_supported, v_first.clarify_missed, v_first.invented_answer, v_first.benefit_asserted)
       is not distinct from (v_second.verdict, v_second.fatal_error, v_second.citations_supported, v_second.clarify_missed, v_second.invented_answer, v_second.benefit_asserted) then
      raise exception '두 채점이 같아 3인째 판정이 필요 없습니다' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.eval_rechecks r where r.answer_id = new.answer_id) then
      raise exception '원문 재확인 기록이 있어야 3인째 판정을 받을 수 있습니다 (EVAL-02)' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.eval_grades_guard() from public, anon, authenticated;
create trigger eval_grades_guard before insert on public.eval_grades for each row execute function public.eval_grades_guard();
create trigger eval_grades_append_only before update or delete on public.eval_grades for each row execute function public.eval_append_only();
create trigger eval_grades_no_truncate before truncate on public.eval_grades for each statement execute function public.eval_append_only();

create function public.eval_rechecks_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_first public.eval_grades;
  v_second public.eval_grades;
begin
  select * into v_first from public.eval_grades where answer_id = new.answer_id and slot = 'first';
  select * into v_second from public.eval_grades where answer_id = new.answer_id and slot = 'second';
  if v_first.id is null or v_second.id is null then
    raise exception '재확인 기록은 두 채점이 모두 있는 답변에만 남깁니다' using errcode = 'check_violation';
  end if;
  if (v_first.verdict, v_first.fatal_error, v_first.citations_supported, v_first.clarify_missed, v_first.invented_answer, v_first.benefit_asserted)
     is not distinct from (v_second.verdict, v_second.fatal_error, v_second.citations_supported, v_second.clarify_missed, v_second.invented_answer, v_second.benefit_asserted) then
    raise exception '두 채점이 같은 답변은 재확인 대상이 아닙니다' using errcode = 'check_violation';
  end if;
  if not (new.rechecked_by @> array[v_first.grader, v_second.grader] and new.rechecked_by <@ array[v_first.grader, v_second.grader]) then
    raise exception '재확인은 두 채점자가 함께 한 기록이어야 합니다' using errcode = 'check_violation';
  end if;
  if public.eval_text_has_pii(new.note) then
    raise exception '재확인 메모에 번호·이메일로 보이는 글자가 있습니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.eval_rechecks_guard() from public, anon, authenticated;
create trigger eval_rechecks_guard before insert on public.eval_rechecks for each row execute function public.eval_rechecks_guard();
create trigger eval_rechecks_append_only before update or delete on public.eval_rechecks for each row execute function public.eval_append_only();
create trigger eval_rechecks_no_truncate before truncate on public.eval_rechecks for each statement execute function public.eval_append_only();

-- 답변마다 확정 상태 - 사람 판정만 (ai_pre_grade는 보지 않는다). disputed = 미확정(집계에서 뺌)
create view public.eval_answer_final as
select a.id as answer_id, a.run_id, a.item_id,
  case
    when t.id is not null then 'confirmed_third'
    when f.id is not null and s.id is not null and
         (f.verdict, f.fatal_error, f.citations_supported, f.clarify_missed, f.invented_answer, f.benefit_asserted)
           is not distinct from (s.verdict, s.fatal_error, s.citations_supported, s.clarify_missed, s.invented_answer, s.benefit_asserted) then 'confirmed'
    when f.id is not null and s.id is not null then 'disputed'
    when f.id is not null or s.id is not null then 'one_grade'
    else 'ungraded'
  end as status,
  case when t.id is not null or (f.id is not null and s.id is not null and
         (f.verdict, f.fatal_error, f.citations_supported, f.clarify_missed, f.invented_answer, f.benefit_asserted)
           is not distinct from (s.verdict, s.fatal_error, s.citations_supported, s.clarify_missed, s.invented_answer, s.benefit_asserted))
       then coalesce(t.verdict, f.verdict) end as verdict,
  case when t.id is not null or (f.id is not null and s.id is not null and
         (f.verdict, f.fatal_error, f.citations_supported, f.clarify_missed, f.invented_answer, f.benefit_asserted)
           is not distinct from (s.verdict, s.fatal_error, s.citations_supported, s.clarify_missed, s.invented_answer, s.benefit_asserted))
       then case when t.id is not null then t.fatal_error else f.fatal_error end end as fatal_error,
  case when t.id is not null or (f.id is not null and s.id is not null and
         (f.verdict, f.fatal_error, f.citations_supported, f.clarify_missed, f.invented_answer, f.benefit_asserted)
           is not distinct from (s.verdict, s.fatal_error, s.citations_supported, s.clarify_missed, s.invented_answer, s.benefit_asserted))
       then coalesce(t.citations_supported, f.citations_supported) end as citations_supported,
  case when t.id is not null or (f.id is not null and s.id is not null and
         (f.verdict, f.fatal_error, f.citations_supported, f.clarify_missed, f.invented_answer, f.benefit_asserted)
           is not distinct from (s.verdict, s.fatal_error, s.citations_supported, s.clarify_missed, s.invented_answer, s.benefit_asserted))
       then coalesce(t.clarify_missed, f.clarify_missed) end as clarify_missed,
  case when t.id is not null or (f.id is not null and s.id is not null and
         (f.verdict, f.fatal_error, f.citations_supported, f.clarify_missed, f.invented_answer, f.benefit_asserted)
           is not distinct from (s.verdict, s.fatal_error, s.citations_supported, s.clarify_missed, s.invented_answer, s.benefit_asserted))
       then coalesce(t.invented_answer, f.invented_answer) end as invented_answer,
  case when t.id is not null or (f.id is not null and s.id is not null and
         (f.verdict, f.fatal_error, f.citations_supported, f.clarify_missed, f.invented_answer, f.benefit_asserted)
           is not distinct from (s.verdict, s.fatal_error, s.citations_supported, s.clarify_missed, s.invented_answer, s.benefit_asserted))
       then coalesce(t.benefit_asserted, f.benefit_asserted) end as benefit_asserted
from public.eval_answers a
left join public.eval_grades f on f.answer_id = a.id and f.slot = 'first'
left join public.eval_grades s on s.answer_id = a.id and s.slot = 'second'
left join public.eval_grades t on t.answer_id = a.id and t.slot = 'third';
comment on view public.eval_answer_final is '답변마다 확정 상태와 확정 판정 (EVAL-02) - disputed는 3인째 판정 전 미확정. 3인째가 있으면 3인째 판정이 확정. service_role만 읽는다';

-- ─────────────────────────────────────────────────────────────
-- 권한 - 공개 0, 서버(service_role)는 읽기와 추가만. 수정은 표마다 좁게(가드 트리거가 한 번 더 막는다)
-- ─────────────────────────────────────────────────────────────
alter table public.eval_sets enable row level security;
alter table public.eval_items enable row level security;
alter table public.eval_runs enable row level security;
alter table public.eval_answers enable row level security;
alter table public.eval_grades enable row level security;
alter table public.eval_rechecks enable row level security;
revoke all on table public.eval_sets, public.eval_items, public.eval_runs, public.eval_answers, public.eval_grades, public.eval_rechecks from anon, authenticated, service_role;
revoke all on table public.eval_answer_final from anon, authenticated, service_role;
grant select, insert on table public.eval_answers, public.eval_grades, public.eval_rechecks to service_role;
grant select, insert, update on table public.eval_sets, public.eval_items, public.eval_runs to service_role;
grant select on table public.eval_answer_final to service_role;
