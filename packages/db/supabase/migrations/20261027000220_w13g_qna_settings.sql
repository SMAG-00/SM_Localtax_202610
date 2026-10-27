-- W13-g g8 — 라운지 설정 검사와 켜기 조건 (PRD-05 QNA-06 · 08, EXP-01, docs/dev/W13-g_설계.md 5장)
-- · qna_neutrality_notice - 중립성 고지·답변 하단 고지·약관 문구 자리. PO·법률 검토본만 넣는다 (씨앗은 비어 있고 미승인, AI 작성 0).
--   승인에는 버전·문구·답변 하단 고지·검토자·검토일이 모두 필요하다. 승인 전에는 기능 키 qna를 켜지 못한다 (라운지 공개 0).
-- · qna_gov_domains - 인증 공무원 메일 도메인 목록 (씨앗 go.kr 하나 - 하위 도메인까지, PO 결정 #20. 통합 메일 도메인은 [확인 필요]).
-- · qna_criteria 모양 - { window_days(1~365), min_accepted(0 이상), min_rate(0~1), strip_size(3~5) } 전부 선택. 비어 있으면 띠는 비어 있다.
-- · qna_detect_dictionary 모양 - { contact_terms: [글자], consult_terms: [글자] } 각 1~40자 100개 이하. 법률 검토 전에는 비어 있다.
-- · 기능 키 account_links는 별도 조건이 없다(관리자만 쓰는 화면, 기본 꺼짐).

insert into public.settings (key, value, description, updated_by) values
  ('qna_neutrality_notice',
   jsonb_build_object('version', '', 'text', '', 'answer_footer', '', 'approved', false, 'reviewed_by', null, 'reviewed_on', null),
   '라운지 중립성 고지 (QNA-06) - 라운지 목록·질문 작성·상세 3개 화면과 답변 하단 고지. PO·법률 검토본만 넣는다. approved=true는 version·text·answer_footer·reviewed_by·reviewed_on이 모두 있어야 하고, 승인 전에는 기능 키 qna를 켜지 못한다. 씨앗은 비어 있다',
   'migration:20261027000220'),
  ('qna_gov_domains',
   '{"domains": ["go.kr"]}'::jsonb,
   '인증 공무원 메일 도메인 (EXP-01 - PO 결정 #20) - 정확히 일치하거나 그 하위 도메인일 때만 인정한다. 통합 메일 도메인은 PO 확인 뒤 더한다 [확인 필요]',
   'migration:20261027000220')
on conflict (key) do nothing;

create function public.qna_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  k text;
begin
  if new.key = 'qna_neutrality_notice' then
    if jsonb_typeof(new.value) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(new.value) x where x not in ('version', 'text', 'answer_footer', 'approved', 'reviewed_by', 'reviewed_on'))
       or jsonb_typeof(new.value -> 'version') is distinct from 'string'
       or jsonb_typeof(new.value -> 'text') is distinct from 'string'
       or jsonb_typeof(new.value -> 'answer_footer') is distinct from 'string'
       or jsonb_typeof(new.value -> 'approved') is distinct from 'boolean'
       or char_length(new.value ->> 'text') > 600
       or char_length(new.value ->> 'answer_footer') > 300 then
      raise exception '라운지 중립성 고지(qna_neutrality_notice)는 { version, text(600자 이하), answer_footer(300자 이하), approved, reviewed_by, reviewed_on }입니다' using errcode = 'check_violation';
    end if;
    if (new.value -> 'approved') = 'true'::jsonb
       and (char_length(btrim(new.value ->> 'version')) = 0 or char_length(btrim(new.value ->> 'text')) = 0
            or char_length(btrim(new.value ->> 'answer_footer')) = 0
            or char_length(btrim(coalesce(new.value ->> 'reviewed_by', ''))) = 0
            or coalesce(new.value ->> 'reviewed_on', '') !~ '^\d{4}-\d{2}-\d{2}$') then
      raise exception '라운지 중립성 고지 승인에는 법률 검토본 버전·문구·답변 하단 고지·검토자·검토일이 모두 필요합니다 (QNA-06)' using errcode = 'check_violation';
    end if;
  elsif new.key = 'qna_gov_domains' then
    if jsonb_typeof(new.value) is distinct from 'object' or jsonb_typeof(new.value -> 'domains') is distinct from 'array'
       or exists (select 1 from jsonb_object_keys(new.value) x where x <> 'domains') then
      raise exception '공무원 인증 도메인(qna_gov_domains)은 { domains: [도메인] }입니다' using errcode = 'check_violation';
    end if;
    for v_item in select x.value from jsonb_array_elements(new.value -> 'domains') as x loop
      if jsonb_typeof(v_item) is distinct from 'string' or (v_item #>> '{}') !~ '^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$' then
        raise exception '공무원 인증 도메인은 소문자 도메인 이름이어야 합니다 (예: 점으로 이어진 두 칸 이상)' using errcode = 'check_violation';
      end if;
    end loop;
  elsif new.key = 'qna_criteria' then
    if jsonb_typeof(new.value) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(new.value) x where x not in ('window_days', 'min_accepted', 'min_rate', 'strip_size')) then
      raise exception '활동 전문가 기준(qna_criteria)은 { window_days, min_accepted, min_rate, strip_size }입니다' using errcode = 'check_violation';
    end if;
    foreach k in array array['window_days', 'min_accepted', 'strip_size'] loop
      if new.value ? k and (jsonb_typeof(new.value -> k) is distinct from 'number' or (new.value ->> k) !~ '^\d+$') then
        raise exception '활동 전문가 기준 %는 0 이상의 정수입니다', k using errcode = 'check_violation';
      end if;
    end loop;
    if new.value ? 'window_days' and (new.value ->> 'window_days')::integer not between 1 and 365 then
      raise exception '활동 전문가 기준 window_days는 1~365입니다' using errcode = 'check_violation';
    end if;
    if new.value ? 'strip_size' and (new.value ->> 'strip_size')::integer not between 3 and 5 then
      raise exception '활동 전문가 기준 strip_size는 3~5입니다 (QNA-08)' using errcode = 'check_violation';
    end if;
    if new.value ? 'min_rate' and (jsonb_typeof(new.value -> 'min_rate') is distinct from 'number' or (new.value ->> 'min_rate')::numeric not between 0 and 1) then
      raise exception '활동 전문가 기준 min_rate는 0~1 사이 숫자입니다' using errcode = 'check_violation';
    end if;
  elsif new.key = 'qna_detect_dictionary' then
    if jsonb_typeof(new.value) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(new.value) x where x not in ('contact_terms', 'consult_terms')) then
      raise exception '라운지 검출 사전(qna_detect_dictionary)은 { contact_terms, consult_terms }입니다' using errcode = 'check_violation';
    end if;
    foreach k in array array['contact_terms', 'consult_terms'] loop
      if new.value ? k then
        if jsonb_typeof(new.value -> k) is distinct from 'array' or jsonb_array_length(new.value -> k) > 100 then
          raise exception '라운지 검출 사전 %는 100개 이하의 글자 배열입니다', k using errcode = 'check_violation';
        end if;
        for v_item in select x.value from jsonb_array_elements(new.value -> k) as x loop
          if jsonb_typeof(v_item) is distinct from 'string' or char_length(btrim(v_item #>> '{}')) not between 1 and 40 then
            raise exception '라운지 검출 사전의 값은 1~40자 글자여야 합니다' using errcode = 'check_violation';
          end if;
        end loop;
      end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.qna_settings_guard() from public, anon, authenticated;
create trigger settings_qna_settings_guard
  before insert or update on public.settings
  for each row when (new.key in ('qna_neutrality_notice', 'qna_gov_domains', 'qna_criteria', 'qna_detect_dictionary'))
  execute function public.qna_settings_guard();

-- 라운지 켜기 - 중립성 고지가 법률 검토본으로 승인돼 있어야 한다 (QNA-06: 법률 검토 전 공개 0)
create function public.qna_flag_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notice jsonb;
begin
  if jsonb_typeof(new.value) = 'object' and (new.value -> 'qna') = 'true'::jsonb
     and (tg_op = 'INSERT' or jsonb_typeof(old.value) is distinct from 'object' or (old.value -> 'qna') is distinct from 'true'::jsonb) then
    select s.value into v_notice from public.settings s where s.key = 'qna_neutrality_notice';
    if jsonb_typeof(v_notice) is distinct from 'object' or (v_notice -> 'approved') is distinct from 'true'::jsonb then
      raise exception '라운지(qna)는 설정 qna_neutrality_notice에 법률 검토본 중립성 고지 승인이 있어야 켭니다 (QNA-06)' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.qna_flag_guard() from public, anon, authenticated;
create trigger settings_qna_flag_guard
  before insert or update on public.settings
  for each row when (new.key = 'feature_flags')
  execute function public.qna_flag_guard();

-- 공개 고지 - 승인된 법률 검토본만 (3개 화면과 답변 하단이 이 뷰를 읽는다)
create view public.public_qna_notice as
select n.value ->> 'version' as version, n.value ->> 'text' as text, n.value ->> 'answer_footer' as answer_footer
  from public.settings n
 where n.key = 'qna_neutrality_notice' and (n.value -> 'approved') = 'true'::jsonb
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'qna') = 'true'::jsonb);
revoke all on table public.public_qna_notice from public, anon, authenticated;
grant select on table public.public_qna_notice to anon, authenticated, service_role;

-- 공개 활동 기준 - 기준 페이지(/qna/criteria)가 읽는다. 값은 설정 그대로
create view public.public_qna_criteria as
select s.value as criteria
  from public.settings s
 where s.key = 'qna_criteria' and (exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'qna') = 'true'::jsonb)
        and exists (select 1 from public.settings n where n.key = 'qna_neutrality_notice' and (n.value -> 'approved') = 'true'::jsonb));
revoke all on table public.public_qna_criteria from public, anon, authenticated;
grant select on table public.public_qna_criteria to anon, authenticated, service_role;
