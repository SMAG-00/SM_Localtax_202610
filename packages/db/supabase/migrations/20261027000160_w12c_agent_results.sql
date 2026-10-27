-- W12-c c1~c3 - 지방세봇 계산·감면·판정 결과 요약 봉인 (docs/dev/W12-c_설계.md 3장 - PRD-04 ASK-05·18·22, 6.11)
--  · agent_results - 한 턴에서 서버가 돌린 계산기·감면 점검·판정의 결과 요약만 남긴다 (금액·기준일·룰셋/판정표 버전·근거 조문).
--    입력값(취득가액·공시가격·사실 응답)을 담는 칸이 없다 - 도구 입력 구조체 저장 0 (원칙 11). 질문 원문도 없다.
--  · agent_tool_calls.tool 허용 목록에 도구 3종을 더한다. 양도세·상속세·증여세 계산 도구는 목록에 없다.
--  · agent_record_results - 한 턴 기록(157)이 끝난 뒤 서버가 부른다. 입력 모양을 검사하고, 봉인 해시는 요약 칸으로 DB가 계산한다.
--    같은 (턴, 순서)는 한 번만 들어간다(멱등).

alter table public.agent_tool_calls drop constraint if exists agent_tool_calls_tool_check;
alter table public.agent_tool_calls
  add constraint agent_tool_calls_tool_check check (tool in ('search_corpus', 'get_law_article', 'get_source', 'lookup_glossary', 'fetch_official_source', 'suggest_actions', 'web_search_official', 'run_calculator', 'check_benefits', 'run_determination'));

create table public.agent_results (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.agent_messages (id) on delete cascade,
  position integer not null check (position >= 0 and position < 20),
  tool text not null check (tool in ('run_calculator', 'check_benefits', 'run_determination')),
  -- 계산기 종류(acquisition·holding) 또는 판정 종류 코드 - 소문자·밑줄만
  subject text not null check (subject ~ '^[a-z][a-z_]{0,39}$'),
  status text not null check (status in ('calculated', 'needs_input', 'unsupported', 'not_liable', 'found', 'none', 'hidden', 'conclusion', 'need_more', 'not_in_table')),
  total_won bigint check (total_won is null or total_won >= 0),
  as_of date,
  ruleset_version text check (ruleset_version is null or ruleset_version ~ '^[0-9]{4}\.[0-9]{2}$'),
  table_version text check (table_version is null or char_length(table_version) between 1 and 40),
  laws text[] not null default '{}' check (cardinality(laws) <= 30),
  item_count integer not null default 0 check (item_count between 0 and 50),
  result_hash text not null check (result_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (message_id, position),
  -- 금액을 낸 계산은 기준일과 룰셋 버전이 반드시 있다
  constraint agent_results_calc_sealed check (status <> 'calculated' or (tool = 'run_calculator' and total_won is not null and as_of is not null and ruleset_version is not null)),
  -- 감면 점검·판정 결과는 판정표 버전이 반드시 있다
  constraint agent_results_table_sealed check (status not in ('found', 'none', 'conclusion', 'need_more', 'not_in_table') or table_version is not null),
  -- 금액 칸은 계산기만 쓴다 (판정·감면 점검은 금액 0행)
  constraint agent_results_amount_only_calc check (tool = 'run_calculator' or total_won is null)
);
create index agent_results_message_idx on public.agent_results (message_id);
comment on table public.agent_results is '지방세봇 계산·감면·판정 결과 요약 봉인 (W12-c) - 입력값 칸 0, 직접 읽기 0, 기록은 agent_record_results로만';

alter table public.agent_results enable row level security;
revoke all on table public.agent_results from anon, authenticated, service_role;
grant select on table public.agent_results to service_role;

create function public.agent_record_results(p_session uuid, p_turn integer, p jsonb) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg bigint;
  v_el jsonb;
  v_pos integer := 0;
  v_n integer := 0;
  v_rows integer;
  v_laws text[];
  v_total bigint;
  v_as_of date;
  v_ruleset text;
  v_table text;
  v_tool text;
  v_subject text;
  v_status text;
  v_items integer;
begin
  if p_session is null or p_turn is null or p_turn < 1 then raise exception 'invalid input' using errcode = '22023'; end if;
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 20 then raise exception 'invalid input' using errcode = '22023'; end if;
  select m.id into v_msg from public.agent_messages m where m.session_id = p_session and m.turn = p_turn;
  if v_msg is null then return 0; end if; -- 저장을 끈 세션 등 기록된 턴이 없으면 쓰지 않는다
  for v_el in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(v_el) <> 'object' then raise exception 'invalid input' using errcode = '22023'; end if;
    v_tool := v_el ->> 'tool';
    v_subject := v_el ->> 'subject';
    v_status := v_el ->> 'status';
    v_total := nullif(v_el ->> 'total_won', '')::bigint;
    v_as_of := nullif(v_el ->> 'as_of', '')::date;
    v_ruleset := nullif(v_el ->> 'ruleset_version', '');
    v_table := nullif(v_el ->> 'table_version', '');
    v_items := coalesce((v_el ->> 'item_count')::integer, 0);
    if jsonb_typeof(coalesce(v_el -> 'laws', '[]'::jsonb)) <> 'array' then raise exception 'invalid input' using errcode = '22023'; end if;
    select coalesce(array_agg(x.value), '{}') into v_laws from jsonb_array_elements_text(coalesce(v_el -> 'laws', '[]'::jsonb)) x(value);
    if exists (select 1 from unnest(v_laws) l where char_length(l) > 200) then raise exception 'invalid input' using errcode = '22023'; end if;
    insert into public.agent_results (message_id, position, tool, subject, status, total_won, as_of, ruleset_version, table_version, laws, item_count, result_hash)
    values (v_msg, v_pos, v_tool, v_subject, v_status, v_total, v_as_of, v_ruleset, v_table, v_laws, v_items,
            encode(sha256(convert_to(concat_ws('|', v_tool, v_subject, v_status, coalesce(v_total::text, ''), coalesce(v_as_of::text, ''), coalesce(v_ruleset, ''), coalesce(v_table, ''), array_to_string(v_laws, '/')), 'UTF8')), 'hex'))
    on conflict (message_id, position) do nothing;
    get diagnostics v_rows = row_count;
    v_n := v_n + v_rows;
    v_pos := v_pos + 1;
  end loop;
  return v_n;
end;
$$;
comment on function public.agent_record_results(uuid, integer, jsonb) is '한 턴의 계산·감면·판정 결과 요약 기록 (W12-c) - 입력값 칸 없음, 같은 (턴, 순서)는 한 번만';
-- 서버(service_role)만 부른다 - anon·로그인 사용자 직접 호출 0 (기록 위조 방지, W12-d 169의 agent_record_turn과 같은 방침)
revoke all on function public.agent_record_results(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.agent_record_results(uuid, integer, jsonb) to service_role;
