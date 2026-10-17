-- W2-a 1단계 DB — 공개 출처 article_sources · 비공개 취재 근거 article_evidence · article_datasets · article_interviews
-- (PRD-01A 6.1, FND-04 · NAV-02 · NAV-10~12 · REG1-09)
-- · article_sources는 공개 기사에 보이는 출처다. kind가 official_doc·dataset이면 출처 URL·발표기관·확인일·권리 상태가
--   비면 DB 제약이 거부한다 (FND-04 — 발행 서비스와 양쪽 검사). 원자료 새 버전은 수정 사유 필수 (REG1-09)
-- · article_evidence·article_datasets·article_interviews는 비공개 — anon·authenticated 0행(정책 없음), 검색 색인·도우미 도구 제외
-- · 인터뷰 기록에는 연락처·녹취 원문 칸을 두지 않고 보존 위치만 둔다 (NAV-11·NAV-12)

create table public.article_sources (
  id bigint generated always as identity primary key,
  article_id bigint not null references public.articles (id) on delete cascade,
  version integer not null default 1 check (version >= 1),     -- 기사 버전
  kind text not null check (kind in ('official_doc', 'dataset', 'press_release', 'interview', 'field', 'photo', 'other')),
  title text,
  source_url text,                                             -- 출처 URL
  source_name text,                                            -- 발표기관 (issuer)
  provider text,                                               -- 제공처 — 발표기관과 다를 때 (예: 공공데이터포털)
  last_verified_at timestamptz,                                -- 확인일
  license_status text,                                         -- 권리 상태 (이용 조건 — 예: 공공누리 제1유형)
  source_type text,                                            -- 공식 자료 종류 (01B REG1-07 — settings 허용 목록)
  published_on date,                                           -- 발표일
  reference_date date,                                         -- 기준일
  region_code text,
  region_unit text,                                            -- 지역 단위
  collected_at timestamptz,                                    -- 수집일
  snapshot_id bigint references public.raw_snapshots (id),
  supersedes_id bigint references public.article_sources (id),
  revision_reason text,
  created_at timestamptz not null default now(),
  constraint article_sources_official_required check (
    kind not in ('official_doc', 'dataset') or (
      length(btrim(coalesce(source_url, ''))) > 0
      and length(btrim(coalesce(source_name, ''))) > 0
      and last_verified_at is not null
      and length(btrim(coalesce(license_status, ''))) > 0)),
  constraint article_sources_revision_reason check (supersedes_id is null or length(btrim(coalesce(revision_reason, ''))) > 0)
);

comment on table public.article_sources is '공개 기사에 보이는 출처 (NAV-03). official_doc·dataset은 출처 URL·발표기관·확인일·권리 상태 필수 (FND-04). press_release 행은 유사도 비교 원문 (OPT-06)';

create index article_sources_article_idx on public.article_sources (article_id, version);

alter table public.article_sources enable row level security;
revoke all on table public.article_sources from anon, authenticated, service_role;
grant select, insert, update, delete on table public.article_sources to service_role;

-- 비공개 취재 근거 (NAV-12)
create table public.article_evidence (
  id bigint generated always as identity primary key,
  article_id bigint not null references public.articles (id) on delete cascade,
  article_version integer not null default 1 check (article_version >= 1),
  evidence_type text not null check (evidence_type in ('dataset', 'document', 'interview', 'field', 'photo', 'calculation')),
  location text not null check (length(btrim(location)) > 0),  -- 원본 보존 위치 (원문·연락처 자체는 넣지 않는다)
  rights_status text not null default 'unconfirmed' check (rights_status in ('unconfirmed', 'confirmed', 'restricted')),
  verified_at timestamptz,
  owner_id bigint references public.people (id),               -- 담당자
  retention_until date,                                        -- 보존 기한 — 지나면 삭제 작업이 지운다
  verification_status text not null default 'pending' check (verification_status in ('pending', 'verified', 'rejected')),
  created_at timestamptz not null default now()
);

comment on table public.article_evidence is '비공개 취재 근거 (NAV-12) — anon·authenticated 0행, 검색 색인·도우미 도구 제외';

create index article_evidence_article_idx on public.article_evidence (article_id, article_version);

alter table public.article_evidence enable row level security;
revoke all on table public.article_evidence from anon, authenticated, service_role;
grant select, insert, update, delete on table public.article_evidence to service_role;

-- 정량형 기사 재현 정보 (NAV-10)
create table public.article_datasets (
  evidence_id bigint primary key references public.article_evidence (id) on delete cascade,
  definition text,          -- 지표 정의
  period text,              -- 기간
  unit text,                -- 단위
  region_unit text,         -- 지역 단위
  denominator text,         -- 분모
  exclusions text,          -- 제외값
  transform text,           -- 계산 과정·변환
  repro_file_hash text,     -- 재현 파일 해시
  provider text,
  source_url text,
  collected_at timestamptz,
  license text
);

comment on table public.article_datasets is '정량형 기사 재현 정보 (NAV-10) — 비공개';

alter table public.article_datasets enable row level security;
revoke all on table public.article_datasets from anon, authenticated, service_role;
grant select, insert, update, delete on table public.article_datasets to service_role;

-- 인터뷰 기록 (NAV-11) — 연락처·녹취 원문 칸 없음, 보존 위치만
create table public.article_interviews (
  evidence_id bigint primary key references public.article_evidence (id) on delete cascade,
  subject_role text not null check (length(btrim(subject_role)) > 0),   -- 대상 역할 (예: 구청 세무과 직원)
  contacted_at timestamptz,
  record_location text,                                                 -- 녹취·메모 보존 위치
  quote_consent text not null check (quote_consent in ('full', 'partial', 'none')),
  anonymity text not null check (anonymity in ('named', 'anonymous')),
  anonymity_reason text
);

comment on table public.article_interviews is '인터뷰 기록 (NAV-11) — 비공개. 연락처·녹취 원문은 이 표에도 넣지 않는다';

alter table public.article_interviews enable row level security;
revoke all on table public.article_interviews from anon, authenticated, service_role;
grant select, insert, update, delete on table public.article_interviews to service_role;
