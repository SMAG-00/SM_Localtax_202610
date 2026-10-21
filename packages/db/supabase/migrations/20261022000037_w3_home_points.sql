-- W3 9단계 — 홈 핵심 메시지 검사 · 허브 "이 분야의 지방세 포인트" (01B CORE-02 · PRD-01A HOME-01, docs/dev/W3_설계.md 1장 9단계 · 2.2 · 2.3 · 2.8 · 12장 #16·#33~#36)
-- · hub_tax_points (settings) — 분야(realestate · finance · local)마다
--     { lines: [1~3줄], base_date: "YYYY-MM-DD", links: [{label, href}] 1~3개, drafted_by, drafted_at, reviewed_by, reviewed_at }.
--   문구·기준일·링크는 편집국이 넣고 세무 감수위원(reviewer)이 서명한다. 이 파일은 문구를 쓰지 않는다 — 씨앗은 빈 객체(블록째 숨김).
-- · 저장 검사(트리거): 0줄·4줄 이상·빈 줄·60자(R8) 넘는 줄·경력 연수 표기('50년' 등) 거부, 기준일 필수(실제 날짜), 링크 1~3개(사이트 안 /tax… · /news/<주소>만),
--   서명은 저장된 초안에만 — 내용(문구·기준일·링크)을 바꾸는 쓰기에 서명이 남아 있으면 거부(서명과 내용 변경을 한 번에 하지 않는다),
--   새 서명의 서명자는 지금 reviewer 역할(staff_roles)이어야 한다.
-- · 공개 뷰 public_hub_tax_points — 서명이 있고 서명자가 지금도 reviewer인 분야만 (서명자·작성자 칸 없음). 감수 전 분야는 행 0 → 블록째 숨김
-- · home_core_message — 글자 한 줄 60자 이하(R8, 화면 검사와 같은 값), 경력 연수 표기는 늘 거부 (12장 #26 — '50년'은 연재 제목에만)
-- · 기존 표·칸·제약·값은 바꾸지 않는다 (settings 씨앗 한 줄 · 트리거 · 뷰만 더한다)

insert into public.settings (key, value, description, updated_by) values
  ('hub_tax_points', '{}'::jsonb,
   '허브 "이 분야의 지방세 포인트" (CORE-02) — 분야(realestate·finance·local)마다 문구 1~3줄·기준일·지방세 해설 링크 1~3개. 편집국 초안 → 세무 감수위원 서명 뒤에만 공개, 서명 전엔 블록째 숨김. /api/admin/hub-points로만 고친다',
   'migration:20261022000037')
on conflict (key) do nothing;

create function public.home_points_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_text text;
  v_section text;
  v_point jsonb;
  v_old jsonb;
  v_item jsonb;
  v_n integer;
  v_uid text;
  v_content_changed boolean;
  v_review_changed boolean;
begin
  if new.key = 'home_core_message' then
    if jsonb_typeof(new.value) is distinct from 'string' then
      raise exception '홈 핵심 메시지(home_core_message)는 글자 한 줄이어야 합니다' using errcode = 'check_violation';
    end if;
    v_text := btrim(new.value #>> '{}');
    if char_length(v_text) > 60 then
      raise exception '홈 핵심 메시지는 60자 이하여야 합니다 (R8 — 지금 %자)', char_length(v_text) using errcode = 'check_violation';
    end if;
    if public.brand_claim_token(v_text) then
      raise exception '홈 핵심 메시지에는 경력 연수 표기(''50년'' 등)를 쓰지 않습니다 — 근거 링크를 붙일 수 있는 연재 제목에만 (12장 #26)' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- hub_tax_points
  if jsonb_typeof(new.value) is distinct from 'object' then
    raise exception '허브 지방세 포인트(hub_tax_points)는 분야별 객체여야 합니다' using errcode = 'check_violation';
  end if;
  for v_section, v_point in select e.key, e.value from jsonb_each(new.value) as e loop
    if v_section not in ('realestate', 'finance', 'local') then
      raise exception '허브 지방세 포인트 분야는 realestate·finance·local만 씁니다 (지방세 허브에는 포인트 블록이 없다 — 지금 %)', v_section using errcode = 'check_violation';
    end if;
    if jsonb_typeof(v_point) is distinct from 'object' then
      raise exception '허브 지방세 포인트(%)는 객체여야 합니다', v_section using errcode = 'check_violation';
    end if;
    if exists (select 1 from jsonb_object_keys(v_point) k where k not in ('lines', 'base_date', 'links', 'drafted_by', 'drafted_at', 'reviewed_by', 'reviewed_at')) then
      raise exception '허브 지방세 포인트(%)에 모르는 칸이 있습니다', v_section using errcode = 'check_violation';
    end if;

    -- 문구 1~3줄 (4줄 저장 거부), 줄마다 1~60자, 경력 연수 표기 0
    if jsonb_typeof(v_point -> 'lines') is distinct from 'array' then
      raise exception '허브 지방세 포인트(%) 문구(lines)는 줄 목록이어야 합니다', v_section using errcode = 'check_violation';
    end if;
    v_n := jsonb_array_length(v_point -> 'lines');
    if v_n < 1 or v_n > 3 then
      raise exception '허브 지방세 포인트(%)는 1~3줄이어야 합니다 — 4줄 이상은 저장하지 않습니다 (지금 %줄)', v_section, v_n using errcode = 'check_violation';
    end if;
    for v_item in select x.value from jsonb_array_elements(v_point -> 'lines') as x loop
      if jsonb_typeof(v_item) is distinct from 'string' or char_length(btrim(v_item #>> '{}')) not between 1 and 60 then
        raise exception '허브 지방세 포인트(%)의 줄은 1~60자 글자여야 합니다 (빈 줄 0)', v_section using errcode = 'check_violation';
      end if;
      if public.brand_claim_token(v_item #>> '{}') then
        raise exception '허브 지방세 포인트(%)에는 경력 연수 표기(''50년'' 등)를 쓰지 않습니다', v_section using errcode = 'check_violation';
      end if;
    end loop;

    -- 기준일 필수 (실제 날짜)
    if jsonb_typeof(v_point -> 'base_date') is distinct from 'string' or (v_point ->> 'base_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception '허브 지방세 포인트(%)에는 기준일(base_date, YYYY-MM-DD)이 필요합니다', v_section using errcode = 'check_violation';
    end if;
    begin
      perform (v_point ->> 'base_date')::date;
    exception when others then
      raise exception '허브 지방세 포인트(%)의 기준일이 날짜가 아닙니다', v_section using errcode = 'check_violation';
    end;

    -- 지방세 해설 링크 1~3개 — 사이트 안 /tax… · /news/<주소>만 (쿼리·조각·바깥 주소 0)
    if jsonb_typeof(v_point -> 'links') is distinct from 'array' or jsonb_array_length(v_point -> 'links') not between 1 and 3 then
      raise exception '허브 지방세 포인트(%)에는 지방세 해설 링크가 1~3개 필요합니다', v_section using errcode = 'check_violation';
    end if;
    for v_item in select x.value from jsonb_array_elements(v_point -> 'links') as x loop
      if jsonb_typeof(v_item) is distinct from 'object'
         or exists (select 1 from jsonb_object_keys(v_item) k where k not in ('label', 'href'))
         or char_length(btrim(coalesce(v_item ->> 'label', ''))) not between 1 and 40
         or coalesce(v_item ->> 'href', '') !~ '^/(tax(/[^[:space:]/?#]+)*|news/[^[:space:]/?#]+)$' then
        raise exception '허브 지방세 포인트(%)의 링크는 이름(1~40자)과 사이트 안 지방세 해설 주소(/tax… · /news/…)여야 합니다', v_section using errcode = 'check_violation';
      end if;
    end loop;

    if char_length(btrim(coalesce(v_point ->> 'drafted_by', ''))) = 0 then
      raise exception '허브 지방세 포인트(%)에는 초안 작성자(drafted_by)가 필요합니다', v_section using errcode = 'check_violation';
    end if;

    -- 세무 감수 서명 — 서명자·시각은 함께, 저장된 초안에만, 새 서명의 서명자는 지금 reviewer
    if (v_point ->> 'reviewed_by' is null) <> (v_point ->> 'reviewed_at' is null) then
      raise exception '허브 지방세 포인트(%)의 감수 서명자와 시각은 함께 있어야 합니다', v_section using errcode = 'check_violation';
    end if;
    if v_point ->> 'reviewed_by' is not null then
      begin
        perform (v_point ->> 'reviewed_at')::timestamptz;
      exception when others then
        raise exception '허브 지방세 포인트(%)의 감수 시각이 시각이 아닙니다', v_section using errcode = 'check_violation';
      end;
      v_old := case when tg_op = 'UPDATE' and jsonb_typeof(old.value) = 'object' then old.value -> v_section end;
      v_content_changed := v_old is null
        or (v_old -> 'lines') is distinct from (v_point -> 'lines')
        or (v_old -> 'base_date') is distinct from (v_point -> 'base_date')
        or (v_old -> 'links') is distinct from (v_point -> 'links');
      if v_content_changed then
        raise exception '허브 지방세 포인트(%) — 감수 서명은 저장된 초안에만 합니다. 문구·기준일·링크를 바꾸면 서명을 지우고 다시 받아야 합니다', v_section
          using errcode = 'check_violation';
      end if;
      v_review_changed := (v_old -> 'reviewed_by') is distinct from (v_point -> 'reviewed_by') or (v_old -> 'reviewed_at') is distinct from (v_point -> 'reviewed_at');
      if v_review_changed then
        v_uid := substring(v_point ->> 'reviewed_by' from '^user:([0-9a-fA-F-]{36})$');
        if v_uid is null or not exists (select 1 from public.staff_roles r where r.user_id::text = lower(v_uid) and r.role = 'reviewer') then
          raise exception '허브 지방세 포인트(%)의 감수 서명은 세무 감수위원(reviewer)만 합니다', v_section using errcode = 'check_violation';
        end if;
      end if;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.home_points_settings_guard() from public, anon, authenticated;
create trigger settings_home_points_guard
  before insert or update on public.settings
  for each row when (new.key in ('home_core_message', 'hub_tax_points'))
  execute function public.home_points_settings_guard();

-- ─────────────────────────────────────────────────────────────
-- 공개 뷰 (anon) — 감수 서명이 있고 서명자가 지금도 세무 감수위원인 분야만. 작성자·서명자 칸은 내지 않는다
-- ─────────────────────────────────────────────────────────────
create view public.public_hub_tax_points as
select p.key as section,
       array(select t.line from jsonb_array_elements_text(p.value -> 'lines') with ordinality as t(line, n) order by t.n) as lines,
       (p.value ->> 'base_date')::date as base_date,
       p.value -> 'links' as links,
       (p.value ->> 'reviewed_at')::timestamptz as reviewed_at
  from public.settings s
  cross join lateral jsonb_each(case when jsonb_typeof(s.value) = 'object' then s.value else '{}'::jsonb end) as p(key, value)
 where s.key = 'hub_tax_points'
   and p.key in ('realestate', 'finance', 'local')
   and p.value ->> 'reviewed_by' is not null
   and exists (select 1 from public.staff_roles r where r.role = 'reviewer' and 'user:' || r.user_id::text = lower(p.value ->> 'reviewed_by'));
comment on view public.public_hub_tax_points is '허브 "이 분야의 지방세 포인트" 공개 (CORE-02) — 세무 감수 서명이 살아 있는 분야만. 서명 전엔 행 0';
revoke all on table public.public_hub_tax_points from public, anon, authenticated, service_role;
grant select on table public.public_hub_tax_points to anon, authenticated, service_role;
