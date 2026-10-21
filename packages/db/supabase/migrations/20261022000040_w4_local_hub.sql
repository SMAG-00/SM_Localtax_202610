-- W4 4단계 — 지자체 허브 골격 (LG-08 순서 · REG1-02 · REG-06, docs/dev/W4_설계.md 1장 4단계 · 2.1 · 2.2 · 2.4 · 2.8 · 3장 · 12장 #8)
-- · local_block_fields (settings) — 블록 ② 지방세·지방재정(local_tax) ③ 부동산·개발(realestate)에 담는 편집 분야.
--     REG1-02 초기값 그대로 씨앗: ② = local_tax·local_finance, ③ = realestate·urban_policy. 화면 코드 상수(LOCAL_BLOCK_TOPICS)에서 옮겼다 —
--     관리자가 운영 설정 화면에서 바꾸면 배포 없이 다음 요청부터(설정 쓰기가 공개 데이터 캐시를 바로 만료한다).
--     블록 순서는 설정이 아니다(LG-08 코드 고정) — 이 값은 '어느 편집 분야가 어느 블록에'만 정한다.
-- · 저장 검사(트리거): 객체 · 칸은 local_tax·realestate 둘 다(모르는 칸 0) · 블록마다 편집 분야(2.1 4값) 1개 이상, 같은 값 두 번 0 ·
--     한 편집 분야는 한 블록에만(같은 기사가 두 블록에 나오지 않게)
-- · 공개 읽기 — anon이 이 키 한 줄만 읽는 정책을 더한다(기존 settings_public_read는 건드리지 않는다 — W2-e company_info와 같은 방식)
-- · 기능 키 weekly_digest(① 금주 핫뉴스)·local_events(④ 행사안내)·redevelopment_status(③ 정비사업 현황 자리)·ordinance_texts(⑤ 조례 원문 자리) — 꺼진 채(2.4).
--     W4 화면은 이 키가 켜져도 ①④·3단계 자리에 그리는 것이 없다(데이터·화면은 W6·3단계)
-- · 지방세 포인트는 W3 hub_tax_points의 local 분야를 그대로 쓴다(새 키 0 — 12장 #31)
-- · 기존 표·칸·제약·값은 바꾸지 않는다 (settings 씨앗 한 줄 · 기능 키 4 · 트리거 · 정책만 더한다)

insert into public.settings (key, value, description, updated_by) values
  ('local_block_fields',
   '{"local_tax": ["local_tax", "local_finance"], "realestate": ["realestate", "urban_policy"]}'::jsonb,
   '지자체 허브 블록과 편집 분야 대응 (REG1-02 · LG-08) — ② 지방세·지방재정(local_tax)·③ 부동산·개발(realestate) 블록마다 담는 편집 분야(local_tax·local_finance·realestate·urban_policy). 블록 순서는 바꾸지 못한다(코드 고정). 한 편집 분야는 한 블록에만',
   'migration:20261022000040')
on conflict (key) do nothing;

-- 없는 키만 false로 더한다 (이미 있는 키의 값은 그대로)
update public.settings s
   set value = s.value || (select jsonb_object_agg(k, false) from unnest(array['weekly_digest', 'local_events', 'redevelopment_status', 'ordinance_texts']) as k where not (s.value ? k)),
       updated_by = 'migration:20261022000040'
 where s.key = 'feature_flags' and jsonb_typeof(s.value) = 'object'
   and exists (select 1 from unnest(array['weekly_digest', 'local_events', 'redevelopment_status', 'ordinance_texts']) as k where not (s.value ? k));

create function public.local_block_fields_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_block text;
  v_fields jsonb;
  v_field jsonb;
  v_seen text[] := '{}';
begin
  if jsonb_typeof(new.value) is distinct from 'object' then
    raise exception '지자체 허브 블록 대응(local_block_fields)은 블록별 객체여야 합니다 — {"local_tax": [...], "realestate": [...]}' using errcode = 'check_violation';
  end if;
  if exists (select 1 from jsonb_object_keys(new.value) k where k not in ('local_tax', 'realestate')) then
    raise exception '지자체 허브 블록 대응의 블록은 local_tax(지방세·지방재정)·realestate(부동산·개발)만 씁니다 — 블록 순서·다른 블록은 설정이 아닙니다 (LG-08)' using errcode = 'check_violation';
  end if;
  foreach v_block in array array['local_tax', 'realestate'] loop
    v_fields := new.value -> v_block;
    if v_fields is null or jsonb_typeof(v_fields) is distinct from 'array' or jsonb_array_length(v_fields) = 0 then
      raise exception '지자체 허브 블록 대응(%)에는 편집 분야가 1개 이상 필요합니다', v_block using errcode = 'check_violation';
    end if;
    for v_field in select x.value from jsonb_array_elements(v_fields) as x loop
      if jsonb_typeof(v_field) is distinct from 'string' or (v_field #>> '{}') not in ('local_tax', 'local_finance', 'realestate', 'urban_policy') then
        raise exception '지자체 허브 블록 대응(%)의 편집 분야는 local_tax·local_finance·realestate·urban_policy 중 하나입니다 (지금 %)', v_block, v_field using errcode = 'check_violation';
      end if;
      if (v_field #>> '{}') = any (v_seen) then
        raise exception '편집 분야 %는 한 블록에 한 번만 씁니다 — 같은 기사가 두 블록에 나오지 않게', v_field #>> '{}' using errcode = 'check_violation';
      end if;
      v_seen := v_seen || (v_field #>> '{}');
    end loop;
  end loop;
  return new;
end;
$$;
revoke all on function public.local_block_fields_guard() from public, anon, authenticated;
create trigger settings_local_block_fields_guard
  before insert or update on public.settings
  for each row when (new.key = 'local_block_fields')
  execute function public.local_block_fields_guard();

-- 공개 읽기 — 이 키 한 줄 (지자체뉴스 허브 /local · 지역 허브 /local/[sido](/[sigungu])가 anon 키로 읽는다)
create policy settings_public_local_block_fields on public.settings
  for select to anon, authenticated
  using (key = 'local_block_fields');
