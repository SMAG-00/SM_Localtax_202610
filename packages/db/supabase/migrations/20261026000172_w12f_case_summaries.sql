-- W12-f f1 - 결정례 요지와 AI 태그 후보 (PRD-04 AIOPS-07 · CASE-05, docs/dev/W12-f_설계.md 2장)
-- 이 파일에 결정례·법령 문장은 없다. 요지 글은 O2 작업이 만든 초안이고, 사람이 승인해야 공개 뷰에 나온다.
--
-- · issue_tags.tax_items - 태그가 속한 세목 목록(AI가 사전에서 고를 때 거르는 칸). 내용 불변 규칙에 포함한다.
-- · case_issue_tags.origin에 ai를 더한다. ai 행은 proposed로만, 전용 함수 case_issue_tag_ai_propose 안에서만 들어간다(직접 INSERT 거부).
--   editor 행은 어떤 경우에도 이 함수가 건드리지 않는다(같은 (case_id, tag_key)가 있으면 아무것도 하지 않음). 승인은 기존 case_issue_tag_approve.
-- · case_summaries - 결정례 요지(3줄). 사건번호·일자 칸이 없다(공개 화면은 public_legal_docs 원문 값을 쓴다). 만든 뒤 내용 불변, 상태는 함수로만.
--   승인(case_summary_approve)은 연결된 검수 항목(review_items kind case_summary)이 approved·published일 때만, 원문 해시가 그대로일 때만.
-- · 공개 뷰 public_case_summaries - 승인 ∧ 요지를 쓴 원문 해시 = 지금 원문 해시 ∧ 공개 가능한 결정례 ∧ 기능 키 case_summaries.
-- · issue_audit의 대상·행위 값을 늘려 요지·요약 상자·배너 승인도 같은 감사 표에 남긴다.
-- service_role만 함수를 실행한다. AI 호출은 앱(O2 작업)이 하고 DB에는 AI가 없다.

-- ─── issue_tags.tax_items ─────────────────────────────────────
alter table public.issue_tags add column tax_items text[] not null default '{}' check (cardinality(tax_items) <= 20);
comment on column public.issue_tags.tax_items is '태그가 속한 세목 목록 - O2가 사전에서 태그를 고를 때 결정례 세목(legal_docs.tax_kinds)과 겹치는 것만 후보로 쓴다. 비어 있으면 세목 제한 없음';

create or replace function public.issue_tags_guard() returns trigger
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
     or new.hub is distinct from old.hub or new.synonyms is distinct from old.synonyms or new.tax_items is distinct from old.tax_items
     or new.proposed_by is distinct from old.proposed_by or new.created_at is distinct from old.created_at then
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

-- ─── case_issue_tags.origin ai ────────────────────────────────
alter table public.case_issue_tags drop constraint case_issue_tags_origin_check;
alter table public.case_issue_tags add constraint case_issue_tags_origin_check check (origin in ('editor', 'ai'));

create or replace function public.case_issue_tags_guard() returns trigger
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
    if new.origin = 'ai' and coalesce(current_setting('ltr.o2_write', true), '') <> '1' then
      raise exception 'AI 태그 후보는 case_issue_tag_ai_propose 함수로만 넣을 수 있습니다' using errcode = 'insufficient_privilege';
    end if;
    new.tag_key := t.tag_key;
    return new;
  end if;
  if new.case_id is distinct from old.case_id or new.issue_tag_id is distinct from old.issue_tag_id or new.tag_key is distinct from old.tag_key
     or new.origin is distinct from old.origin or new.applied_by is distinct from old.applied_by or new.created_at is distinct from old.created_at then
    raise exception '결정례 태그의 대상·태그·출처는 고칠 수 없습니다' using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
    if coalesce(current_setting('ltr.issue_gate', true), '') <> 'rpc' then
      raise exception '승인 상태는 case_issue_tag_approve 함수로만 바뀝니다' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

