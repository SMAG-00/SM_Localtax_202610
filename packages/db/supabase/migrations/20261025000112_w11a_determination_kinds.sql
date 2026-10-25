-- W11-a a3 - 판정표 종류 +7 · 상속/증여 행 분리 검사 · 요건 사전 (PRD-03 6장 · 7장 determination_tables · FAM-05 · PR-12, docs/dev/W11-a_설계.md 3장)
-- · determination_tables.kind에 house_count · trust_taxpayer · redevelopment_right · house_count_inheritance · house_count_gift · redevelopment_tax · trust_acquisition 을 더한다 (기존 refund · reduction 그대로).
--   종류 이름은 PRD-03 7장·4-I 목록을 그대로 쓴다 [결정 안건: 값 이름 - 3단계 설계 5장 #2]. 씨앗 0행 - 판정표 내용은 감수 입력이다.
-- · 상속과 증여는 다른 종류이고 같은 행을 나눠 쓰지 못한다 - 한쪽의 규칙(조건·결론, id 제외)이 다른 쪽의 퇴역하지 않은 판정표에 있으면 저장을 거부한다 (FAM-05).
-- · requirement_dictionary - 판정 도구의 질문 스키마(6장). 세 표(rulesets 등)와 같은 생애(draft -> reviewed -> active -> retired)를 따르고 서명·승인은 기존 rule_sign/rule_approve를 쓴다.
--   주제(topic)마다 활성 1행, 기준일별 버전. 필드 이름·필수 여부는 감수 입력이라 씨앗 0행. 기간·금액 기준은 이 표에 적지 않는다(룰셋 값).
-- · 이 파일에 세법 값·법령 문장은 없다.

alter table public.determination_tables drop constraint determination_tables_kind_check;
alter table public.determination_tables add constraint determination_tables_kind_check check (kind in (
  'refund', 'reduction',
  'house_count', 'trust_taxpayer', 'redevelopment_right', 'house_count_inheritance', 'house_count_gift', 'redevelopment_tax', 'trust_acquisition'));

create function public.determination_origin_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_other text;
begin
  if new.kind not in ('house_count_inheritance', 'house_count_gift') then
    return new;
  end if;
  v_other := case new.kind when 'house_count_inheritance' then 'house_count_gift' else 'house_count_inheritance' end;
  if exists (
    select 1
      from public.determination_tables o
     cross join lateral jsonb_array_elements(case when jsonb_typeof(o.body -> 'rules') = 'array' then o.body -> 'rules' else '[]'::jsonb end) orow
     cross join lateral jsonb_array_elements(case when jsonb_typeof(new.body -> 'rules') = 'array' then new.body -> 'rules' else '[]'::jsonb end) nrow
     where o.kind = v_other and o.status <> 'retired'
       and (orow - 'id' - 'label' - 'basis') = (nrow - 'id' - 'label' - 'basis')
  ) then
    raise exception '상속과 증여 판정표는 같은 행(조건·결론)을 나눠 쓸 수 없습니다 - 원인별로 따로 만드세요 (FAM-05)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.determination_origin_guard() from public, anon, authenticated;
create trigger determination_tables_origin_guard before insert on public.determination_tables for each row execute function public.determination_origin_guard();

-- 요건 사전 - 세 표와 같은 칸·같은 가드 트리거
create table public.requirement_dictionary (
  id bigint generated always as identity primary key,
  topic text not null check (topic ~ '^[a-z][a-z0-9_]{1,39}$'),
  version text not null check (version ~ '^[0-9]{4}\.[0-9]{2}$'),
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'active', 'retired')),
  body jsonb not null check (jsonb_typeof(body) = 'object' and body ? 'as_of' and jsonb_typeof(body -> 'fields') = 'array' and jsonb_array_length(body -> 'fields') <= 100),
  body_sha256 text not null,
  source_ref text not null check (char_length(btrim(source_ref)) between 1 and 200),
  basis_event_id bigint references public.amendment_events (id),
  basis_note text check (basis_note is null or char_length(basis_note) <= 300),
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  signed_by text,
  signed_at timestamptz,
  sheet_ref text check (sheet_ref is null or char_length(btrim(sheet_ref)) between 1 and 200),
  signed_body_sha256 text,
  activated_by text,
  activated_at timestamptz,
  retired_at timestamptz,
  unique (topic, version),
  constraint requirement_dictionary_basis_given check (basis_event_id is not null or char_length(btrim(coalesce(basis_note, ''))) > 0),
  constraint requirement_dictionary_signed_record check (
    status not in ('reviewed', 'active')
    or (signed_by is not null and signed_at is not null and sheet_ref is not null and signed_body_sha256 = body_sha256)),
  constraint requirement_dictionary_active_record check (status <> 'active' or (activated_by is not null and activated_at is not null)),
  constraint requirement_dictionary_draft_clean check (status <> 'draft' or (signed_by is null and signed_at is null and activated_by is null and activated_at is null))
);
comment on table public.requirement_dictionary is '요건 사전 (PRD-03 6장) - 판정 도구 질문 스키마. UI와 판정표가 같은 스키마를 읽는다. 필드·필수 여부는 감수 입력(AI 0), 기준일별 버전, 주제마다 활성 1행';
create unique index requirement_dictionary_one_active on public.requirement_dictionary (topic) where status = 'active';
create trigger requirement_dictionary_guard before insert or update on public.requirement_dictionary for each row execute function public.rule_versions_guard();
create trigger requirement_dictionary_no_delete before delete on public.requirement_dictionary for each row execute function public.rule_versions_no_delete();
create trigger requirement_dictionary_no_truncate before truncate on public.requirement_dictionary for each statement execute function public.rule_versions_no_delete();

