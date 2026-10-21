-- W3 1·2단계 — 바깥 연결 표 official_links + 점검 기록 official_link_checks (PRD-01B TX-01·FAM-08, docs/dev/W3_설계.md 3장)
-- · 시드는 '주소 비운 행'뿐이다 — 실제 SM 계산기 주소·이용 조건 문구는 설정값(관리자 입력, PO 승인 2026-10-21). 주소가 비면 카드는 숨는다.
-- · 공개 읽기는 칸을 좁혀서(내부 점검자 칸 제외) 활성 행만. 쓰기는 service_role. 점검 기록은 추가만(수정·삭제 권한 없음), (link_id, run_key) 유일 = 멱등.
-- · situations.external_link_id(W2-a …10)에 외래 키를 건다.

create table public.official_links (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('sm_calculator', 'external_calculator', 'fallback')),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label text not null check (char_length(label) between 1 and 80),
  url text check (url is null or url ~* '^https?://[^[:space:]]+$'),
  terms_note text check (terms_note is null or char_length(terms_note) <= 300),
  status text not null default 'unchecked' check (status in ('ok', 'broken', 'unchecked')),
  checked_at timestamptz,
  check_method text check (check_method is null or check_method in ('auto', 'manual')),
  checked_by text,
  last_ok_at timestamptz,
  active boolean not null default true,
  sort integer not null default 0,
  unique (kind, key)
);

comment on table public.official_links is '바깥 연결 (TX-01·FAM-08) — SM 계산기 5·외부 계산기 1·대체 안내 2. url이 비면 화면에서 숨김. 상태는 점검 배치가 정한다';
comment on column public.official_links.terms_note is '이용 조건 문구(설정값) — 코드에 문구를 넣지 않는다';

create table public.official_link_checks (
  id bigint generated always as identity primary key,
  link_id bigint not null references public.official_links (id) on delete cascade,
  run_key text not null check (char_length(run_key) between 1 and 40),
  result text not null check (result in ('ok', 'broken')),
  http_status integer,
  method text not null check (method in ('auto', 'manual')),
  by text,
  at timestamptz not null default now(),
  unique (link_id, run_key)
);

comment on table public.official_link_checks is '링크 점검 기록 — 추가만. 같은 실행 키로 두 번 돌려도 한 벌';

insert into public.official_links (kind, key, label, sort) values
  ('sm_calculator', 'acquisition', '취득세 계산기', 10),
  ('sm_calculator', 'property_tax', '재산세 계산기', 20),
  ('sm_calculator', 'transfer', '양도세 계산기 (팔 때)', 30),
  ('sm_calculator', 'registration', '등기·등록 비용 계산기', 40),
  ('sm_calculator', 'comprehensive', '종합 비교 계산기', 50),
  ('external_calculator', 'inheritance_gift', '안심 상속증여계산기', 60),
  ('fallback', 'wetax', '위택스 안내', 70),
  ('fallback', 'nts', '국세청 안내', 80);

alter table public.situations
  add constraint situations_external_link_fk foreign key (external_link_id) references public.official_links (id) on delete set null;

alter table public.official_links enable row level security;
alter table public.official_link_checks enable row level security;
revoke all on table public.official_links, public.official_link_checks from anon, authenticated, service_role;
grant select, insert, update, delete on table public.official_links to service_role;
grant select, insert on table public.official_link_checks to service_role;
grant select (id, kind, key, label, url, terms_note, status, checked_at, last_ok_at, active, sort) on table public.official_links to anon, authenticated;

create policy official_links_public_read on public.official_links
  for select to anon, authenticated
  using (active and url is not null);
