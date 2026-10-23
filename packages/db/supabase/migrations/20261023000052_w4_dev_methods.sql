-- W4 18단계 — 개발방법 DB·관리 (PRD-01B PR-09 · PR-10 · PR-11, docs/dev/W4_설계.md 1장 18단계 · 2.1 · 2.4 · 2.11 · 2.13 · 3장 · 6장 · 7장 4 · 12장 #15·#16·#20·#151~)
-- 이 파일에 실제 개발방법 내용(근거 법령·사업 주체·대상·절차·숫자 요건 값·지방세 쟁점)은 없다 — 편집국이 공식 원문을 보고 쓰고 세무 감수위원(PO)이 서명한다(12장 #15 · 7장 4).
-- 씨앗은 PRD-01B 3.2 화면 초안에 적힌 방법 이름 7개와 slug·종류·고정 편집 순서만(2.1 · 12장 #16). 내용 칸은 모두 비어 있다 → 공개 0.
-- · dev_methods — 정확히 7행(더하기·지우기·slug·이름·종류·순서 바꾸기 거부). 신속통합기획만 planning_support(계획 지원 절차 — 사업 유형 개수에 들지 않음).
--     내용 = 근거 법령 이름 · 한 줄 설명 · 절차 단계(steps) · 「지방세로 읽기」 박스(lens — 16단계 단계 템플릿과 같은 모양·한도). 내용을 고치면 서명을 지운다(재감수 필요).
--     서명(세무 감수위원 — staff_roles reviewer)은 저장된 내용에만, 한 줄 설명·절차 단계가 있어야 한다.
-- · dev_method_compare — 방법 × 비교 항목 6칸(2.1 순서 고정). 칸마다 글(1~300자)·초안·서명. 고치면 서명을 지운다. '확인 중' 같은 자리 채움 글은 저장 거부.
-- · dev_method_facts — 숫자 요건 사실 행(값·단위·근거 조문·기준일·원문 주소·원본 스냅샷). 고치기 = 새 버전 행 + 사유(옛 행 그대로 — 덮어쓰기·지우기 0).
--     서명은 최신 판에만, 기준일이 있어야 한다. 원문 다시 받기(6단계 source_snapshot_refetched)가 같은 주소의 최신 판을 비교해 해시가 다르면 검수 큐 1건(dev_method_fact).
-- · 금지 표현 사전(forbidden_phrases) 새 판 — 2.11 추천·유리 단정 표현을 더한다(이미 있는 낱말·편집국이 넣은 낱말은 그대로). 세 표의 글 칸은 같은 사전으로 저장 거부.
-- · 기능 키 dev_methods(2.4 — 꺼진 채). 켜기는 7개 방법이 모두 '공개 준비'(방법 서명 + 비교 항목 6칸 서명, 서명자가 지금도 reviewer)일 때만(settings 저장 검사).
-- · 공개 뷰(anon) public_dev_methods · public_dev_method_compare · public_dev_method_facts — 기능 키 켜짐 + 공개 준비된 방법만.
--     사실 행은 최신 판 + 서명 + 기준일 + 서명자 공개 이름이 있을 때만(하나라도 없으면 그 행 0 — 옛 판으로 대신하지 않는다). 작성자·서명자 계정·스냅샷 번호·사유 칸 0.
-- · 점수·순위·추천 칸 0 (PR-11 — 시험 tests/w4-dev-methods.test.mjs가 2.13 사전으로 칸 이름·칸 설명을 본다). 기존 표 칸·제약·값은 바꾸지 않는다
--   (검수 큐의 대상 검사·다시 받기 함수만 같은 이름으로 바꿔 적는다 — 12단계 …47과 같은 방식).

-- ─────────────────────────────────────────────────────────────
-- 금지 표현 사전 새 판 — 2.11 낱말 6개를 없을 때만 뒤에 더한다 (12장 #20 — 편집국이 늘린다)
-- ─────────────────────────────────────────────────────────────
update public.settings s
   set value = (s.value - 'version' - 'phrases')
            || jsonb_build_object(
                 'version', '2026-10-23.1',
                 'phrases', (s.value -> 'phrases') || coalesce((
                    select jsonb_agg(x.p order by x.n)
                      from unnest(array['방식이 유리', '방식을 추천', '추천 방식', '가장 좋은 방식', '이 구역에 맞는 방식', '유리합니다']) with ordinality as x(p, n)
                     where not ((s.value -> 'phrases') ? x.p)), '[]'::jsonb)),
       updated_by = 'migration:20261023000052'
 where s.key = 'forbidden_phrases' and jsonb_typeof(s.value -> 'phrases') = 'array';

-- ─────────────────────────────────────────────────────────────
-- 기능 키 dev_methods — 없을 때만 false로 더한다 (이미 있는 값은 그대로)
-- ─────────────────────────────────────────────────────────────
update public.settings s
   set value = s.value || jsonb_build_object('dev_methods', false),
       updated_by = 'migration:20261023000052'
 where s.key = 'feature_flags' and jsonb_typeof(s.value) = 'object' and not (s.value ? 'dev_methods');

-- ─────────────────────────────────────────────────────────────
-- 글 검사 도우미 — 금지 표현(사전) · 자리 채움 글 · 숫자 요건 표현(경고) · 지금 세무 감수위원
-- ─────────────────────────────────────────────────────────────
-- 금지 표현 사전의 낱말 가운데 글에 든 첫 낱말 (NFC·공백 정리 — 16단계 단계 템플릿 검사와 같은 방식). 없으면 null
create function public.dev_method_forbidden_hit(p_texts text[]) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_phrase text;
  v_text text;
begin
  for v_phrase in
    select btrim(regexp_replace(normalize(p, NFC), '[[:space:]]+', ' ', 'g'))
      from jsonb_array_elements_text(coalesce((select s.value -> 'phrases' from public.settings s where s.key = 'forbidden_phrases' and jsonb_typeof(s.value -> 'phrases') = 'array'), '[]'::jsonb)) p
     where btrim(p) <> ''
  loop
    foreach v_text in array coalesce(p_texts, '{}') loop
      if v_text is not null and position(v_phrase in btrim(regexp_replace(normalize(v_text, NFC), '[[:space:]]+', ' ', 'g'))) > 0 then
        return v_phrase;
      end if;
    end loop;
  end loop;
  return null;
end;
$$;
revoke all on function public.dev_method_forbidden_hit(text[]) from public, anon, authenticated;
grant execute on function public.dev_method_forbidden_hit(text[]) to service_role;

-- 자리 채움 글 — 빈 칸을 '확인 중'·'준비 중' 같은 글로 채우지 않는다(PR-09 '필수 비교 항목이 빈 방법은 공개 0'). 공백·문장부호를 뺀 글이 목록과 같으면 true.
-- 웹 규칙(apps/web/lib/admin/dev-method-rules.ts PLACEHOLDER_WORDS)과 같은 목록 — 시험이 같은 견본으로 둘을 본다
create function public.dev_method_placeholder(p_text text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(normalize(coalesce(p_text, ''), NFC), '[[:space:][:punct:]·…‐‑–—―]+', '', 'g'))
         in ('', '확인중', '준비중', '검토중', '미정', '추후', '추후확인', '추후입력', '입력예정', '작성중', 'tbd', 'tba', 'todo', 'na');
$$;
revoke all on function public.dev_method_placeholder(text) from public, anon, authenticated;
grant execute on function public.dev_method_placeholder(text) to service_role;

-- 숫자 요건 표현 — 숫자 + 요건 단위(%·㎡·평·개월·세대·분의·일 이내·년 이내/이상…). 저장 경고(차단 아님) — 숫자 요건 값은 사실 행(dev_method_facts)에 적는다(PR-10).
-- 연도만 있는 날짜('2026년')는 잡지 않는다. 웹 규칙 REQUIREMENT_NUMBER_RE와 같은 식
create function public.dev_method_text_has_requirement(p_text text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_text, '') ~ '[0-9][0-9,.]*[[:space:]]*(%|％|퍼센트|㎡|제곱미터|평(?![가균일등])|개월|세대|분의|일[[:space:]]*이내|년[[:space:]]*(이내|이상|이하|미만|초과))';
$$;
revoke all on function public.dev_method_text_has_requirement(text) from public, anon, authenticated;
grant execute on function public.dev_method_text_has_requirement(text) to service_role;

-- 서명자 — user:<uuid>가 지금 세무 감수위원(staff_roles reviewer)인가
create function public.dev_method_is_reviewer(p_actor text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_actor, '') ~ '^user:[0-9a-fA-F-]{36}$'
     and exists (select 1 from public.staff_roles r where r.role = 'reviewer' and 'user:' || r.user_id::text = lower(p_actor));
$$;
revoke all on function public.dev_method_is_reviewer(text) from public, anon, authenticated;
grant execute on function public.dev_method_is_reviewer(text) to service_role;

-- 「지방세로 읽기」 박스 모양 — 16단계 단계 템플릿(project_stage_lenses_guard)과 같은 칸·한도. 맞으면 null, 틀리면 문장.
-- { topics: 1~5개(1~20자·중복 0), points: 1~3줄(1~120자), links: 1~3개 { kind explainer·book·expert 한 번씩, label 1~40자, url 사이트 안 주소 300자 }, base_date: YYYY-MM-DD }
-- 세액 표현(숫자 + 원 — lens_text_has_tax_amount)도 거부한다
create function public.dev_method_lens_problem(p_lens jsonb) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_seen text[] := '{}';
  v_kinds text[] := '{}';
  v_n integer;
begin
  if jsonb_typeof(p_lens) is distinct from 'object'
     or (select array_agg(k order by k) from jsonb_object_keys(p_lens) k) is distinct from array['base_date', 'links', 'points', 'topics'] then
    return '「지방세로 읽기」는 { topics, points, links, base_date } 네 칸입니다';
  end if;
  if jsonb_typeof(p_lens -> 'topics') is distinct from 'array' or jsonb_array_length(p_lens -> 'topics') not between 1 and 5 then
    return '「지방세로 읽기」 — 관련 세목은 1~5개입니다';
  end if;
  for v_item in select x.value from jsonb_array_elements(p_lens -> 'topics') x loop
    if jsonb_typeof(v_item) is distinct from 'string' or char_length(btrim(v_item #>> '{}')) not between 1 and 20 then
      return '「지방세로 읽기」 — 관련 세목은 1~20자 글자입니다';
    end if;
    if btrim(v_item #>> '{}') = any (v_seen) then
      return '「지방세로 읽기」 — 같은 관련 세목이 두 번 있습니다';
    end if;
    v_seen := v_seen || btrim(v_item #>> '{}');
    if public.lens_text_has_tax_amount(normalize(v_item #>> '{}', NFC)) then
      return '「지방세로 읽기」에는 세액을 쓰지 않습니다 — 숫자 + 원 표현을 빼 주세요 (CORE-01)';
    end if;
  end loop;
  if jsonb_typeof(p_lens -> 'points') is distinct from 'array' then
    return '「지방세로 읽기」 — 핵심 포인트는 줄 목록입니다';
  end if;
  v_n := jsonb_array_length(p_lens -> 'points');
  if v_n < 1 or v_n > 3 then
    return format('「지방세로 읽기」 — 핵심 포인트는 1~3줄입니다 (지금 %s줄)', v_n);
  end if;
  for v_item in select x.value from jsonb_array_elements(p_lens -> 'points') x loop
    if jsonb_typeof(v_item) is distinct from 'string' or char_length(btrim(v_item #>> '{}')) not between 1 and 120 then
      return '「지방세로 읽기」 — 핵심 포인트 줄은 1~120자 글자입니다 (빈 줄 0)';
    end if;
    if public.lens_text_has_tax_amount(normalize(v_item #>> '{}', NFC)) then
      return '「지방세로 읽기」에는 세액을 쓰지 않습니다 — 숫자 + 원 표현을 빼 주세요 (CORE-01)';
    end if;
  end loop;
  if jsonb_typeof(p_lens -> 'links') is distinct from 'array' or jsonb_array_length(p_lens -> 'links') not between 1 and 3 then
    return '「지방세로 읽기」 — 해설·도서·전문가 링크는 1~3개입니다 (링크 0개 저장 거부)';
  end if;
  for v_item in select x.value from jsonb_array_elements(p_lens -> 'links') x loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(v_item) k) is distinct from array['kind', 'label', 'url']
       or coalesce(v_item ->> 'kind', '') not in ('explainer', 'book', 'expert')
       or jsonb_typeof(v_item -> 'label') is distinct from 'string' or char_length(btrim(v_item ->> 'label')) not between 1 and 40
       or jsonb_typeof(v_item -> 'url') is distinct from 'string' or char_length(v_item ->> 'url') > 300
       or (v_item ->> 'url') !~ '^/[^/[:space:]#][^[:space:]#]*$' then
      return '「지방세로 읽기」 — 링크는 { kind: explainer·book·expert, label: 1~40자, url: 사이트 안 주소 } 입니다 (계산기 링크는 적지 않습니다)';
    end if;
    if (v_item ->> 'kind') = any (v_kinds) then
      return '「지방세로 읽기」 — 같은 종류의 링크가 두 번 있습니다 (종류마다 하나)';
    end if;
    v_kinds := v_kinds || (v_item ->> 'kind');
    if public.lens_text_has_tax_amount(normalize(v_item ->> 'label', NFC)) then
      return '「지방세로 읽기」에는 세액을 쓰지 않습니다 — 숫자 + 원 표현을 빼 주세요 (CORE-01)';
    end if;
  end loop;
  if jsonb_typeof(p_lens -> 'base_date') is distinct from 'string' or (p_lens ->> 'base_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return '「지방세로 읽기」 — 법령 기준일(base_date, YYYY-MM-DD)이 필요합니다';
  end if;
  begin
    perform (p_lens ->> 'base_date')::date;
  exception when others then
    return '「지방세로 읽기」 — 법령 기준일이 날짜가 아닙니다';
  end;
  return null;
end;
$$;
revoke all on function public.dev_method_lens_problem(jsonb) from public, anon, authenticated;
grant execute on function public.dev_method_lens_problem(jsonb) to service_role;

-- 박스의 글 칸 (세목·포인트·링크 이름) — 금지 표현 검사용
create function public.dev_method_lens_texts(p_lens jsonb) returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array(select t from jsonb_array_elements_text(case when jsonb_typeof(p_lens -> 'topics') = 'array' then p_lens -> 'topics' else '[]'::jsonb end) t), '{}')
      || coalesce(array(select t from jsonb_array_elements_text(case when jsonb_typeof(p_lens -> 'points') = 'array' then p_lens -> 'points' else '[]'::jsonb end) t), '{}')
      || coalesce(array(select l ->> 'label' from jsonb_array_elements(case when jsonb_typeof(p_lens -> 'links') = 'array' then p_lens -> 'links' else '[]'::jsonb end) l), '{}');
$$;
revoke all on function public.dev_method_lens_texts(jsonb) from public, anon, authenticated;
grant execute on function public.dev_method_lens_texts(jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 개발방법 7행
-- ─────────────────────────────────────────────────────────────
create table public.dev_methods (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug in ('redevelopment', 'reconstruction', 'small-scale', 'public', 'trust', 'renewal', 'rapid-planning')),
  name text not null unique check (char_length(btrim(name)) between 1 and 40),
  kind text not null check (kind in ('project_type', 'planning_support')),
  sort integer not null unique,
  legal_basis_name text check (legal_basis_name is null or char_length(btrim(legal_basis_name)) between 1 and 120),
  summary text check (summary is null or char_length(btrim(summary)) between 1 and 300),
  steps jsonb,
  lens jsonb,
  drafted_by text check (drafted_by is null or length(btrim(drafted_by)) > 0),
  drafted_at timestamptz,
  reviewed_by text,
  reviewed_at timestamptz,
  review_status text not null default 'draft' check (review_status in ('draft', 'reviewed', 'rereview_needed')),
  -- 고정 편집 순서와 종류 (2.1 dev_method.slug 순서 · 12장 #16 — 신속통합기획만 계획 지원 절차)
  constraint dev_methods_fixed_order check (sort = array_position(array['redevelopment', 'reconstruction', 'small-scale', 'public', 'trust', 'renewal', 'rapid-planning']::text[], slug)),
  constraint dev_methods_fixed_kind check (kind = case when slug = 'rapid-planning' then 'planning_support' else 'project_type' end),
  constraint dev_methods_signature check (
    (reviewed_by is null) = (reviewed_at is null)
    and (review_status = 'reviewed') = (reviewed_by is not null)
    and (reviewed_by is null or (summary is not null and steps is not null and drafted_at is not null)))
);

comment on table public.dev_methods is '개발방법 (PR-09) — 정확히 7행, 고정 편집 순서. 씨앗은 이름·slug·종류·순서만(내용 빈 값 → 공개 0). 편집국 초안 → 세무 감수위원 서명. 점수·순위·추천 칸 없음(PR-11)';
comment on column public.dev_methods.slug is '주소 이름 — 2.1 dev_method.slug 7개 (바꾸지 않는다)';
comment on column public.dev_methods.name is '방법 이름 — PRD-01B 3.2 화면 초안 글자 그대로 (바꾸지 않는다)';
comment on column public.dev_methods.kind is '종류 — project_type(사업 유형) · planning_support(계획 지원 절차 — 신속통합기획, 사업 유형 개수에 들지 않음)';
comment on column public.dev_methods.sort is '고정 편집 순서 1~7 (12장 #16) — 화면은 이 순서로만 늘어놓는다';
comment on column public.dev_methods.legal_basis_name is '근거 법령 이름 (편집국 — 공식 원문 기준)';
comment on column public.dev_methods.summary is '한 줄 설명 (편집국) — 서명 전 필수';
comment on column public.dev_methods.steps is '절차 단계 [단계 이름 1~60자, 1~15개] — 방법 상세의 절차 타임라인. 서명 전 필수. 숫자 요건 값은 사실 행에';
comment on column public.dev_methods.lens is '「지방세로 읽기」 박스 { topics, points, links, base_date } — 16단계 단계 템플릿과 같은 모양. 없으면 박스 0';
comment on column public.dev_methods.drafted_by is '내용을 마지막으로 저장한 사람 (user:<id>)';
comment on column public.dev_methods.reviewed_by is '세무 감수 서명자 (user:<id> — 서명할 때 reviewer 역할). 내용을 고치면 지워진다';
comment on column public.dev_methods.review_status is 'draft(서명 전) · reviewed(서명됨) · rereview_needed(서명 뒤 고침 — 다시 서명해야 공개)';

-- 씨앗 — PRD-01B 3.2 화면 초안의 방법 이름과 2.1 slug·12장 #16 순서만. 내용 칸은 비어 있다
insert into public.dev_methods (slug, name, kind, sort) values
  ('redevelopment', '재개발', 'project_type', 1),
  ('reconstruction', '재건축', 'project_type', 2),
  ('small-scale', '소규모정비', 'project_type', 3),
  ('public', '공공 방식', 'project_type', 4),
  ('trust', '신탁방식', 'project_type', 5),
  ('renewal', '재정비', 'project_type', 6),
  ('rapid-planning', '신속통합기획', 'planning_support', 7);

-- 저장 검사 — 7행 고정 · 내용 모양·금지 표현·자리 채움 · 서명 흐름 (내용을 고치면 서명 지움)
create function public.dev_methods_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_where text;
  v_texts text[] := '{}';
  v_item jsonb;
  v_seen text[] := '{}';
  v_problem text;
  v_hit text;
  v_content_changed boolean;
  v_new_signature boolean;
begin
  if tg_op = 'INSERT' then
    raise exception '개발방법은 정확히 7행입니다 — 방법을 더하지 않습니다 (2.3 · 12장 #16)' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    raise exception '개발방법은 정확히 7행입니다 — 방법을 지우지 않습니다 (2.3 · 12장 #16)' using errcode = 'check_violation';
  end if;
  v_where := old.slug;
  if new.id is distinct from old.id or new.slug is distinct from old.slug or new.name is distinct from old.name
     or new.kind is distinct from old.kind or new.sort is distinct from old.sort then
    raise exception '개발방법(%)의 이름·slug·종류·순서는 바꿀 수 없습니다 (PRD-01B 3.2 · 12장 #16)', v_where using errcode = 'check_violation';
  end if;

  v_content_changed := new.legal_basis_name is distinct from old.legal_basis_name or new.summary is distinct from old.summary
                       or new.steps is distinct from old.steps or new.lens is distinct from old.lens;
  v_new_signature := new.reviewed_by is not null and new.reviewed_by is distinct from old.reviewed_by;

  if v_content_changed then
    if v_new_signature then
      raise exception '개발방법(%) — 서명은 저장된 내용에만 합니다. 내용을 고치는 쓰기에 새 서명을 넣지 않습니다', v_where using errcode = 'check_violation';
    end if;
    if length(btrim(coalesce(new.drafted_by, ''))) = 0 then
      raise exception '개발방법(%) — 내용을 저장한 사람(drafted_by)이 필요합니다', v_where using errcode = 'check_violation';
    end if;
    if new.legal_basis_name is not null then v_texts := v_texts || new.legal_basis_name; end if;
    if new.summary is not null then v_texts := v_texts || new.summary; end if;
    if new.steps is not null then
      if jsonb_typeof(new.steps) is distinct from 'array' or jsonb_array_length(new.steps) not between 1 and 15 then
        raise exception '개발방법(%) — 절차 단계는 1~15개 목록입니다', v_where using errcode = 'check_violation';
      end if;
      for v_item in select x.value from jsonb_array_elements(new.steps) x loop
        if jsonb_typeof(v_item) is distinct from 'string' or char_length(btrim(v_item #>> '{}')) not between 1 and 60 then
          raise exception '개발방법(%) — 절차 단계 이름은 1~60자 글자입니다', v_where using errcode = 'check_violation';
        end if;
        if btrim(v_item #>> '{}') = any (v_seen) then
          raise exception '개발방법(%) — 같은 절차 단계가 두 번 있습니다', v_where using errcode = 'check_violation';
        end if;
        v_seen := v_seen || btrim(v_item #>> '{}');
        v_texts := v_texts || (v_item #>> '{}');
      end loop;
    end if;
    -- 빈 칸을 '확인 중' 같은 글로 채우지 않는다 (PR-09)
    if exists (select 1 from unnest(v_texts) t where public.dev_method_placeholder(t)) then
      raise exception '개발방법(%) — ''확인 중''·''준비 중'' 같은 자리 채움 글은 저장하지 않습니다. 모르는 칸은 비워 두면 공개되지 않습니다 (PR-09)', v_where
        using errcode = 'check_violation';
    end if;
    if new.lens is not null then
      v_problem := public.dev_method_lens_problem(new.lens);
      if v_problem is not null then
        raise exception '개발방법(%) — %', v_where, v_problem using errcode = 'check_violation';
      end if;
    end if;
    v_hit := public.dev_method_forbidden_hit(v_texts || public.dev_method_lens_texts(new.lens));
    if v_hit is not null then
      raise exception '개발방법(%)에 금지 표현 ''%'' — 어느 방식이 좋은지 추천하거나 판정하지 않습니다 (PR-11 · UX-01)', v_where, v_hit using errcode = 'check_violation';
    end if;
    if exists (select 1 from unnest(v_texts) t where public.dev_method_text_has_requirement(t)) then
      raise warning '개발방법(%)에 숫자 요건 표현이 있습니다 — 저장은 됩니다. 숫자 요건 값은 기준일·감수자와 함께 사실 행(dev_method_facts)에 적습니다 (PR-10)', v_where;
    end if;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_status := case when old.review_status = 'draft' then 'draft' else 'rereview_needed' end;
    new.drafted_at := now();
    return new;
  end if;

  if v_new_signature then
    if not public.dev_method_is_reviewer(new.reviewed_by) then
      raise exception '개발방법(%)의 감수 서명은 세무 감수위원(reviewer)만 합니다', v_where using errcode = 'check_violation';
    end if;
    if old.summary is null or old.steps is null or old.drafted_at is null then
      raise exception '개발방법(%) — 한 줄 설명과 절차 단계를 저장한 뒤에 서명합니다', v_where using errcode = 'check_violation';
    end if;
    new.reviewed_at := now();
    new.review_status := 'reviewed';
    return new;
  end if;

  if new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at
     or new.review_status is distinct from old.review_status or new.drafted_at is distinct from old.drafted_at then
    raise exception '개발방법(%) — 감수 상태는 서명으로만 바뀝니다 (내용을 고치면 서명이 지워집니다)', v_where using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.dev_methods_guard() from public, anon, authenticated;
create trigger dev_methods_guard
  before insert or update or delete on public.dev_methods
  for each row execute function public.dev_methods_guard();
create trigger dev_methods_no_truncate
  before truncate on public.dev_methods
  for each statement execute function public.append_only_guard();

-- ─────────────────────────────────────────────────────────────
-- 비교 항목 — 방법 × 6칸 (2.1 dev_method.compare_item 순서 고정)
-- ─────────────────────────────────────────────────────────────
create table public.dev_method_compare (
  method_id bigint not null references public.dev_methods (id),
  item text not null check (item in ('legal_basis', 'actor', 'target', 'procedure', 'numeric_requirements', 'tax_issues')),
  body text not null check (char_length(btrim(body)) between 1 and 300),
  drafted_by text not null check (length(btrim(drafted_by)) > 0),
  drafted_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz,
  review_status text not null default 'draft' check (review_status in ('draft', 'reviewed', 'rereview_needed')),
  primary key (method_id, item),
  constraint dev_method_compare_signature check (
    (reviewed_by is null) = (reviewed_at is null)
    and (review_status = 'reviewed') = (reviewed_by is not null))
);

comment on table public.dev_method_compare is '개발방법 비교 항목 (PR-09) — 방법마다 6칸(근거 법령·사업 주체·대상·주요 절차·숫자 요건·지방세 쟁점). 6칸 모두 서명돼야 그 방법이 공개된다. 고치면 서명을 지운다';
comment on column public.dev_method_compare.item is '비교 항목 — 2.1 dev_method.compare_item 6개 (순서 고정)';
comment on column public.dev_method_compare.body is '비교표 칸의 글 (1~300자, 편집국). 자리 채움 글 거부. 숫자 요건 값은 사실 행에';
comment on column public.dev_method_compare.reviewed_by is '세무 감수 서명자 (user:<id>). 글을 고치면 지워진다';
comment on column public.dev_method_compare.review_status is 'draft · reviewed · rereview_needed (방법과 같은 값)';

create function public.dev_method_compare_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_where text;
  v_hit text;
  v_content_changed boolean := tg_op = 'INSERT';
  v_new_signature boolean;
begin
  v_where := coalesce((select m.slug from public.dev_methods m where m.id = new.method_id), new.method_id::text) || ' · ' || new.item;
  if tg_op = 'UPDATE' then
    if new.method_id is distinct from old.method_id or new.item is distinct from old.item then
      raise exception '비교 항목(%)의 방법·항목은 바꿀 수 없습니다', v_where using errcode = 'check_violation';
    end if;
    v_content_changed := new.body is distinct from old.body;
  end if;

  if v_content_changed then
    if public.dev_method_placeholder(new.body) then
      raise exception '비교 항목(%) — ''확인 중''·''준비 중'' 같은 자리 채움 글은 저장하지 않습니다. 모르는 칸은 비워 두면 그 방법이 공개되지 않습니다 (PR-09)', v_where
        using errcode = 'check_violation';
    end if;
    v_hit := public.dev_method_forbidden_hit(array[new.body]);
    if v_hit is not null then
      raise exception '비교 항목(%)에 금지 표현 ''%'' — 어느 방식이 좋은지 추천하거나 판정하지 않습니다 (PR-11 · UX-01)', v_where, v_hit using errcode = 'check_violation';
    end if;
    if public.dev_method_text_has_requirement(new.body) then
      raise warning '비교 항목(%)에 숫자 요건 표현이 있습니다 — 저장은 됩니다. 숫자 요건 값은 기준일·감수자와 함께 사실 행(dev_method_facts)에 적습니다 (PR-10)', v_where;
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.reviewed_by is not null or new.reviewed_at is not null or new.review_status <> 'draft' then
      raise exception '비교 항목(%) — 서명은 저장된 글에만 합니다 (새 칸은 초안)', v_where using errcode = 'check_violation';
    end if;
    new.drafted_at := now();
    return new;
  end if;

  v_new_signature := new.reviewed_by is not null and new.reviewed_by is distinct from old.reviewed_by;
  if v_content_changed then
    if v_new_signature then
      raise exception '비교 항목(%) — 서명은 저장된 글에만 합니다. 글을 고치는 쓰기에 새 서명을 넣지 않습니다', v_where using errcode = 'check_violation';
    end if;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_status := case when old.review_status = 'draft' then 'draft' else 'rereview_needed' end;
    new.drafted_at := now();
    return new;
  end if;

  if v_new_signature then
    if not public.dev_method_is_reviewer(new.reviewed_by) then
      raise exception '비교 항목(%)의 감수 서명은 세무 감수위원(reviewer)만 합니다', v_where using errcode = 'check_violation';
    end if;
    new.reviewed_at := now();
    new.review_status := 'reviewed';
    return new;
  end if;

  if new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at
     or new.review_status is distinct from old.review_status or new.drafted_at is distinct from old.drafted_at then
    raise exception '비교 항목(%) — 감수 상태는 서명으로만 바뀝니다 (글을 고치면 서명이 지워집니다)', v_where using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.dev_method_compare_guard() from public, anon, authenticated;
create trigger dev_method_compare_guard
  before insert or update on public.dev_method_compare
  for each row execute function public.dev_method_compare_guard();
create trigger dev_method_compare_no_delete
  before delete on public.dev_method_compare
  for each row execute function public.append_only_guard();
create trigger dev_method_compare_no_truncate
  before truncate on public.dev_method_compare
  for each statement execute function public.append_only_guard();

-- ─────────────────────────────────────────────────────────────
-- 숫자 요건 사실 행 — 추가만(서명 칸만 한 번 채운다). 고치기 = 새 버전 + 사유
-- ─────────────────────────────────────────────────────────────
create table public.dev_method_facts (
  id bigint generated always as identity primary key,
  method_id bigint not null references public.dev_methods (id),
  fact_key text not null check (fact_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null check (char_length(btrim(label)) between 1 and 40),
  value text not null check (char_length(btrim(value)) between 1 and 40),
  unit text check (unit is null or char_length(btrim(unit)) between 1 and 20),
  law_ref text not null check (char_length(btrim(law_ref)) between 1 and 120),
  reference_date date,
  source_url text not null check (source_url ~* '^https?://[^[:space:]]+$' and char_length(source_url) <= 500),
  snapshot_id bigint not null references public.raw_snapshots (id),
  version integer not null check (version >= 1),
  supersedes_id bigint references public.dev_method_facts (id),
  reason text,
  recorded_by text not null check (length(btrim(recorded_by)) > 0),
  recorded_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz,
  constraint dev_method_facts_versions unique (method_id, fact_key, version),
  constraint dev_method_facts_first_version check ((version = 1) = (supersedes_id is null)),
  constraint dev_method_facts_reason check (version = 1 or char_length(btrim(coalesce(reason, ''))) between 1 and 200),
  constraint dev_method_facts_signature check (
    (reviewed_by is null) = (reviewed_at is null)
    and (reviewed_by is null or reference_date is not null))
);

comment on table public.dev_method_facts is '개발방법 숫자 요건 사실 행 (PR-10) — 추가만. 고치기 = 새 버전 행 + 사유(옛 행 그대로). 공개는 최신 판 + 기준일 + 서명 + 서명자 공개 이름이 있을 때만';
comment on column public.dev_method_facts.fact_key is '요건 열쇠 — 같은 방법 안에서 버전을 잇는 이름 (영문 소문자·숫자·밑줄)';
comment on column public.dev_method_facts.label is '요건 이름 (편집국 — 예: 동의 요건)';
comment on column public.dev_method_facts.value is '값 (편집국 — 공식 원문 그대로)';
comment on column public.dev_method_facts.unit is '단위';
comment on column public.dev_method_facts.law_ref is '근거 조문';
comment on column public.dev_method_facts.reference_date is '기준일 — 없으면 서명·공개 0';
comment on column public.dev_method_facts.source_url is '근거 원문 주소 — 공개 화면은 링크만';
comment on column public.dev_method_facts.snapshot_id is '근거 원본 스냅샷 — 글자는 어떤 공개 화면에도 그리지 않는다. 다시 받은 원문의 해시가 다르면 검수 큐 1건';
comment on column public.dev_method_facts.version is '판 번호 — 같은 방법·같은 열쇠 안에서 1부터 (저장 검사가 매긴다)';
comment on column public.dev_method_facts.supersedes_id is '이 판이 고친 바로 앞 판 (첫 판은 비어 있다, 한 판은 한 번만 고친다)';
comment on column public.dev_method_facts.reason is '고친 사유 — 둘째 판부터 필수 (공개 뷰에 없다)';
comment on column public.dev_method_facts.reviewed_by is '세무 감수 서명자 (user:<id>) — 최신 판에만, 기준일이 있어야 서명한다';

create index dev_method_facts_key_idx on public.dev_method_facts (method_id, fact_key, version);
create index dev_method_facts_source_url_idx on public.dev_method_facts (source_url);
-- 한 판은 한 번만 고친다 (갈래 0 — 최신 판만 고칠 수 있다)
create unique index dev_method_facts_supersedes_once on public.dev_method_facts (supersedes_id) where supersedes_id is not null;

create function public.dev_method_facts_insert_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_where text;
  v_latest public.dev_method_facts;
  v_target public.dev_method_facts;
  v_hit text;
begin
  -- 같은 방법·같은 열쇠에 동시에 들어오는 두 판이 서로를 못 보는 일을 막는다
  perform pg_advisory_xact_lock(hashtextextended('dev_method_facts:' || new.method_id::text || ':' || new.fact_key, 0));
  v_where := coalesce((select m.slug from public.dev_methods m where m.id = new.method_id), new.method_id::text) || ' · ' || new.fact_key;

  if new.reviewed_by is not null or new.reviewed_at is not null then
    raise exception '사실 행(%) — 서명은 저장된 판에만 합니다 (새 판은 서명 전)', v_where using errcode = 'check_violation';
  end if;
  if public.dev_method_placeholder(new.value) or public.dev_method_placeholder(new.law_ref) or public.dev_method_placeholder(new.label) then
    raise exception '사실 행(%) — ''확인 중'' 같은 자리 채움 글은 저장하지 않습니다. 값·근거 조문을 확인한 뒤 적습니다 (PR-10)', v_where using errcode = 'check_violation';
  end if;
  v_hit := public.dev_method_forbidden_hit(array[new.label, new.value, new.unit, new.law_ref]);
  if v_hit is not null then
    raise exception '사실 행(%)에 금지 표현 ''%'' — 어느 방식이 좋은지 추천하거나 판정하지 않습니다 (PR-11 · UX-01)', v_where, v_hit using errcode = 'check_violation';
  end if;

  select f.* into v_latest
    from public.dev_method_facts f
   where f.method_id = new.method_id and f.fact_key = new.fact_key
     and not exists (select 1 from public.dev_method_facts n where n.supersedes_id = f.id)
   order by f.version desc
   limit 1;

  if new.supersedes_id is null then
    if v_latest.id is not null then
      raise exception '사실 행(%)이 이미 있습니다 — 고치려면 최신 판(%)을 고치는 새 판(supersedes_id·reason)으로 적으세요 (덮어쓰기 0)', v_where, v_latest.id
        using errcode = 'check_violation';
    end if;
    new.version := 1;
    return new;
  end if;

  select f.* into v_target from public.dev_method_facts f where f.id = new.supersedes_id;
  if v_target.id is null or v_target.method_id <> new.method_id or v_target.fact_key <> new.fact_key then
    raise exception '사실 행(%) — 고치는 앞 판(%)은 같은 방법·같은 열쇠의 판이어야 합니다', v_where, new.supersedes_id using errcode = 'check_violation';
  end if;
  if v_latest.id is distinct from v_target.id then
    raise exception '사실 행(%) — 앞 판(%)은 최신 판이 아닙니다(최신 %) — 새로 불러와 최신 판을 고치세요', v_where, v_target.id, v_latest.id using errcode = 'check_violation';
  end if;
  new.version := v_target.version + 1;
  return new;
end;
$$;
revoke all on function public.dev_method_facts_insert_guard() from public, anon, authenticated;
create trigger dev_method_facts_insert_guard
  before insert on public.dev_method_facts
  for each row execute function public.dev_method_facts_insert_guard();

-- 고치기 — 서명 칸(서명자·시각)을 한 번 채우는 것만. 최신 판·기준일 있음·서명자는 지금 reviewer. 다른 칸은 그대로, 지우기 0
create function public.dev_method_facts_update_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['reviewed_by', 'reviewed_at']) is distinct from (to_jsonb(old) - array['reviewed_by', 'reviewed_at']) then
    raise exception '사실 행(%)은 고치지 않습니다 — 새 판(supersedes_id·reason)으로 적으세요 (덮어쓰기 0, PR-10)', old.id using errcode = 'insufficient_privilege';
  end if;
  if old.reviewed_by is not null then
    raise exception '사실 행(%)은 이미 서명됐습니다 — 바꾸려면 새 판으로 적으세요', old.id using errcode = 'insufficient_privilege';
  end if;
  if new.reviewed_by is null then
    raise exception '사실 행(%) — 감수 상태는 서명으로만 바뀝니다', old.id using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.dev_method_facts n where n.supersedes_id = old.id) then
    raise exception '사실 행(%)은 최신 판이 아닙니다 — 최신 판에 서명하세요', old.id using errcode = 'check_violation';
  end if;
  if old.reference_date is null then
    raise exception '사실 행(%)에 기준일이 없어 서명하지 않습니다 — 기준일을 넣은 새 판을 적으세요 (PR-10)', old.id using errcode = 'check_violation';
  end if;
  if not public.dev_method_is_reviewer(new.reviewed_by) then
    raise exception '사실 행(%)의 감수 서명은 세무 감수위원(reviewer)만 합니다', old.id using errcode = 'check_violation';
  end if;
  new.reviewed_at := now();
  return new;
end;
$$;
revoke all on function public.dev_method_facts_update_guard() from public, anon, authenticated;
create trigger dev_method_facts_update_guard
  before update on public.dev_method_facts
  for each row execute function public.dev_method_facts_update_guard();
create trigger dev_method_facts_no_delete
  before delete on public.dev_method_facts
  for each row execute function public.append_only_guard();
create trigger dev_method_facts_no_truncate
  before truncate on public.dev_method_facts
  for each statement execute function public.append_only_guard();

-- ─────────────────────────────────────────────────────────────
-- 권한·RLS — 표는 service_role만. 관리자 전권(admin-rights 시험 — 2026-10-17 PO 지시)대로 방법·비교 항목은 네 권한을 주고
-- 방법 더하기·지우기·비교 항목 지우기는 트리거가 막는다. 사실 행은 추가만 되는 표(읽기·더하기 + 서명 칸 한 번 — 고치기 트리거가 서명만 받는다)
-- ─────────────────────────────────────────────────────────────
alter table public.dev_methods enable row level security;
revoke all on table public.dev_methods from anon, authenticated, service_role;
grant select, insert, update, delete on table public.dev_methods to service_role;

alter table public.dev_method_compare enable row level security;
revoke all on table public.dev_method_compare from anon, authenticated, service_role;
grant select, insert, update, delete on table public.dev_method_compare to service_role;

alter table public.dev_method_facts enable row level security;
revoke all on table public.dev_method_facts from anon, authenticated, service_role;
grant select, insert, update on table public.dev_method_facts to service_role;

-- ─────────────────────────────────────────────────────────────
-- 공개 준비 판정 (service_role만) — 방법 서명 + 비교 항목 6칸 서명, 서명자가 지금도 reviewer
-- ─────────────────────────────────────────────────────────────
create view public.dev_method_readiness as
select
  m.id as method_id,
  m.slug,
  m.sort,
  (m.review_status = 'reviewed' and public.dev_method_is_reviewer(m.reviewed_by)) as method_signed,
  array(
    select i.item
      from unnest(array['legal_basis', 'actor', 'target', 'procedure', 'numeric_requirements', 'tax_issues']::text[]) with ordinality as i(item, n)
     where not exists (
       select 1 from public.dev_method_compare c
        where c.method_id = m.id and c.item = i.item and c.review_status = 'reviewed' and public.dev_method_is_reviewer(c.reviewed_by))
     order by i.n) as compare_unsigned,
  (m.review_status = 'reviewed' and public.dev_method_is_reviewer(m.reviewed_by)
   and (select count(*) from public.dev_method_compare c
         where c.method_id = m.id and c.review_status = 'reviewed' and public.dev_method_is_reviewer(c.reviewed_by)) = 6) as ready
from public.dev_methods m;

comment on view public.dev_method_readiness is '개발방법 공개 준비 (PR-09 — 필수 비교 항목이 빈 방법·서명 없는 방법은 공개 0). 기능 키 dev_methods 켜기 검사와 관리 화면이 읽는다. service_role만';
revoke all on table public.dev_method_readiness from public, anon, authenticated, service_role;
grant select on table public.dev_method_readiness to service_role;

-- 기능 키 dev_methods 켜기 — 7개 방법 모두 공개 준비일 때만 (2.4 '7개 방법 비교 항목 전부 + 세무 감수 서명'). 끄기·이미 켜진 값은 검사하지 않는다
create function public.dev_methods_flag_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missing text;
begin
  if jsonb_typeof(new.value) = 'object' and (new.value -> 'dev_methods') = 'true'::jsonb
     and (tg_op = 'INSERT' or jsonb_typeof(old.value) is distinct from 'object' or (old.value -> 'dev_methods') is distinct from 'true'::jsonb) then
    select string_agg(r.slug, ', ' order by r.sort) into v_missing from public.dev_method_readiness r where not r.ready;
    if v_missing is not null or (select count(*) from public.dev_method_readiness r where r.ready) <> 7 then
      raise exception '개발방법 비교(dev_methods)는 7개 방법의 비교 항목 6칸과 세무 감수 서명이 모두 있어야 켭니다 — 아직: %', coalesce(v_missing, '방법 행 없음')
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.dev_methods_flag_guard() from public, anon, authenticated;
create trigger settings_dev_methods_flag_guard
  before insert or update on public.settings
  for each row when (new.key = 'feature_flags')
  execute function public.dev_methods_flag_guard();

-- ─────────────────────────────────────────────────────────────
-- 공개 뷰 (anon) — 기능 키 dev_methods 켜짐 + 공개 준비된 방법만. 식은 몸에 적는다(anon 실행 함수 0)
-- ─────────────────────────────────────────────────────────────
create view public.public_dev_methods as
select
  m.slug,
  m.name,
  m.kind,
  m.sort,
  m.legal_basis_name,
  m.summary,
  array(select t.v from jsonb_array_elements_text(m.steps) with ordinality as t(v, n) order by t.n) as steps,
  m.lens,
  m.reviewed_at,
  (select pe.name from public.people pe
    where pe.visibility = 'public' and pe.staff_user_id is not null
      and 'user:' || pe.staff_user_id::text = lower(m.reviewed_by)
    order by pe.id limit 1) as reviewer_name
from public.dev_methods m
where exists (select 1 from public.settings s where s.key = 'feature_flags' and jsonb_typeof(s.value) = 'object' and (s.value -> 'dev_methods') = 'true'::jsonb)
  and m.review_status = 'reviewed'
  and exists (select 1 from public.staff_roles r where r.role = 'reviewer' and 'user:' || r.user_id::text = lower(m.reviewed_by))
  and (select count(*) from public.dev_method_compare c
        where c.method_id = m.id and c.review_status = 'reviewed'
          and exists (select 1 from public.staff_roles r where r.role = 'reviewer' and 'user:' || r.user_id::text = lower(c.reviewed_by))) = 6;

comment on view public.public_dev_methods is '개발방법 공개 (PR-09) — 기능 키 dev_methods + 방법 서명 + 비교 항목 6칸 서명(서명자가 지금도 reviewer). 고정 편집 순서 sort. 작성자·서명자 계정 칸 0';
revoke all on table public.public_dev_methods from public, anon, authenticated, service_role;
grant select on table public.public_dev_methods to anon, authenticated, service_role;

create view public.public_dev_method_compare as
select
  m.slug,
  m.sort,
  c.item,
  array_position(array['legal_basis', 'actor', 'target', 'procedure', 'numeric_requirements', 'tax_issues']::text[], c.item) as item_position,
  c.body,
  c.reviewed_at,
  (select pe.name from public.people pe
    where pe.visibility = 'public' and pe.staff_user_id is not null
      and 'user:' || pe.staff_user_id::text = lower(c.reviewed_by)
    order by pe.id limit 1) as reviewer_name
from public.dev_method_compare c
join public.dev_methods m on m.id = c.method_id
where m.slug in (select p.slug from public.public_dev_methods p);

comment on view public.public_dev_method_compare is '개발방법 비교표 칸 (PR-09) — 공개된 방법의 6칸만(차례 item_position = 2.1 순서). 작성자·서명자 계정 칸 0';
revoke all on table public.public_dev_method_compare from public, anon, authenticated, service_role;
grant select on table public.public_dev_method_compare to anon, authenticated, service_role;

create view public.public_dev_method_facts as
select
  m.slug,
  m.sort,
  f.fact_key,
  f.label,
  f.value,
  f.unit,
  f.law_ref,
  f.reference_date,
  f.source_url,
  f.version,
  f.reviewed_at,
  pr.name as reviewer_name,
  exists (select 1 from public.source_review_queue q where q.target_type = 'dev_method_fact' and q.target_id = f.id and q.status = 'open') as under_review
from public.dev_method_facts f
join public.dev_methods m on m.id = f.method_id
join lateral (
  select pe.name from public.people pe
   where pe.visibility = 'public' and pe.staff_user_id is not null
     and 'user:' || pe.staff_user_id::text = lower(f.reviewed_by)
   order by pe.id limit 1
) pr on true
where m.slug in (select p.slug from public.public_dev_methods p)
  and not exists (select 1 from public.dev_method_facts n where n.supersedes_id = f.id)
  and f.reviewed_by is not null
  and f.reference_date is not null
  and exists (select 1 from public.staff_roles r where r.role = 'reviewer' and 'user:' || r.user_id::text = lower(f.reviewed_by));

comment on view public.public_dev_method_facts is '개발방법 숫자 요건 공개 (PR-10) — 공개된 방법의 최신 판 + 서명(서명자가 지금도 reviewer) + 기준일 + 서명자 공개 이름이 있는 행만. 최신 판이 서명 전이면 그 요건 0행(옛 판으로 대신하지 않는다). under_review = 원문 검수 중. 사유·기록자·스냅샷 번호 0';
revoke all on table public.public_dev_method_facts from public, anon, authenticated, service_role;
grant select on table public.public_dev_method_facts to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 검수 큐(6단계 …42 · 12단계 …47) — 대상 검사가 개발방법 사실 행을 받는다
-- ─────────────────────────────────────────────────────────────
create or replace function public.source_review_target_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src public.article_sources;
  v_ev public.project_events;
  v_fact public.dev_method_facts;
begin
  if new.target_type = 'article_source' then
    select * into v_src from public.article_sources where id = new.target_id;
    if v_src.id is null then
      raise exception '검수 대상 출처 src:%가 없습니다', new.target_id using errcode = 'foreign_key_violation';
    end if;
    if v_src.kind not in ('official_doc', 'dataset') then
      raise exception '검수 큐에는 공식 자료(official_doc·dataset) 출처만 올립니다 (src:% 는 %)', new.target_id, v_src.kind using errcode = 'check_violation';
    end if;
    if new.article_id is distinct from v_src.article_id then
      raise exception '검수 항목의 기사 번호(%)가 출처 src:%의 기사(%)와 다릅니다', new.article_id, new.target_id, v_src.article_id using errcode = 'check_violation';
    end if;
  elsif new.target_type = 'project_event' then
    select * into v_ev from public.project_events where id = new.target_id;
    if v_ev.id is null then
      raise exception '검수 대상 단계 기록 pe:%가 없습니다', new.target_id using errcode = 'foreign_key_violation';
    end if;
    if v_ev.snapshot_id is null then
      raise exception '검수 큐에는 원본 스냅샷이 있는 단계 기록만 올립니다 (pe:%)', new.target_id using errcode = 'check_violation';
    end if;
    if new.article_id is not null then
      raise exception '단계 기록 검수 항목(pe:%)에는 기사 번호를 넣지 않습니다', new.target_id using errcode = 'check_violation';
    end if;
  elsif new.target_type = 'dev_method_fact' then
    select * into v_fact from public.dev_method_facts where id = new.target_id;
    if v_fact.id is null then
      raise exception '검수 대상 사실 행 dmf:%가 없습니다', new.target_id using errcode = 'foreign_key_violation';
    end if;
    if new.article_id is not null then
      raise exception '사실 행 검수 항목(dmf:%)에는 기사 번호를 넣지 않습니다', new.target_id using errcode = 'check_violation';
    end if;
  else
    raise exception '검수 대상 %는 받지 않습니다', new.target_type using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.source_review_target_guard() from public, anon, authenticated;

-- 원문 다시 받기 — 같은 주소를 쓴 공식 자료(기사)·단계 기록(프로젝트)·사실 행(개발방법 최신 판)을 함께 비교한다.
-- 결과 칸은 12단계 그대로 + methodTargets·methodOpened·methodUnchanged·methodAlreadyQueued(사실 행 — 대체되지 않은 최신 판만, 공개·비공개 모두)
create or replace function public.source_snapshot_refetched(p_url text, p_hash text, p_payload text, p_source text, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := btrim(coalesce(p_url, ''));
  v_hash text := lower(btrim(coalesce(p_hash, '')));
  v_snap bigint;
  v_row record;
  v_rc integer;
  v_targets integer := 0;
  v_opened integer := 0;
  v_same integer := 0;
  v_already integer := 0;
  v_nosnap integer := 0;
  v_p_targets integer := 0;
  v_p_opened integer := 0;
  v_p_same integer := 0;
  v_p_already integer := 0;
  v_m_targets integer := 0;
  v_m_opened integer := 0;
  v_m_same integer := 0;
  v_m_already integer := 0;
begin
  if v_url !~* '^https?://[^[:space:]]+$' then
    raise exception '원문 주소는 http(s) 주소입니다' using errcode = 'check_violation';
  end if;
  if v_hash !~ '^sha256:[0-9a-f]{64}$' then
    raise exception '원문 해시는 sha256:<64자리>입니다' using errcode = 'check_violation';
  end if;
  if length(btrim(coalesce(p_actor, ''))) = 0 then
    raise exception '원문을 다시 받은 사람이 필요합니다' using errcode = 'check_violation';
  end if;

  select s.id into v_snap from public.raw_snapshots s where s.url = v_url and lower(s.content_hash) = v_hash order by s.fetched_at desc, s.id desc limit 1;
  if v_snap is null then
    insert into public.raw_snapshots (source, url, content_hash, payload)
    values (coalesce(nullif(btrim(p_source), ''), '공식 자료 다시 받기'), v_url, v_hash, coalesce(p_payload, ''))
    returning id into v_snap;
  end if;

  for v_row in
    select s.id, s.article_id, r.content_hash as old_hash
      from public.article_sources s
      join public.articles a on a.id = s.article_id
      left join public.raw_snapshots r on r.id = s.snapshot_id
     where s.kind in ('official_doc', 'dataset')
       and btrim(coalesce(s.source_url, '')) = v_url
       and a.status <> 'deleted'
       and not exists (select 1 from public.article_sources n where n.supersedes_id = s.id)
     order by s.id
  loop
    v_targets := v_targets + 1;
    if v_row.old_hash is null then
      v_nosnap := v_nosnap + 1;
    elsif regexp_replace(lower(v_row.old_hash), '^sha256:', '') = regexp_replace(v_hash, '^sha256:', '') then
      v_same := v_same + 1;
    else
      insert into public.source_review_queue (target_type, target_id, article_id, reason, old_hash, new_hash, new_snapshot_id, opened_by)
      values ('article_source', v_row.id, v_row.article_id, 'snapshot_changed', v_row.old_hash, v_hash, v_snap, btrim(p_actor))
      on conflict do nothing;
      get diagnostics v_rc = row_count;
      if v_rc > 0 then v_opened := v_opened + 1; else v_already := v_already + 1; end if;
    end if;
  end loop;

  -- 프로젝트 단계 기록 (W4 12단계 — PR-03 '원본을 다시 받아 스냅샷 해시가 다르면 검수 큐 1건과 해당 단계 검토 중')
  for v_row in
    select e.id, r.content_hash as old_hash
      from public.project_events e
      join public.raw_snapshots r on r.id = e.snapshot_id
     where e.stage is not null and e.kind <> 'not_applicable'
       and btrim(coalesce(e.source_url, '')) = v_url
       and not exists (select 1 from public.project_events c where c.correction_of = e.id)
     order by e.id
  loop
    v_p_targets := v_p_targets + 1;
    if regexp_replace(lower(v_row.old_hash), '^sha256:', '') = regexp_replace(v_hash, '^sha256:', '') then
      v_p_same := v_p_same + 1;
    else
      insert into public.source_review_queue (target_type, target_id, article_id, reason, old_hash, new_hash, new_snapshot_id, opened_by)
      values ('project_event', v_row.id, null, 'snapshot_changed', v_row.old_hash, v_hash, v_snap, btrim(p_actor))
      on conflict do nothing;
      get diagnostics v_rc = row_count;
      if v_rc > 0 then v_p_opened := v_p_opened + 1; else v_p_already := v_p_already + 1; end if;
    end if;
  end loop;

  -- 개발방법 사실 행 (W4 18단계 — PR-10 '사실 행이 근거로 쓴 원문 스냅샷의 해시가 바뀌면 그 행마다 검수 큐 1건'). 대체되지 않은 최신 판만
  for v_row in
    select f.id, r.content_hash as old_hash
      from public.dev_method_facts f
      join public.raw_snapshots r on r.id = f.snapshot_id
     where btrim(f.source_url) = v_url
       and not exists (select 1 from public.dev_method_facts n where n.supersedes_id = f.id)
     order by f.id
  loop
    v_m_targets := v_m_targets + 1;
    if regexp_replace(lower(v_row.old_hash), '^sha256:', '') = regexp_replace(v_hash, '^sha256:', '') then
      v_m_same := v_m_same + 1;
    else
      insert into public.source_review_queue (target_type, target_id, article_id, reason, old_hash, new_hash, new_snapshot_id, opened_by)
      values ('dev_method_fact', v_row.id, null, 'snapshot_changed', v_row.old_hash, v_hash, v_snap, btrim(p_actor))
      on conflict do nothing;
      get diagnostics v_rc = row_count;
      if v_rc > 0 then v_m_opened := v_m_opened + 1; else v_m_already := v_m_already + 1; end if;
    end if;
  end loop;

  return jsonb_build_object('snapshotId', v_snap, 'targets', v_targets, 'opened', v_opened, 'unchanged', v_same, 'alreadyQueued', v_already, 'noSnapshot', v_nosnap,
    'projectTargets', v_p_targets, 'projectOpened', v_p_opened, 'projectUnchanged', v_p_same, 'projectAlreadyQueued', v_p_already,
    'methodTargets', v_m_targets, 'methodOpened', v_m_opened, 'methodUnchanged', v_m_same, 'methodAlreadyQueued', v_m_already);
end;
$$;
revoke all on function public.source_snapshot_refetched(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.source_snapshot_refetched(text, text, text, text, text) to service_role;
