-- W10-c 2단계 — 법령 표 laws · law_versions · law_articles · law_events · law_watch_state (PRD-02 PIPE-01 · PIPE-06 · PIPE-07, 2단계_설계 3장 W10-c)
-- 이 파일에 법령 조문·세율·기한 값은 없다 — 표와 규칙만. 법령 이름은 감시 대상 목록(이름만)이고 조문 내용은 수집기가 가져와 스냅샷과 함께 채운다.
--
-- · laws — 감시 대상 법령 등록부(씨앗 15행: 지방세 4법 × 법·시행령·시행규칙 12 + 계산기 연관 국세 법령 3, 이름만). 상속세·증여세 법령은 이름 검사로 넣을 수 없다 (PO 결정 — 3단계 이월).
-- · law_versions — 개정판 하나에 1행(공포번호 + 시행일자). 새 행만 추가, 고치기·지우기 거부. 스냅샷(raw_snapshots) 없이는 넣을 수 없다 (PIPE-07).
-- · law_articles — 조문. 개정판마다 새 행(덮어쓰기 0), 추가만.
-- · law_events — 감지 기록(first_seen·revision·body_only). (법령, 종류, 사건 키) 하나에 1행이라 크론이 매일 돌아도 중복 0. 해시만 바뀐 body_only는 개정이 아니다.
-- · law_watch_state — 법령별 최근 확인 상태(watching·api_error·paused). 실패한 실행은 이 표만 바꾸고 위 공개 자료 표는 건드리지 않는다 (PIPE-06).
-- 모든 표는 RLS 기본 거부, anon·authenticated 권한 0. 공개 뷰는 W10-d(마이그레이션 89)가 칸을 지정해 만든다.

create table public.laws (
  id bigint generated always as identity primary key,
  law_key text unique check (law_key is null or length(btrim(law_key)) > 0),
  name text not null unique check (length(btrim(name)) > 0),
  tier text not null check (tier in ('statute', 'decree', 'rule')),
  scope text not null default 'local' check (scope in ('local', 'linked_national')),
  watch boolean not null default true,
  created_at timestamptz not null default now(),
  constraint laws_name_not_excluded check (name !~ '(상속세|증여세)')
);

comment on table public.laws is '감시 대상 법령 등록부 — law_key는 법제처 법령 ID(첫 검색 때 채움). 상속세·증여세 법령 이름은 넣을 수 없다 (3단계 이월)';
comment on column public.laws.scope is 'local = 지방세 법령, linked_national = 계산기 연관 국세 법령(감시만 — 계산 아님)';

insert into public.laws (name, tier, scope) values
  ('지방세기본법', 'statute', 'local'), ('지방세기본법 시행령', 'decree', 'local'), ('지방세기본법 시행규칙', 'rule', 'local'),
  ('지방세법', 'statute', 'local'), ('지방세법 시행령', 'decree', 'local'), ('지방세법 시행규칙', 'rule', 'local'),
  ('지방세특례제한법', 'statute', 'local'), ('지방세특례제한법 시행령', 'decree', 'local'), ('지방세특례제한법 시행규칙', 'rule', 'local'),
  ('지방세징수법', 'statute', 'local'), ('지방세징수법 시행령', 'decree', 'local'), ('지방세징수법 시행규칙', 'rule', 'local'),
  ('종합부동산세법', 'statute', 'linked_national'), ('농어촌특별세법', 'statute', 'linked_national'), ('인지세법', 'statute', 'linked_national');

create table public.law_versions (
  id bigint generated always as identity primary key,
  law_id bigint not null references public.laws (id),
  law_serial text check (law_serial is null or length(btrim(law_serial)) > 0),
  promulgation_no text not null check (length(btrim(promulgation_no)) > 0),
  promulgated_on date not null,
  effective_on date not null,
  revision_kind text,
  body_hash text not null check (length(btrim(body_hash)) > 0),
  snapshot_id bigint not null references public.raw_snapshots (id),
  created_at timestamptz not null default now(),
  constraint law_versions_once unique (law_id, promulgation_no, effective_on)
);

comment on table public.law_versions is '법령 개정판 — 공포번호 + 시행일자 하나에 1행(추가만). 스냅샷 없이 넣을 수 없다';
create index law_versions_law_idx on public.law_versions (law_id, effective_on desc, id desc);

create table public.law_articles (
  id bigint generated always as identity primary key,
  version_id bigint not null references public.law_versions (id),
  article_no int not null check (article_no > 0),
  branch_no int not null default 0 check (branch_no >= 0),
  title text,
  body text not null check (length(btrim(body)) > 0),
  effective_on date,
  constraint law_articles_once unique (version_id, article_no, branch_no)
);

comment on table public.law_articles is '법령 조문 — 개정판마다 새 행(추가만). 글자는 수집기가 API 응답에서 옮긴 것이고 손으로 쓰지 않는다';

create table public.law_events (
  id bigint generated always as identity primary key,
  law_id bigint not null references public.laws (id),
  kind text not null check (kind in ('first_seen', 'revision', 'body_only')),
  event_key text not null check (length(btrim(event_key)) > 0),
  version_id bigint references public.law_versions (id),
  snapshot_id bigint not null references public.raw_snapshots (id),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  detected_at timestamptz not null default now(),
  constraint law_events_once unique (law_id, kind, event_key),
  constraint law_events_version check ((kind = 'body_only') = (version_id is null) or kind = 'first_seen')
);

comment on table public.law_events is '법령 변경 감지 기록 — 크론이 매일 돌아도 같은 사건은 1행. body_only(해시만 바뀜)는 개정이 아니라 기록만 한다';

create table public.law_watch_state (
  law_id bigint primary key references public.laws (id),
  status text not null default 'watching' check (status in ('watching', 'api_error', 'paused')),
  last_checked_at timestamptz,
  last_promulgation_no text,
  last_effective_on date,
  last_body_hash text,
  fail_count int not null default 0 check (fail_count >= 0),
  last_error text check (last_error is null or length(last_error) <= 500)
);

comment on table public.law_watch_state is '법령별 최근 확인 상태 — 실패는 여기에만 기록하고 공개 자료(law_versions·law_articles)는 그대로 둔다 (PIPE-06)';

create trigger law_versions_append_only before update or delete on public.law_versions
  for each row execute function public.append_only_guard();
create trigger law_articles_append_only before update or delete on public.law_articles
  for each row execute function public.append_only_guard();
create trigger law_events_append_only before update or delete on public.law_events
  for each row execute function public.append_only_guard();

alter table public.laws enable row level security;
alter table public.law_versions enable row level security;
alter table public.law_articles enable row level security;
alter table public.law_events enable row level security;
alter table public.law_watch_state enable row level security;
revoke all on table public.laws, public.law_versions, public.law_articles, public.law_events, public.law_watch_state from anon, authenticated, service_role;
grant select, insert, update on table public.laws to service_role;
grant select, insert on table public.law_versions, public.law_articles, public.law_events to service_role;
grant select, insert, update on table public.law_watch_state to service_role;

-- W10-a rules_audit.law_event_id(마이그레이션 81이 번호 칸만 둠)에 외래키 연결 — 법령 변경 감지 기록(law_events)을 감사에 잇는다 (O1)
alter table public.rules_audit
  add constraint rules_audit_law_event_fk foreign key (law_event_id) references public.law_events (id);
