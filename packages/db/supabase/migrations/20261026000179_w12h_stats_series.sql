-- W12-h h1 - 지방세 통계 시계열 (PRD-04 DATA-01, docs/dev/W12-h_설계.md 1장·3장)
-- 이 파일에 실제 통계 값·데이터셋 이름·이용 조건 문구는 없다 (원천 행은 unchecked로 시작, 시험 자료는 `시험용`).
-- · data_sources.kind에 'stats' 추가 + 원천 1행 씨앗(mois_local_tax_stats, unchecked -> 수집 불가)
-- · stats_series - 시계열 한 벌(series_key + 기준연도 + 판). 출처 이름·주소·기준연도·확인일·스냅샷(raw_snapshots origin=stats) 모두 NOT NULL. 내용 불변,
--   초안(draft) -> 승인(approved) -> 새 기준연도 승인 시 이전 승인본은 superseded. 승인·철회는 stats_series_approve/withdraw 함수로만 (거부도 감사 1행)
-- · stats_series_put - 수집 배치(AI 0)가 부르는 유일한 쓰기 길. 원천이 수집 가능(data_source_runnable)일 때만 받고, 응답 원본은 raw_snapshots에 먼저 저장
-- · 공개 뷰 public_stats_series - 기능 키 data_stories가 켜지고 승인된 적이 있는(approved/superseded) 행만. 스냅샷 번호·승인자 칸 없음

alter table public.data_sources drop constraint data_sources_kind_check;
alter table public.data_sources add constraint data_sources_kind_check check (kind in ('law', 'admrul', 'interpretation', 'tribunal', 'case', 'nts_interpretation', 'field_data', 'stats'));

insert into public.data_sources (key, name, kind, api_target, priority) values
  ('mois_local_tax_stats', '행정안전부 지방세 통계 (공공데이터포털)', 'stats', null, 'p1')
on conflict (key) do nothing;

-- points 모양 검사 - [{"period": "YYYY" 또는 "YYYY-MM", "value": 숫자}], 1~200개, 기간 오름차순·중복 없음. 문제 글을 돌려주고 없으면 null
create function public.stats_points_problem(p jsonb) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  e jsonb;
  prev text := null;
  n int;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return 'points는 목록이어야 합니다'; end if;
  n := jsonb_array_length(p);
  if n < 1 or n > 200 then return 'points는 1~200개여야 합니다'; end if;
  for e in select x from jsonb_array_elements(p) as x loop
    if jsonb_typeof(e) <> 'object' or (select count(*) from jsonb_object_keys(e)) <> 2 or not (e ? 'period') or not (e ? 'value') then
      return '각 점은 period와 value 두 칸뿐이어야 합니다';
    end if;
    if jsonb_typeof(e -> 'period') <> 'string' or (e ->> 'period') !~ '^[0-9]{4}(-[0-9]{2})?$' then return 'period 모양이 틀렸습니다 (YYYY 또는 YYYY-MM)'; end if;
    if jsonb_typeof(e -> 'value') <> 'number' then return 'value는 숫자여야 합니다'; end if;
    if prev is not null and (e ->> 'period') <= prev then return 'period는 오름차순이고 중복이 없어야 합니다'; end if;
    prev := e ->> 'period';
  end loop;
  return null;
end;
$$;
revoke all on function public.stats_points_problem(jsonb) from public, anon, authenticated;
grant execute on function public.stats_points_problem(jsonb) to service_role;

