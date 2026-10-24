-- W10-a a3 (2/3) - 공식 결과 대조 사례 · 실행 기록 · 공개 게이트 뷰 (PRD-02 CALC-14 · FAM-07, docs/dev/2단계_설계.md 3장)
-- · accuracy_cases: 감수위원이 개인정보를 지우고 준 실제 고지서·위택스 결과(official)와 감수 표본(review_sample). 지방세·종합부동산세만 (값 목록 방식).
--   넣을 때 개인정보 흔적(이름·주소·연락처·번호 칸이나 긴 숫자·한글 문장 값)을 트리거가 막는다. 공개 읽기 0 (RLS + 권한 0).
--   synthetic=true는 화면 시험용 지어낸 사례 - 게이트 계산에 들어가지 않는다.
-- · accuracy_runs / accuracy_run_results: 대조 실행 한 번과 사례별 엔진 결과. 추가만. record_accuracy_run()이 한 번에 원자적으로 넣는다.
-- · calc_gate_status: 세목·원인 묶음마다 공개 가능 여부 - 활성 룰셋(서명·승인 뒤에만 active) AND 그 룰셋의 최신 실행이 현재 확인된 사례 전부를 덮고
--   official 30건 이상 전부 일치 AND 감수 표본 50건 이상 전부 일치. 설정·수동 칸·우회 함수 없음 (뷰 정의가 전부다).
--   엔진 해시 일치는 뷰가 모르는 값(배포된 엔진 해시)이라 앱이 최신 실행의 engine_hash와 비교해 한 번 더 닫는다.

create table public.accuracy_cases (
  id bigint generated always as identity primary key,
  case_key text not null unique check (case_key ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}$'),
  tax_kind text not null check (tax_kind in ('acquisition', 'property', 'comprehensive')),
  -- 취득세 원인 4종 (SM 엔진 값 그대로 - FAM-03). 다른 세목은 비움
  cause text check (cause in ('PAID', 'INHERITANCE', 'GIFT', 'ORIGINAL')),
  sample_kind text not null check (sample_kind in ('official', 'review_sample')),
  case_input jsonb not null check (jsonb_typeof(case_input) = 'object'),
  official_total bigint not null check (official_total >= 0),
  official_basis text not null check (official_basis in ('tax_notice', 'wetax_result', 'reviewer_calc')),
  synthetic boolean not null default false,
  mismatch_cause text check (mismatch_cause in ('rounding', 'ruleset_value', 'input_interpretation')),
  mismatch_note text check (mismatch_note is null or char_length(mismatch_note) <= 200),
  entered_by text not null check (length(btrim(entered_by)) > 0),
  entered_at timestamptz not null default now(),
  confirmed_by text,
  confirmed_at timestamptz,
  retired_at timestamptz,
  constraint accuracy_cases_cause_shape check ((tax_kind = 'acquisition') = (cause is not null)),
  constraint accuracy_cases_basis_shape check ((sample_kind = 'review_sample') = (official_basis = 'reviewer_calc')),
  constraint accuracy_cases_confirm_shape check ((confirmed_by is null) = (confirmed_at is null))
);
comment on table public.accuracy_cases is '공식 결과 대조 사례 (CALC-14·FAM-07) - 개인정보 제거본만. 공개 읽기 0. 확인(감수위원)된 non-synthetic 사례만 게이트에 센다. 입력값은 감수위원이 넣은 익명 사례이며 이용자 계산 입력이 아니다';
create index accuracy_cases_group_idx on public.accuracy_cases (tax_kind, cause) where retired_at is null;

