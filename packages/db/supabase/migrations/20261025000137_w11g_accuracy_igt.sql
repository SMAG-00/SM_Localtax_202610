-- W11-g g5 (2/3) - 대조 사례 세목 gift·inheritance · 상속·증여 실행 기록 · 공개 게이트 묶음 (PRD-03 FAM-12, docs/dev/W11-g_설계.md)
-- · accuracy_cases.tax_kind 에 gift · inheritance 를 더한다(기존 값은 그대로). 개인정보 흔적 검사는 같은 함수를 쓰되, 엔진 입력의 거주 여부 칸 둘
--   (recipient_is_resident · decedent_resident)만 칸 이름 검사에서 뺀다 - 주민번호 칸이 아니라 참/거짓 칸이다. 글자 값은 영문·숫자 40자 이하 코드·날짜만 넣을 수 있다는 규칙은 그대로.
-- · accuracy_runs 에 igt_ruleset_id 를 더한다 - 지방세 실행은 ruleset_id, 상속·증여 실행은 igt_ruleset_id 중 정확히 하나만 채운다.
-- · calc_gate_status 에 묶음 gift ALL · inheritance ALL 을 더한다 - 활성 igt 룰셋의 최신 실행이 확인된 사례 전부를 덮고 official 30건 · 표본 50건이 모두 원 단위 일치여야 열린다.
--   증여와 상속은 따로 판정한다. 엔진 해시가 바뀌면 앱이 한 번 더 닫는다(지방세와 같은 방식). 기존 세 세목 묶음의 정의는 바꾸지 않는다.

