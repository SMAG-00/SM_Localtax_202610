-- W2-a 1단계 DB — 분야 체계(categories)·기존 카테고리 대응표·운영 설정(settings)·용어사전·이미지(media)·제휴사·태그·원본 스냅샷
-- 씨앗 데이터: 분야 = PRD-00 5.3 분야 표 그대로 (CAT-01 — 값 대조 시험 tests/w2a-seed.test.mjs가 문서를 읽어 비교한다)

-- ─────────────────────────────────────────────────────────────
-- categories — 허브(4대 분야 section) > 하위 분야 (CAT-01). 편집국이 CMS에서 추가·정렬한다
-- ─────────────────────────────────────────────────────────────
create table public.categories (
  id bigint generated always as identity primary key,
  section text not null check (section in ('tax', 'realestate', 'finance', 'local')),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),   -- 하위 경로 이름 (/tax/amendments 등)
  name text not null check (length(btrim(name)) > 0),
  intro text,                                                     -- 소개 문구 (편집국이 쓴다)
  sort integer not null default 0,
  visible boolean not null default false,
  needs_disclaimer boolean not null default false,                -- 면책·세무 감수 대상 분야
  needs_tax_lens boolean not null default false,                  -- 「지방세로 읽기」 필수 (CORE-01)
  created_at timestamptz not null default now(),
  unique (section, slug),
  unique (section, name),
  unique (id, section)                                            -- 기사·대응표가 (하위 분야, 분야) 짝으로 참조한다
);

comment on table public.categories is '분야 체계 (CAT-01) — 허브 = 4대 분야(section), 행 = 하위 분야. 뉴스 허브는 분야가 아니라 content_type 필터';

alter table public.categories enable row level security;
revoke all on table public.categories from anon, authenticated, service_role;
grant select, insert, update, delete on table public.categories to service_role;

-- 씨앗: PRD-00 5.3 분야 표 (순서 그대로). 1단계 칸이 모두 있어 전부 공개로 시작한다.
-- needs_disclaimer — PRD-00 6장 감수 서명 대상(세법 해설·개정 브리핑·해석 해설·개발방법 비교 요건 값·금융 구조 세금 문장)과 감수 안내 페이지(상속·증여)
-- needs_tax_lens — CORE-01: 부동산·부동산개발금융·지자체뉴스 분야 (section=tax는 대상 아님)
-- slug — PRD-01A CAT-01의 1단계 하위 경로. 경로가 정해지지 않은 하위 분야(지자체별 허브·분양 정보·규제 통계·금주 핫뉴스·자체 취재)는 임시 이름이다
insert into public.categories (section, slug, name, sort, visible, needs_disclaimer, needs_tax_lens) values
  ('tax',        'amendments',          '개정 트래커',     10, true, true,  false),
  ('tax',        'interpretations',     '해석',            20, true, true,  false),
  ('tax',        'columns',             '칼럼',            30, true, false, false),
  ('realestate', 'regional-hubs',       '지자체별 허브',   10, true, false, true),
  ('realestate', 'projects',            '프로젝트 트래커', 20, true, false, true),
  ('realestate', 'supply',              '분양 정보',       30, true, false, true),
  ('realestate', 'development-methods', '개발방법 비교',   40, true, true,  true),
  ('realestate', 'inheritance-gift',    '상속·증여 안내',  50, true, true,  true),
  ('finance',    'trust-pf',            '신탁·PF 구조',    10, true, true,  true),
  ('finance',    'cases',               '사례',            20, true, false, true),
  ('finance',    'indicators',          '규제 통계',       30, true, false, true),
  ('finance',    'columns',             '칼럼',            40, true, false, true),
  ('local',      'weekly',              '금주 핫뉴스',     10, true, false, true),
  ('local',      'reporting',           '자체 취재',       20, true, false, true),
  ('local',      'events',              '행사안내',        30, true, false, true);

-- ─────────────────────────────────────────────────────────────
-- legacy_category_map — 기존 8개 카테고리 대응 (PRD-00 5.3, RP-03, MIG-01 분류 매핑)
-- PRD-01A 6.1은 categories.legacy_name 칸으로 적었지만, 대응이 여러 대 하나(판례 분석·유권 해석·상담 사례 → 해석)이고
-- 하위 분야 없이 분야에만 대응하는 행(부동산 정보 → 부동산, 교육 및 포럼 → 지방세 + 교육 태그)이 있어 별도 표로 둔다.
-- ─────────────────────────────────────────────────────────────
create table public.legacy_category_map (
  legacy_name text primary key check (length(btrim(legacy_name)) > 0),
  section text not null check (section in ('tax', 'realestate', 'finance', 'local')),
  category_id bigint,                                   -- 비면 분야(section)에만 대응
  tag text,                                             -- 이관 때 붙이는 태그 (교육 및 포럼 → 교육)
  needs_reclassify boolean not null default false,      -- 이관 뒤 편집국 재분류 큐 (MIG-01)
  note text,
  foreign key (category_id, section) references public.categories (id, section)
);