-- 개인정보 흔적 검사 - 문제가 있으면 사유 글(받은 값은 되풀이하지 않는다), 없으면 null
create function public.accuracy_pii_problem(p_input jsonb) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    with recursive walk(k, v) as (
      select null::text, p_input
      union all
      select e.key, e.value from walk w,
        lateral (select x.key, x.value from jsonb_each(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) x
                 union all
                 select null::text, y.value from jsonb_array_elements(case when jsonb_typeof(w.v) = 'array' then w.v else '[]'::jsonb end) y) e
    )
    select k, v from walk
  loop
    if r.k is not null and r.k ~* '(name|addr|phone|tel|mail|ssn|rrn|account|resident|taxno|tax_no|납세|성명|이름|주소|전화|이메일|계좌|주민)' then
      return '입력 칸 이름에 개인정보 칸으로 보이는 낱말이 있습니다';
    end if;
    if jsonb_typeof(r.v) = 'string' then
      if (r.v #>> '{}') !~ '^[A-Za-z0-9_.:/-]{1,40}$' then
        return '글자 값은 영문·숫자 40자 이하 코드나 날짜만 넣을 수 있습니다 (이름·주소·문장 금지)';
      end if;
      if (r.v #>> '{}') ~ '[0-9]{9,}' then
        return '숫자가 9자리 이상 이어지는 글자 값은 넣을 수 없습니다 (번호류)';
      end if;
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function public.accuracy_pii_problem(jsonb) from public, anon, authenticated;
grant execute on function public.accuracy_pii_problem(jsonb) to service_role;

create function public.accuracy_cases_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem text;
begin
  if tg_op = 'INSERT' then
    v_problem := public.accuracy_pii_problem(new.case_input);
    if v_problem is not null then
      raise exception '대조 사례를 저장할 수 없습니다 - %', v_problem using errcode = 'check_violation';
    end if;
    if coalesce(new.mismatch_note, '') ~ '([0-9]{6}-?[1-4][0-9]{6}|[0-9]{9,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+)' then
      raise exception '불일치 메모에 번호·이메일로 보이는 글자가 있습니다' using errcode = 'check_violation';
    end if;
    if new.confirmed_by is not null or new.retired_at is not null then
      raise exception '확인·철회는 사례를 넣은 뒤 함수로 합니다' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.case_key is distinct from old.case_key or new.tax_kind is distinct from old.tax_kind or new.cause is distinct from old.cause
     or new.sample_kind is distinct from old.sample_kind or new.case_input is distinct from old.case_input
     or new.official_total is distinct from old.official_total or new.official_basis is distinct from old.official_basis
     or new.synthetic is distinct from old.synthetic or new.entered_by is distinct from old.entered_by or new.entered_at is distinct from old.entered_at then
    raise exception '대조 사례의 입력·공식 결과는 고칠 수 없습니다 - 철회하고 새 사례로 넣으세요' using errcode = 'insufficient_privilege';
  end if;
  if (new.confirmed_by is distinct from old.confirmed_by or new.confirmed_at is distinct from old.confirmed_at)
     and coalesce(current_setting('ltr.rules_gate', true), '') <> 'rpc' then
    raise exception '사례 확인은 confirm_accuracy_case 함수로만 합니다 (세무 감수위원)' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(new.mismatch_note, '') ~ '([0-9]{6}-?[1-4][0-9]{6}|[0-9]{9,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+)' then
    raise exception '불일치 메모에 번호·이메일로 보이는 글자가 있습니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.accuracy_cases_guard() from public, anon, authenticated;
create trigger accuracy_cases_guard before insert or update on public.accuracy_cases for each row execute function public.accuracy_cases_guard();

create function public.accuracy_no_delete() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '대조 사례·실행 기록은 지우지 못합니다 (% 거부) - 사례는 철회(retired_at)로 뺍니다', tg_op using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.accuracy_no_delete() from public, anon, authenticated;
create trigger accuracy_cases_no_delete before delete on public.accuracy_cases for each row execute function public.accuracy_no_delete();
create trigger accuracy_cases_no_truncate before truncate on public.accuracy_cases for each statement execute function public.accuracy_no_delete();

-- ─────────────────────────────────────────────────────────────
-- 실행 기록 (추가만)
-- ─────────────────────────────────────────────────────────────
create table public.accuracy_runs (
  id bigint generated always as identity primary key,
  ruleset_id bigint not null references public.rulesets (id),
  ruleset_version text not null,
  engine_hash text not null check (engine_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'done' check (status in ('done', 'failed')),
  triggered_by text not null check (length(btrim(triggered_by)) > 0),
  case_count integer not null check (case_count >= 0),
  matched_count integer not null check (matched_count >= 0 and matched_count <= case_count),
  run_at timestamptz not null default now()
);
comment on table public.accuracy_runs is '정확도 대조 실행 (CALC-14) - 추가만. 룰셋 버전·엔진 해시·건수. 사례별 결과는 accuracy_run_results';
create index accuracy_runs_ruleset_idx on public.accuracy_runs (ruleset_id, id desc);

create table public.accuracy_run_results (
  run_id bigint not null references public.accuracy_runs (id),
  case_id bigint not null references public.accuracy_cases (id),
  engine_total bigint not null check (engine_total >= 0),
  matched boolean not null,
  primary key (run_id, case_id)
);
comment on table public.accuracy_run_results is '사례별 엔진 결과 - 추가만. matched = (engine_total = 공식 결과) 원 단위, 함수가 계산해 넣는다';

create trigger accuracy_runs_no_update_delete before update or delete on public.accuracy_runs for each row execute function public.accuracy_no_delete();
create trigger accuracy_runs_no_truncate before truncate on public.accuracy_runs for each statement execute function public.accuracy_no_delete();
create trigger accuracy_run_results_no_update_delete before update or delete on public.accuracy_run_results for each row execute function public.accuracy_no_delete();
create trigger accuracy_run_results_no_truncate before truncate on public.accuracy_run_results for each statement execute function public.accuracy_no_delete();

-- 사례 확인 - 세무 감수위원(reviewer)만 (확인된 사례만 게이트에 센다)
create function public.confirm_accuracy_case(p_case_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.accuracy_cases%rowtype;
begin
  if not public.rules_is_reviewer(p_actor) then
    return jsonb_build_object('ok', false, 'code', 'actor_not_reviewer', 'message', '사례 확인은 세무 감수위원(reviewer)만 할 수 있습니다');
  end if;
  select * into v_case from public.accuracy_cases where id = p_case_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', '사례가 없습니다');
  end if;
  if v_case.retired_at is not null then
    return jsonb_build_object('ok', false, 'code', 'retired', 'message', '철회된 사례입니다');
  end if;
  if v_case.confirmed_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_confirmed', 'message', '이미 확인된 사례입니다');
  end if;
  perform set_config('ltr.rules_gate', 'rpc', true);
  update public.accuracy_cases set confirmed_by = p_actor, confirmed_at = now() where id = p_case_id;
  perform set_config('ltr.rules_gate', '', true);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '확인했습니다');
end;
$$;
revoke all on function public.confirm_accuracy_case(bigint, text) from public, anon, authenticated;
grant execute on function public.confirm_accuracy_case(bigint, text) to service_role;

-- 실행 기록 한 번에 넣기 - 결과 배열 [{case_id, engine_total}]. matched는 여기서 계산한다
create function public.record_accuracy_run(p_ruleset_id bigint, p_engine_hash text, p_triggered_by text, p_results jsonb) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ruleset public.rulesets%rowtype;
  v_run_id bigint;
  v_n integer;
begin
  select * into v_ruleset from public.rulesets where id = p_ruleset_id;
  if not found then
    raise exception '룰셋이 없습니다' using errcode = 'foreign_key_violation';
  end if;
  if jsonb_typeof(p_results) is distinct from 'array' then
    raise exception '결과는 배열이어야 합니다' using errcode = 'check_violation';
  end if;
  v_n := jsonb_array_length(p_results);
  -- 철회·미확인 사례는 실행에 넣지 않는다
  if exists (
       select 1 from jsonb_to_recordset(p_results) as x(case_id bigint, engine_total bigint)
        where not exists (select 1 from public.accuracy_cases c where c.id = x.case_id and c.retired_at is null and c.confirmed_at is not null)) then
    raise exception '확인되지 않았거나 철회된 사례가 결과에 있습니다' using errcode = 'check_violation';
  end if;
  insert into public.accuracy_runs (ruleset_id, ruleset_version, engine_hash, triggered_by, case_count, matched_count)
  select p_ruleset_id, v_ruleset.version, p_engine_hash, p_triggered_by, v_n,
         count(*) filter (where x.engine_total = c.official_total)
    from jsonb_to_recordset(p_results) as x(case_id bigint, engine_total bigint)
    join public.accuracy_cases c on c.id = x.case_id
  returning id into v_run_id;
  insert into public.accuracy_run_results (run_id, case_id, engine_total, matched)
  select v_run_id, x.case_id, x.engine_total, x.engine_total = c.official_total
    from jsonb_to_recordset(p_results) as x(case_id bigint, engine_total bigint)
    join public.accuracy_cases c on c.id = x.case_id;
  return v_run_id;
end;
$$;
revoke all on function public.record_accuracy_run(bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_accuracy_run(bigint, text, text, jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 공개 게이트 뷰 (service_role 전용 - 공개용 칸 지정 뷰는 W10-b가 따로 만든다)
-- 묶음: 취득세는 원인 INHERITANCE · GIFT · OTHER(유상취득+원시취득), 재산세·종합부동산세는 ALL.
--   official 30건 이상은 묶음마다, 감수 표본 50건 이상은 세목마다(원인 묶음 합산). 모두 최신 실행에서 원 단위 일치여야 함.
-- ─────────────────────────────────────────────────────────────
create view public.calc_gate_status as
with groups(tax_kind, cause_group) as (
  values ('acquisition', 'OTHER'), ('acquisition', 'INHERITANCE'), ('acquisition', 'GIFT'), ('property', 'ALL'), ('comprehensive', 'ALL')
),
act as (select id, version from public.rulesets where status = 'active'),
last_run as (
  select r.id, r.ruleset_id, r.engine_hash, r.run_at
    from public.accuracy_runs r
    join act on act.id = r.ruleset_id
   where r.status = 'done'
   order by r.id desc
   limit 1
),
cs as (
  select c.id, c.tax_kind, c.sample_kind,
         case when c.tax_kind = 'acquisition' then (case c.cause when 'INHERITANCE' then 'INHERITANCE' when 'GIFT' then 'GIFT' else 'OTHER' end) else 'ALL' end as cause_group,
         rr.run_id is not null as in_run,
         coalesce(rr.matched, false) as matched
    from public.accuracy_cases c
    left join public.accuracy_run_results rr on rr.case_id = c.id and rr.run_id = (select id from last_run)
   where not c.synthetic and c.confirmed_at is not null and c.retired_at is null
),
g as (
  select gr.tax_kind, gr.cause_group,
         count(*) filter (where cs.sample_kind = 'official' and cs.cause_group = gr.cause_group and cs.tax_kind = gr.tax_kind) as official_cases,
         count(*) filter (where cs.sample_kind = 'official' and cs.cause_group = gr.cause_group and cs.tax_kind = gr.tax_kind and cs.in_run and cs.matched) as official_matched,
         count(*) filter (where cs.sample_kind = 'official' and cs.cause_group = gr.cause_group and cs.tax_kind = gr.tax_kind and cs.in_run) as official_in_run,
         count(*) filter (where cs.sample_kind = 'review_sample' and cs.tax_kind = gr.tax_kind) as sample_cases,
         count(*) filter (where cs.sample_kind = 'review_sample' and cs.tax_kind = gr.tax_kind and cs.in_run and cs.matched) as sample_matched,
         count(*) filter (where cs.sample_kind = 'review_sample' and cs.tax_kind = gr.tax_kind and cs.in_run) as sample_in_run
    from groups gr
    left join cs on cs.tax_kind = gr.tax_kind
   group by gr.tax_kind, gr.cause_group
)
select g.tax_kind, g.cause_group,
       (select version from act) as ruleset_version,
       (select id from last_run) as last_run_id,
       (select run_at from last_run) as run_at,
       (select engine_hash from last_run) as engine_hash,
       g.official_cases, g.official_matched, g.sample_cases, g.sample_matched,
       (exists (select 1 from act)
        and exists (select 1 from last_run)
        and g.official_cases >= 30 and g.official_in_run = g.official_cases and g.official_matched = g.official_cases
        and g.sample_cases >= 50 and g.sample_in_run = g.sample_cases and g.sample_matched = g.sample_cases) as is_open
  from g;
comment on view public.calc_gate_status is '세목·원인 묶음별 자체 계산기 공개 가능 여부 (CALC-14·FAM-07) - 활성(서명·승인된) 룰셋의 최신 실행이 확인된 사례 전부를 덮고 official 30건·표본 50건이 모두 원 단위 일치일 때만 true. 수동 우회 칸 없음. 엔진 해시 일치는 앱이 engine_hash로 한 번 더 확인';

-- ─────────────────────────────────────────────────────────────
-- 권한
-- ─────────────────────────────────────────────────────────────
alter table public.accuracy_cases enable row level security;
alter table public.accuracy_runs enable row level security;
alter table public.accuracy_run_results enable row level security;
revoke all on table public.accuracy_cases, public.accuracy_runs, public.accuracy_run_results from anon, authenticated, service_role;
grant select, insert, update on table public.accuracy_cases to service_role;
grant select on table public.accuracy_runs, public.accuracy_run_results to service_role;
revoke all on table public.calc_gate_status from public, anon, authenticated, service_role;
grant select on table public.calc_gate_status to service_role;
