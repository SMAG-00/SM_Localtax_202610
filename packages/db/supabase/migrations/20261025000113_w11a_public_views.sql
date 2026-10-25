-- W11-a a4 - 공개 뷰 (PRD-03 5장 '감수 서명 전에는 공개하지 않는다', docs/dev/W11-a_설계.md 4장)
-- · 공개 읽기는 칸을 지정한 뷰만. 표 자체는 anon·authenticated 권한이 없다 (RLS 기본 거부).
-- · public_guides: 감수 서명 뒤 관리자가 공개한 버전(published)만. 서명 전(draft·reviewed)·내려간(retired) 버전은 0행.
-- · public_determination_tables: 활성(active = 서명 + 관리자 승인) 판정표만. 판정은 브라우저가 하므로 렌더 때 표를 함께 내려보낸다.
-- · public_requirement_dictionary: 활성 요건 사전만. 같은 사전을 UI(질문)와 판정표가 읽는다.
-- · 서명자 계정·감수 시트 위치·내부 사유는 뷰에 싣지 않는다. 감수일(last_reviewed_at)은 서명 시각에서 낸다 (국세/지방세 배지·최종 감수일 렌더).

create view public.public_guides as
  select g.hub, g.topic, g.slug, v.version, v.title, v.sections, v.facts, v.tax_scope, v.as_of, v.region_codes, v.sources,
         v.body_sha256, v.signed_at as last_reviewed_at, v.published_at
    from public.guides g
    join public.guide_versions v on v.guide_id = g.id
   where v.status = 'published';
revoke all on table public.public_guides from public, anon, authenticated;
grant select on table public.public_guides to anon, authenticated, service_role;

create view public.public_determination_tables as
  select kind, version, body, activated_at
    from public.determination_tables
   where status = 'active';
revoke all on table public.public_determination_tables from public, anon, authenticated;
grant select on table public.public_determination_tables to anon, authenticated, service_role;

create view public.public_requirement_dictionary as
  select topic, version, body, activated_at
    from public.requirement_dictionary
   where status = 'active';
revoke all on table public.public_requirement_dictionary from public, anon, authenticated;
grant select on table public.public_requirement_dictionary to anon, authenticated, service_role;
