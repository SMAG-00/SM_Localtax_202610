-- W12-c c4 - 색인 원천의 범위 태그 현황 (docs/dev/W12-c_설계.md 2장 c4)
-- 범위 태그 규칙 자체(신탁·정비 가이드·지도 = trust_redevelopment, 상속·증여 한쪽만 나오는 해석 = inheritance/gift)는 chunk_sources(153)에 이미 있다.
-- c4가 더한 것은 그 규칙의 현황을 한눈에 보는 내부 뷰와, 아래 두 가지를 색인하지 않는다는 결정의 시험 근거다.
--   · 상속·증여 허브(inheritance_gift) 쟁점 지도와 상속세 및 증여세법(national_igt) 조문: 한 문서에 두 범위가 섞여 한 태그로 나눌 수 없다 -> 색인 제외 (PO·감수가 조문·절 단위 태그 표를 줄 때까지)
--   · related 법령: 어떤 조문을 지방세봇 근거로 허용할지 정책 결정(PO·감수) 전까지 제외
-- 이 뷰는 service_role 전용이다.

create view public.chunk_scope_counts as
  select source_type, scope, count(*)::integer as source_count
    from public.chunk_sources
   group by source_type, scope;
comment on view public.chunk_scope_counts is '색인 원천의 (원천 종류, 범위 태그)별 건수 (W12-c) - 내부용';
revoke all on table public.chunk_scope_counts from public, anon, authenticated, service_role;
grant select on table public.chunk_scope_counts to service_role;
