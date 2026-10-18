-- W2-c 1단계 DB — 측정 기반 (FND-06 · GROW-01 · ART-11 · HOME-05, docs/dev/W2-c_설계.md 2·3·4장)
-- · analytics_events — 자체 분석 이벤트, 지표의 원본 (v1.2 `events`의 새 이름 — 표 이름 `events`는 쓰지 않는다).
--   칸은 PRD-01A 6.1 그대로 14개. 개인정보·질문 원문·IP·User-Agent 원문·좌표·상세 주소·계산 입력값·검색어 원문·회원 ID 칸이 없다
--   (DB 시험이 information_schema로 칸 이름을 검사한다). 방문자·세션 ID는 무작위 UUID만 들어가는 uuid 칸.
--   수집은 서버 API(POST /api/events)가 service_role로 쓴다 — 측정 거부·GPC 요청은 저장하지 않는다(설계 4장).
-- · article_stats — 기사 시간 단위 집계 (ART-11·HOME-05). 2단계 1시간 배치가 채운다. 전체 값과 사람 값(봇·편집자 제외)을 따로 둔다.
-- · settings 씨앗 — 수집 설정·봇 User-Agent 목록·진입 경로 리퍼러 목록·HOT 가중치·많이 본 기사 규칙 (설계 2.5 — 코드 상수 0)
-- · RLS 기본 거부 — 두 표 모두 anon·authenticated 읽기·쓰기 0. service_role 전권 (관리자 전권 — tests/admin-rights.test.mjs)

