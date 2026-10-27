-- W13-d d2 - 알림 함수 (docs/dev/W13-d_설계.md 2절). 모두 service_role 전용, 시계는 인자 p_now(서버가 now()를 넘긴다).
-- 수집은 수신 동의(receive) 철회 안 됨 + 알림 종류를 켠 회원만, 켠 시각 이후 공개분만, 공개·권리 확인·무료 기사만.

insert into public.settings (key, value, description, updated_by) values
  ('notification_policy', '{"daily_hour_kst": 8, "weekly_weekday_kst": 1}'::jsonb, '알림 발송 시각 (W13-d - 일간은 한국 시각 이 시 이후 하루 1통, 주간은 이 요일(1=월~7=일) 이 시 이후)', 'migration:20261027000207')
on conflict (key) do nothing;

create function public.noti_prefs_set(p_user uuid, p_kinds text[], p_frequency text, p_briefing text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.notification_prefs%rowtype;
  v_kinds text[] := coalesce(p_kinds, '{}'::text[]);
begin
  if p_user is null or p_frequency not in ('instant', 'daily', 'weekly') or p_briefing not in ('off', 'web', 'mail') or not (v_kinds <@ array['law', 'saved_search', 'region', 'calendar']::text[]) then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if (cardinality(v_kinds) > 0 or p_briefing = 'mail')
     and not exists (select 1 from public.consents c where c.user_id = p_user and c.kind = 'receive' and c.revoked_at is null) then
    return jsonb_build_object('ok', false, 'code', 'no_consent');
  end if;
  select * into v_old from public.notification_prefs where user_id = p_user;
  insert into public.notification_prefs (user_id, kinds, frequency, briefing, enabled_at)
  values (p_user, v_kinds, p_frequency, p_briefing, case when cardinality(v_kinds) > 0 then now() end)
  on conflict (user_id) do update
    set kinds = excluded.kinds, frequency = excluded.frequency, briefing = excluded.briefing,
        enabled_at = case
          when cardinality(excluded.kinds) = 0 then public.notification_prefs.enabled_at
          when cardinality(public.notification_prefs.kinds) = 0 then now()
          else public.notification_prefs.enabled_at end;
  return jsonb_build_object('ok', true);
end;
$$;

create function public.noti_unsubscribe(p_user uuid) returns boolean
language sql
security definer
set search_path = ''
as $$
  with u as (update public.notification_prefs set kinds = '{}'::text[] where user_id = p_user and cardinality(kinds) > 0 returning 1)
  select exists (select 1 from u);
$$;

-- 수집: 새로 만든 알림 수를 돌려준다. 같은 항목(content_id)은 종류와 관계없이 회원당 한 번.
create function public.noti_collect(p_now timestamptz) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_region integer;
  v_search integer;
begin
  with elig as (
    select p.user_id, p.kinds, p.enabled_at
      from public.notification_prefs p
     where cardinality(p.kinds) > 0 and p.enabled_at is not null
       and exists (select 1 from public.consents c where c.user_id = p.user_id and c.kind = 'receive' and c.revoked_at is null)
  ),
  want as (
    select e.user_id, e.enabled_at, w.code as orig, coalesce(r.successor_code, w.code) as code
      from elig e
      join public.profiles pr on pr.id = e.user_id
      cross join lateral unnest(pr.interest_region_codes) as w(code)
      left join public.regions r on r.code = w.code
     where 'region' = any (e.kinds)
  ),
  hit as (
    select distinct on (wn.user_id, a.id) wn.user_id, wn.code, a.id as article_id, a.title, a.slug
      from want wn
      join public.articles a
        on a.status = 'published' and a.lead_media_cleared and not a.is_paid
       and a.content_type is not null and a.content_type not in ('digest', 'sponsored')
       and a.first_published_at >= greatest(wn.enabled_at, p_now - interval '7 days')
       and a.first_published_at <= p_now
       and exists (select 1 from unnest(a.region_codes) rc
                    where rc = wn.orig or rc = wn.code
                       or (right(wn.code, 8) = '00000000' and left(rc, 2) = left(wn.code, 2)))
     where not exists (select 1 from public.notifications n where n.user_id = wn.user_id and n.content_id = 'article:' || a.id)
     order by wn.user_id, a.id, wn.code
  )
  insert into public.notifications (user_id, kind, target, content_id, label, link, created_at)
  select h.user_id, 'region', h.code, 'article:' || h.article_id, left(h.title, 200), '/news/' || h.slug, p_now from hit h
  on conflict (user_id, kind, content_id) do nothing;
  get diagnostics v_region = row_count;

  with elig as (
    select p.user_id, p.enabled_at
      from public.notification_prefs p
     where 'saved_search' = any (p.kinds) and p.enabled_at is not null
       and exists (select 1 from public.consents c where c.user_id = p.user_id and c.kind = 'receive' and c.revoked_at is null)
  ),
  hit as (
    select distinct on (s.user_id, a.id) s.user_id, s.id as search_id, a.id as article_id, a.title, a.slug
      from public.saved_searches s
      join elig e on e.user_id = s.user_id
      join public.articles a
        on a.status = 'published' and a.lead_media_cleared and not a.is_paid
       and a.first_published_at > greatest(s.created_at, e.enabled_at, p_now - interval '7 days')
       and a.first_published_at <= p_now
       and a.title ilike '%' || replace(replace(replace(btrim(s.conditions ->> 'q'), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
     where s.notify and char_length(btrim(coalesce(s.conditions ->> 'q', ''))) > 0
       and public.has_entitlement(s.user_id, 'workspace', p_now)
       and not exists (select 1 from public.notifications n where n.user_id = s.user_id and n.content_id = 'article:' || a.id)
     order by s.user_id, a.id, s.id
  )
  insert into public.notifications (user_id, kind, target, content_id, label, link, created_at)
  select h.user_id, 'saved_search', 'search:' || h.search_id, 'article:' || h.article_id, left(h.title, 200), '/news/' || h.slug, p_now from hit h
  on conflict (user_id, kind, content_id) do nothing;
  get diagnostics v_search = row_count;

  return jsonb_build_object('region', v_region, 'saved_search', v_search);
end;
$$;

-- 서버가 개정을 확인한 스크랩 조문 알림 한 건 넣기 (law). 켠 회원·동의가 있을 때만 새로 만든다.
create function public.noti_add_law(p_user uuid, p_target text, p_content_id text, p_label text, p_link text, p_now timestamptz) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows integer;
begin
  if not exists (select 1 from public.notification_prefs p where p.user_id = p_user and 'law' = any (p.kinds))
     or not exists (select 1 from public.consents c where c.user_id = p_user and c.kind = 'receive' and c.revoked_at is null)
     or exists (select 1 from public.notifications n where n.user_id = p_user and n.content_id = p_content_id) then
    return false;
  end if;
  insert into public.notifications (user_id, kind, target, content_id, label, link, created_at)
  values (p_user, 'law', p_target, p_content_id, left(p_label, 200), p_link, p_now)
  on conflict (user_id, kind, content_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- 보낼 때가 된 알림. mail=false면 웹 알림함에만 둔다(주간 빈도 + 확인된 주간 브리핑 구독 = 메일 중복 방지).
create function public.noti_due(p_now timestamptz) returns table (id bigint, user_id uuid, kind text, label text, link text, mail boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_policy jsonb := coalesce((select s.value from public.settings s where s.key = 'notification_policy'), '{}'::jsonb);
  v_hour integer := case when jsonb_typeof(v_policy -> 'daily_hour_kst') = 'number' then (v_policy ->> 'daily_hour_kst')::integer else 8 end;
  v_wd integer := case when jsonb_typeof(v_policy -> 'weekly_weekday_kst') = 'number' then (v_policy ->> 'weekly_weekday_kst')::integer else 1 end;
  v_kst timestamp := p_now at time zone 'Asia/Seoul';
begin
  return query
  select n.id, n.user_id, n.kind, n.label, n.link,
         not (p.frequency = 'weekly' and exists (select 1 from public.consents b where b.user_id = n.user_id and b.kind = 'brief' and b.confirmed_at is not null and b.revoked_at is null))
    from public.notifications n
    join public.notification_prefs p on p.user_id = n.user_id
   where n.sent_at is null and n.attempts < 3 and cardinality(p.kinds) > 0
     and exists (select 1 from public.consents c where c.user_id = n.user_id and c.kind = 'receive' and c.revoked_at is null)
     and (
       p.frequency = 'instant'
       or (p.frequency = 'daily' and extract(hour from v_kst) >= v_hour)
       or (p.frequency = 'weekly' and extract(isodow from v_kst) = v_wd and extract(hour from v_kst) >= v_hour))
     and (p.frequency = 'instant' or not exists (
       select 1 from public.notifications d
        where d.user_id = n.user_id and d.sent_at is not null and (d.sent_at at time zone 'Asia/Seoul')::date = v_kst::date))
   order by n.user_id, n.id;
end;
$$;

create function public.noti_mark(p_ids bigint[], p_channel text, p_ok boolean, p_now timestamptz) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows integer;
begin
  if p_channel not in ('mail', 'web') then
    raise exception using errcode = '22023', message = '채널은 mail 또는 web이어야 합니다';
  end if;
  if p_ok then
    update public.notifications set sent_at = p_now, channel = p_channel where id = any (p_ids) and sent_at is null;
  else
    update public.notifications set attempts = attempts + 1 where id = any (p_ids) and sent_at is null and attempts < 3;
  end if;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create function public.noti_read(p_user uuid, p_id bigint, p_now timestamptz) returns text
language sql
security definer
set search_path = ''
as $$
  with u as (update public.notifications set read_at = coalesce(read_at, p_now) where id = p_id and user_id = p_user returning kind)
  select (select kind from u);
$$;

revoke all on function public.noti_prefs_set(uuid, text[], text, text) from public, anon, authenticated;
revoke all on function public.noti_unsubscribe(uuid) from public, anon, authenticated;
revoke all on function public.noti_collect(timestamptz) from public, anon, authenticated;
revoke all on function public.noti_add_law(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.noti_due(timestamptz) from public, anon, authenticated;
revoke all on function public.noti_mark(bigint[], text, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.noti_read(uuid, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.noti_prefs_set(uuid, text[], text, text) to service_role;
grant execute on function public.noti_unsubscribe(uuid) to service_role;
grant execute on function public.noti_collect(timestamptz) to service_role;
grant execute on function public.noti_add_law(uuid, text, text, text, text, timestamptz) to service_role;
grant execute on function public.noti_due(timestamptz) to service_role;
grant execute on function public.noti_mark(bigint[], text, boolean, timestamptz) to service_role;
grant execute on function public.noti_read(uuid, bigint, timestamptz) to service_role;