create table public.stats_series (
  id bigint generated always as identity primary key,
  series_key text not null check (series_key ~ '^[a-z][a-z0-9_]{2,59}$'),
  version int not null check (version >= 1),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  -- 지방세 시계열만 - 국세 세목 이름은 조각을 이어 만든 패턴으로 거부 (국세 금액 통계 0, 앱 lib/data-stories/series.ts NATIONAL_STEMS와 같은 조각)
  tax_item text check (tax_item is null or (char_length(btrim(tax_item)) between 1 and 30 and tax_item !~ ('(' || '양' || '도|상' || '속|증' || '여|부' || '가가' || '치)'))),
  region_code text check (region_code is null or region_code ~ '^[0-9]{2,10}$'),
  unit text not null check (char_length(btrim(unit)) between 1 and 20),
  points jsonb not null check (public.stats_points_problem(points) is null),
  source_name text not null check (char_length(btrim(source_name)) between 1 and 120),
  source_url text not null check (source_url ~* '^https://[^[:space:]]+$' and source_url !~* '[?&;](oc|servicekey|api_?key|auth_?key|access_?token|key)='),
  base_year int not null check (base_year between 1990 and 2100),
  checked_at date not null,
  snapshot_id bigint not null references public.raw_snapshots (id),
  status text not null default 'draft' check (status in ('draft', 'approved', 'superseded', 'withdrawn')),
  created_by text not null check (length(btrim(created_by)) > 0),
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (series_key, base_year, version),
  constraint stats_series_approved_record check ((status in ('approved', 'superseded')) = (approved_by is not null and approved_at is not null) or status = 'withdrawn')
);
comment on table public.stats_series is '지방세 통계 시계열(DATA-01) - 출처·기준연도·확인일·스냅샷 필수, 내용 불변, 승인은 함수로만. 공개 전 편집자 확인';
create unique index stats_series_one_approved on public.stats_series (series_key) where status = 'approved';
create index stats_series_key_idx on public.stats_series (series_key, base_year desc, version desc);

create function public.stats_no_delete() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '통계 시계열·감사 기록은 지우거나 고치지 못합니다 (% 거부)', tg_op using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.stats_no_delete() from public, anon, authenticated;

create function public.stats_series_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  o text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.approved_by is not null or new.approved_at is not null then
      raise exception '통계 시계열은 초안(draft)으로만 만들 수 있습니다 - 승인은 stats_series_approve 함수로만 합니다' using errcode = 'check_violation';
    end if;
    select s.origin into o from public.raw_snapshots s where s.id = new.snapshot_id;
    if o is distinct from 'stats' then
      raise exception '통계 시계열의 스냅샷은 origin = stats 응답 원본이어야 합니다' using errcode = 'check_violation';
    end if;
    new.version := coalesce((select max(i.version) from public.stats_series i where i.series_key = new.series_key and i.base_year = new.base_year), 0) + 1;
    return new;
  end if;
  if new.series_key is distinct from old.series_key or new.version is distinct from old.version or new.title is distinct from old.title
     or new.tax_item is distinct from old.tax_item or new.region_code is distinct from old.region_code or new.unit is distinct from old.unit
     or new.points is distinct from old.points or new.source_name is distinct from old.source_name or new.source_url is distinct from old.source_url
     or new.base_year is distinct from old.base_year or new.checked_at is distinct from old.checked_at or new.snapshot_id is distinct from old.snapshot_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception '통계 시계열의 내용은 고칠 수 없습니다 - 새 판을 수집하세요' using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
    if coalesce(current_setting('ltr.stats_gate', true), '') <> 'rpc' then
      raise exception '승인·철회 상태는 stats_series_approve/withdraw 함수로만 바뀝니다' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.stats_series_guard() from public, anon, authenticated;
create trigger stats_series_guard before insert or update on public.stats_series for each row execute function public.stats_series_guard();
create trigger stats_series_no_delete before delete on public.stats_series for each row execute function public.stats_no_delete();
create trigger stats_series_no_truncate before truncate on public.stats_series for each statement execute function public.stats_no_delete();

-- 감사 - 수집·승인·철회. 추가만, 거부도 1행
create table public.stats_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  target_id bigint,
  action text not null check (action in ('put', 'approve', 'withdraw')),
  outcome text not null check (outcome in ('ok', 'refused')),
  code text not null check (length(btrim(code)) > 0),
  actor text not null check (length(btrim(actor)) > 0),
  detail text check (detail is null or char_length(detail) <= 500),
  constraint stats_audit_ok_code check ((outcome = 'ok') = (code = 'ok'))
);
comment on table public.stats_audit is '통계 시계열 수집·승인·철회 감사 - 추가만, 거부도 1행(code가 사유)';
create index stats_audit_target_idx on public.stats_audit (target_id, at desc);
create trigger stats_audit_no_update_delete before update or delete on public.stats_audit for each row execute function public.stats_no_delete();
create trigger stats_audit_no_truncate before truncate on public.stats_audit for each statement execute function public.stats_no_delete();

