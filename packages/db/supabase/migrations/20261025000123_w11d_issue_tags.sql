-- W11-d d2 - 쟁점 태그 사전과 결정례·해석 태그 (PRD-03 7장 issue_tags · case_issue_tags, AIOPS-12 · TRU-05 · RDV-08, docs/dev/W11-d_설계.md 3장)
-- 이 파일에 쟁점 이름·태그 글자·법령 문장은 없다 (씨앗 0행). 쟁점 태그는 편집자가 제안하고 승인하는 감수 입력이다.
--
-- · issue_tags - 태그 사전. (tag_key, version) 하나에 1행. 새 태그와 이름 고침은 모두 새 버전 제안(proposed) -> 승인(approved)이고, 승인하면 같은 tag_key의 이전 승인본은 retired가 된다.
--   내용(이름·허브·동의어)은 만든 뒤 바꾸지 못한다. 상태는 issue_tag_approve()·issue_tag_retire() 안에서만 바뀐다 (service_role도 UPDATE 권한 없음).
-- · case_issue_tags - 결정례·해석(legal_docs) <-> 쟁점 태그. origin은 이 단계에서 editor뿐(4단계에서 ai 추가). 승인된 태그에만 붙일 수 있고, 승인(case_issue_tag_approve) 전에는 어떤 공개 뷰에도 나오지 않는다.
--   같은 결정례에 같은 tag_key 중복 0 (태그 버전이 달라도 하나). 태그를 폐기하면 연결 행은 이력으로 남고 공개 뷰에서만 빠진다.
-- · issue_audit - 태그·쟁점 지도(124)의 승인·서명·공개 감사. 추가만, 거부도 1행 (예외 대신 { ok, code, message }를 돌려줘야 감사 행이 거래에 남는다).
-- · 공개 뷰 public_issue_tags(승인본만) · public_case_issue_tags(승인된 연결 + 승인된 현재 태그 + 공개 가능한 결정례만). AI는 이 흐름에 없다.

create table public.issue_tags (
  id bigint generated always as identity primary key,
  tag_key text not null check (tag_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  version int not null check (version >= 1),
  label text not null check (char_length(btrim(label)) between 1 and 60),
  hub text not null check (hub in ('trust', 'redevelopment', 'inheritance_gift', 'local_tax')),
  synonyms text[] not null default '{}' check (cardinality(synonyms) <= 20),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'retired')),
  proposed_by text not null check (length(btrim(proposed_by)) > 0),
  approved_by text,
  approved_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tag_key, version),
  constraint issue_tags_approved_record check (status = 'proposed' or (approved_by is not null and approved_at is not null)),
  constraint issue_tags_proposed_clean check (status <> 'proposed' or (approved_by is null and approved_at is null and retired_at is null)),
  constraint issue_tags_retired_record check ((status = 'retired') = (retired_at is not null))
);
comment on table public.issue_tags is '쟁점 태그 사전 (AIOPS-12) - 버전마다 새 행, proposed -> approved -> retired. 키마다 승인본은 1개. 4단계 키워드 맵이 같은 사전을 쓴다';
create unique index issue_tags_one_approved on public.issue_tags (tag_key) where status = 'approved';

create function public.issue_no_delete() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '쟁점 태그·태그 연결·쟁점 지도는 지우지 못합니다 (% 거부) - 내리려면 retired로 바꿉니다', tg_op using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.issue_no_delete() from public, anon, authenticated;

create function public.issue_tags_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hub text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'proposed' then
      raise exception '쟁점 태그는 제안(proposed)으로만 만들 수 있습니다 - 승인은 issue_tag_approve 함수로만 합니다' using errcode = 'check_violation';
    end if;
    new.version := coalesce((select max(t.version) from public.issue_tags t where t.tag_key = new.tag_key), 0) + 1;
    select t.hub into v_hub from public.issue_tags t where t.tag_key = new.tag_key order by t.version desc limit 1;
    if v_hub is not null and v_hub <> new.hub then
      raise exception '같은 태그 키의 허브는 바꿀 수 없습니다 - 새 키로 제안하세요' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.tag_key is distinct from old.tag_key or new.version is distinct from old.version or new.label is distinct from old.label
     or new.hub is distinct from old.hub or new.synonyms is distinct from old.synonyms or new.proposed_by is distinct from old.proposed_by
     or new.created_at is distinct from old.created_at then
    raise exception '쟁점 태그의 내용은 고칠 수 없습니다 - 새 버전으로 제안하세요' using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at
     or new.retired_at is distinct from old.retired_at then
    if coalesce(current_setting('ltr.issue_gate', true), '') <> 'rpc' then
      raise exception '승인·폐기 상태는 issue_tag_approve/issue_tag_retire 함수로만 바뀝니다' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.issue_tags_guard() from public, anon, authenticated;
