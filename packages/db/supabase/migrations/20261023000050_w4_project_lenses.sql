-- W4 16단계 — 단계별 「지방세로 읽기」 (PRD-01B PR-08 · CORE-01 · TX-01, docs/dev/W4_설계.md 1장 16단계 · 2.1 project_stage_lens.review_status · 2.3 · 2.5 · 2.10 · 3장 · 7장 4 · 12장 #129~)
-- 이 파일에 실제 세무 문장·세목·세율·금액은 없다 — 문구는 편집국이 초안을 쓰고 세무 감수위원(PO)이 서명한다(7장 4). 씨앗 행 0.
-- · project_stage_lenses — 사업 유형 × 단계 템플릿 하나 (기본 키 (project_type, stage)). 그 유형을 쓰는 모든 프로젝트의 그 단계에 같은 박스가 붙는다.
--     lens = { topics: [관련 세목 1~5개], points: [핵심 포인트 1~3줄], links: [{ kind, label, url } 1~3개], base_date: "YYYY-MM-DD"(법령 기준일) }
--       — 기사 tax_lens(CORE-01)의 박스 칸과 같은 이름. 생략 사유는 없다(템플릿이 없는 단계 = 박스 0, '준비 중' 0).
--       링크 종류 explainer(해설) · book(도서) · expert(전문가) — 사이트 안 주소만. 계산기는 SM 취득세 카드(official_links — 주소를 적지 않는다)가 박스 옆에 붙는다.
--     저장 검사(트리거 project_stage_lenses_guard): 사업 유형·단계는 설정(project_types·project_stage_lists)에 있어야 하고 바꾸지 못한다 · 모양·한도 ·
--       세액 표현(숫자 + 원 — CORE-01) 거부 · 금지 표현 사전(forbidden_phrases — 감면 단정 등) 거부 · 숫자 + %는 저장 경고(raise warning — PR-05, 차단 아님).
--     서명: 내용(lens)을 고치면 서명을 지운다(서명된 적이 있으면 rereview_needed, 아니면 draft). 서명은 저장된 내용에만 — 내용과 새 서명을 한 번에 넣으면 거부.
--       서명자는 지금 세무 감수위원(staff_roles reviewer)이어야 한다. 상태는 서명(reviewed)으로만 바뀐다.
-- · 공개 뷰 public_project_stage_lenses (anon) — 서명이 살아 있고(서명자가 지금도 reviewer) 공개 프로젝트가 쓰는 유형의 단계 목록에 있는 템플릿만.
--     칸: 유형·단계·차례·세목·포인트·링크·기준일·서명 시각·서명자 공개 이름(people.staff_user_id — 공개 인물일 때만, 아니면 null). 작성자·서명자 계정 칸 0.
-- · 가격·분양가·분담금·수익률·시세 칸 0 (PR-05 — 가격 칸 검사 2.10 대상 표). 기존 표·칸·제약·값은 바꾸지 않는다.

create table public.project_stage_lenses (
  project_type text not null check (project_type ~ '^[a-z][a-z0-9_]{1,39}$'),
  stage text not null check (stage ~ '^[a-z][a-z0-9_]{1,39}$'),
  lens jsonb not null,
  drafted_by text not null check (length(btrim(drafted_by)) > 0),
  drafted_at timestamptz not null default now(),
  reviewed_by text,
  reviewed_at timestamptz,
  review_status text not null default 'draft' check (review_status in ('draft', 'reviewed', 'rereview_needed')),
  primary key (project_type, stage),
  constraint project_stage_lenses_signature check (
    (reviewed_by is null) = (reviewed_at is null)
    and (review_status = 'reviewed') = (reviewed_by is not null))
);

comment on table public.project_stage_lenses is '단계별 「지방세로 읽기」 템플릿 (PR-08) — 사업 유형 × 단계 하나. 편집국 초안 → 세무 감수위원 서명 뒤에만 공개. 내용을 고치면 서명을 지운다(재감수 필요)';
comment on column public.project_stage_lenses.lens is '박스 내용 { topics, points, links, base_date } — 기사 tax_lens(CORE-01)와 같은 칸 이름. 세액 표현·감면 단정 거부';
comment on column public.project_stage_lenses.drafted_by is '초안을 저장한 사람 (user:<id>)';
comment on column public.project_stage_lenses.reviewed_by is '세무 감수 서명자 (user:<id> — 서명할 때 reviewer 역할). 내용을 고치면 지워진다';
comment on column public.project_stage_lenses.review_status is 'draft(서명 전) · reviewed(서명됨 — 공개) · rereview_needed(서명 뒤 고침 — 다시 서명해야 공개)';

-- 세액 표현 — 숫자(쉼표·소수) + (십·백·천·만·억·조) + 원. 뒤가 원칙·원리·원본·원문·원장·원소·원형·원점이면 금액이 아니다.
-- @ltr/editorial TAX_AMOUNT(CORE-01 박스 검사 pointLineProblems)와 같은 식 — 시험이 같은 견본으로 둘을 본다
create function public.lens_text_has_tax_amount(p_text text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_text, '') ~ '[0-9][0-9,]*(\.[0-9]+)?[[:space:]]*([십백천만억조][[:space:]]*)*원(?![칙리본문장소형점])';
$$;
revoke all on function public.lens_text_has_tax_amount(text) from public, anon, authenticated;
grant execute on function public.lens_text_has_tax_amount(text) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 저장 검사 — 유형·단계 · 모양·한도 · 세액 표현·금지 표현 · 서명 흐름
-- ─────────────────────────────────────────────────────────────
create function public.project_stage_lenses_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_where text := new.project_type || ' · ' || new.stage;
  v_lens jsonb := new.lens;
  v_lists jsonb;
  v_types jsonb;
  v_phrases text[];
  v_item jsonb;
  v_text text;
  v_texts text[] := '{}';
  v_kinds text[] := '{}';
  v_seen text[] := '{}';
  v_n integer;
  v_phrase text;
  v_uid text;
  v_content_changed boolean := tg_op = 'INSERT';
  v_new_signature boolean;
begin
  if tg_op = 'UPDATE' then
    if new.project_type is distinct from old.project_type or new.stage is distinct from old.stage then
      raise exception '「지방세로 읽기」 템플릿의 사업 유형·단계(%)는 바꿀 수 없습니다 — 새 템플릿을 만드세요', old.project_type || ' · ' || old.stage using errcode = 'check_violation';
    end if;
    v_content_changed := new.lens is distinct from old.lens;
  end if;

  if tg_op = 'INSERT' then
    select s.value into v_types from public.settings s where s.key = 'project_types';
    select s.value into v_lists from public.settings s where s.key = 'project_stage_lists';
    if jsonb_typeof(v_types) is distinct from 'object' or not (v_types ? new.project_type) then
      raise exception '사업 유형 %가 project_types에 없습니다 — 사업 유형·단계 목록을 먼저 넣으세요', new.project_type using errcode = 'check_violation';
    end if;
    if public.project_stage_position(v_lists, new.project_type, new.stage) is null then
      raise exception '단계 %는 사업 유형 %의 단계 목록(project_stage_lists)에 없습니다', new.stage, new.project_type using errcode = 'check_violation';
    end if;
  end if;

  if v_content_changed then
    -- 모양 — 칸 4개만
    if jsonb_typeof(v_lens) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(v_lens) k) is distinct from array['base_date', 'links', 'points', 'topics'] then
      raise exception '「지방세로 읽기」(%)는 { topics, points, links, base_date } 네 칸입니다', v_where using errcode = 'check_violation';
    end if;
    -- 관련 세목 1~5개, 1~20자, 같은 세목 두 번 0
    if jsonb_typeof(v_lens -> 'topics') is distinct from 'array' or jsonb_array_length(v_lens -> 'topics') not between 1 and 5 then
      raise exception '「지방세로 읽기」(%) — 관련 세목은 1~5개입니다', v_where using errcode = 'check_violation';
    end if;
    for v_item in select x.value from jsonb_array_elements(v_lens -> 'topics') x loop
      if jsonb_typeof(v_item) is distinct from 'string' or char_length(btrim(v_item #>> '{}')) not between 1 and 20 then
        raise exception '「지방세로 읽기」(%) — 관련 세목은 1~20자 글자입니다', v_where using errcode = 'check_violation';
      end if;
      if btrim(v_item #>> '{}') = any (v_seen) then
        raise exception '「지방세로 읽기」(%) — 관련 세목 %가 두 번 있습니다', v_where, btrim(v_item #>> '{}') using errcode = 'check_violation';
      end if;
      v_seen := v_seen || btrim(v_item #>> '{}');
      v_texts := v_texts || (v_item #>> '{}');
    end loop;
    -- 핵심 포인트 1~3줄 (0줄·4줄 저장 거부 — CORE-01), 줄마다 1~120자
    if jsonb_typeof(v_lens -> 'points') is distinct from 'array' then
      raise exception '「지방세로 읽기」(%) — 핵심 포인트는 줄 목록입니다', v_where using errcode = 'check_violation';
    end if;
    v_n := jsonb_array_length(v_lens -> 'points');
    if v_n < 1 or v_n > 3 then
      raise exception '「지방세로 읽기」(%) — 핵심 포인트는 1~3줄입니다 (지금 %줄)', v_where, v_n using errcode = 'check_violation';
    end if;
    for v_item in select x.value from jsonb_array_elements(v_lens -> 'points') x loop
      if jsonb_typeof(v_item) is distinct from 'string' or char_length(btrim(v_item #>> '{}')) not between 1 and 120 then
        raise exception '「지방세로 읽기」(%) — 핵심 포인트 줄은 1~120자 글자입니다 (빈 줄 0)', v_where using errcode = 'check_violation';
      end if;
      v_texts := v_texts || (v_item #>> '{}');
    end loop;
    -- 링크 1~3개 — 종류 explainer·book·expert 한 번씩, 이름 1~40자, 사이트 안 주소(/로 시작, // 아님, 공백·조각 0, 300자까지)
    if jsonb_typeof(v_lens -> 'links') is distinct from 'array' or jsonb_array_length(v_lens -> 'links') not between 1 and 3 then
      raise exception '「지방세로 읽기」(%) — 해설·도서·전문가 링크는 1~3개입니다 (링크 0개 저장 거부)', v_where using errcode = 'check_violation';
    end if;
    for v_item in select x.value from jsonb_array_elements(v_lens -> 'links') x loop
      if jsonb_typeof(v_item) is distinct from 'object'
         or (select array_agg(k order by k) from jsonb_object_keys(v_item) k) is distinct from array['kind', 'label', 'url']
         or coalesce(v_item ->> 'kind', '') not in ('explainer', 'book', 'expert')
         or jsonb_typeof(v_item -> 'label') is distinct from 'string' or char_length(btrim(v_item ->> 'label')) not between 1 and 40
         or jsonb_typeof(v_item -> 'url') is distinct from 'string' or char_length(v_item ->> 'url') > 300
         or (v_item ->> 'url') !~ '^/[^/[:space:]#][^[:space:]#]*$' then
        raise exception '「지방세로 읽기」(%) — 링크는 { kind: explainer·book·expert, label: 1~40자, url: 사이트 안 주소 } 입니다 (계산기는 SM 취득세 카드가 붙습니다)', v_where
          using errcode = 'check_violation';
      end if;
      if (v_item ->> 'kind') = any (v_kinds) then
        raise exception '「지방세로 읽기」(%) — 링크 종류 %가 두 번 있습니다 (종류마다 하나)', v_where, v_item ->> 'kind' using errcode = 'check_violation';
      end if;
      v_kinds := v_kinds || (v_item ->> 'kind');
      v_texts := v_texts || (v_item ->> 'label');
    end loop;
    -- 법령 기준일 (실제 날짜)
    if jsonb_typeof(v_lens -> 'base_date') is distinct from 'string' or (v_lens ->> 'base_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception '「지방세로 읽기」(%) — 법령 기준일(base_date, YYYY-MM-DD)이 필요합니다', v_where using errcode = 'check_violation';
    end if;
    begin
      perform (v_lens ->> 'base_date')::date;
    exception when others then
      raise exception '「지방세로 읽기」(%) — 법령 기준일이 날짜가 아닙니다', v_where using errcode = 'check_violation';
    end;
    -- 세액 표현(숫자 + 원) 거부 · 금지 표현(감면 단정 등) 거부 · 숫자 + % 경고
    foreach v_text in array v_texts loop
      if public.lens_text_has_tax_amount(normalize(v_text, NFC)) then
        raise exception '「지방세로 읽기」(%)에는 세액을 쓰지 않습니다 — 숫자 + 원 표현을 빼 주세요 (CORE-01)', v_where using errcode = 'check_violation';
      end if;
    end loop;
    select array_agg(btrim(regexp_replace(normalize(p, NFC), '[[:space:]]+', ' ', 'g')))
      into v_phrases
      from jsonb_array_elements_text(coalesce((select s.value -> 'phrases' from public.settings s where s.key = 'forbidden_phrases' and jsonb_typeof(s.value -> 'phrases') = 'array'), '[]'::jsonb)) p
     where btrim(p) <> '';
    foreach v_text in array v_texts loop
      foreach v_phrase in array coalesce(v_phrases, '{}') loop
        if position(v_phrase in btrim(regexp_replace(normalize(v_text, NFC), '[[:space:]]+', ' ', 'g'))) > 0 then
          raise exception '「지방세로 읽기」(%)에 금지 표현 ''%'' — 감면 해당 여부를 단정하지 않습니다 (CORE-01 · UX-01)', v_where, v_phrase using errcode = 'check_violation';
        end if;
      end loop;
    end loop;
    if exists (select 1 from unnest(v_texts) t where public.project_note_has_amount(t)) then
      raise warning '「지방세로 읽기」(%)에 숫자와 %% 표현이 있습니다 — 저장은 됩니다. 세율·비율은 감수된 기사에서만 씁니다 (PR-05)', v_where;
    end if;
  end if;

  -- 서명 흐름
  if tg_op = 'INSERT' then
    if new.reviewed_by is not null or new.review_status <> 'draft' then
      raise exception '「지방세로 읽기」(%) — 서명은 저장된 초안에만 합니다 (새 템플릿은 초안)', v_where using errcode = 'check_violation';
    end if;
    return new;
  end if;

  v_new_signature := new.reviewed_by is not null and new.reviewed_by is distinct from old.reviewed_by;
  if v_content_changed then
    if v_new_signature then
      raise exception '「지방세로 읽기」(%) — 서명은 저장된 내용에만 합니다. 내용을 고치는 쓰기에 새 서명을 넣지 않습니다', v_where using errcode = 'check_violation';
    end if;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.review_status := case when old.review_status = 'draft' then 'draft' else 'rereview_needed' end;
    new.drafted_at := now();
    return new;
  end if;

  if v_new_signature then
    v_uid := substring(new.reviewed_by from '^user:([0-9a-fA-F-]{36})$');
    if v_uid is null or not exists (select 1 from public.staff_roles r where r.user_id::text = lower(v_uid) and r.role = 'reviewer') then
      raise exception '「지방세로 읽기」(%)의 감수 서명은 세무 감수위원(reviewer)만 합니다', v_where using errcode = 'check_violation';
    end if;
    new.reviewed_at := now();
    new.review_status := 'reviewed';
    return new;
  end if;

  if new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at or new.review_status is distinct from old.review_status then
    raise exception '「지방세로 읽기」(%) — 감수 상태는 서명으로만 바뀝니다 (내용을 고치면 서명이 지워집니다)', v_where using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.project_stage_lenses_guard() from public, anon, authenticated;
create trigger project_stage_lenses_guard
  before insert or update on public.project_stage_lenses
  for each row execute function public.project_stage_lenses_guard();

-- ─────────────────────────────────────────────────────────────
-- 권한·RLS — 표는 service_role만
-- ─────────────────────────────────────────────────────────────
alter table public.project_stage_lenses enable row level security;
revoke all on table public.project_stage_lenses from anon, authenticated, service_role;
grant select, insert, update, delete on table public.project_stage_lenses to service_role;

-- ─────────────────────────────────────────────────────────────
-- 공개 뷰 — 서명이 살아 있는 템플릿 (공개 프로젝트가 쓰는 유형의 단계 목록 안)
-- ─────────────────────────────────────────────────────────────
create view public.public_project_stage_lenses as
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
    order by pe.id limit 1) as reviewer_name
from public.project_stage_lenses l
join public.public_project_stage_lists sl on sl.project_type = l.project_type and sl.stage = l.stage
where l.review_status = 'reviewed'
  and l.reviewed_by is not null
  and exists (select 1 from public.staff_roles r where r.role = 'reviewer' and 'user:' || r.user_id::text = lower(l.reviewed_by));

comment on view public.public_project_stage_lenses is '단계별 「지방세로 읽기」 공개 (PR-08) — 서명이 살아 있고(서명자가 지금도 reviewer) 공개 프로젝트가 쓰는 유형의 단계 목록에 있는 템플릿만. 서명 전·재감수 필요는 0행. 작성자·서명자 계정 칸 0';
revoke all on table public.public_project_stage_lenses from public, anon, authenticated, service_role;
grant select on table public.public_project_stage_lenses to anon, authenticated, service_role;