-- ─── 감사 표 확장 ─────────────────────────────────────────────
alter table public.issue_audit drop constraint issue_audit_subject_check;
alter table public.issue_audit add constraint issue_audit_subject_check check (subject in ('issue_tag', 'case_issue_tag', 'issue_graph', 'case_summary', 'article_ai_box', 'impact_banner'));
alter table public.issue_audit drop constraint issue_audit_action_check;
alter table public.issue_audit add constraint issue_audit_action_check check (action in ('approve', 'retire', 'submit', 'sign', 'publish', 'unpublish', 'reject'));

-- ─── case_summaries ───────────────────────────────────────────
create table public.case_summaries (
  id bigint generated always as identity primary key,
  case_id bigint not null references public.legal_docs (id),
  content_hash text not null check (length(btrim(content_hash)) > 0),
  summary_lines text[] not null check (cardinality(summary_lines) = 3),
  result_type text not null check (result_type in ('accepted', 'dismissed', 'partial', 'inadmissible', 'other')),
  popularity int not null default 0 check (popularity between 0 and 100),
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected', 'retired')),
  review_item_id bigint references public.review_items (id),
  model text not null check (length(btrim(model)) > 0),
  drafted_by text not null check (length(btrim(drafted_by)) > 0),
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (case_id, content_hash),
  constraint case_summaries_approved_record check ((status in ('approved', 'retired')) = (approved_by is not null and approved_at is not null)),
  constraint case_summaries_lines_shape check (
    summary_lines[1] <> '' and summary_lines[2] <> '' and summary_lines[3] <> ''
    and char_length(summary_lines[1]) <= 140 and char_length(summary_lines[2]) <= 140 and char_length(summary_lines[3]) <= 140)
);
comment on table public.case_summaries is '결정례 요지(AIOPS-07 · CASE-05) - 사건번호·일자 칸 없음(공개 화면은 원문 값). draft -> approved(사람 승인) , 내용 불변. 원문 해시가 바뀌면 공개 뷰에서 빠진다';
comment on column public.case_summaries.popularity is '대중성 점수 0~100 - 핫이슈 후보 추천용. 공개 뷰에 나오지 않는다';
create unique index case_summaries_one_approved on public.case_summaries (case_id) where status = 'approved';

create function public.case_summaries_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '결정례 요지는 지우지 못합니다 - 내리려면 retired로 바꿉니다' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception '결정례 요지는 초안(draft)으로만 만들 수 있습니다' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if new.case_id is distinct from old.case_id or new.content_hash is distinct from old.content_hash or new.summary_lines is distinct from old.summary_lines
     or new.result_type is distinct from old.result_type or new.popularity is distinct from old.popularity or new.model is distinct from old.model
     or new.drafted_by is distinct from old.drafted_by or new.review_item_id is distinct from old.review_item_id or new.created_at is distinct from old.created_at then
    raise exception '결정례 요지의 내용은 고칠 수 없습니다 - 새 초안을 만드세요' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(current_setting('ltr.issue_gate', true), '') <> 'rpc' then
    raise exception '요지 상태는 case_summary_approve/reject 함수로만 바뀝니다' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.case_summaries_guard() from public, anon, authenticated;
create trigger case_summaries_guard before insert or update or delete on public.case_summaries for each row execute function public.case_summaries_guard();
create trigger case_summaries_no_truncate before truncate on public.case_summaries for each statement execute function public.issue_no_delete();

alter table public.case_summaries enable row level security;
revoke all on table public.case_summaries from anon, authenticated, service_role;
grant select, insert on table public.case_summaries to service_role;

