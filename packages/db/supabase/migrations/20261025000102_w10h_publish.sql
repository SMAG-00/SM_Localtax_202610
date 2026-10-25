-- W10-h 3단계 — 승인된 분야 데이터 후보의 공개 반영 (PRD-02 PR-06 · LG-15 · DF-06, docs/dev/W10-h_설계.md 3장 결정 3·4)
-- field_publish(검수 항목 번호, 반영한 사람) — 공개 자료에 쓰는 길은 이 함수 하나다. 승인(approved)된 field_data 항목만, 같은 거래에서 반영하고 published 로 바꾼다.
--  · 다시 확인하는 것: 원천 이용 조건 allowed · 후보 검사(field_candidate_problem) · 공공누리 유형 · 제4유형이면 본문 유사도 통과 기록(본문 해시가 같아야 함)
--  · 멱등: 이미 published 면 아무것도 하지 않고 already_published. 같은 원천 항목의 같은 값 해시는 두 번 들어가지 않는다 (unchanged)
--  · 대상별 반영
--      project_stage     → project_events (처음이면 단계 기록, 같은 원천 항목의 값이 바뀌면 정정 기록)
--      supply_notice     → supply_notices (원천 항목마다 1행, 값이 바뀌면 갱신)
--      local_event       → local_events (원천 항목마다 1행, 값이 바뀌면 갱신 — 취소는 상태 지정 + 상태 이력. 끝난 회차의 날짜는 그대로. 이미지는 권리 확인분만)
--      finance_indicator · finance_regulation → 추가만 시계열
--      finance_case_entry → finance_case_entries (draft 로 들어가고 공개는 사람이 반론 기록 등을 채운 뒤)
-- service_role 만 실행한다. 공개 화면 읽기 함수는 만들지 않는다 (anon 실행 함수 0).

