-- W11-b b5/b6 - 설정 `total_cost_policy` 모양 검사 (docs/dev/W11-b_설계.md 3장, 3단계 설계 3장 b행)
-- · 값 자체(보유 연수 상한·금리 입력 상한·부대비용 항목 수·비교 연수)는 PO 입력이라 이 파일에 없다. 씨앗 {}는 그대로 두고, 비어 있으면 총비용 시뮬레이터는 열리지 않는다.
-- · 비어 있지 않은 값은 칸 4개(max_holding_years·max_rate_bp·max_extra_items·compare_years)만, 모두 0 이상 정수(compare_years는 정수 2개, 보유 연수 상한 이하)여야 저장된다.
--   앱(apps/web/lib/realestate/total-cost.ts parseTotalCostPolicy)이 같은 모양만 읽는다.
-- · 다른 설정 키에는 영향이 없다.

create or replace function public.settings_total_cost_policy_check()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  k text;
  cy jsonb;
begin
  if new.key <> 'total_cost_policy' then
    return new;
  end if;
  if jsonb_typeof(new.value) <> 'object' then
    raise exception 'total_cost_policy는 객체여야 합니다' using errcode = '23514';
  end if;
  if new.value = '{}'::jsonb then
    return new;
  end if;
  for k in select jsonb_object_keys(new.value) loop
    if k not in ('max_holding_years', 'max_rate_bp', 'max_extra_items', 'compare_years') then
      raise exception 'total_cost_policy에 허용되지 않는 칸: %', k using errcode = '23514';
    end if;
  end loop;
  foreach k in array array['max_holding_years', 'max_rate_bp', 'max_extra_items'] loop
    if not (new.value ? k) or jsonb_typeof(new.value -> k) <> 'number' or (new.value ->> k) !~ '^[0-9]+$' then
      raise exception 'total_cost_policy.% 는 0 이상 정수여야 합니다', k using errcode = '23514';
    end if;
  end loop;
  cy := new.value -> 'compare_years';
  if cy is null or jsonb_typeof(cy) <> 'array' or jsonb_array_length(cy) <> 2
     or (cy ->> 0) !~ '^[0-9]+$' or (cy ->> 1) !~ '^[0-9]+$' then
    raise exception 'total_cost_policy.compare_years는 0 이상 정수 2개여야 합니다' using errcode = '23514';
  end if;
  if (cy ->> 0)::numeric > (new.value ->> 'max_holding_years')::numeric or (cy ->> 1)::numeric > (new.value ->> 'max_holding_years')::numeric then
    raise exception 'compare_years는 max_holding_years 이하여야 합니다' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.settings_total_cost_policy_check() from public, anon, authenticated;

drop trigger if exists settings_total_cost_policy_check on public.settings;
create trigger settings_total_cost_policy_check
  before insert or update of value on public.settings
  for each row execute function public.settings_total_cost_policy_check();

comment on function public.settings_total_cost_policy_check() is 'W11-b: settings.total_cost_policy 모양 검사 (값은 PO 입력, 비어 있으면 총비용 시뮬레이터 닫힘)';