-- ─────────────────────────────────────────────────────────────
-- analytics_events
-- ─────────────────────────────────────────────────────────────
create table public.analytics_events (
  id bigint generated always as identity primary key,
  name text not null check (name in (
    'home_entry_clicked', 'hub_viewed', 'article_viewed', 'article_engaged', 'article_shared', 'search_submitted', 'glossary_opened',
    'situation_card_clicked', 'next_action_clicked', 'hot_article_clicked', 'popular_article_clicked', 'video_played',
    'partner_content_viewed', 'signup_completed', 'brief_preregistered', 'inquiry_submitted', 'policy_page_viewed',
    'redirect_hit', 'not_found_viewed')),
  occurred_at timestamptz not null default now(),             -- 서버 시각 (브라우저 시각은 받지 않는다)
  session_id uuid not null,                                   -- 30분 무활동 경계 세션 (GROW-01)
  visitor_id uuid,                                            -- 익명 방문자 ID — 무작위 값. 측정 거부 시 비움 (6.1)
  first_visit boolean not null,                               -- 새 방문자로 시작한 세션의 이벤트
  stage smallint not null check (stage between 1 and 5),      -- 서비스 단계 (설계 9장 #5)
  mode text not null default 'general' check (mode in ('general', 'expert')),
  tier text not null default 'guest' check (tier in ('guest', 'basic', 'premium', 'institution')),
  entry text not null check (entry in ('search', 'ai_answer_engine', 'naver', 'brief', 'assistant', 'experts', 'tax_lens', 'direct', 'referral')),
  section text check (section in ('tax', 'realestate', 'finance', 'local')),
  props jsonb not null default '{}'::jsonb,
  is_bot boolean not null,                                    -- 봇 User-Agent 목록(settings)에 맞음 — User-Agent 원문은 저장하지 않는다
  is_staff boolean not null,                                  -- 편집국·관리자 세션 — 집계에서 뺀다
  constraint analytics_events_props_object check (jsonb_typeof(props) = 'object'),
  -- strict — lax 모드는 배열을 풀어 원소를 보므로 안에 든 배열을 놓친다. strict는 객체가 아니면 오류를 내므로 객체일 때만 본다(객체 검사는 위 제약)
  constraint analytics_events_props_flat check (case when jsonb_typeof(props) = 'object'
    then not jsonb_path_exists(props, 'strict $.* ? (@.type() == "object" || @.type() == "array" || @.type() == "null")') else true end),
  constraint analytics_events_props_size check (octet_length(props::text) <= 2048),
  -- 개인정보·원문을 담을 이름의 속성 칸 거부 — 수집 API가 막지 못해도 DB가 막는다 (FND-06 · GROW-01)
  constraint analytics_events_props_no_personal check (not (props ?| array[
    'ip', 'ip_address', 'ua', 'user_agent', 'useragent', 'email', 'mail', 'phone', 'tel', 'mobile', 'address', 'address_detail', 'addr',
    'lat', 'lng', 'lon', 'latitude', 'longitude', 'coords', 'coordinates', 'location', 'geo',
    'query', 'q', 'search_term', 'keyword', 'question', 'message', 'prompt', 'answer', 'input', 'inputs', 'amount', 'price',
    'user_id', 'member_id', 'profile_id', 'account', 'name', 'full_name', 'rrn', 'referrer', 'referer', 'url']))
);

comment on table public.analytics_events is '자체 분석 이벤트 — 지표의 원본 (FND-06·GROW-01). 개인정보·질문 원문·IP·User-Agent 원문·좌표·상세 주소·계산 입력값·검색어 원문 칸 없음. anon·authenticated 0';
comment on column public.analytics_events.visitor_id is '익명 방문자 ID (무작위 UUID, 1st-party 쿠키 ltr_vid) — 측정 거부·GPC 요청은 저장 자체를 하지 않는다 (설계 9장 #1)';
comment on column public.analytics_events.props is '이벤트 속성 — 이름마다 정해진 칸만 (설계 2.2). 값은 글자·숫자·참거짓, 2KB 이하';

create index analytics_events_occurred_idx on public.analytics_events (occurred_at);
create index analytics_events_name_occurred_idx on public.analytics_events (name, occurred_at);
-- 많이 본 기사·HOT 집계(2단계)가 기사별로 읽는다
create index analytics_events_article_idx on public.analytics_events ((props ->> 'article_id'), occurred_at) where props ? 'article_id';

alter table public.analytics_events enable row level security;
revoke all on table public.analytics_events from anon, authenticated, service_role;
grant select, insert, update, delete on table public.analytics_events to service_role;

-- ─────────────────────────────────────────────────────────────
-- article_stats — 기사 시간 단위 집계 (ART-11 · HOME-05). hour = UTC 정시
-- ─────────────────────────────────────────────────────────────
create table public.article_stats (
  article_id bigint not null references public.articles (id) on delete cascade,
  hour timestamptz not null,
  views_all integer not null default 0 check (views_all >= 0),          -- 모든 조회 (봇·편집자 포함)
  views_human integer not null default 0 check (views_human >= 0),      -- 사람 조회 — 봇·편집자 제외, 같은 방문자 30분 안 반복 1회
  shares integer not null default 0 check (shares >= 0),                -- 사람 공유
  engaged_views integer not null default 0 check (engaged_views >= 0),  -- 사람 30초 이상 열람
  computed_at timestamptz not null default now(),
  primary key (article_id, hour),
  constraint article_stats_hour_start check (date_trunc('hour', hour at time zone 'UTC') = hour at time zone 'UTC'),
  constraint article_stats_human_le_all check (views_human <= views_all)
);

comment on table public.article_stats is '기사 시간 단위 집계 (ART-11·HOME-05) — 원본은 analytics_events, 2단계 1시간 배치가 채운다. 전체 값과 사람 값을 따로 둔다. anon·authenticated 0';

create index article_stats_hour_idx on public.article_stats (hour);

alter table public.article_stats enable row level security;
revoke all on table public.article_stats from anon, authenticated, service_role;
grant select, insert, update, delete on table public.article_stats to service_role;

-- ─────────────────────────────────────────────────────────────
-- 수집·집계 설정 씨앗 (설계 2.5 — 시험 tests/w2c-analytics.test.mjs가 설계 문서의 값과 대조한다)
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value, description, updated_by) values
  ('analytics',
   '{"version":"2026-10-18.1","stage":1,"session_idle_minutes":30,"visitor_id_days":365,"respect_dnt":false,"retention_days":395,"rate_limits":{"visitor_per_minute":120,"ip_per_minute":600}}'::jsonb,
   '수집 설정 (GROW-01) — 단계·세션 경계(무활동 분)·방문자 ID 쿠키 수명(일)·DNT를 거부로 볼지·원본 보존(일 — 결정 안건)·방문자·IP 1분 상한',
   'migration:20261018000014'),
  ('bot_user_agents',
   '{"version":"2026-10-18.1","patterns":["bot","crawl","spider","slurp","headlesschrome","phantomjs","lighthouse","pagespeed","yeti","daumoa","bingpreview","facebookexternalhit","kakaotalk-scrap","whatsapp","gptbot","chatgpt-user","oai-searchbot","claude-user","claude-searchbot","perplexity-user","bytespider","semrush","ahrefs","petalbot","curl/","wget/","python-requests","python-urllib","aiohttp","httpx","go-http-client","java/","okhttp","node","axios/","undici","libwww-perl","scrapy","postmanruntime","insomnia","uptime","pingdom","statuscake","vercel-screenshot","vercel-cron"]}'::jsonb,
   '봇 User-Agent 목록 (ART-11·HOME-05·GROW-01) — 소문자 글자 조각, 하나라도 들어 있으면 봇(빈 User-Agent도 봇). 원문은 저장하지 않는다',
   'migration:20261018000014'),
  ('analytics_referrers',
   '{"version":"2026-10-18.1","ai_answer_engine":["chatgpt.com","chat.openai.com","perplexity.ai","gemini.google.com","copilot.microsoft.com","claude.ai","wrtn.ai","you.com","poe.com"],"naver":["naver.com"],"search":["google.com","google.co.kr","bing.com","search.daum.net","search.yahoo.com","duckduckgo.com","ecosia.org","search.zum.com","baidu.com","yandex.ru"]}'::jsonb,
   '진입 경로 리퍼러 목록 (PRD-00 13장 · OPT-09 AI 답변 엔진 리퍼러) — 호스트가 같거나 .이름으로 끝나면 그 진입 경로. AI → 네이버 → 검색 순 [확인 필요 — 편집국 확정]',
   'migration:20261018000014'),
  ('hot_weights',
   '{"version":"2026-10-18.1","window_days":7,"view":1,"share":5,"engaged":2,"max_pins":2}'::jsonb,
   '상담 사례 HOT (HOME-05) — 최근 window_days일 조회×view + 공유×share + 30초 이상 열람×engaged, 편집자 고정 최대 max_pins건 [결정 안건: HOT 선정 기준]',
   'migration:20261018000014'),
  ('popular_rules',
   '{"version":"2026-10-18.1","window_hours":168,"dedupe_minutes":30,"exclude_content_types":["digest","sponsored"],"sidebar_size":5,"list_size":20}'::jsonb,
   '많이 본 기사 (ART-11) — 최근 window_hours시간 사람 조회, 같은 방문자 dedupe_minutes분 안 반복 1회, 제외 유형 [결정 안건], 사이드바·목록 건수',
   'migration:20261018000014');