create trigger issue_tags_guard before insert or update on public.issue_tags for each row execute function public.issue_tags_guard();
create trigger issue_tags_no_delete before delete on public.issue_tags for each row execute function public.issue_no_delete();
create trigger issue_tags_no_truncate before truncate on public.issue_tags for each statement execute function public.issue_no_delete();

create table public.case_issue_tags (
  id bigint generated always as identity primary key,
  case_id bigint not null references public.legal_docs (id),
  issue_tag_id bigint not null references public.issue_tags (id),
  tag_key text not null,
  origin text not null default 'editor' check (origin in ('editor')),
  status text not null default 'proposed' check (status in ('proposed', 'approved')),
  applied_by text not null check (length(btrim(applied_by)) > 0),
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (case_id, issue_tag_id),
  unique (case_id, tag_key),
  constraint case_issue_tags_approved_record check ((status = 'approved') = (approved_by is not null and approved_at is not null))
);
comment on table public.case_issue_tags is '결정례·해석 <-> 쟁점 태그 (AIOPS-12) - 승인(approved)된 행만 TRU-05·RDV-08 목록과 쟁점 지도 후보에 쓴다. origin은 이 단계에서 editor뿐';
create index case_issue_tags_tag_idx on public.case_issue_tags (tag_key) where status = 'approved';

create function public.case_issue_tags_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.issue_tags;
begin
  if tg_op = 'INSERT' then
    select * into t from public.issue_tags where id = new.issue_tag_id;
    if not found or t.status <> 'approved' then
      raise exception '승인된 쟁점 태그만 결정례·해석에 붙일 수 있습니다' using errcode = 'check_violation';
    end if;
    if new.status <> 'proposed' then
      raise exception '결정례 태그는 제안(proposed)으로만 만들 수 있습니다 - 승인은 case_issue_tag_approve 함수로만 합니다' using errcode = 'check_violation';
    end if;
    new.tag_key := t.tag_key;
    return new;
  end if;
  if new.case_id is distinct from old.case_id or new.issue_tag_id is distinct from old.issue_tag_id or new.tag_key is distinct from old.tag_key
     or new.origin is distinct from old.origin or new.applied_by is distinct from old.applied_by or new.created_at is distinct from old.created_at then
    raise exception '결정례 태그의 대상·태그는 고칠 수 없습니다' using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
    if coalesce(current_setting('ltr.issue_gate', true), '') <> 'rpc' then
      raise exception '승인 상태는 case_issue_tag_approve 함수로만 바뀝니다' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.case_issue_tags_guard() from public, anon, authenticated;
create trigger case_issue_tags_guard before insert or update on public.case_issue_tags for each row execute function public.case_issue_tags_guard();
create trigger case_issue_tags_no_delete before delete on public.case_issue_tags for each row execute function public.issue_no_delete();
create trigger case_issue_tags_no_truncate before truncate on public.case_issue_tags for each statement execute function public.issue_no_delete();

-- 감사 - 태그·쟁점 지도 공용. 추가만
create table public.issue_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  subject text not null check (subject in ('issue_tag', 'case_issue_tag', 'issue_graph')),
  target_id bigint not null,
  action text not null check (action in ('approve', 'retire', 'submit', 'sign', 'publish', 'unpublish')),
  outcome text not null check (outcome in ('ok', 'refused')),
  code text not null check (length(btrim(code)) > 0),
  actor text not null check (length(btrim(actor)) > 0),
  detail text check (detail is null or char_length(detail) <= 500),
  constraint issue_audit_ok_code check ((outcome = 'ok') = (code = 'ok'))
);
comment on table public.issue_audit is '쟁점 태그·쟁점 지도 승인·서명·공개 감사 - 추가만, 거부도 1행(code가 사유). 앱이 관리자 서명 시도를 막은 경우도 같은 표에 남긴다';
create index issue_audit_target_idx on public.issue_audit (subject, target_id, at desc);
create trigger issue_audit_no_update_delete before update or delete on public.issue_audit for each row execute function public.rules_audit_append_only();
create trigger issue_audit_no_truncate before truncate on public.issue_audit for each statement execute function public.rules_audit_append_only();

create function public.issue_audit_write(p_subject text, p_target bigint, p_action text, p_ok boolean, p_code text, p_actor text, p_detail text) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.issue_audit (subject, target_id, action, outcome, code, actor, detail)
  values (p_subject, p_target, p_action, case when p_ok then 'ok' else 'refused' end, p_code, coalesce(nullif(btrim(p_actor), ''), 'unknown'), left(p_detail, 500));
