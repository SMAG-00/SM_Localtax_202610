-- W10-e e2 - 주간 브리핑·구독·알림 (PRD-02 BRIEF-01~04 · HOME-09 · TX-12, docs/dev/W10-e_설계.md 3장)
-- 이 파일에 법령·세무 문장, 발행인·감수·면책 문구는 없다 - 문구는 settings.brief_publish_policy 빈 칸에 PO가 넣는다.
--
-- · consents 확장 - kind brief·amendment_alert 추가(평문 이메일 칸은 새로 만들지 않고 기존 칸을 같은 규칙으로 쓴다), 재확인 칸 3개.
--   확인(confirmed_at)이 채워질 때 재확인 기한(reconfirm_due)을 한국 날짜 + 주기(settings.brief_reconfirm_policy.interval_months, 없으면 24개월)로 채운다.
-- · privacy_purge_rows - 확인 안 된 신청·철회된 동의 삭제 대상에 새 kind 두 개를 더한다(시그니처·반환 모양 그대로).
-- · subscriber_prefs - 알림 구독(kind amendment_alert)의 관심 세목·개정안 번호. 이메일 칸 없음.
-- · brief_issues - 호별 초안·승인·발행. 승인·발행 뒤에는 본문을 고칠 수 없고, 상태 전이는 함수만.
-- · alert_deliveries - (동의, 종류, 참조) 유일. 재실행해도 수신자당 1통.
-- · 수신자 선택 함수 - 이중 확인 완료·미철회·재확인 기한 안·미발송만. service_role만 실행.
-- 모든 표는 RLS 기본 거부. 공개는 public_brief_issues 뷰 하나(발행된 일반 호의 공개 칸만).

-- ─────────────────────────────────────────────────────────────
-- consents 확장
-- ─────────────────────────────────────────────────────────────
alter table public.consents drop constraint consents_kind_check;
alter table public.consents add constraint consents_kind_check
  check (kind in ('signup', 'receive', 'marketing', 'brief_prereg', 'brief', 'amendment_alert'));
alter table public.consents drop constraint consents_email_only_prereg;
alter table public.consents add constraint consents_email_only_prereg
  check (email is null or kind in ('brief_prereg', 'brief', 'amendment_alert'));

alter table public.consents
  add column reconfirm_due date,
  add column reconfirm_notified_at timestamptz,
  add column last_reconfirmed_at timestamptz;

alter table public.consents add constraint consents_reconfirm_kind check (reconfirm_due is null or kind in ('brief', 'amendment_alert'));

comment on column public.consents.reconfirm_due is '재확인 기한(한국 날짜) - 브리핑·알림 구독만. 기한 다음 날부터 발송 대상에서 빠진다 (BRIEF-02, 무응답 = 발송 중지)';

create function public.consents_set_reconfirm_due() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_months integer;
begin
  if tg_op = 'UPDATE' and old.confirmed_at is not null then
    return new;
  end if;
  if new.kind in ('brief', 'amendment_alert') and new.confirmed_at is not null and new.reconfirm_due is null then
    select coalesce((s.value ->> 'interval_months')::integer, 24) into v_months from public.settings s where s.key = 'brief_reconfirm_policy';
    new.reconfirm_due := (new.confirmed_at at time zone 'Asia/Seoul')::date + make_interval(months => coalesce(v_months, 24));
  end if;
  return new;
end;
$$;
revoke all on function public.consents_set_reconfirm_due() from public, anon, authenticated;
create trigger consents_set_reconfirm_due before insert or update of confirmed_at on public.consents
  for each row execute function public.consents_set_reconfirm_due();

-- 재확인 완료 - 기한을 오늘 + 주기로 미룬다. 확인된 미철회 구독만
create function public.consent_reconfirm(p_consent_id bigint, p_today date) returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_months integer;
  v_due date;
begin
  select coalesce((s.value ->> 'interval_months')::integer, 24) into v_months from public.settings s where s.key = 'brief_reconfirm_policy';
  update public.consents
     set reconfirm_due = p_today + make_interval(months => coalesce(v_months, 24)), last_reconfirmed_at = now(), reconfirm_notified_at = null
   where id = p_consent_id and kind in ('brief', 'amendment_alert') and confirmed_at is not null and revoked_at is null
   returning reconfirm_due into v_due;
  if v_due is null then
    raise exception '재확인할 수 있는 구독이 아닙니다 (번호 %)', p_consent_id using errcode = 'check_violation';
  end if;
  return v_due;
