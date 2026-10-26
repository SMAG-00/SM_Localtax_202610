-- W11-c c6/c8 - 단계별 「지방세로 읽기」 공개 뷰에 판정 진입 종류를 더한다 (119의 determination_kind, docs/dev/W11-c_설계.md 5장)
-- · W4 50번 뷰 정의를 그대로 두고 마지막 칸 하나만 더한다 (create or replace view는 칸을 끝에 더하는 것만 허용). 서명 전·재감수 필요는 여전히 0행.
-- · 값은 판정표 종류 이름뿐이며, 화면은 이 값이 있고 해당 판정표가 활성일 때만 진입 버튼을 그린다.

create or replace view public.public_project_stage_lenses as
select
  l.project_type,
  l.stage,
  sl.stage_position,
  array(select t.v from jsonb_array_elements_text(l.lens -> 'topics') with ordinality as t(v, n) order by t.n) as topics,
  array(select t.v from jsonb_array_elements_text(l.lens -> 'points') with ordinality as t(v, n) order by t.n) as points,
  l.lens -> 'links' as links,
  (l.lens ->> 'base_date')::date as base_date,
  l.reviewed_at,
  (select pe.name from public.people pe
    where pe.visibility = 'public' and pe.staff_user_id is not null
      and 'user:' || pe.staff_user_id::text = lower(l.reviewed_by)
    order by pe.id limit 1) as reviewer_name,
  l.determination_kind
from public.project_stage_lenses l
join public.public_project_stage_lists sl on sl.project_type = l.project_type and sl.stage = l.stage
where l.review_status = 'reviewed'
  and l.reviewed_by is not null
  and exists (select 1 from public.staff_roles r where r.role = 'reviewer' and 'user:' || r.user_id::text = lower(l.reviewed_by));