$$;
revoke all on function public.issue_audit_write(text, bigint, text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.issue_audit_write(text, bigint, text, boolean, text, text, text) to service_role;

-- 태그 승인 - 제안만, 같은 키의 이전 승인본은 retired
create function public.issue_tag_approve(p_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.issue_tags;
  v_code text;
  v_msg text;
begin
  select * into t from public.issue_tags where id = p_id for update;
  if not found then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '승인자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif t.status = 'approved' then
    v_code := 'already_approved'; v_msg := '이미 승인된 태그입니다';
  elsif t.status = 'retired' then
    v_code := 'retired'; v_msg := '폐기된 태그입니다 - 새 버전으로 제안하세요';
  end if;
  if v_code is not null then
    perform public.issue_audit_write('issue_tag', p_id, 'approve', false, v_code, p_actor, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.issue_gate', 'rpc', true);
  update public.issue_tags set status = 'retired', retired_at = now() where tag_key = t.tag_key and status = 'approved';
  update public.issue_tags set status = 'approved', approved_by = p_actor, approved_at = now() where id = p_id;
  perform set_config('ltr.issue_gate', '', true);
  perform public.issue_audit_write('issue_tag', p_id, 'approve', true, 'ok', p_actor, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '승인했습니다');
end;
$$;

-- 태그 폐기 - 승인본만. 연결 행은 이력으로 남고 공개 뷰에서 빠진다
create function public.issue_tag_retire(p_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.issue_tags;
  v_code text;
  v_msg text;
begin
  select * into t from public.issue_tags where id = p_id for update;
  if not found then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '처리자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif t.status <> 'approved' then
    v_code := 'not_approved'; v_msg := '승인된 태그만 폐기할 수 있습니다';
  end if;
  if v_code is not null then
    perform public.issue_audit_write('issue_tag', p_id, 'retire', false, v_code, p_actor, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.issue_gate', 'rpc', true);
  update public.issue_tags set status = 'retired', retired_at = now() where id = p_id;
  perform set_config('ltr.issue_gate', '', true);
  perform public.issue_audit_write('issue_tag', p_id, 'retire', true, 'ok', p_actor, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '폐기했습니다');
end;
$$;

-- 결정례 태그 승인 - 제안만, 태그가 지금도 승인본일 때만
create function public.case_issue_tag_approve(p_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.case_issue_tags;
  v_code text;
  v_msg text;
begin
  select * into c from public.case_issue_tags where id = p_id for update;
  if not found then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '승인자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif c.status = 'approved' then
    v_code := 'already_approved'; v_msg := '이미 승인된 태그 연결입니다';
  elsif not exists (select 1 from public.issue_tags t where t.tag_key = c.tag_key and t.status = 'approved') then
    v_code := 'tag_not_approved'; v_msg := '이 쟁점 태그는 지금 승인본이 없습니다 (폐기되었거나 새 버전 승인 대기)';
  end if;
  if v_code is not null then
    perform public.issue_audit_write('case_issue_tag', p_id, 'approve', false, v_code, p_actor, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.issue_gate', 'rpc', true);
  update public.case_issue_tags set status = 'approved', approved_by = p_actor, approved_at = now() where id = p_id;
  perform set_config('ltr.issue_gate', '', true);
  perform public.issue_audit_write('case_issue_tag', p_id, 'approve', true, 'ok', p_actor, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '승인했습니다');
end;
$$;
revoke all on function public.issue_tag_approve(bigint, text), public.issue_tag_retire(bigint, text), public.case_issue_tag_approve(bigint, text) from public, anon, authenticated;
grant execute on function public.issue_tag_approve(bigint, text), public.issue_tag_retire(bigint, text), public.case_issue_tag_approve(bigint, text) to service_role;

-- 권한 - 서버(service_role)는 읽기와 추가만. 수정은 함수만
alter table public.issue_tags enable row level security;
alter table public.case_issue_tags enable row level security;
alter table public.issue_audit enable row level security;
revoke all on table public.issue_tags, public.case_issue_tags, public.issue_audit from anon, authenticated, service_role;
grant select, insert on table public.issue_tags, public.case_issue_tags, public.issue_audit to service_role;

-- 공개 뷰 - 승인본만. 제안 상태·승인자 계정 칸 없음
create view public.public_issue_tags as
  select tag_key, version, label, hub, synonyms, approved_at
    from public.issue_tags
   where status = 'approved';

-- 승인된 연결 + 그 키의 지금 승인본 + 공개 가능한 결정례(public_legal_docs)만. 폐기된 태그·제안 상태 연결은 0행
create view public.public_case_issue_tags as
  select c.case_id, cur.tag_key, cur.label, cur.hub, c.approved_at
    from public.case_issue_tags c
    join public.issue_tags cur on cur.tag_key = c.tag_key and cur.status = 'approved'
   where c.status = 'approved'
     and exists (select 1 from public.public_legal_docs d where d.id = c.case_id);

revoke all on table public.public_issue_tags, public.public_case_issue_tags from public, anon, authenticated, service_role;
grant select on table public.public_issue_tags, public.public_case_issue_tags to anon, authenticated, service_role;
