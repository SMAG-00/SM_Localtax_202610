-- W12-g g3 - 보안 정책 페이지 항목·통제 자가 점검 (PRD-04 SEC-01, docs/dev/W12-g_설계.md 1장·3장)
-- 이 파일에 보안 정책 문구·취약점 신고 연락처·통제 항목 내용은 없다 (모두 PO 입력, 씨앗 0행).
-- · security_policy_items - 7개 항목(데이터 위치·암호화·접근 통제·AI 제공사 데이터 정책·계산 입력값 미저장·대화 보존·파기·취약점 신고 연락처). 버전마다 새 행, 내용 불변,
--   confirmed_on(마지막 확인일) NOT NULL. 게시·내림은 security_item_publish/retire 함수로만 (거부도 감사 1행). ai_provider_data는 계약 확인(contract_verified) 뒤에만 게시.
-- · security_text_violations() - 인증 단정 표현 문구 검사. 앱(apps/web/lib/security/items.ts CERT_CLAIM_PATTERNS)이 같은 목록이고 시험이 두 목록을 대조한다.
-- · security_control_checks / security_self_check_rounds - 통제 목록 자가 점검(추가만). 미흡(gap)에는 조치 계획·기한 필수, 회차 완료는 security_self_check_complete로만.
-- · 공개 뷰 public_security_items - 7개 항목이 모두 게시되고 자가 점검이 1회 이상 완료되고 기능 키 security_page가 켜졌을 때만 행이 나온다 (일부 공개 0).

create table public.security_policy_items (
  id bigint generated always as identity primary key,
  item_key text not null check (item_key in ('data_location', 'encryption', 'access_control', 'ai_provider_data', 'calc_input_not_stored', 'conversation_retention', 'vulnerability_contact')),
  version int not null check (version >= 1),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  confirmed_on date not null,
  contract_verified boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  drafted_by text not null check (length(btrim(drafted_by)) > 0),
  published_by text,
  published_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  unique (item_key, version),
  constraint security_items_publish_record check ((status = 'draft') = (published_by is null and published_at is null)),
  constraint security_items_retired_record check ((status = 'retired') = (retired_at is not null))
);
comment on table public.security_policy_items is '보안 정책 페이지 항목(SEC-01) - 키마다 게시본 1개, 버전은 새 행, 내용 불변. 본문은 PO 입력';
create unique index security_items_one_published on public.security_policy_items (item_key) where status = 'published';

create function public.security_no_delete() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '보안 정책 항목·점검 기록은 지우거나 고치지 못합니다 (% 거부) - 내리려면 retired로 바꾸고 새 버전을 적습니다', tg_op using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.security_no_delete() from public, anon, authenticated;

create function public.security_items_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception '보안 정책 항목은 초안(draft)으로만 만들 수 있습니다 - 게시는 security_item_publish 함수로만 합니다' using errcode = 'check_violation';
    end if;
    new.version := coalesce((select max(i.version) from public.security_policy_items i where i.item_key = new.item_key), 0) + 1;
    return new;
  end if;
  if new.item_key is distinct from old.item_key or new.version is distinct from old.version or new.body is distinct from old.body
     or new.confirmed_on is distinct from old.confirmed_on or new.contract_verified is distinct from old.contract_verified
     or new.drafted_by is distinct from old.drafted_by or new.created_at is distinct from old.created_at then
    raise exception '보안 정책 항목의 내용은 고칠 수 없습니다 - 새 버전을 적으세요' using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status or new.published_by is distinct from old.published_by or new.published_at is distinct from old.published_at
     or new.retired_at is distinct from old.retired_at then
    if coalesce(current_setting('ltr.security_gate', true), '') <> 'rpc' then
      raise exception '게시·내림 상태는 security_item_publish/security_item_retire 함수로만 바뀝니다' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.security_items_guard() from public, anon, authenticated;
create trigger security_items_guard before insert or update on public.security_policy_items for each row execute function public.security_items_guard();
create trigger security_items_no_delete before delete on public.security_policy_items for each row execute function public.security_no_delete();
create trigger security_items_no_truncate before truncate on public.security_policy_items for each statement execute function public.security_no_delete();

-- 인증 단정 표현 문구 검사 - 앱 CERT_CLAIM_PATTERNS와 같은 목록 (시험이 대조). 걸린 패턴 배열을 돌려준다 (없으면 빈 배열)
create function public.security_text_violations(p_text text) returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(p order by p), '{}'::text[])
    from unnest(array[
      '인증\s*(획득|취득|완료|보유)',
      '인증(을|은)?\s*받(은|았|아)',
      '인증된\s*보안',
      '27001[^.]{0,12}(준수|적합|부합)',
      '(100%|완벽|절대)[^.]{0,6}(안전|보안|보호)'
    ]) as p
   where coalesce(p_text, '') ~ p;
$$;
revoke all on function public.security_text_violations(text) from public, anon, authenticated;
grant execute on function public.security_text_violations(text) to service_role;

