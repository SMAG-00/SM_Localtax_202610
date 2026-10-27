-- W13-a a3 - 지식창고 공개 뷰 · 서버 절단 함수 library_read · 열람 속도 제한 (PRD-05 LIB-04·05·06, 5단계 설계 4.1)
-- 이 파일에 본문·가격·한도 값은 없다 (값은 settings 입력).
-- · 공개 뷰 3개는 칸을 지정해 낸다 - 본문 칸 0. 조건: 기능 키 library 켜짐 ∧ status = approved ∧ rights_public = confirmed (권호 기사는 권호도 같은 조건).
-- · library_read(회원, 종류, 번호) - 서버(service_role)만 부른다. 회원 번호는 서버가 세션에서 정한 값이다.
--   공개 등급 본문은 전문, 프리미엄은 has_entitlement(user, 'library') ∧ rights_sale = confirmed 일 때만 전문, 아니면 미리보기만.
--   미리보기 길이 = 설정 library_preview.chars (비면 0자). 짧은 원고는 설정 max_ratio_percent 상한도 함께 적용한다.
--   max_ratio_percent가 비어 있고 설정 글자 수가 본문 길이 이상이면 미리보기는 0자다 (본문 전체가 미리보기로 나가는 일 0).
-- · library_rate_hit(키) - 계정·IP별 열람 속도 제한. 설정 library_rate_limit {max, window_seconds}가 비면 닫힘. n번째 허용, n+1번째 차단 + 차단 기록.

create table public.library_access_log (
  id bigint generated always as identity primary key,
  key text not null check (char_length(btrim(key)) between 1 and 200),
  at timestamptz not null default now()
);
create index library_access_log_key_idx on public.library_access_log (key, at desc);
create table public.library_abuse_log (
  id bigint generated always as identity primary key,
  key text not null check (char_length(btrim(key)) between 1 and 200),
  kind text not null check (kind in ('rate', 'bulk_copy')),
  detail text check (detail is null or char_length(detail) <= 300),
  at timestamptz not null default now()
);
comment on table public.library_abuse_log is '무단 수집 차단 기록 (LIB-05) - 추가만. rate = 속도 제한 초과, bulk_copy = 대량 복사 탐지(195)';
create index library_abuse_log_key_idx on public.library_abuse_log (key, at desc);
create trigger library_abuse_log_no_update_delete before update or delete on public.library_abuse_log for each row execute function public.library_log_immutable();
create trigger library_abuse_log_no_truncate before truncate on public.library_abuse_log for each statement execute function public.library_log_immutable();
alter table public.library_access_log enable row level security;
alter table public.library_abuse_log enable row level security;
revoke all on table public.library_access_log, public.library_abuse_log from public, anon, authenticated, service_role;
grant select on table public.library_access_log, public.library_abuse_log to service_role;

create function public.library_feature_on() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'library') = 'true'::jsonb) $$;
revoke all on function public.library_feature_on() from public;
grant execute on function public.library_feature_on() to anon, authenticated, service_role;

-- ── 공개 뷰 (본문 칸 없음) ────────────────────────────────────
create view public.public_library_nodes as
select n.id, n.edition_id, n.parent_id, n.depth, n.ordinal, n.title, n.access_tier,
       e.edition_label, e.as_of, p.slug as publication_slug, p.title as publication_title,
       (e.as_of = (select max(e2.as_of) from public.editions e2 where e2.publication_id = e.publication_id)) as is_latest
  from public.pub_nodes n
  join public.editions e on e.id = n.edition_id
  join public.publications p on p.id = e.publication_id
 where n.status = 'approved' and n.rights_public = 'confirmed' and public.library_feature_on();
revoke all on table public.public_library_nodes from public, anon, authenticated, service_role;
grant select on table public.public_library_nodes to anon, authenticated, service_role;

create view public.public_library_issues as
select i.id, i.issue_no, i.issued_on, i.as_of, i.title, p.slug as publication_slug, p.title as publication_title,
       (i.rights_pdf = 'confirmed' and i.pdf_path is not null) as pdf_available
  from public.magazine_issues i
  join public.publications p on p.id = i.publication_id
 where i.status = 'approved' and i.rights_public = 'confirmed' and public.library_feature_on();
revoke all on table public.public_library_issues from public, anon, authenticated, service_role;
grant select on table public.public_library_issues to anon, authenticated, service_role;

create view public.public_library_issue_articles as
select a.id, a.issue_id, a.ordinal, a.title, a.author_person_id, a.access_tier
  from public.magazine_articles a
  join public.magazine_issues i on i.id = a.issue_id
 where a.status = 'approved' and a.rights_public = 'confirmed'
   and i.status = 'approved' and i.rights_public = 'confirmed' and public.library_feature_on();
revoke all on table public.public_library_issue_articles from public, anon, authenticated, service_role;
grant select on table public.public_library_issue_articles to anon, authenticated, service_role;

-- ── 서버 절단 함수 ────────────────────────────────────────────
-- 미리보기 자르기 - 지식창고 노드·권호 기사·프리미엄 칼럼이 같은 함수 하나를 쓴다 (절단 로직 하나)
create function public.library_preview_cut(p_body text) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_set jsonb; v_chars int; v_ratio numeric; v_len int; v_n int;
begin
  select s.value into v_set from public.settings s where s.key = 'library_preview';
  v_chars := case when jsonb_typeof(v_set -> 'chars') = 'number' then floor((v_set ->> 'chars')::numeric)::int else 0 end;
  v_ratio := case when jsonb_typeof(v_set -> 'max_ratio_percent') = 'number' then (v_set ->> 'max_ratio_percent')::numeric else null end;
  v_len := char_length(p_body);
  v_n := greatest(v_chars, 0);
  if v_ratio is not null then
    v_n := least(v_n, floor(v_len * least(greatest(v_ratio, 0), 100) / 100.0)::int);
  end if;
  if v_n >= v_len then v_n := 0; end if; -- 본문 전체가 미리보기로 나가지 않는다
  return left(p_body, v_n);
