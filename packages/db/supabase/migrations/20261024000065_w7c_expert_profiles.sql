-- W7c 1단계 — SM(선명) 소속 전문가 소개 (PRD-01C EXPL-01 · 02 · 04 · 05 · 06 · 07 · 08 · 12, docs/dev/W7c_설계.md 1장 1단계 · 2장 · 12장)
-- 이 파일에 실제 프로필·이름·고지문은 없다. 표 틀·검사·공개 뷰만 정한다. 프로필 씨앗 0행 (분류 5개와 설정 기본값만).
-- · 분류(expert_categories)는 PO 결정(2026-10-24)의 5개 - 세무사, 공인회계사, 변호사, 공인중개사, 법무사 (이 순서). 설정 가능한 목록이다.
--   공개 화면은 공개 중인 SM 전문가가 1명 이상인 분류만 낸다 (EXPL-01 · PRD_최종 §13 #26).
-- · 프로필(expert_profiles)은 사람 한 명 = 한 행이고 분류를 하나 이상 가진다. 관리자(PO)가 등록하고 공개한다 - 외부 등재 신청·유료 등재 경로 없음.
--   소속 형태는 고용·SM 법인 소속 두 값뿐 (EXPL-07). 자격 검증 기록·등록번호·재검증 기한은 두지 않는다 (PO 결정 2026-10-24 - PRD EXPL-02·03 검증 부분 대체).
-- · 공개 조건 = 관리자가 공개(published)로 둠 + 본인 동의서 기록(버전·일자·보관 위치) + 철회 없음 + 고지문 승인 + 기능 키 experts. 관리자가 내리면(draft) 다음 요청부터 0.
-- · 쓰면 안 되는 표현("최고"·"1위"·"승소 보장" 등)은 저장 거부 (EXPL-05). 결제·주문 표와 연결 칸 없음 (EXPL-04).
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다 (기능 키 expert_requests 한 개를 기능 목록에 더한다).

-- ─────────────────────────────────────────────────────────────
-- 설정 씨앗 · 저장 검사
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value, description, updated_by) values
  ('expert_notice',
   jsonb_build_object('version', '', 'text', '', 'approved', false, 'reviewed_by', null, 'reviewed_on', null),
   '전문가 소개 고지문 (EXPL-05 · PRD_최종 §13 #20) — 법률 검토본만 넣는다. approved=true는 version·text·reviewed_by·reviewed_on이 모두 있어야 하고, 승인 전에는 기능 키 experts를 켜지 못한다. 씨앗은 비어 있다',
   'migration:20261024000065'),
  ('expert_banned_terms',
   '["최고", "1위", "승소 보장", "승소보장", "전문 보장", "전문보장", "100% 보장", "무조건"]'::jsonb,
   '프로필 문구에 쓸 수 없는 표현 (EXPL-05 — 오인 광고 금지 표현 사전). 공백을 뺀 글자로 비교하고 하나라도 들어 있으면 저장되지 않는다',
   'migration:20261024000065')
on conflict (key) do nothing;

