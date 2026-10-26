-- W12-h h4 - 채널 배포 키트·게시 기록 (PRD-04 CH-01, docs/dev/W12-h_설계.md 1장·3장)
-- 이 파일에 채널 원고 문장·채널 계정 정보는 없다. 외부 채널 게시 호출 0 - 게시는 사람이 하고 이 표는 기록만 남긴다.
-- · channel_kit_get - 승인(approved/published)된 channel_draft 검수 항목만 돌려주고, 내려받기를 channel_kit_downloads에 남긴다 (승인 전 원고 키트 0)
-- · channel_posts - 게시 기록. 승인된 원고당 1건, 추가만. utm_campaign은 기사 slug와 같아야 하고 체크리스트 4칸이 모두 true여야 한다
-- · channel_post_record - 게시 기록 RPC (거부도 감사 1행)
-- · 공개 뷰 public_channel_posts - 채널 유입 측정이 "등록된 (channel, utm_campaign) 쌍인가"만 보는 칸 2개. 기능 키 channel_kit이 켜졌을 때만

create function public.channel_no_update_delete() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '채널 게시·내려받기·감사 기록은 지우거나 고치지 못합니다 (% 거부)', tg_op using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.channel_no_update_delete() from public, anon, authenticated;

create table public.channel_posts (
  id bigint generated always as identity primary key,
  article_id bigint not null references public.articles (id),
  review_item_id bigint not null unique references public.review_items (id),
  channel text not null check (channel in ('brief', 'cardnews', 'shorts', 'naver_blog', 'naver_post')),
  utm_campaign text not null check (utm_campaign ~ '^[^[:space:]/]+$'),
  posted_url text not null check (posted_url ~* '^https://[^[:space:]]+$' and posted_url !~* '[?&;](oc|servicekey|api_?key|auth_?key|access_?token|key|token)='),
  checklist jsonb not null check (
    jsonb_typeof(checklist) = 'object'
    and checklist ?& array['source_noted', 'ai_notice', 'alt_text', 'not_ad']
    and checklist -> 'source_noted' = 'true'::jsonb and checklist -> 'ai_notice' = 'true'::jsonb
    and checklist -> 'alt_text' = 'true'::jsonb and checklist -> 'not_ad' = 'true'::jsonb),
  posted_by text not null check (length(btrim(posted_by)) > 0),
  posted_at timestamptz not null,
  created_at timestamptz not null default now()
);
comment on table public.channel_posts is '채널 게시 기록(CH-01) - 사람이 게시한 뒤 링크를 적는다. 추가만, 승인된 원고당 1건. 자동 게시 0';
create index channel_posts_article_idx on public.channel_posts (article_id, channel);
create trigger channel_posts_no_update_delete before update or delete on public.channel_posts for each row execute function public.channel_no_update_delete();
create trigger channel_posts_no_truncate before truncate on public.channel_posts for each statement execute function public.channel_no_update_delete();

create table public.channel_kit_downloads (
  id bigint generated always as identity primary key,
  review_item_id bigint not null references public.review_items (id),
  downloaded_by text not null check (length(btrim(downloaded_by)) > 0),
  at timestamptz not null default now()
);
comment on table public.channel_kit_downloads is '채널 배포 키트 내려받기 기록 - 추가만';
create index channel_kit_downloads_item_idx on public.channel_kit_downloads (review_item_id, at desc);
create trigger channel_kit_downloads_no_update_delete before update or delete on public.channel_kit_downloads for each row execute function public.channel_no_update_delete();
create trigger channel_kit_downloads_no_truncate before truncate on public.channel_kit_downloads for each statement execute function public.channel_no_update_delete();