alter table public.requirement_dictionary enable row level security;
revoke all on table public.requirement_dictionary from anon, authenticated, service_role;
grant select, insert on table public.requirement_dictionary to service_role;

-- 서명·승인 경로에 요건 사전을 더한다 (감사 종류 + 표 이름 + 주제별 활성 교체)
alter table public.rules_audit drop constraint rules_audit_kind_check;
alter table public.rules_audit add constraint rules_audit_kind_check check (kind in ('ruleset', 'determination_table', 'tax_calendar', 'requirement_dictionary'));

create or replace function public.rules_kind_table(p_kind text) returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind when 'ruleset' then 'rulesets' when 'determination_table' then 'determination_tables' when 'tax_calendar' then 'tax_calendar'
                     when 'requirement_dictionary' then 'requirement_dictionary' end;
$$;

-- 승인 함수는 83번 본문 그대로 두고, 이전 활성본 교체 줄에 '주제별'만 더했다
create or replace function public.rule_approve(p_kind text, p_id bigint, p_approver text, p_impact jsonb default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table text := public.rules_kind_table(p_kind);
  v_row jsonb;
  v_basis bigint;
  v_ev record;
  v_code text;
  v_msg text;
begin
  if v_table is null then
    raise exception '알 수 없는 종류입니다' using errcode = 'invalid_parameter_value';
  end if;
  execute format('select to_jsonb(t) from public.%I t where id = $1 for update', v_table) into v_row using p_id;
  v_basis := nullif(v_row ->> 'basis_event_id', '')::bigint;
  if v_row is null then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif p_approver is null or p_approver !~ '^(user|admin):.+' then
    v_code := 'approver_invalid'; v_msg := '승인자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif v_row ->> 'status' = 'active' then
    v_code := 'already_active'; v_msg := '이미 활성입니다';
  elsif v_row ->> 'status' = 'retired' then
    v_code := 'retired'; v_msg := '내려간 버전은 다시 활성화할 수 없습니다 - 새 차수를 만드세요';
  elsif v_row ->> 'status' <> 'reviewed' or v_row ->> 'signed_at' is null then
    v_code := 'not_signed'; v_msg := '감수 서명이 없는 버전은 승인할 수 없습니다 (RULE-02·04)';
  elsif v_row ->> 'signed_body_sha256' is distinct from v_row ->> 'body_sha256' then
    v_code := 'signature_stale'; v_msg := '서명한 본문과 지금 본문이 다릅니다';
  elsif v_basis is null and char_length(btrim(coalesce(v_row ->> 'basis_note', ''))) = 0 then
    v_code := 'basis_missing'; v_msg := '근거 개정도 사유 글도 없습니다';
  end if;
  if v_code is null and v_basis is not null then
    select e.stage, e.skipped, exists (select 1 from public.amendment_events c where c.correction_of = e.id) as corrected
      into v_ev from public.amendment_events e where e.id = v_basis;
    if not found then
      v_code := 'basis_not_found'; v_msg := '근거 개정 기록이 없습니다';
    elsif v_ev.skipped then
      v_code := 'basis_skipped'; v_msg := '근거 기록이 ''해당 없음'' 단계입니다';
    elsif v_ev.corrected then
      v_code := 'basis_corrected'; v_msg := '근거 기록이 정정으로 대체되었습니다 - 정정 기록을 근거로 다시 만드세요';
    elsif v_ev.stage not in ('promulgated', 'effective') then
      v_code := 'basis_stage'; v_msg := '근거 개정의 단계가 공포 또는 시행이 아니라 반영할 수 없습니다 (TX-05)';
    end if;
  end if;
  if v_code is not null then
    perform public.rules_audit_write(p_kind, p_id, v_row ->> 'version', 'approve', false, v_code, p_approver, v_basis, p_impact, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.rules_gate', 'rpc', true);
  if p_kind = 'determination_table' then
    execute format('update public.%I set status = ''retired'', retired_at = now() where status = ''active'' and id <> $1 and kind = $2', v_table) using p_id, v_row ->> 'kind';
  elsif p_kind = 'requirement_dictionary' then
    execute format('update public.%I set status = ''retired'', retired_at = now() where status = ''active'' and id <> $1 and topic = $2', v_table) using p_id, v_row ->> 'topic';
  else
    execute format('update public.%I set status = ''retired'', retired_at = now() where status = ''active'' and id <> $1', v_table) using p_id;
  end if;
  execute format('update public.%I set status = ''active'', activated_by = $2, activated_at = now() where id = $1', v_table) using p_id, p_approver;
  perform set_config('ltr.rules_gate', '', true);
  perform public.rules_audit_write(p_kind, p_id, v_row ->> 'version', 'approve', true, 'ok', p_approver, v_basis, p_impact, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '활성화했습니다');
end;
$$;

create function public.sign_requirement_dictionary(p_id bigint, p_signer text, p_sheet_ref text, p_impact jsonb default null) returns jsonb
language sql security definer set search_path = '' as $$ select public.rule_sign('requirement_dictionary', p_id, p_signer, p_sheet_ref, p_impact); $$;
create function public.approve_requirement_dictionary(p_id bigint, p_approver text, p_impact jsonb default null) returns jsonb
language sql security definer set search_path = '' as $$ select public.rule_approve('requirement_dictionary', p_id, p_approver, p_impact); $$;
revoke all on function public.sign_requirement_dictionary(bigint, text, text, jsonb), public.approve_requirement_dictionary(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.sign_requirement_dictionary(bigint, text, text, jsonb), public.approve_requirement_dictionary(bigint, text, jsonb) to service_role;
