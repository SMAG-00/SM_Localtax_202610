-- W11-a a1 - 감수 가이드 저장·서명·공개 (PRD-03 7장 guides · 5장 데이터 원칙, docs/dev/W11-a_설계.md 2장)
-- · guides(주제 한 줄) + guide_versions(버전마다 새 행). 가이드 본문은 감수 서명 전에는 공개하지 않는다 - 공개 뷰는 서명 뒤 공개(published) 버전만 보인다.
-- · 버전 내용(제목·절·사실값·출처·기준일·세목 범위·지역)은 만든 뒤 바꾸지 못한다 (덮어쓰기 금지 - 고치려면 새 버전). 본문 해시는 DB가 계산한다.
-- · 상태 전이 draft -> reviewed(감수 서명) -> published(관리자 공개) -> retired 는 guide_sign()·guide_publish() 안에서만 일어난다 (service_role도 UPDATE 권한 없음).
-- · 서명은 세무 감수위원(rules_is_reviewer)만. 거부해도 예외 대신 { ok, code, message }를 돌려주고 guides_audit에 1행을 남긴다 (예외면 거래가 되돌려져 감사가 사라진다).
-- · 이 파일에는 가이드 글도 숫자도 없다 (씨앗 0행). facts는 감수 입력 사실값(기준 금액·기간 등)이 들어가는 구조 칸이며 코드 상수 0 - 화면은 이 칸에서 읽는다.
-- · SM 해설을 가져온 초안은 import_origin에 출처를 적는다 (AI 작성·미감수 값이므로 서명 전에는 draft).

create table public.guides (
  id bigint generated always as identity primary key,
  hub text not null check (hub in ('realestate_tax', 'trust', 'redevelopment', 'finance_tax')),
  topic text not null check (topic ~ '^[a-z][a-z0-9_]{1,39}$'),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 100),
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  unique (hub, topic)
);
comment on table public.guides is '감수 가이드 주제 (PRD-03 guides) - 허브·주제·주소 한 줄. 본문은 guide_versions. DF-08 신탁 주제와 TRU-02는 같은 행';

create table public.guide_versions (
  id bigint generated always as identity primary key,
  guide_id bigint not null references public.guides (id),
  version int not null check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'published', 'retired')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  sections jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array' and jsonb_array_length(sections) <= 50 and pg_column_size(sections) <= 262144),
  facts jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object' and pg_column_size(facts) <= 65536),
  tax_scope text not null check (tax_scope in ('local', 'national', 'both')),
  as_of date,
  region_codes text[] not null default '{}' check (cardinality(region_codes) <= 300),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 100),
  import_origin text check (import_origin is null or char_length(import_origin) <= 200),
  body_sha256 text not null,
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  signed_by text,
  signed_at timestamptz,
  sheet_ref text check (sheet_ref is null or char_length(btrim(sheet_ref)) between 1 and 200),
  signed_body_sha256 text,
  published_by text,
  published_at timestamptz,
  retired_at timestamptz,
  unique (guide_id, version),
  constraint guide_versions_signed_record check (
    status = 'draft' or (signed_by is not null and signed_at is not null and sheet_ref is not null and signed_body_sha256 = body_sha256)),
  constraint guide_versions_published_record check (status not in ('published') or (published_by is not null and published_at is not null)),
  constraint guide_versions_draft_clean check (status <> 'draft' or (signed_by is null and signed_at is null and published_by is null and published_at is null))
);
comment on table public.guide_versions is '감수 가이드 버전 (PRD-03 guides) - draft -> reviewed(감수 서명) -> published(관리자 공개) -> retired. 내용 불변. 주제마다 공개 1행';
comment on column public.guide_versions.facts is '감수 입력 사실값(기준 금액·기간 등) - 코드 상수 0, 화면은 이 칸에서 읽는다 (RE-02 수용 기준)';
create unique index guide_versions_one_published on public.guide_versions (guide_id) where status = 'published';

