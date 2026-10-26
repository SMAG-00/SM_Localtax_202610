-- W12-f f4~f6 - 기사 요약 상자 · 개정 영향 배너 · 정합성 감시 (PRD-04 AIOPS-08 · AIOPS-09 · ART-13 · ART-14, docs/dev/W12-f_설계.md 2장)
-- 이 파일에 법령·기사 문장은 없다. 상자와 배너는 AI가 제안하고 사람이 승인해야 공개 뷰에 나온다.
--
-- · article_ai_boxes - 기사 상단 "3줄 요약 · 내게 무슨 의미?" 초안. 기사 버전(articles.version)에 묶인다 - 기사가 고쳐져 버전이 바뀌면 공개 뷰에서 빠진다(승인은 그 버전에 대한 것).
--   내용 불변, 상태는 함수로만, 승인은 연결된 검수 항목(review_items kind article_ai_box)이 approved·published일 때만.
-- · impact_banners - "개정 전 기준" 배너 제안. (기사, 개정 사건) 하나에 1행. 편집자가 확인(approve)해야 공개 뷰에 나온다.
-- · consistency_scan - 개정 사건(law_events revision)마다, 그 법령 조문을 확인된 연결(links)로 인용하는 공개 기사 중 해당 조문 글이 달라졌거나 없어진 것을 찾는다(AI 없음).
-- · consistency_propose - 개정 사건 하나의 정합성 경보(review_items consistency_alert) 1건 + 영향 기사마다 배너 제안. 재실행 중복 0.
-- · consistency_broken_links / consistency_links_alert - 매주 깨진 연결(최신 개정판에 조문이 없는 확인된 연결) 점검, 주마다 경보 1건.
-- service_role만 함수를 실행한다.

create table public.article_ai_boxes (
  id bigint generated always as identity primary key,
  article_id bigint not null references public.articles (id) on delete cascade,
  article_version int not null check (article_version >= 1),
  three_lines text[] not null check (cardinality(three_lines) = 3),
  meaning text not null check (char_length(btrim(meaning)) between 1 and 300),
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected', 'retired')),
  review_item_id bigint references public.review_items (id),
  model text not null check (length(btrim(model)) > 0),
  drafted_by text not null check (length(btrim(drafted_by)) > 0),
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (article_id, article_version),
  constraint article_ai_boxes_approved_record check ((status in ('approved', 'retired')) = (approved_by is not null and approved_at is not null)),
  constraint article_ai_boxes_lines_shape check (
    three_lines[1] <> '' and three_lines[2] <> '' and three_lines[3] <> ''
    and char_length(three_lines[1]) <= 120 and char_length(three_lines[2]) <= 120 and char_length(three_lines[3]) <= 120)
);
comment on table public.article_ai_boxes is '기사 요약 상자(ART-13) - AI 초안 -> 사람 승인. 기사 버전에 묶임(버전이 바뀌면 공개 뷰에서 빠짐). 내용 불변';
create unique index article_ai_boxes_one_approved on public.article_ai_boxes (article_id) where status = 'approved';

create table public.impact_banners (
  id bigint generated always as identity primary key,
  article_id bigint not null references public.articles (id) on delete cascade,
  law_event_id bigint not null references public.law_events (id),
  law_id bigint not null references public.laws (id),
  change text not null check (change in ('text_changed', 'removed')),
  note text check (note is null or char_length(note) <= 300),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'dismissed', 'retired')),
  review_item_id bigint references public.review_items (id),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (article_id, law_event_id),
  constraint impact_banners_decided_record check ((status = 'proposed') = (decided_by is null and decided_at is null))
);
comment on table public.impact_banners is '개정 영향 배너 제안(ART-14) - 편집자 확인(approved) 전 공개 0. 사유 문장(note)은 AI 참고 문장이며 공개 뷰에 나오지 않는다';
create unique index impact_banners_approved_idx on public.impact_banners (article_id, law_event_id) where status = 'approved';

