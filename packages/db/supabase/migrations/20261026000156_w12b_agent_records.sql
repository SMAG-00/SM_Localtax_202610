-- W12-b 지방세봇 대화·인용·도구·검증 기록 표 (docs/dev/W12-b_설계.md 3장 - 4단계 설계 3장 b행, PRD-04 6.11 로그와 개인정보)
--  · 질문 원문 칸 0 - 마스킹본만, 숫자 9자리 이상·이메일 모양은 check로 거부 (W7b 도우미와 같은 규칙)
--  · 계산·감면·판정 입력 구조체, 상속재산·가족관계·증여 이력을 담는 칸 0 (도구 입력은 짧은 요약 글뿐)
--  · 실시간 인용(is_live)은 스냅샷 ID 필수 - 스냅샷 없는 실시간 인용 0
--  · 공개·로그인 사용자 직접 읽기 0 - 기록은 157의 security definer 함수로만 쓴다 (service role 0)
-- 지시문 버전 표(prompt_versions)에 지방세봇 역할 값 2개를 더한다 (평가 실행 없이 active 불가 제약은 그대로).

alter table public.prompt_versions drop constraint if exists prompt_versions_role_check;
alter table public.prompt_versions
  add constraint prompt_versions_role_check check (role in ('router', 'answer', 'summary_draft', 'agent_answer', 'agent_utility'));

create table public.agent_sessions (
  id uuid primary key,
  user_id uuid references auth.users (id) on delete set null,
  mode text not null check (mode in ('general', 'expert')),
  as_of_date date not null,
  save_enabled boolean not null default true,
  retain_until timestamptz not null,
  entry text check (entry is null or entry in ('mode_switch', 'search_results', 'law', 'case', 'calc', 'article', 'step', 'issue_map')),
  internal boolean not null default false,
  turn_count integer not null default 0 check (turn_count >= 0),
  clarify_rounds integer not null default 0 check (clarify_rounds >= 0),
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);
comment on table public.agent_sessions is '지방세봇 세션 (ASK-12 기록의 기초) - 직접 읽기 0, 기록은 agent_record_turn으로만';

create table public.agent_messages (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.agent_sessions (id) on delete cascade,
  turn integer not null check (turn >= 1),
  question_masked text check (question_masked is null or (char_length(question_masked) <= 2000 and question_masked !~ '[0-9]([^0-9A-Za-z가-힣]*[0-9]){8}' and question_masked !~ '[A-Za-z0-9_.%+-]\s*@\s*[A-Za-z0-9]')),
  answer_masked text check (answer_masked is null or (char_length(answer_masked) <= 20000 and answer_masked !~ '[0-9]([^0-9A-Za-z가-힣]*[0-9]){8}' and answer_masked !~ '[A-Za-z0-9_.%+-]\s*@\s*[A-Za-z0-9]')),
  kind text not null check (kind in ('answer', 'clarify', 'fallback', 'error')),
  fallback_reason text check (fallback_reason is null or fallback_reason in ('no_evidence', 'outage', 'budget', 'verification_failed', 'scope', 'turn_limit', 'search_down')),
  scope text not null check (scope in ('base', 'trust_redevelopment', 'inheritance', 'gift')),
  tier text not null check (tier in ('guest', 'member')),
  model text not null check (char_length(btrim(model)) between 1 and 100),
  prompt_version_id bigint not null references public.prompt_versions (id),
  tokens_in integer not null default 0 check (tokens_in >= 0),
  tokens_out integer not null default 0 check (tokens_out >= 0),
  tokens_cached integer not null default 0 check (tokens_cached >= 0),
  cost numeric(12, 4) not null default 0 check (cost >= 0),
  model_calls integer not null default 0 check (model_calls >= 0),
  created_at timestamptz not null default now(),
  unique (session_id, turn)
);
create index agent_messages_created_idx on public.agent_messages (created_at);

create table public.agent_citations (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.agent_messages (id) on delete cascade,
  position integer not null check (position >= 0),
  source_id text not null check (char_length(btrim(source_id)) between 1 and 80),
  source_type text not null check (source_type in ('law_article', 'interpretation', 'case_decision', 'guide_version', 'issue_graph_version', 'publication', 'article', 'glossary_term', 'live_snapshot')),
  chunk_id bigint,
  is_live boolean not null default false,
  snapshot_id bigint references public.raw_snapshots (id),
  constraint agent_citations_live_needs_snapshot check (not is_live or snapshot_id is not null)
);

create table public.agent_tool_calls (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.agent_messages (id) on delete cascade,
  tool text not null check (tool in ('search_corpus', 'get_law_article', 'get_source', 'lookup_glossary', 'fetch_official_source', 'suggest_actions', 'web_search_official')),
  input_summary text check (input_summary is null or (char_length(input_summary) <= 200 and input_summary !~ '[0-9]([^0-9A-Za-z가-힣]*[0-9]){8}' and input_summary !~ '[A-Za-z0-9_.%+-]\s*@\s*[A-Za-z0-9]')),
  result_id text check (result_id is null or char_length(result_id) <= 80),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  ok boolean not null,
  target_type text check (target_type is null or target_type in ('law', 'case', 'interpretation')),
  snapshot_id bigint references public.raw_snapshots (id)
);

create table public.agent_validations (
  message_id bigint primary key references public.agent_messages (id) on delete cascade,
  v1 boolean not null,
  v2 boolean not null,
  v3 boolean not null,
  v4 boolean not null,
  v5 boolean not null,
  v6 boolean not null,
  regenerated boolean not null default false,
  fallback_reason text check (fallback_reason is null or fallback_reason in ('no_evidence', 'outage', 'budget', 'verification_failed', 'scope', 'turn_limit', 'search_down')),
  failure_codes text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.agent_usage_daily (
  day date not null,
  tier text not null check (tier in ('guest', 'member')),
  mode_tag text not null default 'agent' check (mode_tag = 'agent'),
  turns integer not null default 0 check (turns >= 0),
  tokens_in bigint not null default 0 check (tokens_in >= 0),
  tokens_out bigint not null default 0 check (tokens_out >= 0),
  cost numeric(14, 4) not null default 0 check (cost >= 0),
  primary key (day, tier)
);
comment on table public.agent_usage_daily is '일일 사용량 (모드 표지 agent) - 도우미 usage_daily와 따로 두어 같은 키를 쓰는 두 모드의 비용을 나눈다';

alter table public.agent_sessions enable row level security;
alter table public.agent_messages enable row level security;
alter table public.agent_citations enable row level security;
alter table public.agent_tool_calls enable row level security;
alter table public.agent_validations enable row level security;
alter table public.agent_usage_daily enable row level security;
revoke all on table public.agent_sessions, public.agent_messages, public.agent_citations, public.agent_tool_calls, public.agent_validations, public.agent_usage_daily from anon, authenticated, service_role;
grant select on table public.agent_sessions, public.agent_messages, public.agent_citations, public.agent_tool_calls, public.agent_validations, public.agent_usage_daily to service_role;