comment on table public.legacy_category_map is '기존 8개 카테고리 → 4대 분야(·하위 분야) 대응 (PRD-00 5.3, MIG-01). 하위 분야는 같은 분야의 것만 (짝 외래 키)';

alter table public.legacy_category_map enable row level security;
revoke all on table public.legacy_category_map from anon, authenticated, service_role;
grant select, insert, update, delete on table public.legacy_category_map to service_role;

insert into public.legacy_category_map (legacy_name, section, category_id, tag, needs_reclassify, note)
select v.legacy_name, v.section, c.id, v.tag, v.needs_reclassify, v.note
from (values
  ('지자체 소식', 'local',      'reporting',       null,   false, '지역성이 있는 기사는 region_code를 더한다. 과거 기사를 금주 핫뉴스(digest)로 바꾸지 않는다'),
  ('판례 분석',   'tax',        'interpretations', null,   false, null),
  ('유권 해석',   'tax',        'interpretations', null,   false, null),
  ('전문가 칼럼', 'tax',        'columns',         null,   true,  '이관 후 편집국 재분류 큐에서 부동산·개발금융 칼럼을 나눈다'),
  ('법령 개정',   'tax',        'amendments',      null,   false, '개정 브리핑 기사. 트래커 항목은 새로 만든다'),
  ('부동산 정보', 'realestate', null,              null,   true,  '재분류 큐에서 프로젝트·개발방법·상속·증여로 나누고, 신탁·PF·리츠는 부동산개발금융으로 옮긴다'),
  ('교육 및 포럼', 'tax',       null,              '교육', false, '강좌 일정은 /edu(EDU-01), 기사는 지방세 분야(하위 분야 없이 교육 태그)'),
  ('상담 사례',   'tax',        'interpretations', null,   false, '하위 유형 해결 사례(CAT-05)')
) as v (legacy_name, section, slug, tag, needs_reclassify, note)
left join public.categories c on c.section = v.section and c.slug = v.slug;

-- ─────────────────────────────────────────────────────────────
-- settings — 운영 설정 (배포 없이 바뀐다). 발행 판정(packages/editorial)은 사전·기준값을 입력으로 받는다
-- ─────────────────────────────────────────────────────────────
create table public.settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_.]*$'),
  value jsonb not null,
  description text,
  updated_by text,
  updated_at timestamptz not null default now()
);

comment on table public.settings is '운영 설정 — 금지 표현·공포 표현 사전, 점검 엔진 기준값 등 (PRD-01A 6.1). anon 0행';

create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

alter table public.settings enable row level security;
revoke all on table public.settings from anon, authenticated, service_role;
grant select, insert, update, delete on table public.settings to service_role;

insert into public.settings (key, value, description, updated_by) values
  ('forbidden_phrases',
   jsonb_build_object('version', '2026-10-17.1', 'phrases', jsonb_build_array(
     -- PRD-00 8.8 금지 표현
     '무료 상담', '최저가', '100% 환급', '무조건', '절세 보장', '투자 유망', '지금 사야 할', '명품', '세금 폭탄', '놓치면 끝', '수익 보장', '추천 단지', '추천 전문가',
     -- 검증할 수 없는 순위·평가 표현 (PRD-00 8.8 원칙 12, EXPL-04)
     '현지 1위', '지역 1위', '업계 1위', '국내 1위', '별점 만점',
     -- 세금 혜택·가격 상승·투자 권유 암시 (UX-01, DF-05)
     '세금 혜택 보장', '세금 안 내는 방법', '집값 상승 확실', '가격 상승 기대', '오를 일만 남은', '투자 적기', '매수 적기', '매수 추천', '투자 추천', '수익률 보장', '확정 수익', '원금 보장'
   )),
   '금지 표현 사전 (UX-01) — 들어 있으면 발행 차단. 초기 목록 = PRD-00 8.8 + 검증 불가 순위 + 세금 혜택·가격 상승·투자 권유 암시. 편집자가 고친다',
   'migration:20261018000002'),
  ('fear_phrases',
   jsonb_build_object('version', '2026-10-17.1', 'phrases', jsonb_build_array(
     '세금 폭탄', '큰일', '놓치면 끝', '가산세 폭탄', '세금 날벼락', '큰코다친다'
   )),
   '공포 표현 사전 (UX-03, PRD-00 R9) — CMS 저장 검사와 화면 고정 문구 시험이 같이 쓴다',
   'migration:20261018000002'),
  ('similarity_internal',
   jsonb_build_object(
     'version', 'similarity-internal-2026-10-17.1',
     'sentenceSimilarity', 0.9, 'sentenceComparator', 'gte',
     'articleRatio', 0.6, 'articleComparator', 'gt',
     'quoteRatio', 0.3, 'quoteComparator', 'gt'),
   '점검 엔진 내부 기준 (OPT-06·LG-03) — 규정 버전(NAV-18) 확정 전. 인용 비율 0.3은 임시값 [결정 안건 PRD-01A 13장]. packages/similarity INTERNAL_SIMILARITY_RULES와 같은 모양',
   'migration:20261018000002'),
  ('amendment_confirmed_stage',
   to_jsonb('promulgated'::text),
   '개정 확정 기준 단계 (TX-08 초기값 공포) — 이 단계 전이면 ''확정 아님'' [감수 필요]',
   'migration:20261018000002');

