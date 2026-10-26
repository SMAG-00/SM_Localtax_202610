-- W11-e e3 - 프로젝트 시행자 칸 (PRD-03 RDV-07 구역 목록의 '시행자') - 선택 칸, 이름만. 가격·분담금·수익률 칸이 아니다 (PR-05)
alter table public.projects add column operator_name text check (operator_name is null or length(btrim(operator_name)) > 0);
comment on column public.projects.operator_name is '정비사업 시행자 이름 (RDV-07 구역 목록) - 공개 단계 기록의 고시 기관과 별개, 선택';
