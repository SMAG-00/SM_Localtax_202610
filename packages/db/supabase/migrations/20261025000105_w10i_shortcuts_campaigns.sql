-- W10-i 바로가기·캠페인 랜딩 (PRD-02 4.16 HOME-12·13·14 · PR-15 · GROW-03·04·05·06, docs/dev/W10-i_설계.md 3장)
-- · 캠페인 랜딩 표(주소 칸 없음 - 도착은 키로만 저장) · 광고 표시 검토 기록(추가만) · 감사(추가만) · 승인 함수 · 공개 뷰.
-- · 이번 주 재테크 포인트(호·항목) 표 · 발행 함수 · 공개 뷰. 가격·분담금·수익률·시세 칸은 없다 (자본시장법 - 세금 관점 한 줄만).
-- · 기능 키 3개(shortcuts · realestate_weekly · campaign_landings)는 꺼진 채로, 설정 키 씨앗 2개(home_shortcut_copy 공개 · campaign_utm_values 비공개), 측정 이벤트 4개.
-- · 함수는 거부해도 예외를 던지지 않고 { ok, code, message }를 돌려주며 감사 1행을 남긴다 (예외면 거래가 되돌려져 감사가 사라진다 - W10-a 승인 함수와 같은 이유).
-- · 승인자가 관리자인지는 DB가 모른다(관리자 목록은 서버 환경변수) - 서버가 campaign.approve 권한을 확인한 뒤 service_role로 부른다. 함수는 service_role만 부를 수 있다.
-- · 번호 105 하나만 쓴다 (104는 W10-b 보충). 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다.

-- 1. 측정 이벤트 4개 (65종 -> 69종) - 이름 제약은 값만 늘린 같은 이름 제약으로 바꾼다
alter table public.analytics_events drop constraint analytics_events_name_check;
alter table public.analytics_events add constraint analytics_events_name_check check (name in (
  'home_entry_clicked', 'hub_viewed', 'article_viewed', 'article_engaged', 'article_shared', 'search_submitted', 'glossary_opened',
  'situation_card_clicked', 'next_action_clicked', 'hot_article_clicked', 'popular_article_clicked', 'video_played',
  'partner_content_viewed', 'signup_completed', 'brief_preregistered', 'inquiry_submitted', 'policy_page_viewed',
  'redirect_hit', 'not_found_viewed',
  'calculator_card_clicked', 'amendment_viewed', 'interpretation_viewed',
  'region_viewed', 'regional_news_opened', 'regional_source_opened', 'region_to_tax_clicked', 'region_to_realestate_clicked',
  'project_viewed', 'dev_method_viewed',
  'product_clicked', 'order_link_clicked',
  'calc_started', 'calc_completed', 'calc_step_viewed', 'calc_step_left',
  'calc_compared', 'calc_compare_gated', 'reduction_shown', 'reduction_expanded',
  'refund_diagnosed', 'wetax_handoff', 'external_calculator_opened', 'calc_offline_used',
  'calendar_exported', 'accuracy_viewed', 'content_to_tool', 'law_viewed',
  'related_panel_opened', 'case_viewed', 'brief_subscribe_viewed', 'brief_subscribed',
  'brief_confirmed', 'brief_opened', 'brief_unsubscribed', 'brief_link_visited',
  'review_decided', 'sm_calculator_opened', 'amendment_alert_subscribed', 'amendment_alert_sent',
  'paywall_viewed', 'subscription_started', 'subscription_cancelled', 'order_paid',
  'certificate_issued', 'training_quote_requested',
  'shortcut_clicked', 'realestate_weekly_viewed', 'campaign_landing_viewed', 'campaign_cta_clicked'));

