-- W13-i i4 - 네이버 프리미엄 콘텐츠 연재 원고 준비·게시 기록 (PRD-05 CH-02, docs/dev/W13-i_설계.md)
-- 외부 호출 0 - 원고를 준비해 내려받고, 사람이 올린 뒤 링크만 적는다. 이 파일에 판매 조건·가격·약관 문장은 없다.
-- 네이버 뉴스 제휴와 다른 상태로 따로 기록한다(channel_posts 채널 값·CHANNEL_KEYS는 바꾸지 않는다).

create table public.naver_series_manuscripts (
  id bigint generated always as identity primary key,
  article_id bigint not null unique references public.articles (id),
  contract_id bigint not null references public.license_contracts (id),
  status text not null default 'prepared' check (status in ('prepared', 'posted')),
  prepared_by text not null check (length(btrim(prepared_by)) > 0),
  prepared_at timestamptz not null default now(),
  posted_url text check (posted_url is null or (posted_url ~* '^https://[^[:space:]]+$' and posted_url !~* '[?&;](oc|servicekey|api_?key|auth_?key|access_?token|key|token)=')),
  posted_at timestamptz,
  posted_by text,
  double_pay_notice_ok boolean not null default false,
  constraint naver_series_posted_shape check (
    (status = 'prepared' and posted_url is null and posted_at is null and posted_by is null and not double_pay_notice_ok)
    or (status = 'posted' and posted_url is not null and posted_at is not null and posted_by is not null and double_pay_notice_ok))
);
comment on table public.naver_series_manuscripts is '네이버 프리미엄 콘텐츠 연재 원고 기록 (CH-02) - 승인·유료 판매 권리 확인된 프리미엄 칼럼만, 칼럼당 1건. 자동 게시 0. 직접 읽기 0';

create function public.naver_series_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception '연재 원고 기록은 지우지 못합니다' using errcode = 'insufficient_privilege';
  end if;
  if old.status <> 'prepared' or new.status <> 'posted' or new.id is distinct from old.id or new.article_id is distinct from old.article_id
     or new.contract_id is distinct from old.contract_id or new.prepared_by is distinct from old.prepared_by or new.prepared_at is distinct from old.prepared_at then
    raise exception '연재 원고 기록은 준비에서 게시 완료로만 바뀝니다' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.naver_series_guard() from public, anon, authenticated;
create trigger naver_series_guard before update or delete on public.naver_series_manuscripts for each row execute function public.naver_series_guard();
create trigger naver_series_no_truncate before truncate on public.naver_series_manuscripts for each statement execute function public.naver_series_guard();

alter table public.naver_series_manuscripts enable row level security;
revoke all on table public.naver_series_manuscripts from public, anon, authenticated, service_role;
grant select on table public.naver_series_manuscripts to service_role;

create function public.naver_series_flag_on() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'naver_series') = 'true'::jsonb);
$$;
revoke all on function public.naver_series_flag_on() from public, anon, authenticated;
grant execute on function public.naver_series_flag_on() to service_role;

-- 원고 준비 - 발행된 프리미엄 칼럼 + 유료 판매 권리(paid_bodies.sale_allowed) + 유효한 naver_series 계약
create function public.naver_manuscript_prepare(p_article bigint, p_contract bigint, p_actor text, p_now timestamptz default now()) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare c public.license_contracts; v_code text; v_id bigint; v_today date := (p_now at time zone 'Asia/Seoul')::date;
begin
  select * into c from public.license_contracts where id = p_contract;
  if p_actor is null or p_actor !~ '^(user|admin):.+' then v_code := 'actor_invalid';
  elsif not public.naver_series_flag_on() then v_code := 'feature_off';
  elsif c.id is null or c.kind <> 'naver_series' then v_code := 'contract_missing';
  elsif c.status <> 'active' or v_today < c.period_start or v_today > c.period_end then v_code := 'contract_inactive';
  elsif not exists (select 1 from public.articles a where a.id = p_article and a.access_tier = 'premium' and a.status = 'published') then v_code := 'not_premium_column';
  elsif not exists (select 1 from public.paid_bodies b where b.kind = 'column' and b.article_id = p_article and b.sale_allowed) then v_code := 'sale_right_missing';
  elsif exists (select 1 from public.naver_series_manuscripts m where m.article_id = p_article) then v_code := 'already_prepared';
  end if;
  if v_code is not null then
    perform public.partner_feed_audit_write('manuscript', false, v_code, p_actor, p_article, 'prepare');
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;
  insert into public.naver_series_manuscripts (article_id, contract_id, prepared_by, prepared_at) values (p_article, p_contract, p_actor, p_now) returning id into v_id;
  perform public.partner_feed_audit_write('manuscript', true, 'ok', p_actor, v_id, 'prepare');
  return jsonb_build_object('ok', true, 'code', 'ok', 'id', v_id);