-- 통제 목록 자가 점검 (추가만). 같은 회차·통제에 다시 적으면 가장 큰 id가 현재 값
create table public.security_control_checks (
  id bigint generated always as identity primary key,
  round_no int not null check (round_no >= 1),
  control_key text not null check (control_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  control_title text not null check (char_length(btrim(control_title)) between 1 and 120),
  result text not null check (result in ('met', 'gap', 'na')),
  checked_on date not null,
  gap_plan text check (gap_plan is null or char_length(gap_plan) <= 1000),
  due_on date,
  checked_by text not null check (length(btrim(checked_by)) > 0),
  created_at timestamptz not null default now(),
  constraint security_checks_gap_plan check (result <> 'gap' or (char_length(btrim(coalesce(gap_plan, ''))) > 0 and due_on is not null))
);
comment on table public.security_control_checks is '통제 목록 자가 점검 기록(SEC-01) - 추가만, 미흡(gap)은 조치 계획·기한 필수. 통제 목록 내용은 PO 입력';
create index security_checks_round_idx on public.security_control_checks (round_no, control_key, id desc);

create table public.security_self_check_rounds (
  id bigint generated always as identity primary key,
  round_no int not null unique check (round_no >= 1),
  completed_on date not null,
  completed_by text not null check (length(btrim(completed_by)) > 0),
  controls int not null check (controls >= 1),
  gaps int not null check (gaps >= 0),
  created_at timestamptz not null default now()
);
comment on table public.security_self_check_rounds is '자가 점검 회차 완료 기록(SEC-01) - 1회 이상이어야 /security가 열린다. 추가만';

create function public.security_checks_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.security_self_check_rounds r where r.round_no = new.round_no) then
    raise exception '이미 완료된 점검 회차에는 더 적을 수 없습니다 - 다음 회차로 적으세요' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.security_checks_guard() from public, anon, authenticated;
create trigger security_checks_guard before insert on public.security_control_checks for each row execute function public.security_checks_guard();
create trigger security_checks_no_update_delete before update or delete on public.security_control_checks for each row execute function public.security_no_delete();
create trigger security_checks_no_truncate before truncate on public.security_control_checks for each statement execute function public.security_no_delete();
create trigger security_rounds_no_update_delete before update or delete on public.security_self_check_rounds for each row execute function public.security_no_delete();
create trigger security_rounds_no_truncate before truncate on public.security_self_check_rounds for each statement execute function public.security_no_delete();

-- 감사 - 게시·내림·점검 완료. 추가만, 거부도 1행
create table public.security_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  subject text not null check (subject in ('item', 'round')),
  target_id bigint not null,
  action text not null check (action in ('publish', 'retire', 'complete')),
  outcome text not null check (outcome in ('ok', 'refused')),
  code text not null check (length(btrim(code)) > 0),
  actor text not null check (length(btrim(actor)) > 0),
  detail text check (detail is null or char_length(detail) <= 500),
  constraint security_audit_ok_code check ((outcome = 'ok') = (code = 'ok'))
);
comment on table public.security_audit is '보안 정책 게시·내림·자가 점검 완료 감사 - 추가만, 거부도 1행(code가 사유)';
create index security_audit_target_idx on public.security_audit (subject, target_id, at desc);
create trigger security_audit_no_update_delete before update or delete on public.security_audit for each row execute function public.security_no_delete();
create trigger security_audit_no_truncate before truncate on public.security_audit for each statement execute function public.security_no_delete();

create function public.security_audit_write(p_subject text, p_target bigint, p_action text, p_ok boolean, p_code text, p_actor text, p_detail text) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.security_audit (subject, target_id, action, outcome, code, actor, detail)
  values (p_subject, p_target, p_action, case when p_ok then 'ok' else 'refused' end, p_code, coalesce(nullif(btrim(p_actor), ''), 'unknown'), left(p_detail, 500));