create table public.channel_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  review_item_id bigint,
  action text not null check (action in ('kit', 'post')),
  outcome text not null check (outcome in ('ok', 'refused')),
  code text not null check (length(btrim(code)) > 0),
  actor text not null check (length(btrim(actor)) > 0),
  detail text check (detail is null or char_length(detail) <= 500),
  constraint channel_audit_ok_code check ((outcome = 'ok') = (code = 'ok'))
);
comment on table public.channel_audit is '채널 키트·게시 기록 감사 - 추가만, 거부도 1행(code가 사유)';
create index channel_audit_item_idx on public.channel_audit (review_item_id, at desc);
create trigger channel_audit_no_update_delete before update or delete on public.channel_audit for each row execute function public.channel_no_update_delete();
create trigger channel_audit_no_truncate before truncate on public.channel_audit for each statement execute function public.channel_no_update_delete();

create function public.channel_audit_write(p_item bigint, p_action text, p_ok boolean, p_code text, p_actor text, p_detail text) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.channel_audit (review_item_id, action, outcome, code, actor, detail)
  values (p_item, p_action, case when p_ok then 'ok' else 'refused' end, p_code, coalesce(nullif(btrim(p_actor), ''), 'unknown'), left(p_detail, 500));
$$;
revoke all on function public.channel_audit_write(bigint, text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.channel_audit_write(bigint, text, boolean, text, text, text) to service_role;

-- 키트 조회 - 기사 하나의 승인된 채널 원고. 기능 키 channel_kit이 꺼져 있으면 빈 목록(감사 1행). 내려받기마다 기록
create function public.channel_kit_get(p_article_id bigint, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_slug text;
  r record;
begin
  if p_actor is null or p_actor !~ '^(user|admin):.+' then
    perform public.channel_audit_write(null, 'kit', false, 'actor_invalid', p_actor, '내려받은 사람 표시가 필요합니다');
    return jsonb_build_object('ok', false, 'code', 'actor_invalid', 'items', '[]'::jsonb);
  end if;
  if not exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'channel_kit') = 'true'::jsonb) then
    perform public.channel_audit_write(null, 'kit', false, 'feature_off', p_actor, null);
    return jsonb_build_object('ok', false, 'code', 'feature_off', 'items', '[]'::jsonb);
  end if;
  select a.slug into v_slug from public.articles a where a.id = p_article_id;
  if v_slug is null then
    perform public.channel_audit_write(null, 'kit', false, 'not_found', p_actor, null);
    return jsonb_build_object('ok', false, 'code', 'not_found', 'items', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'review_item_id', i.id, 'channel', i.payload ->> 'channel', 'text', i.payload ->> 'text', 'article_url', i.payload ->> 'articleUrl',
           'article_version', (i.payload ->> 'articleVersion')::int, 'posted', exists (select 1 from public.channel_posts p where p.review_item_id = i.id)) order by i.id), '[]'::jsonb)
    into v_items
    from public.review_items i
   where i.kind = 'channel_draft' and i.status in ('approved', 'published') and (i.payload ->> 'articleId')::bigint = p_article_id;
  for r in select i.id from public.review_items i where i.kind = 'channel_draft' and i.status in ('approved', 'published') and (i.payload ->> 'articleId')::bigint = p_article_id loop
    insert into public.channel_kit_downloads (review_item_id, downloaded_by) values (r.id, p_actor);
  end loop;
  perform public.channel_audit_write(null, 'kit', true, 'ok', p_actor, 'article:' || p_article_id);
  return jsonb_build_object('ok', true, 'code', 'ok', 'slug', v_slug, 'items', v_items);
end;
$$;