create function public.guide_versions_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception '가이드는 초안(draft)으로만 만들 수 있습니다 - 공개는 감수 서명 뒤 guide_publish 함수로만 합니다' using errcode = 'check_violation';
    end if;
    new.version := coalesce((select max(v.version) from public.guide_versions v where v.guide_id = new.guide_id), 0) + 1;
    new.body_sha256 := encode(sha256(convert_to(jsonb_build_object('title', new.title, 'sections', new.sections, 'facts', new.facts, 'tax_scope', new.tax_scope,
      'as_of', new.as_of, 'region_codes', to_jsonb(new.region_codes), 'sources', new.sources)::text, 'UTF8')), 'hex');
    return new;
  end if;
  if new.guide_id is distinct from old.guide_id or new.version is distinct from old.version or new.title is distinct from old.title
     or new.sections is distinct from old.sections or new.facts is distinct from old.facts or new.tax_scope is distinct from old.tax_scope
     or new.as_of is distinct from old.as_of or new.region_codes is distinct from old.region_codes or new.sources is distinct from old.sources
     or new.import_origin is distinct from old.import_origin or new.body_sha256 is distinct from old.body_sha256
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception '가이드 버전의 내용은 고칠 수 없습니다 - 새 버전으로 만드세요 (PRD-03 5장)' using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status or new.signed_by is distinct from old.signed_by or new.signed_at is distinct from old.signed_at
     or new.sheet_ref is distinct from old.sheet_ref or new.signed_body_sha256 is distinct from old.signed_body_sha256
     or new.published_by is distinct from old.published_by or new.published_at is distinct from old.published_at or new.retired_at is distinct from old.retired_at then
    if coalesce(current_setting('ltr.guide_gate', true), '') <> 'rpc' then
      raise exception '서명·공개 상태는 guide_sign/guide_publish 함수로만 바뀝니다' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guide_versions_guard() from public, anon, authenticated;
create trigger guide_versions_guard before insert or update on public.guide_versions for each row execute function public.guide_versions_guard();

create function public.guides_no_delete() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '가이드와 버전은 지우지 못합니다 (% 거부) - 내리려면 retired로 바꿉니다', tg_op using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.guides_no_delete() from public, anon, authenticated;
create trigger guides_no_delete before delete on public.guides for each row execute function public.guides_no_delete();
create trigger guide_versions_no_delete before delete on public.guide_versions for each row execute function public.guides_no_delete();
create trigger guides_no_truncate before truncate on public.guides for each statement execute function public.guides_no_delete();
create trigger guide_versions_no_truncate before truncate on public.guide_versions for each statement execute function public.guides_no_delete();

-- 감사 - 추가만. 서명·공개 성공도 거부도 1행
create table public.guides_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  guide_version_id bigint not null,
  action text not null check (action in ('sign', 'publish')),
  outcome text not null check (outcome in ('ok', 'refused')),
  code text not null check (length(btrim(code)) > 0),
  actor text not null check (length(btrim(actor)) > 0),
  detail text check (detail is null or char_length(detail) <= 500),
  constraint guides_audit_ok_code check ((outcome = 'ok') = (code = 'ok'))
);
comment on table public.guides_audit is '가이드 서명·공개 감사 - 추가만. 거부도 1행(code가 사유). 앱이 관리자 서명 시도를 막은 경우도 같은 표에 남긴다';
create index guides_audit_target_idx on public.guides_audit (guide_version_id, at desc);
create trigger guides_audit_no_update_delete before update or delete on public.guides_audit for each row execute function public.rules_audit_append_only();
create trigger guides_audit_no_truncate before truncate on public.guides_audit for each statement execute function public.rules_audit_append_only();

create function public.guides_audit_write(p_id bigint, p_action text, p_ok boolean, p_code text, p_actor text, p_detail text) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.guides_audit (guide_version_id, action, outcome, code, actor, detail)
  values (p_id, p_action, case when p_ok then 'ok' else 'refused' end, p_code, coalesce(nullif(btrim(p_actor), ''), 'unknown'), left(p_detail, 500));