-- 두 표 공통 보호 - 지우기 거부, 내용 불변, 상태는 함수로만
create function public.w12f_ai_rows_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '요약 상자·배너는 지우지 못합니다 - retired/dismissed로 바꿉니다' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    if (to_jsonb(new) ->> 'status') not in ('draft', 'proposed') then
      raise exception '초안·제안 상태로만 만들 수 있습니다' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if tg_table_name = 'article_ai_boxes' then
    if (new.article_id, new.article_version, new.three_lines, new.meaning, new.model, new.drafted_by, new.review_item_id, new.created_at)
         is distinct from (old.article_id, old.article_version, old.three_lines, old.meaning, old.model, old.drafted_by, old.review_item_id, old.created_at) then
      raise exception '요약 상자의 내용은 고칠 수 없습니다 - 새 초안을 만드세요' using errcode = 'insufficient_privilege';
    end if;
  else
    if to_jsonb(new) - 'status' - 'decided_by' - 'decided_at' is distinct from to_jsonb(old) - 'status' - 'decided_by' - 'decided_at' then
      raise exception '배너 제안의 내용은 고칠 수 없습니다' using errcode = 'insufficient_privilege';
    end if;
  end if;
  if coalesce(current_setting('ltr.issue_gate', true), '') <> 'rpc' then
    raise exception '상태는 승인·반려 함수로만 바뀝니다' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.w12f_ai_rows_guard() from public, anon, authenticated;
create trigger article_ai_boxes_guard before insert or update or delete on public.article_ai_boxes for each row execute function public.w12f_ai_rows_guard();
create trigger impact_banners_guard before insert or update or delete on public.impact_banners for each row execute function public.w12f_ai_rows_guard();
create trigger article_ai_boxes_no_truncate before truncate on public.article_ai_boxes for each statement execute function public.issue_no_delete();
create trigger impact_banners_no_truncate before truncate on public.impact_banners for each statement execute function public.issue_no_delete();

alter table public.article_ai_boxes enable row level security;
alter table public.impact_banners enable row level security;
revoke all on table public.article_ai_boxes, public.impact_banners from anon, authenticated, service_role;
grant select, insert on table public.article_ai_boxes, public.impact_banners to service_role;

