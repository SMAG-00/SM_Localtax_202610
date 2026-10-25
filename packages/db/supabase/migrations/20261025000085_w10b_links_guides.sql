-- W10-b 보충 — official_links 연속 실패 횟수 · 위택스 이용 안내 wetax_guides (PRD-02 FAM-04 · WETAX-01 · WETAX-02, docs/dev/W10-b_설계.md 3장)
-- 이 파일에 이용 시간·전화번호 같은 실제 안내 값은 없다 — 안내 항목은 편집자가 출처와 확인일과 함께 넣는다(씨앗 0행).
--
-- · official_links.fail_count — 점검이 연속으로 실패한 횟수. 앱의 점검 배치가 2회 연속 실패하면 status를 broken으로 바꾸고 성공하면 0으로 되돌린다
--   (wetax_links와 같은 규칙). 공개 읽기 칸 목록에는 넣지 않는다(내부 칸).
-- · wetax_guides — 위택스 공식 이용 안내(이용 시간·문의처 등). 출처와 확인일이 둘 다 있는 활성 행만 공개로 읽힌다 — 출처·확인일이 없는 항목은 렌더하지 않는다(원칙 13).
--   확인일이 92일을 넘은 항목은 백오피스 재확인 대상이다(앱의 판정 함수 lib/calc/guide.ts).

alter table public.official_links
  add column fail_count integer not null default 0 check (fail_count between 0 and 99);
comment on column public.official_links.fail_count is '연속 점검 실패 횟수 - 2회 연속이면 앱 배치가 broken으로, 성공하면 0 (FAM-04)';

create table public.wetax_guides (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label text not null check (char_length(label) between 1 and 80),
  body text not null check (char_length(btrim(body)) between 1 and 300),
  source text check (source is null or char_length(btrim(source)) between 1 and 200),
  confirmed_on date,
  active boolean not null default true,
  sort integer not null default 0
);

comment on table public.wetax_guides is '위택스 공식 이용 안내 (WETAX-02) - 출처·확인일이 있는 활성 행만 공개. 값은 편집자 입력(씨앗 0행)';

alter table public.wetax_guides enable row level security;
revoke all on table public.wetax_guides from anon, authenticated, service_role;
grant select, insert, update, delete on table public.wetax_guides to service_role;
grant select (key, label, body, source, confirmed_on, active, sort) on table public.wetax_guides to anon, authenticated;

create policy wetax_guides_public_read on public.wetax_guides
  for select to anon, authenticated
  using (active and nullif(btrim(coalesce(source, '')), '') is not null and confirmed_on is not null);
