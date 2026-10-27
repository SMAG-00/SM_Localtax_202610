-- W13-d d4 - 맞춤 브리핑 (docs/dev/W13-d_설계.md 3절, PRD-05 WS-06)
-- · items = [{type, id, reason, basis_on}] - 콘텐츠 번호만 담는다(제목·본문 사본 칸 없음). 트리거가 공개 상태 콘텐츠만 허용한다.
--   type article = 발행·권리 확인·무료 기사 / case_summary = 승인·공개된 결정례 요지(public_case_summaries). 출판물 type 없음.
-- · (user_id, period) 유일 - 같은 주차는 한 번만 만든다. 읽기는 본인 행만, 쓰기는 서버 함수로만.

insert into public.settings (key, value, description, updated_by) values
  ('briefing_policy', '{}'::jsonb, '맞춤 브리핑 선정 한도 (W13-d - {"max_items": n}. 비어 있으면 브리핑 생성 0)', 'migration:20261027000208')
on conflict (key) do nothing;

create table public.briefings (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-W[0-9]{2}$'),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 50 and pg_column_size(items) <= 20000),
  channel text not null default 'web' check (channel in ('web', 'mail')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  opened_at timestamptz,
  constraint briefings_once unique (user_id, period)
);
comment on table public.briefings is '맞춤 브리핑 (WS-06) - 주차별 1건, items는 공개 상태 콘텐츠의 종류+번호+이유+기준일뿐. AI가 쓴 문장 없음. 본인만 읽기';
create index briefings_user_idx on public.briefings (user_id, period desc);

create function public.briefings_items_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
begin
  for v_item in select * from jsonb_array_elements(new.items) loop
    if jsonb_typeof(v_item) <> 'object'
       or (v_item ->> 'type') is null or (v_item ->> 'id') !~ '^[0-9]{1,18}$'
       or (v_item ->> 'reason') not in ('saved_search', 'region', 'interest', 'case_summary')
       or (v_item ->> 'basis_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or (select count(*) from jsonb_object_keys(v_item)) <> 4 then
      raise exception '브리핑 항목 모양이 맞지 않습니다' using errcode = 'check_violation';
    end if;
    if v_item ->> 'type' = 'article' then
      if not exists (select 1 from public.articles a where a.id = (v_item ->> 'id')::bigint and a.status = 'published' and a.lead_media_cleared and not a.is_paid) then
        raise exception '공개 상태가 아닌 기사는 브리핑에 담을 수 없습니다' using errcode = 'check_violation';
      end if;
    elsif v_item ->> 'type' = 'case_summary' then
      if not exists (select 1 from public.public_case_summaries s where s.case_id = (v_item ->> 'id')::bigint) then
        raise exception '승인·공개되지 않은 결정례 요지는 브리핑에 담을 수 없습니다' using errcode = 'check_violation';
      end if;
    else
      raise exception '브리핑에 담을 수 없는 종류입니다' using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.briefings_items_guard() from public, anon, authenticated;
create trigger briefings_items before insert or update of items on public.briefings for each row execute function public.briefings_items_guard();

-- 만들기: workspace 권한 + 브리핑 설정이 켜진 회원만. 같은 주차는 한 번(이미 있으면 created=false)
create function public.briefing_create(p_user uuid, p_period text, p_items jsonb, p_now timestamptz) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_id bigint;
begin
  select p.briefing into v_mode from public.notification_prefs p where p.user_id = p_user;
  if v_mode is null or v_mode = 'off' then
    return jsonb_build_object('ok', false, 'code', 'off');
  end if;
  if not public.has_entitlement(p_user, 'workspace', p_now) then
    return jsonb_build_object('ok', false, 'code', 'no_entitlement');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'code', 'empty');
  end if;
  insert into public.briefings (user_id, period, items, channel, created_at)
  values (p_user, p_period, p_items, case when v_mode = 'mail' and exists (select 1 from public.consents c where c.user_id = p_user and c.kind = 'receive' and c.revoked_at is null) then 'mail' else 'web' end, p_now)
  on conflict (user_id, period) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('ok', true, 'created', false);
  end if;
  return jsonb_build_object('ok', true, 'created', true, 'id', v_id);
end;
$$;

create function public.briefing_mark_sent(p_id bigint, p_now timestamptz) returns boolean
language sql
security definer
set search_path = ''
as $$
  with u as (update public.briefings set sent_at = p_now where id = p_id and sent_at is null and channel = 'mail' returning 1)
  select exists (select 1 from u);
$$;

create function public.briefing_open(p_user uuid, p_id bigint, p_now timestamptz) returns text
language sql
security definer
set search_path = ''
as $$
  with u as (update public.briefings set opened_at = coalesce(opened_at, p_now) where id = p_id and user_id = p_user returning channel)
  select (select channel from u);
$$;

alter table public.briefings enable row level security;
revoke all on table public.briefings from public, anon, authenticated, service_role;
grant select on table public.briefings to authenticated;
grant select, insert, update, delete on table public.briefings to service_role;
create policy briefings_own_read on public.briefings for select to authenticated using (user_id = (select auth.uid()));

revoke all on function public.briefing_create(uuid, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.briefing_mark_sent(bigint, timestamptz) from public, anon, authenticated;
revoke all on function public.briefing_open(uuid, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.briefing_create(uuid, text, jsonb, timestamptz) to service_role;
grant execute on function public.briefing_mark_sent(bigint, timestamptz) to service_role;
grant execute on function public.briefing_open(uuid, bigint, timestamptz) to service_role;