-- ─── 요약 상자 초안 + 검수 항목 ──────────────────────────────────
create function public.article_ai_box_add(
  p_article_id bigint, p_article_version int, p_lines text[], p_meaning text, p_model text, p_actor text, p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.articles;
  v_item bigint;
  v_id bigint;
  v_key text;
begin
  select * into a from public.articles where id = p_article_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if a.version is distinct from p_article_version then
    return jsonb_build_object('ok', false, 'code', 'article_changed');
  end if;
  if exists (select 1 from public.article_ai_boxes b where b.article_id = p_article_id and b.article_version = p_article_version) then
    return jsonb_build_object('ok', true, 'code', 'exists');
  end if;
  v_key := format('article_ai_box:%s:%s', p_article_id, p_article_version);
  insert into public.review_items (kind, source_key, title, payload, created_by)
  values ('article_ai_box', v_key, left(format('기사 요약 상자 초안 (기사 %s, 버전 %s)', p_article_id, p_article_version), 200),
          coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('articleId', p_article_id, 'articleVersion', p_article_version), coalesce(nullif(btrim(p_actor), ''), 'job:article-ai-box'))
  on conflict (kind, source_key) do nothing
  returning id into v_item;
  if v_item is null then
    select i.id into v_item from public.review_items i where i.kind = 'article_ai_box' and i.source_key = v_key;
  end if;
  insert into public.article_ai_boxes (article_id, article_version, three_lines, meaning, review_item_id, model, drafted_by)
  values (p_article_id, p_article_version, p_lines, p_meaning, v_item, p_model, coalesce(nullif(btrim(p_actor), ''), 'job:article-ai-box'))
  returning id into v_id;
  return jsonb_build_object('ok', true, 'code', 'created', 'id', v_id, 'reviewItemId', v_item);
end;
$$;

create function public.article_ai_box_approve(p_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.article_ai_boxes;
  v_ver int;
  v_status text;
  v_code text;
  v_msg text;
begin
  select * into b from public.article_ai_boxes where id = p_id for update;
  if not found then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '승인자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif b.status <> 'draft' then
    v_code := 'not_draft'; v_msg := '초안 상태의 상자만 승인할 수 있습니다';
  else
    select version into v_ver from public.articles where id = b.article_id;
    select status into v_status from public.review_items where id = b.review_item_id;
    if v_ver is distinct from b.article_version then
      v_code := 'article_changed'; v_msg := '상자를 만든 뒤 기사가 바뀌었습니다 - 새 초안이 필요합니다';
    elsif v_status is null or v_status not in ('approved', 'published') then
      v_code := 'review_not_approved'; v_msg := '검수 항목이 승인되지 않았습니다';
    end if;
  end if;
  if v_code is not null then
    perform public.issue_audit_write('article_ai_box', coalesce(p_id, 0), 'approve', false, v_code, p_actor, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.issue_gate', 'rpc', true);
  update public.article_ai_boxes set status = 'retired' where article_id = b.article_id and status = 'approved';
  update public.article_ai_boxes set status = 'approved', approved_by = p_actor, approved_at = now() where id = p_id;
  perform set_config('ltr.issue_gate', '', true);
  perform public.issue_audit_write('article_ai_box', p_id, 'approve', true, 'ok', p_actor, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '승인했습니다');
end;
$$;

create function public.article_ai_box_reject(p_id bigint, p_actor text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.article_ai_boxes;
  v_code text;
  v_msg text;
begin
  select * into b from public.article_ai_boxes where id = p_id for update;
  if not found then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '처리자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif b.status <> 'draft' then
    v_code := 'not_draft'; v_msg := '초안 상태의 상자만 반려할 수 있습니다';
  elsif length(btrim(coalesce(p_reason, ''))) = 0 then
    v_code := 'reason_required'; v_msg := '반려 사유가 필요합니다';
  end if;
  if v_code is not null then
    perform public.issue_audit_write('article_ai_box', coalesce(p_id, 0), 'reject', false, v_code, p_actor, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.issue_gate', 'rpc', true);
  update public.article_ai_boxes set status = 'rejected' where id = p_id;
  perform set_config('ltr.issue_gate', '', true);
  perform public.issue_audit_write('article_ai_box', p_id, 'reject', true, 'ok', p_actor, left(p_reason, 400));
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '반려했습니다');
end;
$$;

-- ─── 정합성 감시 - 영향 기사 찾기 (AI 없음) ───────────────────────
-- 개정 사건(revision)의 개정판에서, 확인된 연결(links)로 그 조문을 인용하는 공개 기사 중 조문 글이 이전 개정판과 다르거나 없어진 것
create function public.consistency_scan(p_since timestamptz)
returns table (law_event_id bigint, law_id bigint, law_name text, version_id bigint, effective_on date, detected_at timestamptz,
               article_id bigint, article_title text, article_format text, article_no int, branch_no int, change text)
language sql
stable
security definer
set search_path = ''
as $$
  select ev.id, ev.law_id, l.name, ev.version_id, nv.effective_on, ev.detected_at,
         a.id, a.title, a.format, k.dst_article_no, k.dst_branch_no,
         case when na.id is null then 'removed' else 'text_changed' end
    from public.law_events ev
    join public.laws l on l.id = ev.law_id
    join public.law_versions nv on nv.id = ev.version_id
    join public.links k on k.status = 'confirmed' and k.src_kind = 'article' and k.dst_kind = 'law_provision' and k.dst_id = ev.law_id
    join public.articles a on a.id = k.src_id and a.status = 'published'
    cross join lateral (
      select pv.id from public.law_versions pv
       where pv.law_id = ev.law_id and pv.id <> nv.id and (pv.effective_on < nv.effective_on or (pv.effective_on = nv.effective_on and pv.id < nv.id))
       order by pv.effective_on desc, pv.id desc limit 1) as prev
    join public.law_articles oa on oa.version_id = prev.id and oa.article_no = k.dst_article_no and oa.branch_no = k.dst_branch_no
    left join public.law_articles na on na.version_id = nv.id and na.article_no = k.dst_article_no and na.branch_no = k.dst_branch_no
   where ev.kind = 'revision' and ev.version_id is not null and ev.detected_at >= p_since
     and (na.id is null or na.body is distinct from oa.body)
   order by ev.id, a.id, k.dst_article_no, k.dst_branch_no;
$$;
revoke all on function public.consistency_scan(timestamptz) from public, anon, authenticated;
grant execute on function public.consistency_scan(timestamptz) to service_role;

-- 개정 사건 하나의 경보 1건 + 영향 기사별 배너 제안. p_notes = { "<기사 번호>": "AI 참고 문장" } (없어도 됨). 멱등
create function public.consistency_propose(p_law_event_id bigint, p_actor text, p_notes jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_item bigint;
  v_created int := 0;
  v_rows int;
  v_key text := format('consistency:event:%s', p_law_event_id);
  v_list jsonb;
  v_law_name text;
begin
  select coalesce(jsonb_agg(jsonb_build_object('articleId', x.article_id, 'title', x.article_title, 'format', x.article_format, 'change', x.change, 'articleNo', x.article_no, 'branchNo', x.branch_no) order by x.article_id, x.article_no), '[]'::jsonb),
         max(x.law_name)
    into v_list, v_law_name
    from public.consistency_scan('-infinity') x where x.law_event_id = p_law_event_id;
  if jsonb_array_length(v_list) = 0 then
    return jsonb_build_object('ok', true, 'code', 'none', 'banners', 0);
  end if;
  insert into public.review_items (kind, source_key, title, payload, created_by)
  values ('consistency_alert', v_key, left(format('개정 정합성 - %s 인용 기사 %s건 확인', v_law_name, jsonb_array_length(v_list)), 200),
          jsonb_build_object('lawEventId', p_law_event_id, 'lawName', v_law_name, 'articles', v_list, 'notes', coalesce(p_notes, '{}'::jsonb)),
          coalesce(nullif(btrim(p_actor), ''), 'job:consistency-watch'))
  on conflict (kind, source_key) do nothing;
  select i.id into v_item from public.review_items i where i.kind = 'consistency_alert' and i.source_key = v_key;
  for r in
    select x.article_id, x.law_id, (array_agg(x.change order by (x.change = 'removed') desc))[1] as change
      from public.consistency_scan('-infinity') x where x.law_event_id = p_law_event_id group by x.article_id, x.law_id
  loop
    insert into public.impact_banners (article_id, law_event_id, law_id, change, note, review_item_id)
    values (r.article_id, p_law_event_id, r.law_id, r.change, left(nullif(btrim(coalesce(p_notes ->> r.article_id::text, '')), ''), 300), v_item)
    on conflict (article_id, law_event_id) do nothing;
    get diagnostics v_rows = row_count;
    v_created := v_created + v_rows;
  end loop;
  return jsonb_build_object('ok', true, 'code', 'ok', 'reviewItemId', v_item, 'banners', v_created, 'articles', jsonb_array_length(v_list));
end;
$$;

create function public.impact_banner_decide(p_id bigint, p_actor text, p_approve boolean, p_reason text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.impact_banners;
  v_code text;
  v_msg text;
  v_act text := case when p_approve then 'approve' else 'reject' end;
begin
  select * into b from public.impact_banners where id = p_id for update;
  if not found then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '처리자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif b.status <> 'proposed' then
    v_code := 'not_proposed'; v_msg := '제안 상태의 배너만 처리할 수 있습니다';
  elsif not p_approve and length(btrim(coalesce(p_reason, ''))) = 0 then
    v_code := 'reason_required'; v_msg := '반려 사유가 필요합니다';
  end if;
  if v_code is not null then
    perform public.issue_audit_write('impact_banner', coalesce(p_id, 0), v_act, false, v_code, p_actor, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.issue_gate', 'rpc', true);
  update public.impact_banners set status = case when p_approve then 'approved' else 'dismissed' end, decided_by = p_actor, decided_at = now() where id = p_id;
  perform set_config('ltr.issue_gate', '', true);
  perform public.issue_audit_write('impact_banner', p_id, v_act, true, 'ok', p_actor, left(p_reason, 400));
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', case when p_approve then '배너를 확인했습니다' else '반려했습니다' end);
end;
$$;

-- 배너 내리기 - 승인된 배너를 retired로 (기사를 고쳐 반영한 뒤)
create function public.impact_banner_retire(p_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.impact_banners;
begin
  select * into b from public.impact_banners where id = p_id for update;
  if not found or b.status <> 'approved' or p_actor is null or p_actor !~ '^(user|admin):.+' then
    perform public.issue_audit_write('impact_banner', coalesce(p_id, 0), 'retire', false, 'not_approved', p_actor, '승인된 배너만 내릴 수 있습니다');
    return jsonb_build_object('ok', false, 'code', 'not_approved', 'message', '승인된 배너만 내릴 수 있습니다');
  end if;
  perform set_config('ltr.issue_gate', 'rpc', true);
  update public.impact_banners set status = 'retired' where id = p_id;
  perform set_config('ltr.issue_gate', '', true);
  perform public.issue_audit_write('impact_banner', p_id, 'retire', true, 'ok', p_actor, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '내렸습니다');
end;
$$;

-- ─── 매주 깨진 연결 점검 ───────────────────────────────────────
create function public.consistency_broken_links()
returns table (article_id bigint, article_title text, law_id bigint, law_name text, article_no int, branch_no int)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.title, l.id, l.name, k.dst_article_no, k.dst_branch_no
    from public.links k
    join public.articles a on a.id = k.src_id and a.status = 'published'
    join public.laws l on l.id = k.dst_id
    cross join lateral (select v.id from public.law_versions v where v.law_id = l.id order by v.effective_on desc, v.id desc limit 1) as latest
   where k.status = 'confirmed' and k.src_kind = 'article' and k.dst_kind = 'law_provision'
     and not exists (select 1 from public.law_articles x where x.version_id = latest.id and x.article_no = k.dst_article_no and x.branch_no = k.dst_branch_no)
   order by a.id, l.id, k.dst_article_no;
$$;

create function public.consistency_links_alert(p_week text, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_list jsonb;
  v_rows int;
begin
  select coalesce(jsonb_agg(jsonb_build_object('articleId', x.article_id, 'title', x.article_title, 'lawName', x.law_name, 'articleNo', x.article_no, 'branchNo', x.branch_no)), '[]'::jsonb)
    into v_list from public.consistency_broken_links() x;
  if jsonb_array_length(v_list) = 0 then
    return jsonb_build_object('ok', true, 'code', 'none', 'broken', 0);
  end if;
  insert into public.review_items (kind, source_key, title, payload, created_by)
  values ('consistency_alert', format('consistency:links:%s', p_week), left(format('깨진 조문 연결 %s건 확인 (%s)', jsonb_array_length(v_list), p_week), 200),
          jsonb_build_object('week', p_week, 'brokenLinks', v_list), coalesce(nullif(btrim(p_actor), ''), 'job:consistency-watch'))
  on conflict (kind, source_key) do nothing;
  get diagnostics v_rows = row_count;
  return jsonb_build_object('ok', true, 'code', case when v_rows = 1 then 'created' else 'exists' end, 'broken', jsonb_array_length(v_list));
end;
$$;

revoke all on function public.article_ai_box_add(bigint, int, text[], text, text, text, jsonb), public.article_ai_box_approve(bigint, text), public.article_ai_box_reject(bigint, text, text),
  public.consistency_propose(bigint, text, jsonb), public.impact_banner_decide(bigint, text, boolean, text), public.impact_banner_retire(bigint, text),
  public.consistency_broken_links(), public.consistency_links_alert(text, text) from public, anon, authenticated;
grant execute on function public.article_ai_box_add(bigint, int, text[], text, text, text, jsonb), public.article_ai_box_approve(bigint, text), public.article_ai_box_reject(bigint, text, text),
  public.consistency_propose(bigint, text, jsonb), public.impact_banner_decide(bigint, text, boolean, text), public.impact_banner_retire(bigint, text),
  public.consistency_broken_links(), public.consistency_links_alert(text, text) to service_role;

-- ─── 공개 뷰 ────────────────────────────────────────────────
-- 상자: 승인 ∧ 승인한 기사 버전 = 지금 버전 ∧ 발행된 기사 ∧ 기능 키 article_ai_box. 모델·승인자 칸 없음
create view public.public_article_ai_boxes as
  select b.article_id, b.three_lines, b.meaning, (b.approved_at at time zone 'Asia/Seoul')::date as approved_on
    from public.article_ai_boxes b
    join public.articles a on a.id = b.article_id and a.version = b.article_version and a.status = 'published'
   where b.status = 'approved'
     and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'article_ai_box') = 'true'::jsonb);

-- 배너: 확인(approved) ∧ 발행된 기사 ∧ 기능 키 impact_banner. 법령 이름·개정판 시행일은 원문 값. AI 참고 문장(note) 칸 없음
create view public.public_impact_banners as
  select p.article_id, l.name as law_name, v.effective_on, p.change
    from public.impact_banners p
    join public.articles a on a.id = p.article_id and a.status = 'published'
    join public.laws l on l.id = p.law_id
    join public.law_events ev on ev.id = p.law_event_id
    join public.law_versions v on v.id = ev.version_id
   where p.status = 'approved'
     and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'impact_banner') = 'true'::jsonb);

revoke all on table public.public_article_ai_boxes, public.public_impact_banners from public, anon, authenticated, service_role;
grant select on table public.public_article_ai_boxes, public.public_impact_banners to anon, authenticated, service_role;
