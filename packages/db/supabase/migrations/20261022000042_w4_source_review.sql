-- W4 6단계 — 원문 변경·시점 만료 검수 큐 (PRD-01B REG1-13 · PR-03 · PR-10, docs/dev/W4_설계.md 1장 6단계 · 2.1 · 2.2 · 3장 · 12장 #23)
-- 이 파일에 실제 공식 자료·원문 글자는 없다 — 편집국이 원문을 다시 받는다(수동 — 자동 재수집은 2단계). 값 목록과 규칙만 정한다.
-- · source_review_queue — 대상(target_type: article_source · project_event · dev_method_fact) × 사유(reason: snapshot_changed · expired).
--     (대상, 사유)마다 열린 항목 하나. 같은 새 해시로는 대상마다 한 번만, 같은 확인일로는 만료 항목 한 번만 (해결 뒤 같은 원인으로 다시 열지 않는다).
--     프로젝트 단계·개발방법 사실 행은 표가 아직 없다 — 12·18단계가 대상 검사(source_review_target_guard)를 바꿔 연다. 지금은 공식 자료 출처만 받는다.
--     열린 항목은 해결(resolved — 해결한 사람·시각 필수)로만 바뀐다. 다른 칸은 고칠 수 없고, 해결된 항목을 다시 열 수 없다.
-- · 원문 다시 받기 (source_snapshot_refetched) — 편집자가 받은(웹 앱이 원문 주소에서 받거나 편집자가 붙여 넣은) 원문의 해시를 받아
--     원본 스냅샷(raw_snapshots — 같은 주소·같은 해시면 기존 행)을 남기고, 그 주소를 쓴 공식 자료(대체되지 않은 official_doc·dataset, 삭제 기사 제외)마다
--     자기 스냅샷 해시와 다르면 검수 항목 1건. 같은 해시 0 · 스냅샷 없는 출처는 비교하지 않는다(센 수만). 출처 행·원본 스냅샷 행은 고치지 않는다(REG1-09).
-- · 시점 만료 (source_expiry_scan — 배치 workflows source-expiry, 실행 키 = 한국 날짜) — 발행(예약)된 기사의 대체되지 않은 공식 자료 중
--     확인일(last_verified_at, 한국 날짜)부터 설정 official_source_expiry_days(씨앗 365 — 12장 #23)일을 넘긴 것마다 항목 1건. 기준 당일(= 365일째) 0건, 하루 넘김 1건.
--     같은 날 두 번 돌려도 한 벌(항목마다 실행 키 기록, 같은 확인일로는 한 번만). 확인일을 새로 적으면(다시 확인) 그 날부터 다시 잰다.
-- · 공개 표시 — 뷰 public_source_reviews(공개 기사·열린 항목의 출처 번호만). 기사 화면의 공식 자료 카드·출처 줄에 '검토 중'. 큐 표 자체는 anon 0행.
-- · 기존 표·칸·제약·값은 바꾸지 않는다.

-- ─────────────────────────────────────────────────────────────
-- 설정 씨앗 — 2.2 official_source_expiry_days (12장 #23 — 365, 설정으로 바꿈)
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value, description, updated_by) values
  ('official_source_expiry_days', '365'::jsonb,
   '공식 자료 시점 만료 기준 (REG1-13) — 확인일(한국 날짜)부터 이 일수를 넘기면 검수 큐 1건. 기준 당일은 0건, 하루 넘김 1건. 1~3650 정수',
   'migration:20261022000042')
on conflict (key) do nothing;

create function public.source_review_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if jsonb_typeof(new.value) is distinct from 'number'
     or (new.value #>> '{}') !~ '^[0-9]+$'
     or (new.value #>> '{}')::numeric < 1 or (new.value #>> '{}')::numeric > 3650 then
    raise exception '시점 만료 기준(official_source_expiry_days)은 1~3650 정수입니다 (지금 %)', new.value using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.source_review_settings_guard() from public, anon, authenticated;
create trigger settings_source_review_guard
  before insert or update on public.settings
  for each row when (new.key = 'official_source_expiry_days')
  execute function public.source_review_settings_guard();

-- ─────────────────────────────────────────────────────────────
-- 검수 큐
-- ─────────────────────────────────────────────────────────────
create table public.source_review_queue (
  id bigint generated always as identity primary key,
  target_type text not null check (target_type in ('article_source', 'project_event', 'dev_method_fact')),
  target_id bigint not null,
  article_id bigint references public.articles (id) on delete cascade,   -- 대상이 기사 출처일 때 그 기사 ('검토 중' 표시 자리)
  reason text not null check (reason in ('snapshot_changed', 'expired')),
  old_hash text,                                                         -- 원문 변경: 대상이 쓰던 스냅샷 해시
  new_hash text,                                                         -- 원문 변경: 다시 받은 원문 해시
  new_snapshot_id bigint references public.raw_snapshots (id),
  basis_on date,                                                         -- 시점 만료: 잰 확인일 (한국 날짜)
  run_key text,                                                          -- 시점 만료: 배치 실행 키 (한국 날짜)
  status text not null default 'open' check (status in ('open', 'resolved')),
  opened_at timestamptz not null default now(),
  opened_by text not null check (length(btrim(opened_by)) > 0),          -- user:<uuid> · job:source-expiry
  resolved_by text,
  resolved_at timestamptz,
  resolution_note text,
  constraint source_review_changed_hashes check (
    reason <> 'snapshot_changed'
    or (length(btrim(coalesce(old_hash, ''))) > 0 and length(btrim(coalesce(new_hash, ''))) > 0 and old_hash <> new_hash and new_snapshot_id is not null)),
  constraint source_review_expired_basis check (reason <> 'expired' or (basis_on is not null and run_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')),
  constraint source_review_resolution check (
    (status = 'open' and resolved_by is null and resolved_at is null)
    or (status = 'resolved' and length(btrim(coalesce(resolved_by, ''))) > 0 and resolved_at is not null)),
  constraint source_review_article check (target_type <> 'article_source' or article_id is not null)
);

comment on table public.source_review_queue is '원문 변경·시점 만료 검수 큐 (REG1-13 · PR-03 · PR-10) — (대상, 사유)마다 열린 항목 하나. service_role만, 공개는 뷰 public_source_reviews(출처 번호만)';

create unique index source_review_queue_open_once on public.source_review_queue (target_type, target_id, reason) where status = 'open';
create unique index source_review_queue_hash_once on public.source_review_queue (target_type, target_id, new_hash) where reason = 'snapshot_changed';
create unique index source_review_queue_expiry_once on public.source_review_queue (target_type, target_id, basis_on) where reason = 'expired';
create index source_review_queue_article_idx on public.source_review_queue (article_id) where status = 'open';

-- 대상 검사 — 지금은 공식 자료 출처(official_doc·dataset)만, 기사 번호는 그 출처의 기사. 프로젝트 단계·개발방법 사실 행은 12·18단계가 연다
create function public.source_review_target_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src public.article_sources;
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
  else
    raise exception '검수 대상 %는 아직 받지 않습니다 — 프로젝트 단계(12단계)·개발방법 사실 행(18단계)이 표를 만든 뒤 엽니다', new.target_type
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.source_review_target_guard() from public, anon, authenticated;
create trigger source_review_target_guard
  before insert on public.source_review_queue
  for each row execute function public.source_review_target_guard();

-- 고치기 — 열린 항목을 해결로 바꾸는 것만 (해결한 사람·시각·메모). 다른 칸은 그대로, 해결된 항목은 다시 열지 않는다
create function public.source_review_update_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'resolved' then
    raise exception '해결된 검수 항목(%)은 고칠 수 없습니다 — 같은 대상에 새 원인이 생기면 새 항목이 열립니다', old.id using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - array['status', 'resolved_by', 'resolved_at', 'resolution_note']) is distinct from (to_jsonb(old) - array['status', 'resolved_by', 'resolved_at', 'resolution_note']) then
    raise exception '검수 항목(%)은 해결 표시(해결한 사람·시각·메모)만 바꿀 수 있습니다', old.id using errcode = 'check_violation';
  end if;
  if new.status <> 'resolved' then
    raise exception '열린 검수 항목(%)은 해결(resolved)로만 바꿉니다', old.id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.source_review_update_guard() from public, anon, authenticated;
create trigger source_review_update_guard
  before update on public.source_review_queue
  for each row execute function public.source_review_update_guard();

-- ─────────────────────────────────────────────────────────────
-- 원문 다시 받기 — 해시가 다른 출처마다 항목 1건 (웹 앱 POST /api/admin/source-review op=refetch가 부른다)
-- ─────────────────────────────────────────────────────────────
create function public.source_snapshot_refetched(p_url text, p_hash text, p_payload text, p_source text, p_actor text) returns jsonb
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

  return jsonb_build_object('snapshotId', v_snap, 'targets', v_targets, 'opened', v_opened, 'unchanged', v_same, 'alreadyQueued', v_already, 'noSnapshot', v_nosnap);
end;
$$;
revoke all on function public.source_snapshot_refetched(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.source_snapshot_refetched(text, text, text, text, text) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 시점 만료 — 배치 source-expiry (실행 키 = 한국 날짜 p_today). 기준 당일 0건, 하루 넘김 1건
-- ─────────────────────────────────────────────────────────────
create function public.source_expiry_scan(p_today date) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_raw jsonb;
  v_run text;
  v_row record;
  v_rc integer;
  v_expired integer := 0;
  v_opened integer := 0;
  v_already integer := 0;
begin
  if p_today is null then
    raise exception '실행 날짜(한국 날짜)가 필요합니다' using errcode = 'check_violation';
  end if;
  v_run := to_char(p_today, 'YYYY-MM-DD');
  select s.value into v_raw from public.settings s where s.key = 'official_source_expiry_days';
  -- 설정이 없거나 틀리면 씨앗 값(365)으로 — 저장 검사(settings_source_review_guard)가 틀린 값을 막는다
  v_days := case when jsonb_typeof(v_raw) = 'number' and (v_raw #>> '{}') ~ '^[0-9]+$' and (v_raw #>> '{}')::numeric between 1 and 3650
                 then (v_raw #>> '{}')::integer else 365 end;

  for v_row in
    select s.id, s.article_id, (s.last_verified_at at time zone 'Asia/Seoul')::date as basis
      from public.article_sources s
      join public.articles a on a.id = s.article_id
     where s.kind in ('official_doc', 'dataset')
       and s.last_verified_at is not null
       and a.status in ('published', 'scheduled')
       and not exists (select 1 from public.article_sources n where n.supersedes_id = s.id)
       and p_today - (s.last_verified_at at time zone 'Asia/Seoul')::date > v_days
     order by s.id
  loop
    v_expired := v_expired + 1;
    insert into public.source_review_queue (target_type, target_id, article_id, reason, basis_on, run_key, opened_by)
    values ('article_source', v_row.id, v_row.article_id, 'expired', v_row.basis, v_run, 'job:source-expiry')
    on conflict do nothing;
    get diagnostics v_rc = row_count;
    if v_rc > 0 then v_opened := v_opened + 1; else v_already := v_already + 1; end if;
  end loop;

  return jsonb_build_object('runKey', v_run, 'expiryDays', v_days, 'expired', v_expired, 'opened', v_opened, 'alreadyQueued', v_already);
end;
$$;
revoke all on function public.source_expiry_scan(date) from public, anon, authenticated;
grant execute on function public.source_expiry_scan(date) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 권한·RLS — 큐는 service_role만 (anon 0행). 공개 '검토 중' 표시는 뷰가 출처 번호만 낸다
-- ─────────────────────────────────────────────────────────────
alter table public.source_review_queue enable row level security;
revoke all on table public.source_review_queue from anon, authenticated, service_role;
grant select, insert, update, delete on table public.source_review_queue to service_role;

-- 공개 기사(발행·대표 이미지 권리 확인 또는 없음·무료 — public_articles와 같은 조건)의 열린 검수 항목이 걸린 출처 번호만. 사유·해시·사람·메모 0
create view public.public_source_reviews as
select distinct q.article_id, q.target_id as source_id
  from public.source_review_queue q
  join public.articles a on a.id = q.article_id
 where q.status = 'open'
   and q.target_type = 'article_source'
   and a.status = 'published' and a.lead_media_cleared and not a.is_paid;
comment on view public.public_source_reviews is '공개 기사 출처의 검수 중 표시 (REG1-13 — 기사 화면 ''검토 중''). 출처 번호만 — 사유·해시·처리자 0';
revoke all on table public.public_source_reviews from public, anon, authenticated, service_role;
grant select on table public.public_source_reviews to anon, authenticated, service_role;