end;
$$;

-- 개인정보 보존 정리 - 새 kind 두 개도 같은 규칙 (확인 안 된 신청, 철회 뒤 일정 기간)
create or replace function public.privacy_purge_rows(
  p_now timestamptz,
  p_unconfirmed_prereg_days integer,
  p_revoked_days integer,
  p_contact_days integer
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prereg integer;
  v_revoked integer;
  v_contacts integer;
begin
  if p_now is null
     or p_unconfirmed_prereg_days is null or p_unconfirmed_prereg_days not between 1 and 3650
     or p_revoked_days is null or p_revoked_days not between 1 and 3650
     or p_contact_days is null or p_contact_days not between 1 and 3650 then
    raise exception 'privacy_purge_rows: 기준 시각 또는 일수가 맞지 않습니다' using errcode = '22023';
  end if;

  delete from public.consents
   where kind in ('brief_prereg', 'brief', 'amendment_alert') and email is not null and confirmed_at is null and revoked_at is null
     and created_at <= p_now - make_interval(days => p_unconfirmed_prereg_days);
  get diagnostics v_prereg = row_count;

  delete from public.consents
   where kind in ('brief_prereg', 'brief', 'amendment_alert') and revoked_at is not null
     and revoked_at <= p_now - make_interval(days => p_revoked_days);
  get diagnostics v_revoked = row_count;

  update public.inquiries
     set contact_name = null, organization = null, contact_email = null, contact_cleared_at = now()
   where status = 'done' and done_at is not null and done_at <= p_now - make_interval(days => p_contact_days)
     and contact_cleared_at is null
     and (contact_name is not null or organization is not null or contact_email is not null);
  get diagnostics v_contacts = row_count;

  return jsonb_build_object('unconfirmed_prereg', v_prereg, 'revoked_consents', v_revoked, 'contacts_cleared', v_contacts);
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- subscriber_prefs
-- ─────────────────────────────────────────────────────────────
create table public.subscriber_prefs (
  consent_id bigint primary key references public.consents (id) on delete cascade,
  tax_kinds text[] not null default '{}' check (cardinality(tax_kinds) <= 12
    and array_to_string(tax_kinds, ',') ~ '^([a-z0-9]+(-[a-z0-9]+)*)?(,[a-z0-9]+(-[a-z0-9]+)*)*$'),
  amendment_ids bigint[] not null default '{}' check (cardinality(amendment_ids) <= 50),
  include_docs boolean not null default false,
  updated_at timestamptz not null default now()
);
comment on table public.subscriber_prefs is '관심 세목·개정안 알림 설정 (TX-12) - 알림 구독(kind amendment_alert)에만. 이메일 칸 없음, service_role만';

create function public.subscriber_prefs_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.consents c where c.id = new.consent_id and c.kind = 'amendment_alert') then
    raise exception '관심 세목·개정안 설정은 알림 구독에만 둘 수 있습니다' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.subscriber_prefs_guard() from public, anon, authenticated;
create trigger subscriber_prefs_guard before insert or update on public.subscriber_prefs
  for each row execute function public.subscriber_prefs_guard();

alter table public.subscriber_prefs enable row level security;
revoke all on table public.subscriber_prefs from anon, authenticated, service_role;
grant select, insert, update, delete on table public.subscriber_prefs to service_role;