create function public.expert_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
begin
  if new.key = 'expert_notice' then
    if jsonb_typeof(new.value) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(new.value) k where k not in ('version', 'text', 'approved', 'reviewed_by', 'reviewed_on'))
       or jsonb_typeof(new.value -> 'version') is distinct from 'string'
       or jsonb_typeof(new.value -> 'text') is distinct from 'string'
       or jsonb_typeof(new.value -> 'approved') is distinct from 'boolean'
       or char_length(new.value ->> 'text') > 600 then
      raise exception '전문가 소개 고지문(expert_notice)은 { version, text(600자 이하), approved, reviewed_by, reviewed_on }입니다' using errcode = 'check_violation';
    end if;
    if (new.value -> 'approved') = 'true'::jsonb
       and (char_length(btrim(new.value ->> 'version')) = 0 or char_length(btrim(new.value ->> 'text')) = 0
            or char_length(btrim(coalesce(new.value ->> 'reviewed_by', ''))) = 0
            or coalesce(new.value ->> 'reviewed_on', '') !~ '^\d{4}-\d{2}-\d{2}$') then
      raise exception '전문가 소개 고지문 승인에는 법률 검토본 버전·문구·검토자·검토일이 모두 필요합니다 (EXPL-05)' using errcode = 'check_violation';
    end if;
  elsif new.key = 'expert_banned_terms' then
    if jsonb_typeof(new.value) is distinct from 'array' then
      raise exception '쓸 수 없는 표현(expert_banned_terms)은 글자 배열입니다' using errcode = 'check_violation';
    end if;
    for v_item in select x.value from jsonb_array_elements(new.value) as x loop
      if jsonb_typeof(v_item) is distinct from 'string' or char_length(btrim(v_item #>> '{}')) not between 1 and 40 then
        raise exception '쓸 수 없는 표현(expert_banned_terms)의 값은 1~40자 글자여야 합니다' using errcode = 'check_violation';
      end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.expert_settings_guard() from public, anon, authenticated;
create trigger settings_expert_settings_guard
  before insert or update on public.settings
  for each row when (new.key in ('expert_notice', 'expert_banned_terms'))
  execute function public.expert_settings_guard();

-- 기능 키 목록에 expert_requests(꺼짐)를 더한다. 이미 있으면 그대로
update public.settings set value = value || '{"expert_requests": false}'::jsonb
 where key = 'feature_flags' and jsonb_typeof(value) = 'object' and not (value ? 'expert_requests');

-- 전문가 소개 켜기 — 고지문이 법률 검토본으로 승인돼 있어야 한다 (EXPL-05: 검토본 버전이 없으면 공개 0)
create function public.expert_flag_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notice jsonb;
begin
  if jsonb_typeof(new.value) = 'object' and (new.value -> 'experts') = 'true'::jsonb
     and (tg_op = 'INSERT' or jsonb_typeof(old.value) is distinct from 'object' or (old.value -> 'experts') is distinct from 'true'::jsonb) then
    select s.value into v_notice from public.settings s where s.key = 'expert_notice';
    if jsonb_typeof(v_notice) is distinct from 'object' or (v_notice -> 'approved') is distinct from 'true'::jsonb then
      raise exception '전문가 소개(experts)는 설정 expert_notice에 법률 검토본 고지문 승인이 있어야 켭니다 (EXPL-05)' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.expert_flag_guard() from public, anon, authenticated;
create trigger settings_expert_flag_guard
  before insert or update on public.settings
  for each row when (new.key = 'feature_flags')
  execute function public.expert_flag_guard();

-- 쓰면 안 되는 표현 검사 — 걸린 표현 또는 null
create function public.expert_text_problem(p_text text) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_terms jsonb;
  v_flat text;
  t text;
begin
  select s.value into v_terms from public.settings s where s.key = 'expert_banned_terms';
  if jsonb_typeof(v_terms) is distinct from 'array' or p_text is null then
    return null;
  end if;
  v_flat := lower(regexp_replace(p_text, '\s', '', 'g'));
  for t in select jsonb_array_elements_text(v_terms) loop
    if position(lower(regexp_replace(t, '\s', '', 'g')) in v_flat) > 0 then
      return t;
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function public.expert_text_problem(text) from public, anon, authenticated;
grant execute on function public.expert_text_problem(text) to service_role;

-- ─────────────────────────────────────────────────────────────
-- 분류 (EXPL-01) — 설정 가능한 목록. 씨앗은 PO 결정의 5개
-- ─────────────────────────────────────────────────────────────
create table public.expert_categories (
  code text primary key check (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(code) <= 40 and code not in ('profile', 'request', 'report')),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  sort_order integer not null default 100 check (sort_order between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.expert_categories is '전문가 분류 목록 (EXPL-01) — 설정 가능. 씨앗 5개(PO 결정 2026-10-24). 공개 화면은 공개 프로필이 1명 이상인 분류만';
insert into public.expert_categories (code, name, sort_order) values
  ('tax-accountant', '세무사', 10),
  ('cpa', '공인회계사', 20),
  ('lawyer', '변호사', 30),
  ('realtor', '공인중개사', 40),
  ('judicial-scrivener', '법무사', 50);

create function public.expert_categories_touch() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.expert_categories_touch() from public, anon, authenticated;
create trigger expert_categories_touch
  before update on public.expert_categories
  for each row execute function public.expert_categories_touch();

-- ─────────────────────────────────────────────────────────────
-- 프로필 (EXPL-02 · 05 · 07) — 사람 한 명 = 한 행, 분류 하나 이상. 관리자만 쓴다
-- ─────────────────────────────────────────────────────────────
create table public.expert_profiles (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  category_codes text[] not null check (cardinality(category_codes) between 1 and 5),
  specialties text[] not null default '{}' check (cardinality(specialties) <= 8),
  office_name text not null check (char_length(btrim(office_name)) between 1 and 80),
  regions text[] not null default '{}' check (cardinality(regions) <= 10),
  contact_links jsonb not null default '[]'::jsonb,
  interests text not null default '' check (char_length(interests) <= 300),
  intro text not null default '' check (char_length(intro) <= 400),
  house_relation text not null check (house_relation in ('employed', 'sm_corporation')),
  photo_media_id bigint references public.media (id),
  status text not null default 'draft' check (status in ('draft', 'published', 'withdrawn')),
  consent_version text check (consent_version is null or char_length(btrim(consent_version)) between 1 and 40),
  consent_on date,
  consent_doc_ref text check (consent_doc_ref is null or char_length(btrim(consent_doc_ref)) between 1 and 200),
  published_by text,
  withdrawn_at timestamptz,
  withdrawn_reason text check (withdrawn_reason is null or char_length(withdrawn_reason) <= 300),
  edited_by text not null check (length(btrim(edited_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expert_profiles_published_complete check (
    status <> 'published' or (consent_version is not null and consent_on is not null and consent_doc_ref is not null
                              and length(btrim(coalesce(published_by, ''))) > 0 and withdrawn_at is null)),
  constraint expert_profiles_withdrawn_record check (
    (status = 'withdrawn') = (withdrawn_at is not null) and (status <> 'withdrawn' or length(btrim(coalesce(withdrawn_reason, ''))) > 0))
);
comment on table public.expert_profiles is 'SM 소속 전문가 프로필 (EXPL-02·07) - 사람 한 명 = 한 행, 분류 하나 이상, 관리자만 등록·공개. house_relation은 고용·SM 법인 소속 두 값뿐. published = 본인 동의서 기록(버전·일자·보관 위치) + 공개한 관리자. 자격 검증·등록번호·재검증 기록 칸 없음(PO 결정). 별점·후기·순위·상담 건수 칸 없음. 결제·주문 표와 연결 칸 없음 (EXPL-04)';
create index expert_profiles_status_idx on public.expert_profiles (status);

create function public.expert_profiles_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_term text;
  v_link jsonb;
  c text;
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and old.status = 'withdrawn' and new.status <> 'withdrawn' then
    raise exception '철회된 프로필은 되살릴 수 없습니다 - 새 프로필로 등록하세요 (EXPL-07)' using errcode = 'check_violation';
  end if;
  -- 분류: 있는 분류만, 겹침 없음, 새로 더하는 분류는 열려 있어야 한다
  if (select count(distinct x) from unnest(new.category_codes) x) <> cardinality(new.category_codes) then
    raise exception '분류가 겹칩니다' using errcode = 'check_violation';
  end if;
  foreach c in array new.category_codes loop
    if not exists (select 1 from public.expert_categories k where k.code = c) then
      raise exception '분류 %가 없습니다', c using errcode = 'foreign_key_violation';
    end if;
    if (tg_op = 'INSERT' or not (c = any (old.category_codes))) and not exists (select 1 from public.expert_categories k where k.code = c and k.active) then
      raise exception '닫힌 분류(%)에는 프로필을 더할 수 없습니다', c using errcode = 'check_violation';
    end if;
  end loop;
  -- 연락 링크: 최대 3개, 새 창으로 열 수 있는 http(s) 주소 (이용자 식별 쿼리 없음)
  if jsonb_typeof(new.contact_links) is distinct from 'array' or jsonb_array_length(new.contact_links) > 3 then
    raise exception '연락 링크는 3개 이하의 배열입니다' using errcode = 'check_violation';
  end if;
  for v_link in select x.value from jsonb_array_elements(new.contact_links) as x loop
    if jsonb_typeof(v_link) is distinct from 'object'
       or exists (select 1 from jsonb_object_keys(v_link) k where k not in ('label', 'url'))
       or char_length(btrim(coalesce(v_link ->> 'label', ''))) not between 1 and 30
       or coalesce(v_link ->> 'url', '') !~* '^https?://[^/?#[:space:]@]+(/[^?#[:space:]]*)?$' then
      raise exception '연락 링크는 { label(1~30자), url(쿼리 없는 http(s) 주소) }입니다' using errcode = 'check_violation';
    end if;
  end loop;
  if exists (select 1 from unnest(new.specialties) s where char_length(btrim(s)) not between 1 and 30) then
    raise exception '전문 분야 항목은 1~30자입니다' using errcode = 'check_violation';
  end if;
  -- 쓰면 안 되는 표현 (EXPL-05)
  v_term := public.expert_text_problem(concat_ws(' ', new.name, new.office_name, new.interests, new.intro, new.contact_links::text, array_to_string(new.regions, ' '), array_to_string(new.specialties, ' ')));
  if v_term is not null then
    raise exception '프로필 문구에 쓸 수 없는 표현이 있습니다: % (EXPL-05 오인 광고 금지 표현)', v_term using errcode = 'check_violation';
  end if;
  -- 사진: 이용 권리가 확인된 사진만 (기존 media 권리 규칙 그대로)
  if new.photo_media_id is not null
     and not exists (select 1 from public.media m where m.id = new.photo_media_id and m.rights_status = 'confirmed' and m.kind = 'photo') then
    raise exception '프로필 사진은 이용 권리가 확인된(confirmed) 사진만 쓸 수 있습니다' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.expert_profiles_guard() from public, anon, authenticated;
create trigger expert_profiles_guard
  before insert or update on public.expert_profiles
  for each row execute function public.expert_profiles_guard();

-- 기록 (EXPL-08) — 상태가 바뀔 때마다 1행, 추가만 (누가 공개했고 누가 내렸는지)
create table public.expert_profile_events (
  id bigint generated always as identity primary key,
  profile_id bigint not null references public.expert_profiles (id),
  from_status text,
  to_status text not null,
  actor text not null,
  note text check (note is null or char_length(note) <= 300),
  at timestamptz not null default now()
);
comment on table public.expert_profile_events is '전문가 프로필 상태 기록 (EXPL-08) - 추가만. 공개·내림·철회와 행위자, 철회 사유가 남는다';

create function public.expert_profiles_history() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.expert_profile_events (profile_id, from_status, to_status, actor, note)
    values (new.id, case when tg_op = 'INSERT' then null else old.status end, new.status, new.edited_by,
            case new.status when 'published' then '본인 동의서 ' || coalesce(new.consent_version, '-') when 'withdrawn' then new.withdrawn_reason else null end);
  end if;
  return null;
end;
$$;
revoke all on function public.expert_profiles_history() from public, anon, authenticated;
create trigger expert_profiles_history
  after insert or update on public.expert_profiles
  for each row execute function public.expert_profiles_history();
create trigger expert_profile_events_no_change
  before update or delete on public.expert_profile_events
  for each row execute function public.append_only_guard();
create trigger expert_profile_events_no_truncate
  before truncate on public.expert_profile_events
  for each statement execute function public.append_only_guard();

-- ─────────────────────────────────────────────────────────────
-- 권한 · 공개 뷰
-- ─────────────────────────────────────────────────────────────
alter table public.expert_categories enable row level security;
alter table public.expert_profiles enable row level security;
alter table public.expert_profile_events enable row level security;
revoke all on table public.expert_categories, public.expert_profiles, public.expert_profile_events from anon, authenticated, service_role;
grant select, insert, update on table public.expert_categories to service_role;
grant select, insert, update on table public.expert_profiles to service_role;
grant select on table public.expert_profile_events to service_role;

-- 공개 프로필 — 프로필 한 명당 한 행. 모든 공개 조건을 한 곳에서:
-- 관리자가 공개(published) + 본인 동의서 기록 + 철회 없음 + SM 소속 형태 + 고지문 승인 + 기능 키 experts (목록·프로필·검색·구조화 데이터·사이트맵이 모두 이 뷰를 읽는다)
-- category_codes/category_names는 열려 있는 분류만, 분류 순서대로
create view public.public_expert_profiles as
select p.id, p.slug, p.name,
       coalesce((select array_agg(c.code order by c.sort_order, c.code) from public.expert_categories c where c.active and c.code = any (p.category_codes)), '{}') as category_codes,
       coalesce((select array_agg(c.name order by c.sort_order, c.code) from public.expert_categories c where c.active and c.code = any (p.category_codes)), '{}') as category_names,
       p.specialties, p.office_name, p.regions, p.contact_links, p.interests, p.intro, p.house_relation,
       p.updated_at::date as updated_on,
       m.path as photo_path, m.alt as photo_alt, m.credit as photo_credit
  from public.expert_profiles p
  left join public.media m on m.id = p.photo_media_id and m.rights_status = 'confirmed'
 where p.status = 'published'
   and p.withdrawn_at is null
   and p.house_relation in ('employed', 'sm_corporation')
   and p.consent_version is not null and p.consent_on is not null and p.consent_doc_ref is not null
   and exists (select 1 from public.expert_categories c where c.active and c.code = any (p.category_codes))
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'experts') = 'true'::jsonb)
   and exists (select 1 from public.settings n where n.key = 'expert_notice' and (n.value -> 'approved') = 'true'::jsonb);

-- 공개 분류 — 공개 프로필이 1명 이상인 분류만 (0명 분류는 행이 없다)
create view public.public_expert_categories as
select c.code, c.name, c.sort_order,
       (select count(*)::int from public.public_expert_profiles p where c.code = any (p.category_codes)) as profile_count
  from public.expert_categories c
 where c.active and exists (select 1 from public.public_expert_profiles p where c.code = any (p.category_codes));

-- 공개 고지문 — 승인된 법률 검토본만
create view public.public_expert_notice as
select n.value ->> 'version' as version, n.value ->> 'text' as text
  from public.settings n
 where n.key = 'expert_notice' and (n.value -> 'approved') = 'true'::jsonb
   and exists (select 1 from public.settings f where f.key = 'feature_flags' and jsonb_typeof(f.value) = 'object' and (f.value -> 'experts') = 'true'::jsonb);

revoke all on table public.public_expert_profiles, public.public_expert_categories, public.public_expert_notice from public, anon, authenticated, service_role;
grant select on table public.public_expert_profiles, public.public_expert_categories, public.public_expert_notice to anon, authenticated, service_role;
