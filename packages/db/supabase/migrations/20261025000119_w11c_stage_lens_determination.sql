-- W11-c c8 - 단계 카드의 판정 진입 칸 (PRD-03 PR-12 '진입: 1단계 프로젝트 트래커 단계(PR-02·05 단계별 「지방세로 읽기」)', docs/dev/W11-c_설계.md 2장 #5)
-- · project_stage_lenses에 determination_kind(비어 있어도 됨)를 더한다. 값이 있어야 그 단계 카드에 '세금 판정' 진입 버튼이 생기고, 없으면 버튼도 '준비 중'도 없다.
-- · 값은 판정표 종류 이름만(정비·신탁 PR-12 4개). 판정 입력·결과를 담는 칸은 없다.
-- · 서명된(reviewed) 카드의 진입 종류를 고치면 서명을 지운다(재감수 필요) - 카드 내용을 고칠 때와 같은 규칙.

alter table public.project_stage_lenses
  add column determination_kind text
  check (determination_kind is null or determination_kind in ('redevelopment_right', 'redevelopment_tax', 'trust_acquisition', 'trust_taxpayer'));
comment on column public.project_stage_lenses.determination_kind is '이 단계에서 열 수 있는 세금 판정 종류 (PR-12) - 판정표 종류 이름. 비어 있으면 진입 버튼 0';

create function public.project_stage_lenses_kind_resign() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.determination_kind is distinct from old.determination_kind and old.review_status = 'reviewed' then
    new.review_status := 'rereview_needed';
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.project_stage_lenses_kind_resign() from public, anon, authenticated;
create trigger project_stage_lenses_kind_resign before update on public.project_stage_lenses
  for each row execute function public.project_stage_lenses_kind_resign();