-- ─────────────────────────────────────────────────────────────
-- brief_issues
-- ─────────────────────────────────────────────────────────────
create table public.brief_issues (
  id bigint generated always as identity primary key,
  issue_no integer not null unique check (issue_no >= 0),
  kind text not null default 'regular' check (kind in ('regular', 'premium')),
  title text not null check (length(btrim(title)) between 1 and 200),
  publish_at timestamptz not null,
  corners jsonb not null default '[]'::jsonb check (jsonb_typeof(corners) = 'array' and pg_column_size(corners) <= 262144),
  source_excerpts jsonb not null default '{}'::jsonb check (jsonb_typeof(source_excerpts) = 'object' and pg_column_size(source_excerpts) <= 1048576),
  has_ad boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'approved', 'published', 'withdrawn')),
  check_report jsonb check (check_report is null or jsonb_typeof(check_report) = 'object'),
  warnings_ack_by text,
  approved_by text,
  approved_at timestamptz,
  published_at timestamptz,
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brief_issues_approved check (status not in ('approved', 'published') or (length(btrim(coalesce(approved_by, ''))) > 0 and approved_at is not null)),
  constraint brief_issues_published check ((status = 'published') = (published_at is not null)),
  constraint brief_issues_once_per_slot unique (kind, publish_at)
);
comment on table public.brief_issues is '브리핑 호 (BRIEF-01) - 승인 전에는 공개 0. 본문(corners)에 원문 발췌는 없고 source_excerpts(비공개)에 있다. 승인·발행 뒤 본문 고치기 거부';
comment on column public.brief_issues.corners is '코너 배열 [{key,title,items:[{id,text,origin,reviewed,sourceUrl,amendment}],emptyNote}] - 웹·메일·4단계 채널이 코너 단위로 쓴다';

create function public.brief_issues_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_content_changed boolean;
begin
  if tg_op = 'DELETE' then
    raise exception '브리핑 호는 지울 수 없습니다 - 발행 전 취소는 상태를 withdrawn으로' using errcode = 'insufficient_privilege';
  end if;
  v_content_changed := new.title is distinct from old.title or new.corners is distinct from old.corners
    or new.has_ad is distinct from old.has_ad or new.source_excerpts is distinct from old.source_excerpts
    or new.issue_no is distinct from old.issue_no or new.kind is distinct from old.kind or new.publish_at is distinct from old.publish_at;
  if new.status is distinct from old.status and coalesce(current_setting('ltr.brief_write', true), '') <> '1' then
    raise exception '브리핑 호의 상태는 승인·발행 함수로만 바꿀 수 있습니다' using errcode = 'insufficient_privilege';
  end if;
  if old.status in ('approved', 'published', 'withdrawn') and v_content_changed then
    raise exception '승인·발행된 호의 본문은 고칠 수 없습니다 (현재 %)', old.status using errcode = 'check_violation';
  end if;
  if old.status = 'draft' and v_content_changed then
    new.check_report := null;
    new.warnings_ack_by := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.brief_issues_guard() from public, anon, authenticated;
create trigger brief_issues_guard before update or delete on public.brief_issues
  for each row execute function public.brief_issues_guard();

-- 승인 - 검사 보고서가 있고 차단 0, 경고가 있으면 확인자, AI가 쓴 항목은 모두 검수 완료
create function public.brief_issue_approve(p_id bigint, p_actor text, p_ack_by text default null) returns public.brief_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.brief_issues;
  v_blocking integer;
  v_warnings integer;
begin
  if length(btrim(coalesce(p_actor, ''))) = 0 then
    raise exception '승인하는 사람이 필요합니다' using errcode = 'check_violation';
  end if;
  select * into r from public.brief_issues where id = p_id for update;
  if not found then
    raise exception '브리핑 호 %가 없습니다', p_id using errcode = 'no_data_found';
  end if;
  if r.status <> 'draft' then
    raise exception '초안만 승인할 수 있습니다 (현재 %)', r.status using errcode = 'check_violation';
  end if;
  if r.check_report is null then
    raise exception '검사기 8종을 먼저 돌려야 승인할 수 있습니다' using errcode = 'check_violation';
  end if;
  v_blocking := coalesce((r.check_report ->> 'blocking')::integer, 1);
  v_warnings := coalesce((r.check_report ->> 'warnings')::integer, 0);
  if v_blocking > 0 then
    raise exception '검사기 차단 항목 %건이 있어 승인할 수 없습니다', v_blocking using errcode = 'check_violation';
  end if;
  if v_warnings > 0 and length(btrim(coalesce(p_ack_by, ''))) = 0 then
    raise exception '경고 %건은 검수자 확인 표시 뒤에 승인할 수 있습니다', v_warnings using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from jsonb_array_elements(r.corners) c, jsonb_array_elements(coalesce(c -> 'items', '[]'::jsonb)) i
     where i ->> 'origin' = 'ai' and coalesce((i ->> 'reviewed')::boolean, false) = false) then
    raise exception 'AI가 쓴 항목은 검수자가 확인한 뒤에 승인할 수 있습니다' using errcode = 'check_violation';
  end if;
  perform set_config('ltr.brief_write', '1', true);
  update public.brief_issues set status = 'approved', approved_by = p_actor, approved_at = now(),
         warnings_ack_by = case when v_warnings > 0 then btrim(p_ack_by) else null end
   where id = p_id returning * into r;
  perform set_config('ltr.brief_write', '', true);
  return r;
