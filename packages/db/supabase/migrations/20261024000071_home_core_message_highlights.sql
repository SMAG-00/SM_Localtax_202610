-- 홈 핵심 메시지 문구 교체 + 강조 낱말 설정 (PO 결정 2026-10-24 — PRD-00 8.4 · 8.10 · HOME-01 · CORE-02)
-- · home_core_message — 옛 씨앗 값 그대로일 때만 새 문구로 바꾼다. PO가 이미 고쳐 둔 값은 건드리지 않는다
--     새 문구: 취득·보유·상속·증여·양도 등 모든 순간 — 지방세와 부동산 세금을 알면 재테크가 보입니다
-- · home_core_highlights — 핵심 메시지 안에서 오렌지(hermes-400)로 칠할 낱말 글자 목록. 씨앗 ["지방세","부동산 세금","재테크"]
--     (핵심 메시지에 있는 낱말만 넣는다 — PO가 메시지를 이미 고쳤다면 그 메시지에 남아 있는 낱말만)
--     저장 검사(트리거): 글자 목록 · 1~5개 · 낱말마다 비지 않고 30자 이하 · 서로 다름 · 지금 핵심 메시지 안에 있는 글자
--     공개 읽기 — anon이 이 키 한 줄만 읽는 정책. 기존 settings_public_read는 그대로
-- · 기존 표·칸·제약은 바꾸지 않는다 (settings 값 한 줄 갱신 · 씨앗 한 줄 · 트리거 · 정책만 더한다)

update public.settings
   set value = to_jsonb('취득·보유·상속·증여·양도 등 모든 순간 — 지방세와 부동산 세금을 알면 재테크가 보입니다'::text),
       updated_by = 'migration:20261024000071'
 where key = 'home_core_message'
   and value = to_jsonb('부동산과 지자체의 변화를 읽고 대응하려면 지방세 이해가 필수다'::text);

-- 씨앗은 트리거를 만들기 전에 넣는다 — PO가 메시지를 고쳐 둔 경우에도 이 줄이 막히지 않게 메시지에 남아 있는 낱말만 고른다
insert into public.settings (key, value, description, updated_by)
select 'home_core_highlights',
       coalesce(jsonb_agg(f.w order by f.n), '[]'::jsonb),
       '홈 핵심 메시지 강조 낱말 (HOME-01 · CORE-02) — 핵심 메시지 안의 낱말 1~5개, 나온 곳마다 오렌지로 칠한다. 핵심 메시지를 먼저 바꾼 뒤 이 값을 맞춘다',
       'migration:20261024000071'
  from (
    select t.w, t.n
      from jsonb_array_elements_text('["지방세", "부동산 세금", "재테크"]'::jsonb) with ordinality as t(w, n)
     where position(t.w in coalesce((select s.value #>> '{}' from public.settings s where s.key = 'home_core_message'), '')) > 0
  ) f
on conflict (key) do nothing;

create function public.core_highlights_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg text;
  v_n integer;
  v_word text;
  v_seen text[] := '{}';
  i integer;
begin
  if jsonb_typeof(new.value) is distinct from 'array' then
    raise exception '홈 핵심 메시지 강조 낱말(home_core_highlights)은 글자 목록이어야 합니다' using errcode = 'check_violation';
  end if;
  v_n := jsonb_array_length(new.value);
  if v_n < 1 or v_n > 5 then
    raise exception '홈 핵심 메시지 강조 낱말은 1~5개여야 합니다 (지금 %개)', v_n using errcode = 'check_violation';
  end if;
  select btrim(s.value #>> '{}') into v_msg from public.settings s where s.key = 'home_core_message';
  for i in 0 .. v_n - 1 loop
    if jsonb_typeof(new.value -> i) is distinct from 'string' then
      raise exception '홈 핵심 메시지 강조 낱말은 글자여야 합니다 (% 번째)', i + 1 using errcode = 'check_violation';
    end if;
    v_word := btrim(new.value ->> i);
    if v_word = '' then
      raise exception '홈 핵심 메시지 강조 낱말은 비어 있을 수 없습니다 (% 번째)', i + 1 using errcode = 'check_violation';
    end if;
    if char_length(v_word) > 30 then
      raise exception '홈 핵심 메시지 강조 낱말은 30자 이하여야 합니다 (% 번째 — 지금 %자)', i + 1, char_length(v_word) using errcode = 'check_violation';
    end if;
    if v_word = any (v_seen) then
      raise exception '홈 핵심 메시지 강조 낱말에 같은 낱말이 두 번 있습니다 (%)', v_word using errcode = 'check_violation';
    end if;
    v_seen := v_seen || v_word;
    if v_msg is null or position(v_word in v_msg) = 0 then
      raise exception '홈 핵심 메시지 안에 없는 낱말입니다 (%) — 메시지에 있는 글자 그대로 적으세요', v_word using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.core_highlights_guard() from public, anon, authenticated;
create trigger settings_core_highlights_guard
  before insert or update on public.settings
  for each row when (new.key = 'home_core_highlights')
  execute function public.core_highlights_guard();

create policy settings_public_core_highlights on public.settings
  for select to anon, authenticated
  using (key = 'home_core_highlights');