-- ─── 후보 선별 - 요지가 아직 없는 결정례 (현재 원문 해시 기준) ───────
create function public.case_summary_candidates(p_limit int default 20)
returns table (case_id bigint, content_hash text, doc_type text, tax_kinds text[], issuer text, doc_no text, decided_on date, body text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.content_hash, d.doc_type, d.tax_kinds, d.issuer, d.doc_no, d.decided_on, t.body
    from public.legal_docs d
    join public.legal_doc_texts t on t.legal_doc_id = d.id and t.snapshot_id = d.snapshot_id
   where coalesce(btrim(d.content_hash), '') <> ''
     and d.rights_status = 'confirmed'
     and not exists (select 1 from public.legal_doc_holds h where h.legal_doc_id = d.id and h.released_at is null)
     and not exists (select 1 from public.case_summaries s where s.case_id = d.id and s.content_hash = d.content_hash)
   order by d.id
   limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;
revoke all on function public.case_summary_candidates(int) from public, anon, authenticated;
grant execute on function public.case_summary_candidates(int) to service_role;

-- ─── 초안 + 검수 항목 한 번에 ───────────────────────────────────
create function public.case_summary_draft_add(
  p_case_id bigint, p_content_hash text, p_lines text[], p_result_type text, p_popularity int, p_model text, p_actor text, p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.legal_docs;
  v_item bigint;
  v_id bigint;
  v_key text;
begin
  select * into d from public.legal_docs where id = p_case_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if d.content_hash is distinct from p_content_hash then
    return jsonb_build_object('ok', false, 'code', 'source_changed');
  end if;
  if exists (select 1 from public.case_summaries s where s.case_id = p_case_id and s.content_hash = p_content_hash) then
    return jsonb_build_object('ok', true, 'code', 'exists');
  end if;
  v_key := format('case_summary:%s:%s', p_case_id, left(p_content_hash, 64));
  insert into public.review_items (kind, source_key, title, snapshot_id, payload, created_by)
  values ('case_summary', v_key, left(format('결정례 요지 초안 (결정례 %s)', p_case_id), 200), d.snapshot_id,
          coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('caseId', p_case_id, 'contentHash', p_content_hash), coalesce(nullif(btrim(p_actor), ''), 'job:case-summary-draft'))
  on conflict (kind, source_key) do nothing
  returning id into v_item;
  if v_item is null then
    select i.id into v_item from public.review_items i where i.kind = 'case_summary' and i.source_key = v_key;
  end if;
  insert into public.case_summaries (case_id, content_hash, summary_lines, result_type, popularity, review_item_id, model, drafted_by)
  values (p_case_id, p_content_hash, p_lines, p_result_type, coalesce(p_popularity, 0), v_item, p_model, coalesce(nullif(btrim(p_actor), ''), 'job:case-summary-draft'))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'code', 'created', 'id', v_id, 'reviewItemId', v_item);
end;
$$;
revoke all on function public.case_summary_draft_add(bigint, text, text[], text, int, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.case_summary_draft_add(bigint, text, text[], text, int, text, text, jsonb) to service_role;

-- ─── 승인 / 반려 ──────────────────────────────────────────────
create function public.case_summary_approve(p_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.case_summaries;
  v_hash text;
  v_status text;
  v_code text;
  v_msg text;
begin
  select * into s from public.case_summaries where id = p_id for update;
  if not found then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '승인자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif s.status <> 'draft' then
    v_code := 'not_draft'; v_msg := '초안 상태의 요지만 승인할 수 있습니다';
  else
    select content_hash into v_hash from public.legal_docs where id = s.case_id;
    select status into v_status from public.review_items where id = s.review_item_id;
    if v_hash is distinct from s.content_hash then
      v_code := 'source_changed'; v_msg := '요지를 쓴 뒤 원문이 바뀌었습니다 - 새 초안이 필요합니다';
    elsif v_status is null or v_status not in ('approved', 'published') then
      v_code := 'review_not_approved'; v_msg := '검수 항목이 승인되지 않았습니다';
    end if;
  end if;
  if v_code is not null then
    perform public.issue_audit_write('case_summary', coalesce(p_id, 0), 'approve', false, v_code, p_actor, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.issue_gate', 'rpc', true);
  update public.case_summaries set status = 'retired' where case_id = s.case_id and status = 'approved';
  update public.case_summaries set status = 'approved', approved_by = p_actor, approved_at = now() where id = p_id;
  perform set_config('ltr.issue_gate', '', true);
  perform public.issue_audit_write('case_summary', p_id, 'approve', true, 'ok', p_actor, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '승인했습니다');
end;
$$;

create function public.case_summary_reject(p_id bigint, p_actor text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.case_summaries;
  v_code text;
  v_msg text;
begin
  select * into s from public.case_summaries where id = p_id for update;
  if not found then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '처리자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif s.status <> 'draft' then
    v_code := 'not_draft'; v_msg := '초안 상태의 요지만 반려할 수 있습니다';
  elsif length(btrim(coalesce(p_reason, ''))) = 0 then
    v_code := 'reason_required'; v_msg := '반려 사유가 필요합니다';
  end if;
  if v_code is not null then
    perform public.issue_audit_write('case_summary', coalesce(p_id, 0), 'reject', false, v_code, p_actor, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.issue_gate', 'rpc', true);
  update public.case_summaries set status = 'rejected' where id = p_id;
  perform set_config('ltr.issue_gate', '', true);
  perform public.issue_audit_write('case_summary', p_id, 'reject', true, 'ok', p_actor, left(p_reason, 400));
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '반려했습니다');
end;
$$;
revoke all on function public.case_summary_approve(bigint, text), public.case_summary_reject(bigint, text, text) from public, anon, authenticated;
grant execute on function public.case_summary_approve(bigint, text), public.case_summary_reject(bigint, text, text) to service_role;

-- ─── O2 쓰기 함수 - AI 태그 후보 (origin ai · proposed만) ────────────
create function public.case_issue_tag_ai_propose(p_case_id bigint, p_tag_key text, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.issue_tags;
  v_id bigint;
begin
  if not exists (select 1 from public.legal_docs where id = p_case_id) then
    return jsonb_build_object('ok', false, 'code', 'case_not_found');
  end if;
  select * into t from public.issue_tags where tag_key = p_tag_key and status = 'approved';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'tag_not_approved');
  end if;
  if exists (select 1 from public.case_issue_tags c where c.case_id = p_case_id and c.tag_key = p_tag_key) then
    return jsonb_build_object('ok', false, 'code', 'exists');
  end if;
  perform set_config('ltr.o2_write', '1', true);
  insert into public.case_issue_tags (case_id, issue_tag_id, origin, status, applied_by)
  values (p_case_id, t.id, 'ai', 'proposed', coalesce(nullif(btrim(p_actor), ''), 'job:case-summary-draft'))
  returning id into v_id;
  perform set_config('ltr.o2_write', '', true);
  return jsonb_build_object('ok', true, 'code', 'created', 'id', v_id);
end;
$$;
revoke all on function public.case_issue_tag_ai_propose(bigint, text, text) from public, anon, authenticated;
grant execute on function public.case_issue_tag_ai_propose(bigint, text, text) to service_role;

-- ─── 공개 뷰 ────────────────────────────────────────────────
-- 승인 ∧ 요지를 쓴 원문 해시가 지금 원문 해시 ∧ 공개 가능한 결정례(public_legal_docs) ∧ 기능 키 case_summaries. 대중성 점수·모델·승인자 칸 없음
create view public.public_case_summaries as
  select s.case_id, s.summary_lines, s.result_type, (s.approved_at at time zone 'Asia/Seoul')::date as approved_on
    from public.case_summaries s
    join public.legal_docs ld on ld.id = s.case_id and ld.content_hash = s.content_hash
   where s.status = 'approved'
     and exists (select 1 from public.public_legal_docs d where d.id = s.case_id)
     and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'case_summaries') = 'true'::jsonb);
revoke all on table public.public_case_summaries from public, anon, authenticated, service_role;
grant select on table public.public_case_summaries to anon, authenticated, service_role;