end;
$$;

-- 승인 취소 - 발행 전이면 초안으로 되돌려 다시 고칠 수 있다 (보고서는 비운다)
create function public.brief_issue_unapprove(p_id bigint, p_actor text) returns public.brief_issues
language plpgsql
security definer
set search_path = ''
as $$
declare r public.brief_issues;
begin
  if length(btrim(coalesce(p_actor, ''))) = 0 then
    raise exception '취소하는 사람이 필요합니다' using errcode = 'check_violation';
  end if;
  select * into r from public.brief_issues where id = p_id for update;
  if not found then raise exception '브리핑 호 %가 없습니다', p_id using errcode = 'no_data_found'; end if;
  if r.status <> 'approved' then
    raise exception '승인된 호만 승인 취소할 수 있습니다 (현재 %)', r.status using errcode = 'check_violation';
  end if;
  perform set_config('ltr.brief_write', '1', true);
  update public.brief_issues set status = 'draft', approved_by = null, approved_at = null, warnings_ack_by = null, check_report = null where id = p_id returning * into r;
  perform set_config('ltr.brief_write', '', true);
  return r;
end;
$$;

-- 발행 - 승인된 호가 발행 시각(publish_at) 이상일 때만. 이미 발행된 호는 'already'
create function public.brief_issue_publish(p_id bigint, p_now timestamptz default now()) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare r public.brief_issues;
begin
  select * into r from public.brief_issues where id = p_id for update;
  if not found then raise exception '브리핑 호 %가 없습니다', p_id using errcode = 'no_data_found'; end if;
  if r.status = 'published' then return 'already'; end if;
  if r.status <> 'approved' then return 'not_approved'; end if;
  if r.publish_at > p_now then return 'not_due'; end if;
  perform set_config('ltr.brief_write', '1', true);
  update public.brief_issues set status = 'published', published_at = p_now where id = p_id;
  perform set_config('ltr.brief_write', '', true);
  return 'published';
end;
$$;