-- 세목 값 목록 확장 (기존 제약을 읽어 값만 더한다 - 다른 단위가 값을 더했어도 보존)
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint where conrelid = 'public.accuracy_cases'::regclass and conname = 'accuracy_cases_tax_kind_check';
  if v_def is null then
    raise exception 'accuracy_cases_tax_kind_check 제약이 없습니다';
  end if;
  if v_def not like '%inheritance%' then
    execute 'alter table public.accuracy_cases drop constraint accuracy_cases_tax_kind_check';
    execute format('alter table public.accuracy_cases add constraint accuracy_cases_tax_kind_check %s', replace(v_def, '''acquisition''::text', '''acquisition''::text, ''gift''::text, ''inheritance''::text'));
  end if;
end;
$$;

-- 개인정보 흔적 검사 - 82번과 같고, 거주 여부 참/거짓 칸 둘만 칸 이름 검사에서 제외
create or replace function public.accuracy_pii_problem(p_input jsonb) returns text
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
    if r.k is not null and r.k !~ '^(recipient_is_resident|decedent_resident)$'
       and r.k ~* '(name|addr|phone|tel|mail|ssn|rrn|account|resident|taxno|tax_no|납세|성명|이름|주소|전화|이메일|계좌|주민)' then
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

-- 실행 기록: 지방세(ruleset_id) 또는 상속·증여(igt_ruleset_id) 중 하나
alter table public.accuracy_runs alter column ruleset_id drop not null;
alter table public.accuracy_runs add column igt_ruleset_id bigint references public.igt_rulesets (id);
alter table public.accuracy_runs add constraint accuracy_runs_one_ruleset check ((ruleset_id is null) <> (igt_ruleset_id is null));

create function public.record_accuracy_run_igt(p_igt_ruleset_id bigint, p_engine_hash text, p_triggered_by text, p_results jsonb) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ruleset public.igt_rulesets%rowtype;
  v_run_id bigint;
  v_n integer;
begin
  select * into v_ruleset from public.igt_rulesets where id = p_igt_ruleset_id;
  if not found then
    raise exception '상속·증여세 룰셋이 없습니다' using errcode = 'foreign_key_violation';
  end if;
  if jsonb_typeof(p_results) is distinct from 'array' then
    raise exception '결과는 배열이어야 합니다' using errcode = 'check_violation';
  end if;
  v_n := jsonb_array_length(p_results);
  -- 철회·미확인 사례, 그리고 상속·증여 사례가 아닌 사례는 실행에 넣지 않는다
  if exists (
       select 1 from jsonb_to_recordset(p_results) as x(case_id bigint, engine_total bigint)
        where not exists (select 1 from public.accuracy_cases c
                           where c.id = x.case_id and c.retired_at is null and c.confirmed_at is not null and c.tax_kind in ('gift', 'inheritance'))) then
    raise exception '확인되지 않았거나 철회된 사례, 또는 증여·상속 사례가 아닌 사례가 결과에 있습니다' using errcode = 'check_violation';
  end if;
  insert into public.accuracy_runs (igt_ruleset_id, ruleset_version, engine_hash, triggered_by, case_count, matched_count)
  select p_igt_ruleset_id, v_ruleset.version, p_engine_hash, p_triggered_by, v_n,
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
revoke all on function public.record_accuracy_run_igt(bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_accuracy_run_igt(bigint, text, text, jsonb) to service_role;

-- 공개 게이트 뷰 - 82번 정의 그대로 + 상속·증여 묶음 (열 이름·자료형 불변)
create or replace view public.calc_gate_status as
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
),
act_igt as (select id, version from public.igt_rulesets where status = 'active'),
last_igt as (
  select r.id, r.igt_ruleset_id, r.engine_hash, r.run_at
    from public.accuracy_runs r
    join act_igt on act_igt.id = r.igt_ruleset_id
   where r.status = 'done'
   order by r.id desc
   limit 1
),
cs_igt as (
  select c.id, c.tax_kind, c.sample_kind,
         rr.run_id is not null as in_run,
         coalesce(rr.matched, false) as matched
    from public.accuracy_cases c
    left join public.accuracy_run_results rr on rr.case_id = c.id and rr.run_id = (select id from last_igt)
   where c.tax_kind in ('gift', 'inheritance') and not c.synthetic and c.confirmed_at is not null and c.retired_at is null
),
gi as (
  select k.tax_kind, 'ALL'::text as cause_group,
         count(*) filter (where cs_igt.sample_kind = 'official') as official_cases,
         count(*) filter (where cs_igt.sample_kind = 'official' and cs_igt.in_run and cs_igt.matched) as official_matched,
         count(*) filter (where cs_igt.sample_kind = 'official' and cs_igt.in_run) as official_in_run,
         count(*) filter (where cs_igt.sample_kind = 'review_sample') as sample_cases,
         count(*) filter (where cs_igt.sample_kind = 'review_sample' and cs_igt.in_run and cs_igt.matched) as sample_matched,
         count(*) filter (where cs_igt.sample_kind = 'review_sample' and cs_igt.in_run) as sample_in_run
    from (values ('gift'), ('inheritance')) k(tax_kind)
    left join cs_igt on cs_igt.tax_kind = k.tax_kind
   group by k.tax_kind
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
  from g
union all
select gi.tax_kind, gi.cause_group,
       (select version from act_igt),
       (select id from last_igt),
       (select run_at from last_igt),
       (select engine_hash from last_igt),
       gi.official_cases, gi.official_matched, gi.sample_cases, gi.sample_matched,
       (exists (select 1 from act_igt)
        and exists (select 1 from last_igt)
        and gi.official_cases >= 30 and gi.official_in_run = gi.official_cases and gi.official_matched = gi.official_cases
        and gi.sample_cases >= 50 and gi.sample_in_run = gi.sample_cases and gi.sample_matched = gi.sample_cases)
  from gi;
comment on view public.calc_gate_status is '세목·원인 묶음별 자체 계산기 공개 가능 여부 (CALC-14·FAM-07·FAM-12) - 지방세는 활성 rulesets, 증여·상속(gift ALL · inheritance ALL)은 활성 igt_rulesets 의 최신 실행이 확인된 사례 전부를 덮고 official 30건 · 표본 50건이 모두 원 단위 일치일 때만 열린다. 수동 켜기 경로 없음';