end;
$$;
revoke all on function public.library_preview_cut(text) from public, anon, authenticated;
grant execute on function public.library_preview_cut(text) to service_role;

create function public.library_read(p_user uuid, p_kind text, p_id bigint, p_at timestamptz default now()) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_title text; v_tier text; v_sale text; v_body text;
  v_entitled boolean := false;
begin
  if not public.library_feature_on() or p_kind not in ('node', 'issue_article') then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if p_kind = 'node' then
    select n.title, n.access_tier, n.rights_sale into v_title, v_tier, v_sale
      from public.pub_nodes n where n.id = p_id and n.status = 'approved' and n.rights_public = 'confirmed';
  else
    select a.title, a.access_tier, a.rights_sale into v_title, v_tier, v_sale
      from public.magazine_articles a join public.magazine_issues i on i.id = a.issue_id
     where a.id = p_id and a.status = 'approved' and a.rights_public = 'confirmed' and i.status = 'approved' and i.rights_public = 'confirmed';
  end if;
  if v_title is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select b.body into v_body from public.library_bodies b where b.kind = p_kind and b.ref_id = p_id;
  if v_body is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if v_tier = 'public' then
    return jsonb_build_object('ok', true, 'code', 'ok', 'title', v_title, 'tier', v_tier, 'full', true, 'text', v_body);
  end if;
  v_entitled := p_user is not null and v_sale = 'confirmed' and public.has_entitlement(p_user, 'library', p_at);
  if v_entitled then
    return jsonb_build_object('ok', true, 'code', 'ok', 'title', v_title, 'tier', v_tier, 'full', true, 'text', v_body);
  end if;
  -- 비구독자 - 미리보기만 (설정이 비면 0자)
  return jsonb_build_object('ok', true, 'code', 'ok', 'title', v_title, 'tier', v_tier, 'full', false, 'text', public.library_preview_cut(v_body),
    'locked', true, 'reason', case when p_user is null then 'login' when v_sale <> 'confirmed' then 'sale_rights' else 'subscribe' end);
end;
$$;
comment on function public.library_read(uuid, text, bigint, timestamptz) is '지식창고 본문 절단 읽기 - 서버(service_role)만 부른다. 비구독자는 설정 길이 미리보기만';
revoke all on function public.library_read(uuid, text, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.library_read(uuid, text, bigint, timestamptz) to service_role;

-- ── 열람 속도 제한 ────────────────────────────────────────────
create function public.library_rate_hit(p_key text, p_now timestamptz default now()) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_set jsonb; v_max int; v_win int; v_cnt int; v_bulk int;
begin
  if coalesce(btrim(p_key), '') = '' then
    return jsonb_build_object('ok', false, 'code', 'bad_input');
  end if;
  select s.value into v_set from public.settings s where s.key = 'library_rate_limit';
  if jsonb_typeof(v_set -> 'max') is distinct from 'number' or jsonb_typeof(v_set -> 'window_seconds') is distinct from 'number' then
    return jsonb_build_object('ok', false, 'code', 'rate_unset');
  end if;
  v_max := floor((v_set ->> 'max')::numeric)::int;
  v_win := floor((v_set ->> 'window_seconds')::numeric)::int;
  if v_max < 1 or v_win < 1 then
    return jsonb_build_object('ok', false, 'code', 'rate_unset');
  end if;
  delete from public.library_access_log where at < p_now - make_interval(secs => greatest(v_win, 86400 * 7));
  select count(*)::int into v_cnt from public.library_access_log where key = p_key and at > p_now - make_interval(secs => v_win) and at <= p_now;
  if v_cnt >= v_max then
    insert into public.library_abuse_log (key, kind, detail, at) values (p_key, 'rate', format('window=%s max=%s', v_win, v_max), p_now);
    return jsonb_build_object('ok', false, 'code', 'limited', 'count', v_cnt);
  end if;
  -- 대량 복사 탐지 (LIB-05) - 설정에 bulk_copy_max·bulk_copy_window_seconds가 둘 다 있을 때만. 긴 창 안의 열람 수가 상한 이상이면 차단 + 기록
  if jsonb_typeof(v_set -> 'bulk_copy_max') = 'number' and jsonb_typeof(v_set -> 'bulk_copy_window_seconds') = 'number' then
    select count(*)::int into v_bulk from public.library_access_log
     where key = p_key and at > p_now - make_interval(secs => floor((v_set ->> 'bulk_copy_window_seconds')::numeric)::int) and at <= p_now;
    if v_bulk >= floor((v_set ->> 'bulk_copy_max')::numeric)::int then
      insert into public.library_abuse_log (key, kind, detail, at) values (p_key, 'bulk_copy', format('count=%s', v_bulk), p_now);
      return jsonb_build_object('ok', false, 'code', 'bulk_copy', 'count', v_bulk);
    end if;
  end if;
  insert into public.library_access_log (key, at) values (p_key, p_now);
  return jsonb_build_object('ok', true, 'code', 'ok', 'count', v_cnt + 1);
end;
$$;
revoke all on function public.library_rate_hit(text, timestamptz) from public, anon, authenticated;
grant execute on function public.library_rate_hit(text, timestamptz) to service_role;