create function public.stats_audit_write(p_target bigint, p_action text, p_ok boolean, p_code text, p_actor text, p_detail text) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.stats_audit (target_id, action, outcome, code, actor, detail)
  values (p_target, p_action, case when p_ok then 'ok' else 'refused' end, p_code, coalesce(nullif(btrim(p_actor), ''), 'unknown'), left(p_detail, 500));
$$;
revoke all on function public.stats_audit_write(bigint, text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.stats_audit_write(bigint, text, boolean, text, text, text) to service_role;

-- 수집 쓰기 - 원천이 수집 가능할 때만. 응답 원본(스냅샷, origin=stats)을 먼저 저장하고 시계열 초안 1행.
-- 같은 (series_key, 기준연도)에 points가 똑같은 판이 이미 있으면 새로 만들지 않는다 (created=false, 멱등)
create function public.stats_series_put(p_source_key text, p_snapshot jsonb, p_series jsonb, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_msg text;
  v_snap bigint;
  v_id bigint;
  v_prev public.stats_series;
begin
  if p_actor is null or p_actor !~ '^(job|system|user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '수집자 표시가 필요합니다';
  elsif not public.data_source_runnable(p_source_key) then
    v_code := 'source_not_runnable'; v_msg := '원천이 수집 가능 상태가 아닙니다 (이용 조건 허용 + 견본 계약 확인 필요)';
  elsif p_snapshot is null or coalesce(p_snapshot ->> 'url', '') = '' or coalesce(p_snapshot ->> 'content_hash', '') = '' or coalesce(p_snapshot ->> 'payload', '') = '' then
    v_code := 'snapshot_missing'; v_msg := '응답 원본(주소·해시·본문)이 없습니다';
  elsif p_series is null or jsonb_typeof(p_series) <> 'object' then
    v_code := 'series_invalid'; v_msg := '시계열 내용이 없습니다';
  end if;
  if v_code is null then
    insert into public.raw_snapshots (source, url, content_hash, payload, source_key, external_id, http_status, origin)
    values (p_source_key, p_snapshot ->> 'url', p_snapshot ->> 'content_hash', p_snapshot ->> 'payload', p_source_key,
            coalesce(nullif(p_snapshot ->> 'external_id', ''), p_series ->> 'series_key'), nullif(p_snapshot ->> 'http_status', '')::int, 'stats')
    on conflict (source_key, external_id, content_hash) where source_key is not null do nothing;
    select s.id into v_snap from public.raw_snapshots s
     where s.source_key = p_source_key and s.external_id = coalesce(nullif(p_snapshot ->> 'external_id', ''), p_series ->> 'series_key') and s.content_hash = p_snapshot ->> 'content_hash';
    select * into v_prev from public.stats_series s
     where s.series_key = p_series ->> 'series_key' and s.base_year = (p_series ->> 'base_year')::int order by s.version desc limit 1;
    if found and v_prev.points = p_series -> 'points' and v_prev.status <> 'withdrawn' then
      return jsonb_build_object('ok', true, 'code', 'ok', 'created', false, 'id', v_prev.id);
    end if;
    begin
      insert into public.stats_series (series_key, version, title, tax_item, region_code, unit, points, source_name, source_url, base_year, checked_at, snapshot_id, created_by)
      values (p_series ->> 'series_key', 1, p_series ->> 'title', nullif(p_series ->> 'tax_item', ''), nullif(p_series ->> 'region_code', ''), p_series ->> 'unit',
              p_series -> 'points', p_series ->> 'source_name', p_series ->> 'source_url', (p_series ->> 'base_year')::int, (p_series ->> 'checked_at')::date, v_snap, p_actor)
      returning id into v_id;
    exception when check_violation or not_null_violation or invalid_text_representation or datetime_field_overflow then
      v_code := 'series_invalid'; v_msg := left(sqlerrm, 300);
    end;
  end if;
  if v_code is not null then
    perform public.stats_audit_write(null, 'put', false, v_code, p_actor, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform public.stats_audit_write(v_id, 'put', true, 'ok', p_actor, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'created', true, 'id', v_id);
end;
$$;

-- 승인 - 초안만. 같은 series_key의 이전 승인본은 superseded (기사 차트는 기준연도로 고정되어 계속 열린다)
create function public.stats_series_approve(p_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.stats_series;
  v_code text;
  v_msg text;
begin
  select * into s from public.stats_series where id = p_id for update;
  if not found then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '승인자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif s.status <> 'draft' then
    v_code := 'not_draft'; v_msg := '초안만 승인할 수 있습니다';
  elsif s.checked_at > (now() at time zone 'Asia/Seoul')::date then
    v_code := 'checked_future'; v_msg := '확인일이 오늘보다 뒤입니다';
  end if;
  if v_code is not null then
    perform public.stats_audit_write(p_id, 'approve', false, v_code, p_actor, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.stats_gate', 'rpc', true);
  update public.stats_series set status = 'superseded' where series_key = s.series_key and status = 'approved';
  update public.stats_series set status = 'approved', approved_by = p_actor, approved_at = now() where id = p_id;
  perform set_config('ltr.stats_gate', '', true);
  perform public.stats_audit_write(p_id, 'approve', true, 'ok', p_actor, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '승인했습니다');
end;
$$;

-- 철회 - 승인본(approved/superseded)을 공개에서 내린다 (잘못 공개한 자료). 이유 필수
create function public.stats_series_withdraw(p_id bigint, p_actor text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.stats_series;
  v_code text;
  v_msg text;
begin
  select * into s from public.stats_series where id = p_id for update;
  if not found then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '처리자 표시가 필요합니다';
  elsif s.status not in ('approved', 'superseded') then
    v_code := 'not_published'; v_msg := '승인된 시계열만 철회할 수 있습니다';
  elsif char_length(btrim(coalesce(p_reason, ''))) = 0 then
    v_code := 'reason_required'; v_msg := '철회 이유가 필요합니다';
  end if;
  if v_code is not null then
    perform public.stats_audit_write(p_id, 'withdraw', false, v_code, p_actor, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.stats_gate', 'rpc', true);
  update public.stats_series set status = 'withdrawn' where id = p_id;
  perform set_config('ltr.stats_gate', '', true);
  perform public.stats_audit_write(p_id, 'withdraw', true, 'ok', p_actor, p_reason);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '철회했습니다');
end;
$$;
revoke all on function public.stats_series_put(text, jsonb, jsonb, text), public.stats_series_approve(bigint, text), public.stats_series_withdraw(bigint, text, text) from public, anon, authenticated;
grant execute on function public.stats_series_put(text, jsonb, jsonb, text), public.stats_series_approve(bigint, text), public.stats_series_withdraw(bigint, text, text) to service_role;

-- 권한 - 서버(service_role)는 읽기만(쓰기는 함수), 감사는 읽기만
alter table public.stats_series enable row level security;
alter table public.stats_audit enable row level security;
revoke all on table public.stats_series, public.stats_audit from anon, authenticated, service_role;
grant select on table public.stats_series, public.stats_audit to service_role;

-- 공개 뷰 - 기능 키 data_stories + 승인된 적이 있는 행(승인본·새 기준연도로 대체된 이전본). 초안·철회·스냅샷 번호·승인자 칸 없음
create view public.public_stats_series as
select s.id, s.series_key, s.title, s.tax_item, s.region_code, s.unit, s.points, s.source_name, s.source_url, s.base_year, s.checked_at, s.status, s.approved_at
  from public.stats_series s
 where s.status in ('approved', 'superseded')
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'data_stories') = 'true'::jsonb);

revoke all on table public.public_stats_series from public, anon, authenticated, service_role;
grant select on table public.public_stats_series to anon, authenticated, service_role;