create function public.brief_issues_due(p_now timestamptz default now()) returns table (id bigint, issue_no integer, kind text, publish_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select b.id, b.issue_no, b.kind, b.publish_at from public.brief_issues b
   where b.status = 'approved' and b.publish_at <= p_now order by b.publish_at, b.id;
$$;

alter table public.brief_issues enable row level security;
revoke all on table public.brief_issues from anon, authenticated, service_role;
grant select, insert, update on table public.brief_issues to service_role;

-- 공개 뷰 - 발행된 일반 호의 공개 칸만 (원문 발췌·검사 보고서·승인자 없음). 프리미엄 호는 W10-f 유료 본문 경로
create view public.public_brief_issues as
select b.issue_no, b.title, b.publish_at, b.corners, b.has_ad, b.published_at
  from public.brief_issues b
 where b.status = 'published' and b.kind = 'regular';
comment on view public.public_brief_issues is '발행된 일반 브리핑 호의 공개 칸 (BRIEF-01) - 승인 전 호·원문 발췌·검사 보고서 0';
revoke all on table public.public_brief_issues from public, anon, authenticated, service_role;
grant select on table public.public_brief_issues to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- alert_deliveries
-- ─────────────────────────────────────────────────────────────
create table public.alert_deliveries (
  id bigint generated always as identity primary key,
  consent_id bigint not null references public.consents (id) on delete cascade,
  delivery_kind text not null check (delivery_kind in ('brief_issue', 'amendment_alert', 'reconfirm', 'prereg_notice')),
  ref text not null check (length(btrim(ref)) between 1 and 100),
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint alert_deliveries_once unique (consent_id, delivery_kind, ref),
  constraint alert_deliveries_sent check ((status = 'sent') = (sent_at is not null))
);
comment on table public.alert_deliveries is '발송 기록 (TX-12 · BRIEF-02) - (동의, 종류, 참조) 유일이라 발송 작업을 다시 돌려도 수신자당 1통. 이메일 칸 없음';

-- 발송 자리 잡기 - 처음이면 true, 실패 기록은 3회까지 다시 true, 이미 있거나 보냈으면 false
create function public.alert_delivery_claim(p_consent_id bigint, p_kind text, p_ref text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows integer;
begin
  insert into public.alert_deliveries (consent_id, delivery_kind, ref) values (p_consent_id, p_kind, p_ref)
  on conflict (consent_id, delivery_kind, ref) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then return true; end if;
  update public.alert_deliveries set status = 'queued', attempts = attempts + 1
   where consent_id = p_consent_id and delivery_kind = p_kind and ref = p_ref and status = 'failed' and attempts < 3;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

create function public.alert_delivery_mark(p_consent_id bigint, p_kind text, p_ref text, p_ok boolean) returns void
language sql
security definer
set search_path = ''
as $$
  update public.alert_deliveries
     set status = case when p_ok then 'sent' else 'failed' end, sent_at = case when p_ok then now() else null end
   where consent_id = p_consent_id and delivery_kind = p_kind and ref = p_ref and status = 'queued';
$$;

alter table public.alert_deliveries enable row level security;
revoke all on table public.alert_deliveries from anon, authenticated, service_role;
grant select on table public.alert_deliveries to service_role;

-- ─────────────────────────────────────────────────────────────
-- 수신자 선택 (service_role만)
-- ─────────────────────────────────────────────────────────────
-- 브리핑 호 수신자 - 이중 확인 완료 · 미철회 · 재확인 기한 안(기한 당일까지) · 아직 안 보냄. 일반 호는 이메일 구독자, 프리미엄 권한 확인은 앱이 한다
create function public.brief_recipients(p_issue_id bigint, p_today date) returns table (consent_id bigint, email text)
language sql
stable
set search_path = ''
as $$
  select c.id, c.email from public.consents c
   where c.kind = 'brief' and c.email is not null and c.confirmed_at is not null and c.revoked_at is null
     and (c.reconfirm_due is null or c.reconfirm_due >= p_today)
     and exists (select 1 from public.brief_issues b where b.id = p_issue_id and b.status = 'published')
     and not exists (select 1 from public.alert_deliveries d where d.consent_id = c.id and d.delivery_kind = 'brief_issue' and d.ref = p_issue_id::text and d.status = 'sent')
   order by c.id;
$$;

-- 개정 알림 수신자 - 공개 개정안의 건너뛰지 않은 원 기록 1건에 대해, 관심 세목(연결 기사의 분야 slug) 또는 개정안 번호가 맞는 알림 구독자
create function public.amendment_alert_recipients(p_event_id bigint, p_today date) returns table (consent_id bigint, email text)
language sql
stable
set search_path = ''
as $$
  select c.id, c.email
    from public.amendment_events e
    join public.amendments a on a.id = e.amendment_id and a.status = 'public'
    join public.consents c on c.kind = 'amendment_alert' and c.email is not null and c.confirmed_at is not null and c.revoked_at is null
                          and (c.reconfirm_due is null or c.reconfirm_due >= p_today)
    join public.subscriber_prefs p on p.consent_id = c.id
   where e.id = p_event_id and not e.skipped and e.correction_of is null
     and (a.id = any (p.amendment_ids)
          or exists (select 1 from public.articles ar join public.categories ca on ca.id = ar.category_id
                      where ar.status = 'published' and ca.slug = any (p.tax_kinds)
                        and (ar.amendment_id = a.id or exists (select 1 from public.article_amendments aa where aa.article_id = ar.id and aa.amendment_id = a.id))))
     and not exists (select 1 from public.alert_deliveries d where d.consent_id = c.id and d.delivery_kind = 'amendment_alert' and d.ref = p_event_id::text and d.status = 'sent')
   order by c.id;
$$;

-- 최근 7일 안에 기록된 공개 개정안의 단계 기록 - 알림 작업이 돌 대상
create function public.amendment_alert_pending(p_now timestamptz) returns table (event_id bigint)
language sql
stable
set search_path = ''
as $$
  select e.id from public.amendment_events e join public.amendments a on a.id = e.amendment_id and a.status = 'public'
   where not e.skipped and e.correction_of is null and e.recorded_at > p_now - interval '7 days' and e.recorded_at <= p_now
   order by e.id;
$$;

-- 재확인 안내 대상 - 기한이 오늘(한국 날짜)인 확인된 미철회 구독. 전날 0, 다음 날 0
create function public.reconfirm_due_today(p_today date) returns table (consent_id bigint, email text, kind text)
language sql
stable
set search_path = ''
as $$
  select c.id, c.email, c.kind from public.consents c
   where c.kind in ('brief', 'amendment_alert') and c.email is not null and c.confirmed_at is not null and c.revoked_at is null
     and c.reconfirm_due = p_today
     and not exists (select 1 from public.alert_deliveries d where d.consent_id = c.id and d.delivery_kind = 'reconfirm' and d.ref = p_today::text and d.status = 'sent')
   order by c.id;
$$;

-- 사전 알림 신청자 안내 대상 (HOME-09) - 이중 확인한 사전 알림만. 구독 동의로 자동 전환하지 않는다
create function public.prereg_notice_recipients() returns table (consent_id bigint, email text)
language sql
stable
set search_path = ''
as $$
  select c.id, c.email from public.consents c
   where c.kind = 'brief_prereg' and c.email is not null and c.confirmed_at is not null and c.revoked_at is null
     and not exists (select 1 from public.alert_deliveries d where d.consent_id = c.id and d.delivery_kind = 'prereg_notice' and d.ref = 'first_issue' and d.status = 'sent')
   order by c.id;
$$;

revoke all on function public.consent_reconfirm(bigint, date) from public, anon, authenticated;
revoke all on function public.privacy_purge_rows(timestamptz, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.brief_issue_approve(bigint, text, text) from public, anon, authenticated;
revoke all on function public.brief_issue_unapprove(bigint, text) from public, anon, authenticated;
revoke all on function public.brief_issue_publish(bigint, timestamptz) from public, anon, authenticated;
revoke all on function public.brief_issues_due(timestamptz) from public, anon, authenticated;
revoke all on function public.alert_delivery_claim(bigint, text, text) from public, anon, authenticated;
revoke all on function public.alert_delivery_mark(bigint, text, text, boolean) from public, anon, authenticated;
revoke all on function public.brief_recipients(bigint, date) from public, anon, authenticated;
revoke all on function public.amendment_alert_recipients(bigint, date) from public, anon, authenticated;
revoke all on function public.amendment_alert_pending(timestamptz) from public, anon, authenticated;
revoke all on function public.reconfirm_due_today(date) from public, anon, authenticated;
revoke all on function public.prereg_notice_recipients() from public, anon, authenticated;
grant execute on function public.consent_reconfirm(bigint, date) to service_role;
grant execute on function public.privacy_purge_rows(timestamptz, integer, integer, integer) to service_role;
grant execute on function public.brief_issue_approve(bigint, text, text) to service_role;
grant execute on function public.brief_issue_unapprove(bigint, text) to service_role;
grant execute on function public.brief_issue_publish(bigint, timestamptz) to service_role;
grant execute on function public.brief_issues_due(timestamptz) to service_role;
grant execute on function public.alert_delivery_claim(bigint, text, text) to service_role;
grant execute on function public.alert_delivery_mark(bigint, text, text, boolean) to service_role;
grant execute on function public.brief_recipients(bigint, date) to service_role;
grant execute on function public.amendment_alert_recipients(bigint, date) to service_role;
grant execute on function public.amendment_alert_pending(timestamptz) to service_role;
grant execute on function public.reconfirm_due_today(date) to service_role;
grant execute on function public.prereg_notice_recipients() to service_role;