-- 게시 기록 - 승인된 원고만, 체크리스트 4칸 모두 true, utm_campaign = 기사 slug, 주소는 https
create function public.channel_post_record(p_review_item_id bigint, p_posted_url text, p_checklist jsonb, p_posted_at timestamptz, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.review_items;
  v_slug text;
  v_code text;
  v_msg text;
  v_id bigint;
  v_article bigint;
begin
  select * into i from public.review_items where id = p_review_item_id;
  if not found or i.kind <> 'channel_draft' then
    v_code := 'not_found'; v_msg := '채널 원고 항목이 없습니다';
  elsif p_actor is null or p_actor !~ '^(user|admin):.+' then
    v_code := 'actor_invalid'; v_msg := '기록한 사람 표시가 필요합니다';
  elsif i.status not in ('approved', 'published') then
    v_code := 'not_approved'; v_msg := '승인된 원고만 게시 기록을 남길 수 있습니다';
  elsif exists (select 1 from public.channel_posts p where p.review_item_id = p_review_item_id) then
    v_code := 'already_recorded'; v_msg := '이미 게시 기록이 있습니다';
  elsif p_posted_url is null or p_posted_url !~* '^https://[^[:space:]]+$' then
    v_code := 'url_invalid'; v_msg := '게시 링크는 https 주소여야 합니다';
  elsif p_checklist is null or jsonb_typeof(p_checklist) <> 'object' or not (p_checklist ?& array['source_noted', 'ai_notice', 'alt_text', 'not_ad'])
        or p_checklist -> 'source_noted' <> 'true'::jsonb or p_checklist -> 'ai_notice' <> 'true'::jsonb or p_checklist -> 'alt_text' <> 'true'::jsonb or p_checklist -> 'not_ad' <> 'true'::jsonb then
    v_code := 'checklist_incomplete'; v_msg := '체크리스트 4개(출처 표기·AI 활용 표기·대체 텍스트·광고 아님)를 모두 확인해야 합니다';
  elsif p_posted_at is null or p_posted_at > now() + interval '5 minutes' then
    v_code := 'posted_at_invalid'; v_msg := '게시 시각이 미래입니다';
  end if;
  if v_code is null then
    v_article := (i.payload ->> 'articleId')::bigint;
    select a.slug into v_slug from public.articles a where a.id = v_article;
    if v_slug is null then
      v_code := 'article_missing'; v_msg := '원고의 기사가 없습니다';
    elsif i.payload ->> 'articleUrl' is null or i.payload ->> 'articleUrl' !~ '[?&]utm_campaign=[^&[:space:]]+' then
      v_code := 'utm_invalid'; v_msg := '원고 링크의 UTM 형식이 맞지 않습니다';
    elsif i.payload ->> 'articleUrl' !~ ('[?&]utm_source=' || (i.payload ->> 'channel') || '(&|$)') then
      v_code := 'utm_invalid'; v_msg := 'utm_source가 채널과 다릅니다';
    end if;
  end if;
  if v_code is not null then
    perform public.channel_audit_write(p_review_item_id, 'post', false, v_code, p_actor, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  insert into public.channel_posts (article_id, review_item_id, channel, utm_campaign, posted_url, checklist, posted_by, posted_at)
  values (v_article, p_review_item_id, i.payload ->> 'channel', v_slug, p_posted_url, p_checklist, p_actor, p_posted_at)
  returning id into v_id;
  perform public.channel_audit_write(p_review_item_id, 'post', true, 'ok', p_actor, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'id', v_id, 'message', '게시 기록을 남겼습니다');
end;
$$;
revoke all on function public.channel_kit_get(bigint, text), public.channel_post_record(bigint, text, jsonb, timestamptz, text) from public, anon, authenticated;
grant execute on function public.channel_kit_get(bigint, text), public.channel_post_record(bigint, text, jsonb, timestamptz, text) to service_role;

alter table public.channel_posts enable row level security;
alter table public.channel_kit_downloads enable row level security;
alter table public.channel_audit enable row level security;
revoke all on table public.channel_posts, public.channel_kit_downloads, public.channel_audit from anon, authenticated, service_role;
grant select on table public.channel_posts, public.channel_kit_downloads, public.channel_audit to service_role;

-- 공개 뷰 - 채널 유입 측정이 등록된 쌍인지만 본다 (주소·게시자 칸 없음)
create view public.public_channel_posts as
select distinct p.channel, p.utm_campaign
  from public.channel_posts p
 where exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'channel_kit') = 'true'::jsonb);

revoke all on table public.public_channel_posts from public, anon, authenticated, service_role;
grant select on table public.public_channel_posts to anon, authenticated, service_role;