$$;
revoke all on function public.guides_audit_write(bigint, text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.guides_audit_write(bigint, text, boolean, text, text, text) to service_role;

-- 서명 - 세무 감수위원만, 초안만, 감수 시트 위치 필수
create function public.guide_sign(p_version_id bigint, p_signer text, p_sheet_ref text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_code text;
  v_msg text;
begin
  select * into v from public.guide_versions where id = p_version_id for update;
  if not found then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif not public.rules_is_reviewer(p_signer) then
    v_code := 'signer_not_reviewer'; v_msg := '가이드 감수 서명은 세무 감수위원(reviewer)만 할 수 있습니다';
  elsif v.status <> 'draft' then
    v_code := 'not_draft'; v_msg := '초안(draft)만 서명할 수 있습니다';
  elsif char_length(btrim(coalesce(p_sheet_ref, ''))) not between 1 and 200 then
    v_code := 'sheet_missing'; v_msg := '감수 시트 위치(1~200자)가 필요합니다';
  end if;
  if v_code is not null then
    perform public.guides_audit_write(p_version_id, 'sign', false, v_code, p_signer, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.guide_gate', 'rpc', true);
  update public.guide_versions set status = 'reviewed', signed_by = p_signer, signed_at = now(), sheet_ref = btrim(p_sheet_ref), signed_body_sha256 = body_sha256 where id = p_version_id;
  perform set_config('ltr.guide_gate', '', true);
  perform public.guides_audit_write(p_version_id, 'sign', true, 'ok', p_signer, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '서명했습니다');
end;
$$;

-- 공개 - 서명 뒤에만, 서명한 본문과 같을 때만. 이전 공개본은 retired
create function public.guide_publish(p_version_id bigint, p_publisher text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_code text;
  v_msg text;
begin
  select * into v from public.guide_versions where id = p_version_id for update;
  if not found then
    v_code := 'not_found'; v_msg := '대상이 없습니다';
  elsif p_publisher is null or p_publisher !~ '^(user|admin):.+' then
    v_code := 'publisher_invalid'; v_msg := '공개자 표시(user:... 또는 admin:...)가 필요합니다';
  elsif v.status = 'published' then
    v_code := 'already_published'; v_msg := '이미 공개된 버전입니다';
  elsif v.status = 'retired' then
    v_code := 'retired'; v_msg := '내려간 버전은 다시 공개할 수 없습니다 - 새 버전을 만드세요';
  elsif v.status <> 'reviewed' or v.signed_at is null then
    v_code := 'not_signed'; v_msg := '감수 서명이 없는 가이드는 공개할 수 없습니다';
  elsif v.signed_body_sha256 is distinct from v.body_sha256 then
    v_code := 'signature_stale'; v_msg := '서명한 본문과 지금 본문이 다릅니다';
  end if;
  if v_code is not null then
    perform public.guides_audit_write(p_version_id, 'publish', false, v_code, p_publisher, v_msg);
    return jsonb_build_object('ok', false, 'code', v_code, 'message', v_msg);
  end if;
  perform set_config('ltr.guide_gate', 'rpc', true);
  update public.guide_versions set status = 'retired', retired_at = now() where guide_id = v.guide_id and status = 'published' and id <> p_version_id;
  update public.guide_versions set status = 'published', published_by = p_publisher, published_at = now() where id = p_version_id;
  perform set_config('ltr.guide_gate', '', true);
  perform public.guides_audit_write(p_version_id, 'publish', true, 'ok', p_publisher, null);
  return jsonb_build_object('ok', true, 'code', 'ok', 'message', '공개했습니다');
end;
$$;
revoke all on function public.guide_sign(bigint, text, text), public.guide_publish(bigint, text) from public, anon, authenticated;
grant execute on function public.guide_sign(bigint, text, text), public.guide_publish(bigint, text) to service_role;

-- 권한 - 서버(service_role)는 읽기와 추가만. 수정은 함수만. 공개 읽기는 113번의 칸 지정 뷰만
alter table public.guides enable row level security;
alter table public.guide_versions enable row level security;
alter table public.guides_audit enable row level security;
revoke all on table public.guides, public.guide_versions, public.guides_audit from anon, authenticated, service_role;
grant select, insert on table public.guides, public.guide_versions, public.guides_audit to service_role;
