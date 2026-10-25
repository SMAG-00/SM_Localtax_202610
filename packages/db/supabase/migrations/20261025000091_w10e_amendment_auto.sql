-- W10-e e1 - 개정 자동 감지 (PRD-02 AIOPS-01 · TX-05, docs/dev/W10-e_설계.md 3장)
-- 이 파일에 법령 문장·세율·기한 값은 없다 - 표 칸과 함수만 만든다.
--
-- · amendment_events 확장 - origin(manual·auto)·review_item_id. auto이면 승인된 후보 번호가 있어야 하고(유일), 후보는 승인 전에 이 표에 들어가지 않는다.
--   공개 칸 목록(grant select (cols))에는 새 칸을 넣지 않는다 - 익명 읽기 불변.
-- · amendment_candidates_detect(p_today) - law_events 개정을 읽어 검수 후보(review_items kind amendment_stage)를 만든다.
--   공포 후보는 항상, 시행 후보는 시행일이 p_today 이하일 때. (종류, 키) 유일이라 재감지도 후보 1건.
-- · amendment_candidate_apply(item, amendment, actor) - 승인(approved)된 후보만 amendment_events에 넣고 처리 완료로 바꾼다. 같은 후보는 한 번만.
-- service_role만 실행한다.

alter table public.amendment_events
  add column origin text not null default 'manual' check (origin in ('manual', 'auto')),
  add column review_item_id bigint references public.review_items (id);

alter table public.amendment_events
  add constraint amendment_events_origin_item check ((origin = 'auto') = (review_item_id is not null));

create unique index amendment_events_review_item_uidx on public.amendment_events (review_item_id) where review_item_id is not null;

comment on column public.amendment_events.origin is '기록 출처 - manual 편집자 입력 / auto 자동 감지 후보를 승인해 반영 (AIOPS-01)';
comment on column public.amendment_events.review_item_id is 'auto 기록의 승인된 검수 후보 번호 (유일)';

create function public.amendment_candidates_detect(p_today date default ((now() at time zone 'Asia/Seoul')::date))
returns table (created integer, existing integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  s record;
  v_created integer := 0;
  v_existing integer := 0;
  v_url text;
  v_rows integer;
begin
  for r in
    select ev.id as event_id, ev.law_id, ev.snapshot_id, l.name as law_name,
           v.promulgation_no, v.promulgated_on, v.effective_on
      from public.law_events ev
      join public.laws l on l.id = ev.law_id
      join public.law_versions v on v.id = ev.version_id
     where ev.kind = 'revision'
     order by ev.id
  loop
    v_url := coalesce(
      (select i.payload ->> 'publicUrl' from public.review_items i
        where i.kind = 'law_change' and i.source_key = format('law:%s:%s:%s', r.law_id, r.promulgation_no, r.effective_on)),
      (select sn.url from public.raw_snapshots sn where sn.id = r.snapshot_id));
    for s in
      select 'promulgated'::text as stage, '공포'::text as label, r.promulgated_on as on_date
      union all
      select 'effective', '시행', r.effective_on where r.effective_on <= p_today
    loop
      insert into public.review_items (kind, source_key, title, data_source_key, snapshot_id, payload, created_by)
      values ('amendment_stage', format('law_event:%s:%s', r.event_id, s.stage),
              left(format('%s %s 단계 후보', r.law_name, s.label), 200), 'law_api', r.snapshot_id,
              jsonb_build_object('lawEventId', r.event_id, 'lawId', r.law_id, 'lawName', r.law_name, 'stage', s.stage,
                                 'occurredOn', s.on_date, 'promulgationNo', r.promulgation_no, 'effectiveOn', r.effective_on, 'sourceUrl', v_url),
              'job:amendment-detect')
      on conflict (kind, source_key) do nothing;
      get diagnostics v_rows = row_count;
      if v_rows = 1 then v_created := v_created + 1; else v_existing := v_existing + 1; end if;
    end loop;
  end loop;
  return query select v_created, v_existing;
end;
$$;

create function public.amendment_candidate_apply(p_item_id bigint, p_amendment_id bigint, p_actor text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.review_items;
  v_event bigint;
begin
  if length(btrim(coalesce(p_actor, ''))) = 0 then
    raise exception '반영하는 사람이 필요합니다' using errcode = 'check_violation';
  end if;
  select * into i from public.review_items where id = p_item_id for update;
  if not found then
    raise exception '검수 항목 %가 없습니다', p_item_id using errcode = 'no_data_found';
  end if;
  if i.kind <> 'amendment_stage' then
    raise exception '개정 단계 후보가 아닙니다 (종류 %)', i.kind using errcode = 'check_violation';
  end if;
  select e.id into v_event from public.amendment_events e where e.review_item_id = p_item_id;
  if found then
    return v_event;
  end if;
  if i.status <> 'approved' then
    raise exception '승인된 후보만 개정 트래커에 반영할 수 있습니다 (현재 %)', i.status using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.amendments a where a.id = p_amendment_id) then
    raise exception '개정안 %가 없습니다', p_amendment_id using errcode = 'no_data_found';
  end if;
  insert into public.amendment_events (amendment_id, stage, occurred_on, source_url, snapshot_id, recorded_by, origin, review_item_id)
  values (p_amendment_id, i.payload ->> 'stage', (i.payload ->> 'occurredOn')::date, i.payload ->> 'sourceUrl', i.snapshot_id, p_actor, 'auto', p_item_id)
  returning id into v_event;
  perform public.review_item_transition(p_item_id, 'published', p_actor, null, null, null);
  return v_event;
end;
$$;

revoke all on function public.amendment_candidates_detect(date) from public, anon, authenticated;
revoke all on function public.amendment_candidate_apply(bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.amendment_candidates_detect(date) to service_role;
grant execute on function public.amendment_candidate_apply(bigint, bigint, text) to service_role;
