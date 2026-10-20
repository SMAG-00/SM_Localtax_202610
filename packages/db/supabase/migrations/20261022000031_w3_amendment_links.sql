-- W3 4단계 — 기사 ↔ 개정안 연결 (PRD-01B TX-08 개정 브리핑, docs/dev/W3_설계.md 3장 article_amendments)
-- · 기사 하나가 개정안 여러 건에, 개정안 하나에 기사 여러 건이 연결된다. 기존 articles.amendment_id(단일 지정)는 그대로 둔다(표·제약 불변).
-- · 갱신 배너·`확정 아님` 칩은 저장하지 않고 서버가 단계 기록에서 계산한다. 이 표는 연결만 가진다.
-- · 공개 읽기: 공개 개정안에 걸린 연결 행만 (개정안 RLS를 따른다). 쓰기는 service_role만.

create table public.article_amendments (
  article_id bigint not null references public.articles (id) on delete cascade,
  amendment_id bigint not null references public.amendments (id),
  created_at timestamptz not null default now(),
  primary key (article_id, amendment_id)
);

comment on table public.article_amendments is '기사↔개정안 연결 (TX-08) — 갱신 배너·확정 아님 칩의 대상. 상태는 저장하지 않는다';

create index article_amendments_amendment_idx on public.article_amendments (amendment_id);

alter table public.article_amendments enable row level security;
revoke all on table public.article_amendments from anon, authenticated, service_role;
grant select, insert, update, delete on table public.article_amendments to service_role;
grant select (article_id, amendment_id) on table public.article_amendments to anon, authenticated;

create policy article_amendments_public_read on public.article_amendments
  for select to anon, authenticated
  using (exists (select 1 from public.amendments m where m.id = article_amendments.amendment_id));
