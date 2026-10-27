-- W13-a a2 - O7 디지털 이관 상태기계 (PRD-05 AIOPS-16, 5단계 설계 1.1 a2)
-- 권리 확인 -> 추출 -> 구조화 -> 교정 -> 승인 순서로만 전이한다. 건너뛰기·되돌리기 거부.
-- · 작업은 대상(노드·권호·권호 기사)의 공개 권리(rights_public)가 확인된 뒤에만 만든다 (권리 확인 전 원고는 처리 대상 아님).
-- · 승인은 digitize_approve 함수로만 된다 - 표본 오류율이 설정 digitization_sample_error_max(퍼센트)를 넘으면 닫힌다. 설정이 비면 닫힘.
-- · 승인 함수가 대상의 status = approved, approved_job_id를 채운다. 대상 표 트리거는 '승인 단계의 작업이 그 대상을 가리킬 때'만 approved를 허용한다.
-- · 모든 시도(거부 포함)는 digitization_audit에 남는다. 유료 OCR·AI 호출은 이 파일에 없다 - 추출 결과는 사람이 넣은 텍스트로 시험한다.

create table public.digitization_jobs (
  id bigint generated always as identity primary key,
  target_kind text not null check (target_kind in ('node', 'issue', 'issue_article')),
  target_id bigint not null,
  source_file text not null check (char_length(btrim(source_file)) between 1 and 300),
  stage text not null default 'rights_confirmed' check (stage in ('rights_confirmed', 'extracted', 'structured', 'proofread', 'approved')),
  sample_size int check (sample_size is null or sample_size > 0),
  sample_errors int check (sample_errors is null or sample_errors >= 0),
  sample_error_rate numeric generated always as (case when sample_size > 0 then round(sample_errors * 100.0 / sample_size, 4) end) stored,
  approved_by text check (approved_by is null or char_length(btrim(approved_by)) > 0),
  approved_at timestamptz,
  created_by text not null check (char_length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint digitization_jobs_sample_range check (sample_errors is null or sample_size is null or sample_errors <= sample_size),
  constraint digitization_jobs_approved_record check (stage <> 'approved' or (approved_by is not null and approved_at is not null and sample_size is not null and sample_errors is not null))
);
comment on table public.digitization_jobs is 'O7 이관 작업 (AIOPS-16) - 단계는 순서대로만. 승인은 digitize_approve로만. 직접 읽기 0';
create unique index digitization_jobs_open_once on public.digitization_jobs (target_kind, target_id) where stage <> 'approved';

create table public.digitization_audit (
  id bigint generated always as identity primary key,
  job_id bigint,
  action text not null check (action in ('create', 'advance', 'approve')),
  outcome text not null check (outcome in ('ok', 'refused')),
  code text not null check (char_length(btrim(code)) > 0),
  actor text not null check (char_length(btrim(actor)) > 0),
  at timestamptz not null default now(),
  constraint digitization_audit_ok_code check ((outcome = 'ok') = (code = 'ok'))
);
comment on table public.digitization_audit is '이관 작업 감사 - 추가만, 거부도 1행(code가 사유)';
create trigger digitization_audit_no_update_delete before update or delete on public.digitization_audit for each row execute function public.library_log_immutable();
create trigger digitization_audit_no_truncate before truncate on public.digitization_audit for each statement execute function public.library_log_immutable();

create function public.digitization_stage_no(p text) returns int
language sql immutable set search_path = ''
as $$ select array_position(array['rights_confirmed', 'extracted', 'structured', 'proofread', 'approved'], p) $$;
revoke all on function public.digitization_stage_no(text) from public, anon, authenticated;

-- 전이 가드: 한 단계씩만 앞으로, 승인은 함수 안에서만, 승인 뒤 변경 0
create function public.digitization_jobs_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '이관 작업은 지울 수 없습니다' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' then
    if new.target_kind <> old.target_kind or new.target_id <> old.target_id or new.source_file <> old.source_file then
      raise exception '이관 작업의 대상·원본은 바꿀 수 없습니다' using errcode = 'check_violation';
    end if;
    if old.stage = 'approved' then
      raise exception '승인된 작업은 바꿀 수 없습니다' using errcode = 'insufficient_privilege';
    end if;
    if new.stage <> old.stage then
      if public.digitization_stage_no(new.stage) <> public.digitization_stage_no(old.stage) + 1 then
        raise exception '이관 단계는 순서대로만 바뀝니다 (% -> % 거부)', old.stage, new.stage using errcode = 'check_violation';
      end if;
      if new.stage = 'approved' and coalesce(current_setting('ltr.digitize_approve', true), '') <> '1' then
        raise exception '승인은 digitize_approve 함수로만 됩니다' using errcode = 'insufficient_privilege';
      end if;
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.digitization_jobs_guard() from public, anon, authenticated;
create trigger digitization_jobs_guard before update or delete on public.digitization_jobs for each row execute function public.digitization_jobs_guard();

-- 대상 표: approved 는 '승인 단계의 작업이 그 대상을 가리킬 때'만
create function public.library_approved_check() returns trigger
language plpgsql
set search_path = ''
as $$
declare v_kind text := tg_argv[0];
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') then
    if not exists (select 1 from public.digitization_jobs j
                    where j.id = new.approved_job_id and j.stage = 'approved' and j.target_kind = v_kind and j.target_id = new.id) then
      raise exception '승인은 그 대상의 승인 단계 이관 작업으로만 됩니다' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.library_approved_check() from public, anon, authenticated;
create trigger pub_nodes_approved_check before insert or update on public.pub_nodes for each row execute function public.library_approved_check('node');
create trigger magazine_issues_approved_check before insert or update on public.magazine_issues for each row execute function public.library_approved_check('issue');
create trigger magazine_articles_approved_check before insert or update on public.magazine_articles for each row execute function public.library_approved_check('issue_article');

alter table public.pub_nodes add constraint pub_nodes_approved_job_fk foreign key (approved_job_id) references public.digitization_jobs (id);
alter table public.magazine_issues add constraint magazine_issues_approved_job_fk foreign key (approved_job_id) references public.digitization_jobs (id);
alter table public.magazine_articles add constraint magazine_articles_approved_job_fk foreign key (approved_job_id) references public.digitization_jobs (id);

create function public.digitization_audit_write(p_job bigint, p_action text, p_ok boolean, p_code text, p_actor text) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.digitization_audit (job_id, action, outcome, code, actor)
  values (p_job, p_action, case when p_ok then 'ok' else 'refused' end, p_code, coalesce(nullif(btrim(p_actor), ''), 'unknown'));
$$;
revoke all on function public.digitization_audit_write(bigint, text, boolean, text, text) from public, anon, authenticated;

-- 작업 만들기: 대상이 있고 공개 권리가 확인된 초안일 때만
create function public.digitize_create(p_kind text, p_target bigint, p_source_file text, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_rights text; v_status text; v_id bigint;
begin
  if p_kind = 'node' then select rights_public, status into v_rights, v_status from public.pub_nodes where id = p_target;
  elsif p_kind = 'issue' then select rights_public, status into v_rights, v_status from public.magazine_issues where id = p_target;
  elsif p_kind = 'issue_article' then select rights_public, status into v_rights, v_status from public.magazine_articles where id = p_target;
  else
    perform public.digitization_audit_write(null, 'create', false, 'bad_kind', p_actor);
    return jsonb_build_object('ok', false, 'code', 'bad_kind');
  end if;
  if v_status is null then
    perform public.digitization_audit_write(null, 'create', false, 'no_target', p_actor);
    return jsonb_build_object('ok', false, 'code', 'no_target');
  end if;
  if v_rights <> 'confirmed' then
    perform public.digitization_audit_write(null, 'create', false, 'rights_not_confirmed', p_actor);
    return jsonb_build_object('ok', false, 'code', 'rights_not_confirmed');
  end if;
  if v_status <> 'draft' then
    perform public.digitization_audit_write(null, 'create', false, 'not_draft', p_actor);
    return jsonb_build_object('ok', false, 'code', 'not_draft');
  end if;
  if coalesce(btrim(p_source_file), '') = '' or coalesce(btrim(p_actor), '') = '' then
    perform public.digitization_audit_write(null, 'create', false, 'bad_input', p_actor);
    return jsonb_build_object('ok', false, 'code', 'bad_input');
  end if;
  begin
    insert into public.digitization_jobs (target_kind, target_id, source_file, created_by) values (p_kind, p_target, p_source_file, p_actor) returning id into v_id;
  exception when unique_violation then
    perform public.digitization_audit_write(null, 'create', false, 'already_open', p_actor);
    return jsonb_build_object('ok', false, 'code', 'already_open');
  end;
  perform public.digitization_audit_write(v_id, 'create', true, 'ok', p_actor);
  return jsonb_build_object('ok', true, 'code', 'ok', 'jobId', v_id);
end;
$$;
revoke all on function public.digitize_create(text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.digitize_create(text, bigint, text, text) to service_role;

-- 한 단계 앞으로 (승인 단계는 digitize_approve 전용). 건너뛰기는 트리거가 거부 -> 코드 skip
create function public.digitize_advance(p_job bigint, p_to text, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare j record;
begin
  select * into j from public.digitization_jobs where id = p_job for update;
  if not found then
    perform public.digitization_audit_write(p_job, 'advance', false, 'no_job', p_actor);
    return jsonb_build_object('ok', false, 'code', 'no_job');
  end if;
  if p_to = 'approved' then
    perform public.digitization_audit_write(p_job, 'advance', false, 'use_approve', p_actor);
    return jsonb_build_object('ok', false, 'code', 'use_approve');
  end if;
  if public.digitization_stage_no(p_to) is null or public.digitization_stage_no(p_to) <> public.digitization_stage_no(j.stage) + 1 then
    perform public.digitization_audit_write(p_job, 'advance', false, 'skip', p_actor);
    return jsonb_build_object('ok', false, 'code', 'skip');
  end if;
  update public.digitization_jobs set stage = p_to where id = p_job;
  perform public.digitization_audit_write(p_job, 'advance', true, 'ok', p_actor);
  return jsonb_build_object('ok', true, 'code', 'ok', 'stage', p_to);
end;
$$;
revoke all on function public.digitize_advance(bigint, text, text) from public, anon, authenticated;
grant execute on function public.digitize_advance(bigint, text, text) to service_role;

-- 승인: 교정 단계 + 표본 오류율 <= 설정 퍼센트일 때만. 대상을 approved 로 바꾼다
create function public.digitize_approve(p_job bigint, p_sample_size int, p_sample_errors int, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare j record; v_max numeric; v_rate numeric;
begin
  select * into j from public.digitization_jobs where id = p_job for update;
  if not found then
    perform public.digitization_audit_write(p_job, 'approve', false, 'no_job', p_actor);
    return jsonb_build_object('ok', false, 'code', 'no_job');
  end if;
  if j.stage <> 'proofread' then
    perform public.digitization_audit_write(p_job, 'approve', false, 'skip', p_actor);
    return jsonb_build_object('ok', false, 'code', 'skip');
  end if;
  if coalesce(p_sample_size, 0) <= 0 or p_sample_errors is null or p_sample_errors < 0 or p_sample_errors > p_sample_size or coalesce(btrim(p_actor), '') = '' then
    perform public.digitization_audit_write(p_job, 'approve', false, 'bad_input', p_actor);
    return jsonb_build_object('ok', false, 'code', 'bad_input');
  end if;
  select (s.value ->> 'percent')::numeric into v_max from public.settings s where s.key = 'digitization_sample_error_max' and jsonb_typeof(s.value) = 'object' and s.value ? 'percent';
  if v_max is null then
    perform public.digitization_audit_write(p_job, 'approve', false, 'setting_missing', p_actor);
    return jsonb_build_object('ok', false, 'code', 'setting_missing');
  end if;
  v_rate := p_sample_errors * 100.0 / p_sample_size;
  if v_rate > v_max then
    update public.digitization_jobs set sample_size = p_sample_size, sample_errors = p_sample_errors where id = p_job;
    perform public.digitization_audit_write(p_job, 'approve', false, 'error_rate', p_actor);
    return jsonb_build_object('ok', false, 'code', 'error_rate', 'rate', round(v_rate, 4));
  end if;
  perform set_config('ltr.digitize_approve', '1', true);
  perform set_config('ltr.actor', p_actor, true);
  update public.digitization_jobs set stage = 'approved', sample_size = p_sample_size, sample_errors = p_sample_errors, approved_by = p_actor, approved_at = now() where id = p_job;
  if j.target_kind = 'node' then update public.pub_nodes set status = 'approved', approved_job_id = p_job where id = j.target_id;
  elsif j.target_kind = 'issue' then update public.magazine_issues set status = 'approved', approved_job_id = p_job where id = j.target_id;
  else update public.magazine_articles set status = 'approved', approved_job_id = p_job where id = j.target_id;
  end if;
  perform set_config('ltr.digitize_approve', '', true);
  perform public.digitization_audit_write(p_job, 'approve', true, 'ok', p_actor);
  return jsonb_build_object('ok', true, 'code', 'ok', 'rate', round(v_rate, 4));
end;
$$;
revoke all on function public.digitize_approve(bigint, int, int, text) from public, anon, authenticated;
grant execute on function public.digitize_approve(bigint, int, int, text) to service_role;

alter table public.digitization_jobs enable row level security;
alter table public.digitization_audit enable row level security;
revoke all on table public.digitization_jobs, public.digitization_audit from public, anon, authenticated, service_role;
grant select on table public.digitization_jobs, public.digitization_audit to service_role;
