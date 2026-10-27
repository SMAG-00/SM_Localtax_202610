-- W13-b b3 - 저장 검색 (docs/dev/W13-b_설계.md, PRD-05 WS-04)
-- · 한도: 설정 saved_search_limit 의 {"max": n}. 비어 있거나 모양이 틀리면 0 (저장 닫힘). n번째는 성공, n+1번째는 거부.
-- · 생성은 함수 ws_saved_search_create(service_role 전용) 하나 - 권한(workspace)·한도·사용자별 잠금을 한 곳에서 판정한다. 시계는 DB(now())만.
-- · 읽기는 본인 행만 (RLS). 검색어는 이벤트·알림 기록에 넣지 않는다.

create table public.saved_searches (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  conditions jsonb not null check (jsonb_typeof(conditions) = 'object' and pg_column_size(conditions) <= 2000),
  notify boolean not null default false,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
comment on table public.saved_searches is '저장 검색 (WS-04) - 조건 {q, kind}·알림 여부·마지막 확인 시각. 새 결과는 공개·권리 확인 콘텐츠만 센다(서버). 구독이 끝나도 지우지 않는다';
create index saved_searches_user_idx on public.saved_searches (user_id, created_at desc);

create function public.ws_saved_search_limit() returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when jsonb_typeof(s.value -> 'max') = 'number' and (s.value ->> 'max')::numeric >= 0 and (s.value ->> 'max')::numeric = trunc((s.value ->> 'max')::numeric)
        then least((s.value ->> 'max')::numeric, 100000)::integer
      else 0 end
    from public.settings s where s.key = 'saved_search_limit'), 0);
$$;
revoke all on function public.ws_saved_search_limit() from public, anon, authenticated;
grant execute on function public.ws_saved_search_limit() to service_role;

create function public.ws_saved_search_create(p_user uuid, p_name text, p_conditions jsonb, p_notify boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := public.ws_saved_search_limit();
  v_count integer;
  v_id bigint;
begin
  if p_user is null or p_name is null or char_length(btrim(p_name)) not between 1 and 80 or p_conditions is null or jsonb_typeof(p_conditions) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if not public.has_entitlement(p_user, 'workspace', now()) then
    return jsonb_build_object('ok', false, 'code', 'no_entitlement');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ws_saved_search:' || p_user::text, 0));
  select count(*) into v_count from public.saved_searches s where s.user_id = p_user;
  if v_count >= v_limit then
    return jsonb_build_object('ok', false, 'code', 'limit', 'limit', v_limit, 'count', v_count);
  end if;
  begin
    insert into public.saved_searches (user_id, name, conditions, notify) values (p_user, btrim(p_name), p_conditions, coalesce(p_notify, false)) returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'duplicate');
  end;
  return jsonb_build_object('ok', true, 'id', v_id, 'limit', v_limit, 'count', v_count + 1);
end;
$$;
revoke all on function public.ws_saved_search_create(uuid, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.ws_saved_search_create(uuid, text, jsonb, boolean) to service_role;

alter table public.saved_searches enable row level security;
revoke all on table public.saved_searches from public, anon, authenticated, service_role;
grant select on table public.saved_searches to authenticated;
grant select, update, delete on table public.saved_searches to service_role;
create policy saved_searches_own_read on public.saved_searches for select to authenticated using (user_id = (select auth.uid()));
