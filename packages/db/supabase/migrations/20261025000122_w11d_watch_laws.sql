-- W11-d d1 - 감시 법령 확대 씨앗 (PRD-03 AIOPS-11, docs/dev/W11-d_설계.md 2장)
-- 이 파일에 법령 문장·조문·세율·기한 값은 없다 - 감시 대상 법령의 이름과 단계(법·시행령·시행규칙)만 넣는다. 조문 내용은 W10-c 수집기가 가져와 스냅샷과 함께 채운다.
--
-- · laws.scope 값 'related'(쟁점 지도·신탁·정비 관련 법령)를 더한다. 기존 값(local·linked_national)과 15행 씨앗은 건드리지 않는다.
--   (laws 표를 고치는 순서는 d(122) -> e(127) -> g(138). 뒤 단위가 scope 제약을 다시 만들 때 'related'를 그대로 포함해야 한다.)
-- · 씨앗 19행 - PRD AIOPS-11 목록(도시정비법·소규모주택정비법·재건축초과이익환수법·신탁법·자본시장법·부동산투자회사법·소득세법)과 하위 법령 이름.
--   [감수 필요] 목록과 하위 법령(시행령·시행규칙) 존재 여부는 PO·감수위원이 확정한다. 이름이 실제와 다르면 수집기가 '찾지 못함'으로 기록할 뿐 공개 자료는 바뀌지 않는다.
--   법제처 법령 ID(law_key)는 비워 두고 첫 검색 때 채운다.
-- · 상속세 및 증여세법은 이 목록에 넣지 않는다 - FAM-13(scope national_igt, W11-g)이 맡는다. laws_name_not_excluded 제약이 그대로 막는다.

alter table public.laws drop constraint laws_scope_check;
alter table public.laws add constraint laws_scope_check check (scope in ('local', 'linked_national', 'related'));

comment on column public.laws.scope is 'local = 지방세 법령, linked_national = 계산기 연관 국세 법령(감시만 - 계산 아님), related = 신탁·정비 쟁점 지도 관련 법령(AIOPS-11 - 감시·원문 연결만)';

insert into public.laws (name, tier, scope) values
  ('도시 및 주거환경정비법', 'statute', 'related'), ('도시 및 주거환경정비법 시행령', 'decree', 'related'), ('도시 및 주거환경정비법 시행규칙', 'rule', 'related'),
  ('빈집 및 소규모주택 정비에 관한 특례법', 'statute', 'related'), ('빈집 및 소규모주택 정비에 관한 특례법 시행령', 'decree', 'related'), ('빈집 및 소규모주택 정비에 관한 특례법 시행규칙', 'rule', 'related'),
  ('재건축초과이익 환수에 관한 법률', 'statute', 'related'), ('재건축초과이익 환수에 관한 법률 시행령', 'decree', 'related'), ('재건축초과이익 환수에 관한 법률 시행규칙', 'rule', 'related'),
  ('신탁법', 'statute', 'related'), ('신탁법 시행령', 'decree', 'related'),
  ('자본시장과 금융투자업에 관한 법률', 'statute', 'related'), ('자본시장과 금융투자업에 관한 법률 시행령', 'decree', 'related'),
  ('부동산투자회사법', 'statute', 'related'), ('부동산투자회사법 시행령', 'decree', 'related'), ('부동산투자회사법 시행규칙', 'rule', 'related'),
  ('소득세법', 'statute', 'related'), ('소득세법 시행령', 'decree', 'related'), ('소득세법 시행규칙', 'rule', 'related')
on conflict (name) do nothing;