create function public.field_publish(p_item_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.review_items;
  v_pl jsonb;
  v_f jsonb;
  v_target text;
  v_src text;
  v_item text;
  v_hash text;
  v_kogl text;
  v_terms text;
  v_problem text;
  v_body text;
  v_checked_on date;
  v_source_name text;
  v_action text := 'created';
  v_target_id bigint;
  v_project_id bigint;
  v_prev public.project_events;
  v_sn public.supply_notices;
  v_ev public.local_events;
  v_ce public.finance_case_entries;
  v_override text;
  v_image text;
begin
  if length(btrim(coalesce(p_actor, ''))) = 0 then
    raise exception '반영한 사람이 필요합니다' using errcode = 'check_violation';
  end if;
  select * into r from public.review_items where id = p_item_id for update;
  if r.id is null or r.kind <> 'field_data' then
    raise exception '분야 데이터 후보 %가 없습니다', p_item_id using errcode = 'no_data_found';
  end if;
  if r.status = 'published' then
    return jsonb_build_object('action', 'already_published', 'itemId', r.id);
  end if;
  if r.status <> 'approved' then
    raise exception '승인된 후보만 공개 반영할 수 있습니다 (현재 %)', r.status using errcode = 'check_violation';
  end if;

  v_pl := r.payload;
  v_f := v_pl -> 'fields';
  v_target := v_pl ->> 'target';
  v_src := r.data_source_key;
  v_item := v_pl ->> 'source_item_id';
  v_hash := v_pl ->> 'value_hash';
  v_kogl := v_pl ->> 'kogl_type';

  select s.terms_status, s.name into v_terms, v_source_name from public.data_sources s where s.key = v_src;
  if v_terms is distinct from 'allowed' then
    raise exception '원천 %의 이용 조건이 허용(allowed)이 아니라 공개 반영할 수 없습니다 (지금 %)', v_src, coalesce(v_terms, '없음') using errcode = 'check_violation';
  end if;
  v_problem := public.field_candidate_problem(v_pl, r.snapshot_id, v_src);
  if v_problem is not null then
    raise exception '공개 반영 불가 — %', v_problem using errcode = 'check_violation';
  end if;

  -- 제4유형(상업적 이용·변경 금지): 공개 본문이 있으면 유사도 통과 기록이 있어야 한다 (원문 전재 0)
  v_body := public.field_body_text(v_pl);
  if v_kogl = 'kogl_4' and v_body is not null then
    if not exists (
      select 1 from public.field_candidate_checks c
       where c.review_item_id = r.id and c.kind = 'similarity' and c.status = 'pass' and c.text_hash = public.field_body_hash(v_body)
    ) then
      raise exception '제4유형 후보는 공개 본문의 원문 유사도 검사를 통과해야 공개합니다 (통과 기록이 없거나 검사 뒤 글자가 바뀌었습니다)' using errcode = 'check_violation';
    end if;
  end if;

  select (s.fetched_at at time zone 'Asia/Seoul')::date into v_checked_on from public.raw_snapshots s where s.id = r.snapshot_id;

  if v_target = 'project_stage' then
    select p.id into v_project_id from public.projects p where p.slug = v_f ->> 'project_slug';
    select e.* into v_prev from public.project_events e
     where e.source_key = v_src and e.source_item_id = v_item
       and not exists (select 1 from public.project_events c where c.correction_of = e.id)
     order by e.id desc limit 1;
    if v_prev.id is not null and v_prev.source_value_hash = v_hash then
      v_action := 'unchanged';
      v_target_id := v_prev.id;
    else
      insert into public.project_events (project_id, kind, stage, notice_no, notice_date, issuer, source_url, snapshot_id, license_type,
                                         correction_of, reason, public, recorded_by, source_key, source_item_id, source_value_hash)
      values (v_project_id, case when v_prev.id is null then 'stage' else 'correction' end, v_f ->> 'stage', v_f ->> 'notice_no', (v_f ->> 'notice_date')::date,
              v_f ->> 'issuer', v_f ->> 'source_url', r.snapshot_id, v_kogl, v_prev.id,
              case when v_prev.id is null then null else format('원천 값이 바뀌어 편집자가 승인한 정정 (검수 항목 %s)', r.id) end,
              true, p_actor, v_src, v_item, v_hash)
      returning id into v_target_id;
      v_action := case when v_prev.id is null then 'created' else 'corrected' end;
    end if;

  elsif v_target = 'supply_notice' then
    select n.* into v_sn from public.supply_notices n where n.source_key = v_src and n.source_item_id = v_item;
    if v_f ? 'project_slug' then
      select p.id into v_project_id from public.projects p where p.slug = v_f ->> 'project_slug';
    end if;
    if v_sn.id is not null and v_sn.source_value_hash = v_hash then
      v_action := 'unchanged';
      v_target_id := v_sn.id;
    elsif v_sn.id is not null then
      update public.supply_notices set
        name = v_f ->> 'name', region_code = v_f ->> 'region_code', project_id = coalesce(v_project_id, project_id), supply_scale = v_f ->> 'supply_scale',
        apply_start = (v_f ->> 'apply_start')::date, apply_end = (v_f ->> 'apply_end')::date, notice_date = (v_f ->> 'notice_date')::date,
        notice_issuer = v_f ->> 'notice_issuer', official_notice_url = v_f ->> 'official_notice_url', verified_at = now(), license_type = v_kogl,
        status = 'public', source_value_hash = v_hash, updated_by = p_actor
       where id = v_sn.id;
      v_target_id := v_sn.id;
      v_action := 'updated';
    else
      insert into public.supply_notices (name, region_code, project_id, supply_scale, apply_start, apply_end, notice_date, notice_issuer, official_notice_url,
                                         verified_at, license_type, status, created_by, updated_by, source_key, source_item_id, source_value_hash)
      values (v_f ->> 'name', v_f ->> 'region_code', v_project_id, v_f ->> 'supply_scale', (v_f ->> 'apply_start')::date, (v_f ->> 'apply_end')::date,
              (v_f ->> 'notice_date')::date, v_f ->> 'notice_issuer', v_f ->> 'official_notice_url', now(), v_kogl, 'public', p_actor, p_actor, v_src, v_item, v_hash)
      returning id into v_target_id;
    end if;

  elsif v_target = 'local_event' then
    v_override := case when coalesce(v_f ->> 'status', 'normal') in ('cancelled', 'changing') then v_f ->> 'status' end;
    -- 이미지는 권리가 확인된 것만 저장한다 (LG-15)
    v_image := case when coalesce(v_f ->> 'image_rights', 'unconfirmed') = 'confirmed' then nullif(btrim(coalesce(v_f ->> 'image_url', '')), '') end;
    select e.* into v_ev from public.local_events e where e.source_key = v_src and e.source_item_id = v_item;
    if v_ev.id is not null and v_ev.source_value_hash = v_hash then
      v_action := 'unchanged';
      v_target_id := v_ev.id;
    elsif v_ev.id is not null then
      update public.local_events set
        title = v_f ->> 'title', category = v_f ->> 'category', organizer = v_f ->> 'organizer', organizer_type = v_f ->> 'organizer_type', venue = v_f ->> 'venue',
        region_code = v_f ->> 'region_code',
        starts_at = case when v_ev.ends_at < now() then v_ev.starts_at else (v_f ->> 'starts_at')::timestamptz end,
        ends_at = case when v_ev.ends_at < now() then v_ev.ends_at else (v_f ->> 'ends_at')::timestamptz end,
        official_url = v_f ->> 'official_url', source_name = v_source_name, confirmed_on = v_checked_on,
        status_override = v_override,
        status_source_url = case when v_override is null then null else coalesce(v_f ->> 'status_source_url', v_f ->> 'official_url') end,
        status_confirmed_at = case when v_override is null then null else now() end,
        sponsored = (v_f ->> 'sponsored')::boolean, edited_by = p_actor, license_type = v_kogl,
        image_rights = case when v_image is null then 'unconfirmed' else 'confirmed' end, image_url = v_image, source_value_hash = v_hash
       where id = v_ev.id;
      v_target_id := v_ev.id;
      v_action := 'updated';
    else
      insert into public.local_events (slug, series_key, title, category, organizer, organizer_type, venue, region_code, starts_at, ends_at, official_url, source_name,
                                       confirmed_on, status_override, status_source_url, status_confirmed_at, sponsored, published, edited_by,
                                       source_key, source_item_id, source_value_hash, license_type, image_url, image_rights)
      values (v_f ->> 'slug', v_f ->> 'series_key', v_f ->> 'title', v_f ->> 'category', v_f ->> 'organizer', v_f ->> 'organizer_type', v_f ->> 'venue', v_f ->> 'region_code',
              (v_f ->> 'starts_at')::timestamptz, (v_f ->> 'ends_at')::timestamptz, v_f ->> 'official_url', v_source_name, v_checked_on, v_override,
              case when v_override is null then null else coalesce(v_f ->> 'status_source_url', v_f ->> 'official_url') end,
              case when v_override is null then null else now() end,
              (v_f ->> 'sponsored')::boolean, true, p_actor, v_src, v_item, v_hash, v_kogl, v_image, case when v_image is null then 'unconfirmed' else 'confirmed' end)
      returning id into v_target_id;
    end if;

  elsif v_target = 'finance_indicator' then
    insert into public.finance_indicators (indicator_key, label, definition, value, unit, as_of, collected_on, provider, source_url, snapshot_id, recorded_by,
                                           source_key, source_item_id, source_value_hash, released_on, license_type)
    values (v_f ->> 'indicator_key', v_f ->> 'label', v_f ->> 'definition', (v_f ->> 'value')::numeric, v_f ->> 'unit', (v_f ->> 'as_of')::date, v_checked_on,
            v_f ->> 'provider', v_f ->> 'source_url', r.snapshot_id, p_actor, v_src, v_item, v_hash, (v_f ->> 'released_on')::date, v_kogl)
    on conflict (source_key, source_item_id, source_value_hash) where source_key is not null do nothing
    returning id into v_target_id;
    if v_target_id is null then
      v_action := 'unchanged';
      select i.id into v_target_id from public.finance_indicators i where i.source_key = v_src and i.source_item_id = v_item and i.source_value_hash = v_hash;
    end if;

  elsif v_target = 'finance_regulation' then
    insert into public.finance_regulations (reg_key, title, stage, effective_on, provider, source_url, snapshot_id, recorded_by,
                                            source_key, source_item_id, source_value_hash, released_on, as_of, license_type)
    values (v_f ->> 'reg_key', v_f ->> 'title', v_f ->> 'stage', (v_f ->> 'effective_on')::date, v_f ->> 'provider', v_f ->> 'source_url', r.snapshot_id, p_actor,
            v_src, v_item, v_hash, (v_f ->> 'released_on')::date, (v_f ->> 'as_of')::date, v_kogl)
    on conflict (source_key, source_item_id, source_value_hash) where source_key is not null do nothing
    returning id into v_target_id;
    if v_target_id is null then
      v_action := 'unchanged';
      select i.id into v_target_id from public.finance_regulations i where i.source_key = v_src and i.source_item_id = v_item and i.source_value_hash = v_hash;
    end if;

  else -- finance_case_entry
    select c.* into v_ce from public.finance_case_entries c where c.source_key = v_src and c.source_item_id = v_item;
    if v_ce.id is not null and v_ce.source_value_hash = v_hash then
      v_action := 'unchanged';
      v_target_id := v_ce.id;
    elsif v_ce.id is not null then
      update public.finance_case_entries set
        title = v_f ->> 'title', structure_type = v_f ->> 'structure_type', issues = array(select jsonb_array_elements_text(v_f -> 'issues')),
        outcome = v_f ->> 'outcome', as_of = (v_f ->> 'as_of')::date, sources = v_f -> 'sources',
        companies = case when v_f ? 'companies' then array(select jsonb_array_elements_text(v_f -> 'companies')) else companies end,
        judgment_quoted = coalesce((v_f ->> 'judgment_quoted')::boolean, false), anonymized_checked = coalesce((v_f ->> 'anonymized_checked')::boolean, false),
        snapshot_id = r.snapshot_id, license_type = v_kogl, released_on = (v_f ->> 'released_on')::date, source_value_hash = v_hash, updated_by = p_actor
       where id = v_ce.id;
      v_target_id := v_ce.id;
      v_action := 'updated';
    else
      insert into public.finance_case_entries (slug, title, structure_type, issues, outcome, as_of, sources, companies, judgment_quoted, anonymized_checked, status,
                                               source_key, source_item_id, source_value_hash, snapshot_id, license_type, released_on, created_by, updated_by)
      values (v_f ->> 'slug', v_f ->> 'title', v_f ->> 'structure_type', array(select jsonb_array_elements_text(v_f -> 'issues')), v_f ->> 'outcome', (v_f ->> 'as_of')::date,
              v_f -> 'sources', case when v_f ? 'companies' then array(select jsonb_array_elements_text(v_f -> 'companies')) else '{}'::text[] end,
              coalesce((v_f ->> 'judgment_quoted')::boolean, false), coalesce((v_f ->> 'anonymized_checked')::boolean, false), 'draft',
              v_src, v_item, v_hash, r.snapshot_id, v_kogl, (v_f ->> 'released_on')::date, p_actor, p_actor)
      returning id into v_target_id;
    end if;
  end if;

  insert into public.field_publications (review_item_id, target, target_id, source_key, source_item_id, value_hash, action, published_by)
  values (r.id, v_target, v_target_id, v_src, v_item, v_hash, v_action, p_actor);
  perform public.review_item_transition(r.id, 'published', p_actor);
  return jsonb_build_object('action', v_action, 'target', v_target, 'targetId', v_target_id, 'itemId', r.id);
end;
$$;
revoke all on function public.field_publish(bigint, text) from public, anon, authenticated;
grant execute on function public.field_publish(bigint, text) to service_role;
