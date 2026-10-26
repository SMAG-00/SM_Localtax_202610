-- W11-g g5 (3/3) + g8 - 감시 법령 scope national_igt · 상속세 및 증여세법 이름 3행 · 미반영 개정 3건의 첫 검수 항목 (PRD-03 FAM-13, docs/dev/W11-g_설계.md)
-- · laws 표를 고치는 순서는 d(122) -> e(127) -> g(138). 이 파일은 scope 제약에 값 하나를 더하기만 하고(기존 값 보존), 이름 제약은 national_igt 범위에서만 상속세·증여세 이름을 허용한다.
--   그 밖의 scope 에서 상속세·증여세 이름을 넣는 것은 그대로 거부된다. national_igt 이름은 '상속세 및 증여세법'으로 시작해야 한다.
-- · 수집은 기존 W10-c 파이프라인이 한다 - 이 파일은 이름만 등록한다. 원천 이용 조건이 unchecked 이면 요청 0 (data_sources 관문). AI 호출 0.
-- · 안심 상속증여계산기가 2026-10-08 에 감지한 미반영 개정 3건을 검수 항목(law_change)으로 등록한다. 제목과 출처 표시만 담고 법령 본문은 담지 않는다.

do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint where conrelid = 'public.laws'::regclass and conname = 'laws_scope_check';
  if v_def is null then
    raise exception 'laws_scope_check 제약이 없습니다';
  end if;
  if v_def not like '%national_igt%' then
    execute 'alter table public.laws drop constraint laws_scope_check';
    execute format('alter table public.laws add constraint laws_scope_check %s', replace(v_def, '''local''::text', '''local''::text, ''national_igt''::text'));
  end if;
end;
$$;

alter table public.laws drop constraint laws_name_not_excluded;
alter table public.laws add constraint laws_name_not_excluded check (scope = 'national_igt' or name !~ '(상속세|증여세)');
alter table public.laws add constraint laws_igt_name check (scope <> 'national_igt' or name ~ '^상속세 및 증여세법');
comment on column public.laws.scope is 'local = 지방세 법령, linked_national = 계산기 연관 국세 법령(감시만 - 계산 아님), related = 신탁·정비 쟁점 지도 관련 법령, national_igt = 상속세 및 증여세법과 하위 법령(FAM-13 - 감시·수집만, 룰셋 자동 반영 0)';

insert into public.laws (name, tier, scope) values
  ('상속세 및 증여세법', 'statute', 'national_igt'),
  ('상속세 및 증여세법 시행령', 'decree', 'national_igt'),
  ('상속세 및 증여세법 시행규칙', 'rule', 'national_igt');

insert into public.review_items (kind, source_key, title, payload, created_by) values
  ('law_change', 'igt-unreflected-20261008-1', '상속세 및 증여세법 시행령 - 안심 상속증여계산기가 감지한 미반영 개정(2026-10-08)',
   '{"origin":"안심 상속증여계산기 changes/20261008","scope":"national_igt","reflected":false,"action":"이식 룰셋 감수 전에 개정 내용을 확인하고 룰셋 반영 여부를 결정"}'::jsonb, 'migration:w11g'),
  ('law_change', 'igt-unreflected-20261008-2', '조세특례제한법 - 안심 상속증여계산기가 감지한 미반영 개정(2026-10-08)',
   '{"origin":"안심 상속증여계산기 changes/20261008","scope":"national_igt","reflected":false,"action":"가업승계·창업자금 특례는 룰셋 범위 밖이나 감시 대상 - 영향 여부만 확인"}'::jsonb, 'migration:w11g'),
  ('law_change', 'igt-unreflected-20261008-3', '조세특례제한법 시행령 - 안심 상속증여계산기가 감지한 미반영 개정(2026-10-08)',
   '{"origin":"안심 상속증여계산기 changes/20261008","scope":"national_igt","reflected":false,"action":"가업승계·창업자금 특례는 룰셋 범위 밖이나 감시 대상 - 영향 여부만 확인"}'::jsonb, 'migration:w11g');