$$;
revoke all on function public.security_audit_write(text, bigint, text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.security_audit_write(text, bigint, text, boolean, text, text, text) to service_role;

-- 게시 - 초안만. 본문 있음·확인일이 오늘(서울) 이하·인증 단정 표현 0·AI 제공사 항목은 계약 확인. 같은 키의 이전 게시본은 retired
create function public.security_item_publish(p_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.security_policy_items;
  v_code text;
  v_msg text;
  v_hits text[];
begin
  select * into i from public.security_policy_items where id = p_id for update;
  if not found then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '게시자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif i.status <> 'draft' then
    v_code := 'not_draft'; v_msg := '초안만 게시할 수 있습니다';
  elsif char_length(btrim(i.body)) = 0 then
    v_code := 'body_empty'; v_msg := '본문이 비어 있습니다';
  elsif i.confirmed_on > (now() at time zone 'Asia/Seoul')::date then
    v_code := 'confirmed_future'; v_msg := '마지막 확인일이 오늘보다 뒤입니다';
  elsif i.item_key = 'ai_provider_data' and not i.contract_verified then
    v_code := 'contract_unverified'; v_msg := 'AI 제공사 데이터 조건은 계약 확인 뒤에만 게시할 수 있습니다';
  end if;
  if v_code is null then
    v_hits := public.security_text_violations(i.body);
    if cardinality(v_hits) > 0 then
      v_code := 'cert_claim'; v_msg := '인증을 받은 것으로 읽히는 표현이 있습니다 - 인증 취득 전에는 쓸 수 없습니다';
    end if;
  end if;
  if v_code is not null then
    perform public.security_audit_write('item', p_id, 'publish', false, v_code, p_actor, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.security_gate', 'rpc', true);
  update public.security_policy_items set status = 'retired', retired_at = now() where item_key = i.item_key and status = 'published';
  update public.security_policy_items set status = 'published', published_by = p_actor, published_at = now() where id = p_id;
  perform set_config('ltr.security_gate', '', true);
  perform public.security_audit_write('item', p_id, 'publish', true, 'ok', p_actor, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '게시했습니다');
end;
$$;

-- 내림 - 게시본만 (7개가 모자라면 /security가 닫힌다)
create function public.security_item_retire(p_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.security_policy_items;
  v_code text;
  v_msg text;
begin
  select * into i from public.security_policy_items where id = p_id for update;
  if not found then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '처리자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif i.status <> 'published' then
    v_code := 'not_published'; v_msg := '게시된 항목만 내릴 수 있습니다';
  end if;
  if v_code is not null then
    perform public.security_audit_write('item', p_id, 'retire', false, v_code, p_actor, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.security_gate', 'rpc', true);
  update public.security_policy_items set status = 'retired', retired_at = now() where id = p_id;
  perform set_config('ltr.security_gate', '', true);
  perform public.security_audit_write('item', p_id, 'retire', true, 'ok', p_actor, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '내렸습니다');
end;
$$;

-- 자가 점검 회차 완료 - 점검 행이 1건 이상, 미흡에는 조치 계획(제약이 이미 보장). 이미 완료한 회차는 거부
create function public.security_self_check_complete(p_round int, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_msg text;
  v_controls int;
  v_gaps int;
  v_id bigint;
begin
  if p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '완료자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif p_round is null or p_round < 1 then
    v_code := 'round_invalid'; v_msg := '회차 번호가 올바르지 않습니다';
  elsif exists (select 1 from public.security_self_check_rounds r where r.round_no = p_round) then
    v_code := 'already_complete'; v_msg := '이미 완료한 회차입니다';
  end if;
  if v_code is null then
    select count(*), count(*) filter (where x.result = 'gap') into v_controls, v_gaps
      from (select distinct on (c.control_key) c.result from public.security_control_checks c where c.round_no = p_round order by c.control_key, c.id desc) x;
    if v_controls = 0 then
      v_code := 'no_checks'; v_msg := '이 회차에 점검 기록이 없습니다';
    end if;
  end if;
  if v_code is not null then
    perform public.security_audit_write('round', coalesce(p_round, 0), 'complete', false, v_code, p_actor, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  insert into public.security_self_check_rounds (round_no, completed_on, completed_by, controls, gaps)
  values (p_round, (now() at time zone 'Asia/Seoul')::date, p_actor, v_controls, v_gaps) returning id into v_id;
  perform public.security_audit_write('round', v_id, 'complete', true, 'ok', p_actor, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '점검 회차를 완료했습니다');
end;
$$;
revoke all on function public.security_item_publish(bigint, text), public.security_item_retire(bigint, text), public.security_self_check_complete(int, text) from public, anon, authenticated;
grant execute on function public.security_item_publish(bigint, text), public.security_item_retire(bigint, text), public.security_self_check_complete(int, text) to service_role;

-- 권한 - 서버(service_role)는 읽기와 추가만. 게시·내림·완료는 함수만
alter table public.security_policy_items enable row level security;
alter table public.security_control_checks enable row level security;
alter table public.security_self_check_rounds enable row level security;
alter table public.security_audit enable row level security;
revoke all on table public.security_policy_items, public.security_control_checks, public.security_self_check_rounds, public.security_audit from anon, authenticated, service_role;
grant select, insert on table public.security_policy_items, public.security_control_checks, public.security_audit to service_role;
grant select on table public.security_self_check_rounds to service_role;

-- 공개 뷰 - 열림 조건 한 곳(public_security_gate), 항목, 점검 요약. 초안·게시자 계정·통제 내용·미흡 건수 칸 없음
create view public.public_security_gate as
select true as is_open
 where exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'security_page') = 'true'::jsonb)
   and (select count(distinct i.item_key) from public.security_policy_items i where i.status = 'published') = 7
   and exists (select 1 from public.security_self_check_rounds);

create view public.public_security_items as
select i.item_key, i.version, i.body, i.confirmed_on, i.published_at
  from public.security_policy_items i
 where i.status = 'published'
   and exists (select 1 from public.public_security_gate);

create view public.public_security_status as
select r.completed_on, r.controls
  from public.security_self_check_rounds r
 where exists (select 1 from public.public_security_gate)
 order by r.round_no desc
 limit 1;

revoke all on table public.public_security_gate, public.public_security_items, public.public_security_status from public, anon, authenticated, service_role;
grant select on table public.public_security_gate, public.public_security_items, public.public_security_status to anon, authenticated, service_role;