end;
$$;

-- 원고 내려받기 - 권리·계약이 아직 유효할 때만 제목·전문을 돌려준다 (내려받기마다 감사 1행)
create function public.naver_manuscript_text(p_id bigint, p_actor text, p_now timestamptz default now()) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare m public.naver_series_manuscripts; c public.license_contracts; v_code text; v_title text; v_body text; v_today date := (p_now at time zone 'Asia/Seoul')::date;
begin
  select * into m from public.naver_series_manuscripts where id = p_id;
  select * into c from public.license_contracts where id = m.contract_id;
  if p_actor is null or p_actor !~ '^(user|admin):.+' then v_code := 'actor_invalid';
  elsif not public.naver_series_flag_on() then v_code := 'feature_off';
  elsif m.id is null then v_code := 'not_found';
  elsif c.status <> 'active' or v_today < c.period_start or v_today > c.period_end then v_code := 'contract_inactive';
  end if;
  if v_code is null then
    select a.title, b.body into v_title, v_body
      from public.articles a join public.paid_bodies b on b.kind = 'column' and b.article_id = a.id and b.sale_allowed
     where a.id = m.article_id and a.access_tier = 'premium' and a.status = 'published';
    if v_title is null then v_code := 'sale_right_missing'; end if;
  end if;
  if v_code is not null then
    perform public.partner_feed_audit_write('manuscript', false, v_code, p_actor, p_id, 'download');
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;
  perform public.partner_feed_audit_write('manuscript', true, 'ok', p_actor, p_id, 'download');
  return jsonb_build_object('ok', true, 'code', 'ok', 'title', v_title, 'text', v_body, 'article_id', m.article_id);
end;
$$;

-- 게시 기록 - https 링크 + 사이트 구독자 이중 결제 안내 확인
create function public.naver_manuscript_post(p_id bigint, p_url text, p_double_pay_ok boolean, p_actor text, p_now timestamptz default now()) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_code text;
begin
  if p_actor is null or p_actor !~ '^(user|admin):.+' then v_code := 'actor_invalid';
  elsif not exists (select 1 from public.naver_series_manuscripts where id = p_id) then v_code := 'not_found';
  elsif exists (select 1 from public.naver_series_manuscripts where id = p_id and status = 'posted') then v_code := 'already_posted';
  elsif p_url is null or p_url !~* '^https://[^[:space:]]+$' or p_url ~* '[?&;](oc|servicekey|api_?key|auth_?key|access_?token|key|token)=' then v_code := 'url_invalid';
  elsif not coalesce(p_double_pay_ok, false) then v_code := 'double_pay_notice_missing';
  end if;
  if v_code is not null then
    perform public.partner_feed_audit_write('manuscript', false, v_code, p_actor, p_id, 'post');
    return jsonb_build_object('ok', false, 'code', v_code);
  end if;
  update public.naver_series_manuscripts set status = 'posted', posted_url = p_url, posted_at = p_now, posted_by = p_actor, double_pay_notice_ok = true where id = p_id;
  perform public.partner_feed_audit_write('manuscript', true, 'ok', p_actor, p_id, 'post');
  return jsonb_build_object('ok', true, 'code', 'ok');
end;
$$;

revoke all on function public.naver_manuscript_prepare(bigint, bigint, text, timestamptz), public.naver_manuscript_text(bigint, text, timestamptz), public.naver_manuscript_post(bigint, text, boolean, text, timestamptz) from public, anon, authenticated;
grant execute on function public.naver_manuscript_prepare(bigint, bigint, text, timestamptz), public.naver_manuscript_text(bigint, text, timestamptz), public.naver_manuscript_post(bigint, text, boolean, text, timestamptz) to service_role;