-- 1-1. 세션 진입 경로 `campaign` 추가 (GROW-05 - /go/* 첫 이벤트는 리퍼러와 상관없이 campaign)
alter table public.analytics_events drop constraint analytics_events_entry_check;
alter table public.analytics_events add constraint analytics_events_entry_check check (entry in
  ('search', 'ai_answer_engine', 'naver', 'brief', 'assistant', 'experts', 'tax_lens', 'campaign', 'direct', 'referral'));

-- 1-2. 전문가 연락 요청 출발점 3개 추가 (GROW-06 - 계산 결과 보조 링크 calc_result · 캠페인 랜딩 campaign · 바로가기 shortcut)
alter table public.expert_requests drop constraint expert_requests_source_check;
alter table public.expert_requests add constraint expert_requests_source_check check (source in ('assistant', 'experts', 'article', 'calc_result', 'campaign', 'shortcut'));

-- 1-3. 하위 분야 주소 weekly 예약 (/realestate/weekly 화면과 겹친다 - 앱 category-rules의 RESERVED_CATEGORY_SLUGS와 같다)
-- 지자체뉴스(local)의 기존 하위 분야 weekly(금주 핫뉴스)는 그대로 둔다 - 부동산재테크 분야만 막는다
alter table public.categories add constraint categories_slug_not_reserved check (not (section = 'realestate' and slug = 'weekly'));

-- 2. 기능 키 3개 (꺼짐) - 이미 있는 키는 건드리지 않는다
update public.settings s
   set value = s.value || (select jsonb_object_agg(k, false) from unnest(array['shortcuts', 'realestate_weekly', 'campaign_landings']) as k where not (s.value ? k)),
       updated_by = 'migration:20261025000105'
 where s.key = 'feature_flags' and jsonb_typeof(s.value) = 'object'
   and exists (select 1 from unnest(array['shortcuts', 'realestate_weekly', 'campaign_landings']) as k where not (s.value ? k));

-- 3. 설정 키 - 홈 바로가기 카드 한 줄 설명(공개) · 캠페인 태그 등록 값(비공개). 씨앗은 비어 있다 (문구·값은 PO 입력)
create function public.w10i_settings_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  e jsonb;
begin
  if new.key = 'shortcut_order' then
    -- 바로가기 순서 (HOME-12) - 상담 요청을 뺀 3개 키를 정확히 한 번씩, 순서만 바꾼다. 상담 요청은 항상 마지막(앱이 고정)
    if jsonb_typeof(new.value) <> 'array' or jsonb_array_length(new.value) <> 3
       or (select count(distinct x) from jsonb_array_elements_text(new.value) x where x in ('calc', 'realestate_weekly', 'brief_weekly')) <> 3 then
      raise exception 'shortcut_order는 calc·realestate_weekly·brief_weekly를 한 번씩 담은 목록이어야 합니다' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if jsonb_typeof(new.value) <> 'object' then
    raise exception '% 값은 객체여야 합니다', new.key using errcode = 'check_violation';
  end if;
  if new.key = 'home_shortcut_copy' then
    for k, v in select * from jsonb_each(new.value) loop
      if k not in ('calc', 'expert_request', 'brief_weekly', 'realestate_weekly') then
        raise exception 'home_shortcut_copy 키가 틀렸습니다: %', k using errcode = 'check_violation';
      end if;
      if jsonb_typeof(v) <> 'string' or char_length(btrim(v #>> '{}')) > 30 or (v #>> '{}') ~ '[\r\n]' then
        raise exception 'home_shortcut_copy.% 는 한 줄 30자 이하 글자여야 합니다', k using errcode = 'check_violation';
      end if;
    end loop;
  elsif new.key = 'campaign_utm_values' then
    for k, v in select * from jsonb_each(new.value) loop
      if k not in ('source', 'medium', 'content') then
        raise exception 'campaign_utm_values 키가 틀렸습니다: %', k using errcode = 'check_violation';
      end if;
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 20 then
        raise exception 'campaign_utm_values.% 는 20개 이하 목록이어야 합니다', k using errcode = 'check_violation';
      end if;
      for e in select * from jsonb_array_elements(v) loop
        if jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[a-z0-9][a-z0-9_-]{0,19}$' or (e #>> '{}') = 'other' then
          raise exception 'campaign_utm_values.% 값은 소문자·숫자·-·_ 20자 이하(other 제외)여야 합니다', k using errcode = 'check_violation';
        end if;
      end loop;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.w10i_settings_guard() from public, anon, authenticated;
create trigger settings_w10i_guard
  before insert or update on public.settings
  for each row when (new.key in ('home_shortcut_copy', 'campaign_utm_values', 'shortcut_order'))
  execute function public.w10i_settings_guard();

insert into public.settings (key, value, description, updated_by) values
  ('home_shortcut_copy', '{}'::jsonb, '홈 바로가기 카드 한 줄 설명 (HOME-13 - 키 calc·expert_request·brief_weekly·realestate_weekly, 각 30자 이하 한 줄. 비어 있으면 이름만 보인다. 문구는 PO 입력 - AI 작성 0)', 'migration:20261025000105'),
  ('shortcut_order', '["calc", "realestate_weekly", "brief_weekly"]'::jsonb, '바로가기 순서 (HOME-12·13 - 계산기·재테크 포인트·법령 해석 3개 키의 순서. SM 전문가 상담 요청은 순서에 넣지 않고 항상 마지막 강조 버튼. 관리자가 고친다)', 'migration:20261025000105'),
  ('campaign_utm_values', '{"source": [], "medium": [], "content": []}'::jsonb, '캠페인 태그 등록 값 (GROW-05 - utm_source·utm_medium·utm_content의 허용 값 목록. 목록 밖 값은 other로 바꿔 저장한다. 비어 있으면 모든 값이 other)', 'migration:20261025000105')
on conflict (key) do nothing;

create policy settings_public_home_shortcut_copy on public.settings
  for select to anon, authenticated
  using (key in ('home_shortcut_copy', 'shortcut_order'));

-- 4. 캠페인 랜딩 (GROW-03·04)
create table public.campaign_landings (
  id bigint generated always as identity primary key,
  campaign_key text not null unique check (campaign_key ~ '^[a-z0-9][a-z0-9-]{1,39}$' and campaign_key not in ('admin', 'api', 'go')),
  title text not null check (char_length(btrim(title)) between 1 and 30),
  body text not null check (char_length(btrim(body)) between 1 and 120),
  primary_target text not null check (primary_target in ('calc', 'expert_request', 'brief_weekly', 'realestate_weekly')),
  secondary_target text check (secondary_target in ('calc', 'expert_request', 'brief_weekly', 'realestate_weekly')),
  primary_tool text check (primary_tool in ('acquisition', 'holding', 'refund')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'withdrawn')),
  -- 광고 채널 (도착 제안용 - 제안일 뿐 관리자가 고른다. 문구 해시에는 넣지 않는다)
  channel text not null default 'other' check (channel in ('search', 'sns', 'display', 'email', 'other')),
  content_hash text not null default '',
  copy_check_hash text,
  created_by text not null check (length(btrim(created_by)) > 0),
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint campaign_landings_period check (starts_at < ends_at),
  constraint campaign_landings_secondary_differs check (secondary_target is null or secondary_target <> primary_target),
  constraint campaign_landings_tool_only_calc check (primary_tool is null or primary_target = 'calc'),
  constraint campaign_landings_approved_cols check ((status = 'approved') = (approved_by is not null and approved_at is not null))
);
comment on table public.campaign_landings is '캠페인 랜딩 (GROW-03) - 도착은 키 4개 중 하나뿐(주소 칸 없음). 상태는 함수만 바꾼다. 문구·도착·기간이 바뀌면 draft로 돌아간다';

-- 상태 보호 + 해시 계산 - 함수가 거치는 경로만 상태를 바꿀 수 있다 (거래 안 설정 ltr.campaign_fn)
create function public.campaign_landings_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_fn boolean := coalesce(current_setting('ltr.campaign_fn', true), '') = '1';
begin
  new.content_hash := md5(concat_ws('|', btrim(new.title), btrim(new.body), new.primary_target, coalesce(new.secondary_target, ''), coalesce(new.primary_tool, ''),
                                    new.starts_at::text, new.ends_at::text));
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.approved_by is not null or new.approved_at is not null or new.submitted_at is not null then
      raise exception '새 캠페인은 초안으로만 만들 수 있습니다' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if old.status = 'withdrawn' and not v_fn then
    raise exception '철회된 캠페인은 고칠 수 없습니다' using errcode = 'check_violation';
  end if;
  if not v_fn then
    if new.status is distinct from old.status or new.approved_by is distinct from old.approved_by
       or new.approved_at is distinct from old.approved_at or new.submitted_at is distinct from old.submitted_at then
      raise exception '상태·승인 칸은 승인 함수로만 바꿀 수 있습니다' using errcode = 'check_violation';
    end if;
    if new.content_hash is distinct from old.content_hash and old.status in ('submitted', 'approved') then
      new.status := 'draft';
      new.approved_by := null;
      new.approved_at := null;
      new.submitted_at := null;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.campaign_landings_guard() from public, anon, authenticated;
create trigger campaign_landings_guard
  before insert or update on public.campaign_landings
  for each row execute function public.campaign_landings_guard();

create function public.campaign_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% 는 추가만 할 수 있습니다', tg_table_name using errcode = 'check_violation';
end;
$$;
revoke all on function public.campaign_append_only() from public, anon, authenticated;

create table public.campaign_ad_reviews (
  id bigint generated always as identity primary key,
  landing_id bigint not null references public.campaign_landings (id) on delete restrict,
  content_hash text not null,
  reviewer text not null check (length(btrim(reviewer)) > 0),
  reviewed_at timestamptz not null default now(),
  basis_ref text not null check (length(btrim(basis_ref)) > 0),
  scope text[] not null check (cardinality(scope) >= 1 and scope <@ array['표시광고법', '세무사 광고 기준', '자본시장법']),
  result text not null check (result in ('approved', 'rejected')),
  note text
);
comment on table public.campaign_ad_reviews is '광고 표시 규칙 검토 기록 (GROW-04) - 문구 해시별. 추가만';
create trigger campaign_ad_reviews_append_only
  before update or delete on public.campaign_ad_reviews
  for each row execute function public.campaign_append_only();

create table public.campaign_audit (
  id bigint generated always as identity primary key,
  landing_id bigint references public.campaign_landings (id) on delete restrict,
  action text not null check (action in ('submit', 'review', 'approve', 'withdraw')),
  actor text not null,
  code text not null,
  at timestamptz not null default now()
);
comment on table public.campaign_audit is '캠페인 승인 감사 - 성공도 거부도 1행. 추가만';
create trigger campaign_audit_append_only
  before update or delete on public.campaign_audit
  for each row execute function public.campaign_append_only();

alter table public.campaign_landings enable row level security;
alter table public.campaign_ad_reviews enable row level security;
alter table public.campaign_audit enable row level security;
revoke all on table public.campaign_landings, public.campaign_ad_reviews, public.campaign_audit from public, anon, authenticated, service_role;
grant select, insert, update on table public.campaign_landings to service_role;
grant select, insert on table public.campaign_ad_reviews, public.campaign_audit to service_role;

create function public.campaign_audit_write(p_id bigint, p_action text, p_actor text, p_code text) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.campaign_audit (landing_id, action, actor, code)
  values (p_id, p_action, coalesce(nullif(btrim(p_actor), ''), 'unknown'), p_code);
$$;
revoke all on function public.campaign_audit_write(bigint, text, text, text) from public, anon, authenticated;

-- 제출 - 초안만
create function public.submit_campaign_landing(p_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.campaign_landings;
  v_code text := 'ok';
begin
  select * into v_row from public.campaign_landings where id = p_id for update;
  if not found then
    v_code := 'not_found';
  elsif v_row.status <> 'draft' then
    v_code := 'not_draft';
  else
    perform set_config('ltr.campaign_fn', '1', true);
    update public.campaign_landings set status = 'submitted', submitted_at = now() where id = p_id;
    perform set_config('ltr.campaign_fn', '', true);
  end if;
  perform public.campaign_audit_write(case when v_code = 'not_found' then null else p_id end, 'submit', p_actor, v_code);
  return jsonb_build_object('ok', v_code = 'ok', 'code', v_code, 'message', case v_code when 'ok' then '제출했습니다' when 'not_found' then '캠페인이 없습니다' else '초안만 제출할 수 있습니다' end);
end;
$$;
revoke all on function public.submit_campaign_landing(bigint, text) from public, anon, authenticated;
grant execute on function public.submit_campaign_landing(bigint, text) to service_role;

-- 광고 표시 규칙 검토 기록 붙이기 - 지금 문구 해시로 기록한다 (문구가 바뀌면 해시가 달라져 기록이 낡은 것이 된다)
create function public.record_campaign_ad_review(p_id bigint, p_reviewer text, p_basis_ref text, p_scope text[], p_result text, p_note text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_code text := 'ok';
begin
  select content_hash into v_hash from public.campaign_landings where id = p_id;
  if v_hash is null then
    v_code := 'not_found';
  elsif coalesce(btrim(p_reviewer), '') = '' or coalesce(btrim(p_basis_ref), '') = '' then
    v_code := 'review_incomplete';
  elsif p_scope is null or cardinality(p_scope) < 1 or not (p_scope <@ array['표시광고법', '세무사 광고 기준', '자본시장법']) then
    v_code := 'scope_invalid';
  elsif p_result not in ('approved', 'rejected') then
    v_code := 'result_invalid';
  else
    insert into public.campaign_ad_reviews (landing_id, content_hash, reviewer, basis_ref, scope, result, note)
    values (p_id, v_hash, btrim(p_reviewer), btrim(p_basis_ref), p_scope, p_result, p_note);
  end if;
  perform public.campaign_audit_write(case when v_code = 'not_found' then null else p_id end, 'review', p_reviewer, v_code);
  return jsonb_build_object('ok', v_code = 'ok', 'code', v_code, 'message', case v_code when 'ok' then '검토 기록을 붙였습니다' else '검토 기록을 붙일 수 없습니다' end);
end;
$$;
revoke all on function public.record_campaign_ad_review(bigint, text, text, text[], text, text) from public, anon, authenticated;
grant execute on function public.record_campaign_ad_review(bigint, text, text, text[], text, text) to service_role;

-- 승인 - 제출됨 + 작성자와 다른 승인자 + 지금 문구 해시의 통과한 검토 기록 + 지금 문구 해시의 문구 검사
create function public.approve_campaign_landing(p_id bigint, p_approver text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.campaign_landings;
  v_review public.campaign_ad_reviews;
  v_code text := 'ok';
begin
  select * into v_row from public.campaign_landings where id = p_id for update;
  if not found then
    v_code := 'not_found';
  elsif v_row.status <> 'submitted' then
    v_code := 'not_submitted';
  elsif coalesce(btrim(p_approver), '') = '' then
    v_code := 'approver_invalid';
  elsif lower(btrim(p_approver)) = lower(btrim(v_row.created_by)) then
    v_code := 'same_person';
  else
    select * into v_review from public.campaign_ad_reviews where landing_id = p_id order by id desc limit 1;
    if not found then
      v_code := 'review_missing';
    elsif v_review.content_hash <> v_row.content_hash then
      v_code := 'review_stale';
    elsif v_review.result <> 'approved' then
      v_code := 'review_rejected';
    elsif v_row.copy_check_hash is distinct from v_row.content_hash then
      v_code := 'copy_check_stale';
    end if;
  end if;
  if v_code = 'ok' then
    perform set_config('ltr.campaign_fn', '1', true);
    update public.campaign_landings set status = 'approved', approved_by = btrim(p_approver), approved_at = now() where id = p_id;
    perform set_config('ltr.campaign_fn', '', true);
  end if;
  perform public.campaign_audit_write(case when v_code = 'not_found' then null else p_id end, 'approve', p_approver, v_code);
  return jsonb_build_object('ok', v_code = 'ok', 'code', v_code, 'message', case v_code
    when 'ok' then '승인했습니다' when 'not_found' then '캠페인이 없습니다' when 'not_submitted' then '제출된 캠페인만 승인할 수 있습니다'
    when 'approver_invalid' then '승인자가 비어 있습니다' when 'same_person' then '작성자와 다른 사람이 승인해야 합니다'
    when 'review_missing' then '광고 표시 규칙 검토 기록이 없습니다' when 'review_stale' then '검토 기록 이후 문구·도착·기간이 바뀌었습니다'
    when 'review_rejected' then '검토 결과가 통과가 아닙니다' else '문구 검사를 다시 통과해야 합니다' end);
end;
$$;
revoke all on function public.approve_campaign_landing(bigint, text) from public, anon, authenticated;
grant execute on function public.approve_campaign_landing(bigint, text) to service_role;

-- 철회 - 철회됨이 아닌 모든 상태
create function public.withdraw_campaign_landing(p_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_code text := 'ok';
begin
  select status into v_status from public.campaign_landings where id = p_id for update;
  if v_status is null then
    v_code := 'not_found';
  elsif v_status = 'withdrawn' then
    v_code := 'already_withdrawn';
  else
    perform set_config('ltr.campaign_fn', '1', true);
    update public.campaign_landings set status = 'withdrawn', approved_by = null, approved_at = null where id = p_id;
    perform set_config('ltr.campaign_fn', '', true);
  end if;
  perform public.campaign_audit_write(case when v_code = 'not_found' then null else p_id end, 'withdraw', p_actor, v_code);
  return jsonb_build_object('ok', v_code = 'ok', 'code', v_code, 'message', case v_code when 'ok' then '철회했습니다' when 'not_found' then '캠페인이 없습니다' else '이미 철회됐습니다' end);
end;
$$;
revoke all on function public.withdraw_campaign_landing(bigint, text) from public, anon, authenticated;
grant execute on function public.withdraw_campaign_landing(bigint, text) to service_role;

-- 공개 뷰 - 승인되고 시작된 캠페인. 끝난 캠페인(state = ended)은 문구 칸이 null. 기능 키가 꺼지면 0행
create view public.public_campaign_landings as
select c.campaign_key,
       case when c.ends_at > now() then c.title end as title,
       case when c.ends_at > now() then c.body end as body,
       c.primary_target,
       case when c.ends_at > now() then c.secondary_target end as secondary_target,
       c.primary_tool,
       case when c.ends_at > now() then 'live' else 'ended' end as state
  from public.campaign_landings c
 where c.status = 'approved' and c.starts_at <= now()
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'campaign_landings') = 'true'::jsonb);
comment on view public.public_campaign_landings is '공개 캠페인 랜딩 (GROW-03) - 승인·시작된 행만, 끝난 행은 문구 null, 기능 키 꺼짐이면 0행';
revoke all on table public.public_campaign_landings from public, anon, authenticated, service_role;
grant select on table public.public_campaign_landings to anon, authenticated, service_role;

-- 5. 이번 주 재테크 포인트 (PR-15)
create table public.realestate_weekly_issues (
  id bigint generated always as identity primary key,
  week text not null unique check (week ~ '^[0-9]{4}-[0-9]{2}$'),
  status text not null default 'draft' check (status in ('draft', 'approved', 'published', 'withdrawn')),
  edited_by text not null check (length(btrim(edited_by)) > 0),
  approved_by text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  constraint realestate_weekly_published_cols check ((status = 'published') = (approved_by is not null and published_at is not null) or status = 'withdrawn')
);
comment on table public.realestate_weekly_issues is '이번 주 재테크 포인트 호 (PR-15) - 주(ISO yyyy-ww, Asia/Seoul)마다 1호. 발행은 publish_realestate_weekly()로만';

create table public.realestate_weekly_items (
  id bigint generated always as identity primary key,
  issue_id bigint not null references public.realestate_weekly_issues (id) on delete cascade,
  article_id bigint not null references public.articles (id) on delete restrict,
  rank smallint not null check (rank between 1 and 7),
  tax_items text[] not null check (cardinality(tax_items) >= 1),
  point text not null check (char_length(btrim(point)) between 1 and 60),
  unique (issue_id, article_id),
  unique (issue_id, rank)
);
comment on table public.realestate_weekly_items is '재테크 포인트 항목 - 기사 · 순서 · 관련 세목 · 세금 관점 한 줄. 가격·분담금·수익률·시세 칸 없음 (자본시장법)';

create table public.realestate_weekly_audit (
  id bigint generated always as identity primary key,
  issue_id bigint references public.realestate_weekly_issues (id) on delete restrict,
  action text not null,
  actor text not null,
  code text not null,
  at timestamptz not null default now()
);
create trigger realestate_weekly_audit_append_only
  before update or delete on public.realestate_weekly_audit
  for each row execute function public.campaign_append_only();

create function public.realestate_weekly_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_fn boolean := coalesce(current_setting('ltr.weekly_fn', true), '') = '1';
  v_status text;
begin
  if tg_table_name = 'realestate_weekly_issues' then
    if tg_op = 'INSERT' then
      if new.status <> 'draft' or new.approved_by is not null or new.published_at is not null then
        raise exception '새 호는 초안으로만 만들 수 있습니다' using errcode = 'check_violation';
      end if;
    elsif not v_fn then
      if new.status is distinct from old.status or new.approved_by is distinct from old.approved_by or new.published_at is distinct from old.published_at then
        raise exception '상태·발행 칸은 발행 함수로만 바꿀 수 있습니다' using errcode = 'check_violation';
      end if;
      if old.status in ('published', 'withdrawn') and new.week is distinct from old.week then
        raise exception '발행된 호의 주는 바꿀 수 없습니다' using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end if;
  -- 항목: 발행·철회된 호는 고치지 못한다
  select status into v_status from public.realestate_weekly_issues where id = coalesce(case when tg_op = 'DELETE' then old.issue_id else new.issue_id end, 0);
  if v_status in ('published', 'withdrawn') and not v_fn then
    raise exception '발행된 호의 항목은 고칠 수 없습니다' using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.realestate_weekly_guard() from public, anon, authenticated;
create trigger realestate_weekly_issues_guard
  before insert or update on public.realestate_weekly_issues
  for each row execute function public.realestate_weekly_guard();
create trigger realestate_weekly_items_guard
  before insert or update or delete on public.realestate_weekly_items
  for each row execute function public.realestate_weekly_guard();

alter table public.realestate_weekly_issues enable row level security;
alter table public.realestate_weekly_items enable row level security;
alter table public.realestate_weekly_audit enable row level security;
revoke all on table public.realestate_weekly_issues, public.realestate_weekly_items, public.realestate_weekly_audit from public, anon, authenticated, service_role;
grant select, insert, update on table public.realestate_weekly_issues to service_role;
grant select, insert, update, delete on table public.realestate_weekly_items to service_role;
grant select, insert on table public.realestate_weekly_audit to service_role;

-- 발행 - 항목 3~7건 · 기사가 모두 공개 상태 · 부동산재테크 분야 · 그 주(월~일, Asia/Seoul)에 처음 발행된 기사
create function public.publish_realestate_weekly(p_issue_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_issue public.realestate_weekly_issues;
  v_count int;
  v_bad int;
  v_code text := 'ok';
begin
  select * into v_issue from public.realestate_weekly_issues where id = p_issue_id for update;
  if not found then
    v_code := 'not_found';
  elsif v_issue.status not in ('draft', 'approved') then
    v_code := 'not_publishable';
  elsif coalesce(btrim(p_actor), '') = '' then
    v_code := 'actor_invalid';
  else
    select count(*) into v_count from public.realestate_weekly_items where issue_id = p_issue_id;
    if v_count < 3 then
      v_code := 'items_too_few';
    elsif v_count > 7 then
      v_code := 'items_too_many';
    else
      select count(*) into v_bad from public.realestate_weekly_items i
        left join public.public_articles a on a.id = i.article_id
       where i.issue_id = p_issue_id and a.id is null;
      if v_bad > 0 then
        v_code := 'article_not_public';
      else
        select count(*) into v_bad from public.realestate_weekly_items i
          join public.public_articles a on a.id = i.article_id
         where i.issue_id = p_issue_id and a.section <> 'realestate';
        if v_bad > 0 then
          v_code := 'wrong_section';
        else
          select count(*) into v_bad from public.realestate_weekly_items i
            join public.public_articles a on a.id = i.article_id
           where i.issue_id = p_issue_id and to_char(a.first_published_at at time zone 'Asia/Seoul', 'IYYY-IW') <> v_issue.week;
          if v_bad > 0 then
            v_code := 'wrong_week';
          end if;
        end if;
      end if;
    end if;
  end if;
  if v_code = 'ok' then
    perform set_config('ltr.weekly_fn', '1', true);
    update public.realestate_weekly_issues set status = 'published', approved_by = btrim(p_actor), published_at = now() where id = p_issue_id;
    perform set_config('ltr.weekly_fn', '', true);
  end if;
  insert into public.realestate_weekly_audit (issue_id, action, actor, code)
  values (case when v_code = 'not_found' then null else p_issue_id end, 'publish', coalesce(nullif(btrim(p_actor), ''), 'unknown'), v_code);
  return jsonb_build_object('ok', v_code = 'ok', 'code', v_code, 'message', case v_code
    when 'ok' then '발행했습니다' when 'not_found' then '호가 없습니다' when 'not_publishable' then '초안만 발행할 수 있습니다'
    when 'actor_invalid' then '발행자가 비어 있습니다' when 'items_too_few' then '항목은 3건 이상이어야 합니다' when 'items_too_many' then '항목은 7건 이하여야 합니다'
    when 'article_not_public' then '공개 상태가 아닌 기사가 있습니다' when 'wrong_section' then '부동산재테크 분야 기사만 넣을 수 있습니다'
    else '그 주에 발행된 기사만 넣을 수 있습니다' end);
end;
$$;
revoke all on function public.publish_realestate_weekly(bigint, text) from public, anon, authenticated;
grant execute on function public.publish_realestate_weekly(bigint, text) to service_role;

-- 공개 뷰 - 발행된 호의 항목 + 공개 기사 제목·주소. 기능 키 꺼짐이면 0행
create view public.public_realestate_weekly as
select i.id as issue_id, i.week, i.published_at, it.rank, it.tax_items, it.point, a.id as article_id, a.slug, a.title
  from public.realestate_weekly_issues i
  join public.realestate_weekly_items it on it.issue_id = i.id
  join public.public_articles a on a.id = it.article_id
 where i.status = 'published'
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'realestate_weekly') = 'true'::jsonb);
comment on view public.public_realestate_weekly is '공개 이번 주 재테크 포인트 (PR-15) - 발행된 호만, 기능 키 꺼짐이면 0행';
revoke all on table public.public_realestate_weekly from public, anon, authenticated, service_role;
grant select on table public.public_realestate_weekly to anon, authenticated, service_role;
