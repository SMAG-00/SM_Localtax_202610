-- W10-c 3단계 — legal_docs 확장(원천 · 원천 문서 번호 · 결정 유형 · 출처 구분) + legal_doc_aliases (PRD-02 PIPE-02~04 · PIPE-07, 2단계_설계 3장 W10-c)
-- 이 파일에 해석·판례 문장은 없다. 수집기가 넣은 후보 문서는 rights_status `unchecked`로 시작하므로 공개 읽기 정책(권리 확인된 행만)에 걸려 공개되지 않는다 — 검수 승인(review_items kind legal_doc) 뒤 편집자가 권리를 확인한다.
--
-- · legal_docs.origin — manual(편집국 입력, 기존 행) / pipeline(수집기). pipeline 행은 원천·원천 문서 번호·스냅샷이 모두 있어야 한다 (스냅샷 없이 저장된 원문 행 0).
-- · (source_key, source_doc_id) 하나에 1행 — 같은 문서를 다시 수집해도 행이 늘지 않는다.
-- · legal_doc_aliases — 같은 해석을 두 원천이 줄 때 다른 원천의 문서 번호를 같은 행에 대응시킨다(중복 표시 0).
-- · doc_type 값 목록은 늘리지 않는다 — 국세청 해석(PIPE-09, P1)은 원천 이용 조건·실응답 확인 뒤 검색·공개 경로(마이그레이션 38·45·49 규칙)와 함께 더한다.
-- 새 칸은 anon·authenticated에 열지 않는다 (공개 열 목록 그대로).

alter table public.legal_docs
  add column origin text not null default 'manual' check (origin in ('manual', 'pipeline')),
  add column source_key text references public.data_sources (key),
  add column source_doc_id text check (source_doc_id is null or length(btrim(source_doc_id)) > 0),
  add column decision_kind text check (decision_kind is null or decision_kind in ('accepted', 'rejected', 'dismissed', 'remanded', 'other')),
  add constraint legal_docs_pipeline_complete check (
    origin = 'manual' or (source_key is not null and source_doc_id is not null and snapshot_id is not null));

comment on column public.legal_docs.origin is 'manual = 편집국 입력, pipeline = 수집기 후보 (스냅샷·원천·원천 문서 번호 필수)';
comment on column public.legal_docs.decision_kind is '결정 유형(심판·판례) — 분류 코드만, 결정 내용 글자는 raw_snapshots';

create unique index legal_docs_source_once on public.legal_docs (source_key, source_doc_id) where source_key is not null and source_doc_id is not null;

create table public.legal_doc_aliases (
  id bigint generated always as identity primary key,
  legal_doc_id bigint not null references public.legal_docs (id),
  source_key text not null references public.data_sources (key),
  source_doc_id text not null check (length(btrim(source_doc_id)) > 0),
  snapshot_id bigint not null references public.raw_snapshots (id),
  created_at timestamptz not null default now(),
  constraint legal_doc_aliases_once unique (source_key, source_doc_id)
);

comment on table public.legal_doc_aliases is '같은 문서를 다른 원천이 줄 때의 문서 번호 대응 — 원천·번호 하나에 1행 (해석 중복 표시 0)';
create index legal_doc_aliases_doc_idx on public.legal_doc_aliases (legal_doc_id);

create trigger legal_doc_aliases_append_only before update or delete on public.legal_doc_aliases
  for each row execute function public.append_only_guard();

alter table public.legal_doc_aliases enable row level security;
revoke all on table public.legal_doc_aliases from anon, authenticated, service_role;
grant select, insert on table public.legal_doc_aliases to service_role;
