-- 편집위원 데스크 결과물 → 기사 초안 (PO 2026-11-18 "기사초안으로 옮기기 버튼만들어줘")
-- 결과물 묶음 하나에서 만든 기사 초안을 적어 둔다 — 같은 묶음으로 초안이 두 번 생기지 않게 하고, 묶음 화면에서 '초안 열기'로 잇는다.
-- 기사를 지우면(행 삭제) 비워져 다시 만들 수 있다. 표 권한·RLS는 241 그대로(service_role만).

alter table public.editorial_packages
  add column article_id bigint references public.articles (id) on delete set null;

create unique index editorial_packages_article_id_key on public.editorial_packages (article_id) where article_id is not null;

comment on column public.editorial_packages.article_id is '이 결과물로 만든 기사 초안 (편집위원 데스크 → 기사 초안 옮기기)';