-- ─────────────────────────────────────────────────────────────
-- glossary_terms — 쉬운 말 사전 (UX-01). 쉬운 풀이는 60자 이하
-- ─────────────────────────────────────────────────────────────
create table public.glossary_terms (
  id bigint generated always as identity primary key,
  term text not null unique check (length(btrim(term)) > 0),
  reading text,
  definition text,
  plain text check (plain is null or char_length(plain) <= 60),
  jargon boolean not null default true,              -- 전문 용어 여부 — 풀이 없는 첫 등장 경고 대상
  related text[] not null default '{}',
  section text[] not null default '{}' check (section <@ array['tax', 'realestate', 'finance', 'local']::text[]),
  source text,
  updated_at timestamptz not null default now()
);

create trigger glossary_terms_touch before update on public.glossary_terms
  for each row execute function public.touch_updated_at();

alter table public.glossary_terms enable row level security;
revoke all on table public.glossary_terms from anon, authenticated, service_role;
grant select, insert, update, delete on table public.glossary_terms to service_role;

-- ─────────────────────────────────────────────────────────────
-- media — 이미지 출처·이용 조건. 권리 미확인 이미지는 공개 렌더·이미지 사이트맵 0 (PRD-01A 6.1, REG1-09)
-- 권리 확인(confirmed)은 출처·이용 조건·확인일이 모두 있어야 하고, 사진은 촬영자도 있어야 한다
-- ─────────────────────────────────────────────────────────────
create table public.media (
  id bigint generated always as identity primary key,
  path text not null check (length(btrim(path)) > 0),
  alt text,
  credit text,                 -- 출처
  photographer text,
  license text,                -- 이용 조건
  source_url text,
  checked_at timestamptz,
  kind text not null default 'photo' check (kind in ('photo', 'thumbnail')),
  rights_status text not null default 'unconfirmed' check (rights_status in ('unconfirmed', 'confirmed', 'rejected')),
  created_at timestamptz not null default now(),
  constraint media_confirmed_complete check (
    rights_status <> 'confirmed' or (
      length(btrim(coalesce(credit, ''))) > 0
      and length(btrim(coalesce(license, ''))) > 0
      and checked_at is not null
      and (kind <> 'photo' or length(btrim(coalesce(photographer, ''))) > 0)))
);

alter table public.media enable row level security;
revoke all on table public.media from anon, authenticated, service_role;
grant select, insert, update, delete on table public.media to service_role;

-- ─────────────────────────────────────────────────────────────
-- partners — 제휴사 (ART-10). 공개 행만 anon이 읽는다
-- ─────────────────────────────────────────────────────────────
create table public.partners (
  id bigint generated always as identity primary key,
  name text not null check (length(btrim(name)) > 0),
  kind text not null check (kind in ('tax_firm', 'media', 'institution', 'local_business')), -- 세무법인·언론·기관·지역 사업자
  intro text,
  logo_media_id bigint references public.media (id),
  url text,
  contract_from date,
  contract_to date,
  visible boolean not null default false,
  created_at timestamptz not null default now(),
  check (contract_from is null or contract_to is null or contract_to >= contract_from)
);

alter table public.partners enable row level security;
revoke all on table public.partners from anon, authenticated, service_role;
grant select, insert, update, delete on table public.partners to service_role;

-- ─────────────────────────────────────────────────────────────
-- tags — 비슷한 사례 선정·이관 태그 (기사 연결 article_tags는 기사 마이그레이션에서)
-- ─────────────────────────────────────────────────────────────
create table public.tags (
  id bigint generated always as identity primary key,
  name text not null unique check (length(btrim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

alter table public.tags enable row level security;
revoke all on table public.tags from anon, authenticated, service_role;
grant select, insert, update, delete on table public.tags to service_role;

-- ─────────────────────────────────────────────────────────────
-- raw_snapshots — 공식 원자료·보도자료 원본 스냅샷 (PRD-01A 6.1). 01B(REG1-09·TX)가 쓰고, OPT-06이 비교 원문으로 읽는다
-- ─────────────────────────────────────────────────────────────
create table public.raw_snapshots (
  id bigint generated always as identity primary key,
  source text not null check (length(btrim(source)) > 0),
  url text not null check (length(btrim(url)) > 0),
  fetched_at timestamptz not null default now(),
  content_hash text not null check (length(btrim(content_hash)) > 0),
  payload text not null
);

create index raw_snapshots_url_idx on public.raw_snapshots (url, fetched_at desc);

alter table public.raw_snapshots enable row level security;
revoke all on table public.raw_snapshots from anon, authenticated, service_role;
grant select, insert, update, delete on table public.raw_snapshots to service_role;
