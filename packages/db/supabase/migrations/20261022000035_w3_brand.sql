-- W3 7단계 — 브랜드: 경력 증빙 people_evidence · 이름/초상 동의서 name_likeness_consents · 감수 표시 뷰 article_review_marks
-- (PRD-01C BR-01·02·03·07·08, docs/dev/W3_설계.md 2.1·2.2·2.4·3장 · 12장 #11·#12·#13)
-- · 실제 약력·경력 연수·증빙 내용·동의서 문구는 이 파일에 없다. 증빙·동의서 문서는 저장소 밖(PO 관리)이고 표에는 위치(참조)만 둔다.
-- · 약력은 people_evidence의 approved 행(같은 인물)을 가리키는 항목만 공개 뷰에 나온다 — 기존 people.bio_items·public_people은 그대로 두고 새 뷰를 더한다.
-- · 동의서 검사는 기능 키와 상관없이 항상: 현재 동의서 버전(가장 늦게 시작한 문서)이 활성이고 범위가 맞아야 이름이 든 콘텐츠를 낸다.
--   인물 페이지 = profile_page, 칼럼 발행 = column. 철회·만료되면 다음 요청부터 내려간다(인물 페이지 404 · 사이트맵 원본 뷰 0행).
-- · 감수 표시는 새 서명 표 없이 editorial_reviews(tax_review)에서 뷰로 계산한다(두 군데 진실 금지). 서명 뒤 오탈자 아닌 수정 → hidden_changed + 재감수 큐.
-- · 기능 키 people_pages · brand_copy는 꺼진 채. 켜기 조건은 아래 트리거가 강제한다(서버도 같은 조건으로 사유를 보인다).

-- ─────────────────────────────────────────────────────────────
-- people_evidence — 약력 항목의 증빙 (BR-01). 승인은 확인자·확인 시각이 있을 때만
-- ─────────────────────────────────────────────────────────────
create table public.people_evidence (
  id bigint generated always as identity primary key,
  person_id bigint not null references public.people (id) on delete cascade,
  kind text not null check (kind in ('document', 'official_record', 'publisher_history')),
  doc_ref text not null check (length(btrim(doc_ref)) > 0),          -- 증빙 문서 위치(저장소 밖) — 공개 뷰에 없다
  recorded_by text not null check (length(btrim(recorded_by)) > 0),  -- 등록한 사람 user:<uuid> · admin:<이메일>
  verified_by text,
  verified_at timestamptz,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint people_evidence_approval check (not approved or (length(btrim(coalesce(verified_by, ''))) > 0 and verified_at is not null))
);
comment on table public.people_evidence is '인물 경력 증빙 (BR-01) — 문서는 저장소 밖, 위치(참조)만. approved는 확인자·확인 시각이 있을 때만. service_role만';
create index people_evidence_person_idx on public.people_evidence (person_id);
create trigger people_evidence_touch before update on public.people_evidence
  for each row execute function public.touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- name_likeness_consents — 이름·초상 동의서 버전 (BR-07). 기록은 고치지 않고, 철회만 한 번 한다
-- ─────────────────────────────────────────────────────────────
create table public.name_likeness_consents (
  id bigint generated always as identity primary key,
  person_id bigint not null references public.people (id) on delete cascade,
  version text not null check (length(btrim(version)) > 0),
  scope text[] not null check (cardinality(scope) > 0 and scope <@ array['profile_page', 'column', 'home', 'external_profile', 'product', 'ad', 'video']::text[]),
  doc_ref text not null check (length(btrim(doc_ref)) > 0),           -- 동의서 문서 위치(저장소 밖) — 공개 뷰에 없다
  recorded_by text not null check (length(btrim(recorded_by)) > 0),
  recorded_at timestamptz not null default now(),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  withdrawn_at timestamptz,
  withdrawn_by text,
  unique (person_id, version),
  constraint name_likeness_consents_period check (valid_from <= recorded_at and (valid_to is null or valid_to > valid_from)),
  constraint name_likeness_consents_withdrawal check ((withdrawn_at is null) = (withdrawn_by is null))
);
comment on table public.name_likeness_consents is '이름·초상 동의서 버전 (BR-07) — 현재 버전(가장 늦게 시작한 문서)이 활성이고 범위가 맞을 때만 이름·사진 콘텐츠. 철회는 한 번, 기록 내용은 고치지 않는다. service_role만';
create index name_likeness_consents_person_idx on public.name_likeness_consents (person_id, valid_from desc, id desc);

create function public.name_likeness_consents_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.withdrawn_at is not null then
    raise exception '철회한 동의서는 바꿀 수 없습니다 — 새 버전을 기록하세요 (동의서 %)', old.id using errcode = 'check_violation';
  end if;
  if (new.person_id, new.version, new.scope, new.doc_ref, new.recorded_by, new.recorded_at, new.valid_from, new.valid_to)
     is distinct from (old.person_id, old.version, old.scope, old.doc_ref, old.recorded_by, old.recorded_at, old.valid_from, old.valid_to) then
    raise exception '동의서 기록은 고칠 수 없습니다 — 철회만 할 수 있고, 바뀐 동의는 새 버전으로 기록합니다 (동의서 %)', old.id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.name_likeness_consents_guard() from public, anon, authenticated;
create trigger name_likeness_consents_guard
  before update on public.name_likeness_consents
  for each row execute function public.name_likeness_consents_guard();

alter table public.people_evidence enable row level security;
alter table public.name_likeness_consents enable row level security;
revoke all on table public.people_evidence, public.name_likeness_consents from anon, authenticated, service_role;
grant select, insert, update, delete on table public.people_evidence, public.name_likeness_consents to service_role;

-- ─────────────────────────────────────────────────────────────
-- 뷰 — 관리용(service_role)과 공개용(anon). 공개 뷰에는 문서 위치·확인자가 없다
-- ─────────────────────────────────────────────────────────────

-- 관리용: 동의서마다 상태(active · withdrawn · expired)와 현재 버전 여부
create view public.name_consent_docs as
select c.id, c.person_id, c.version, c.scope, c.doc_ref, c.recorded_by, c.recorded_at, c.valid_from, c.valid_to, c.withdrawn_at, c.withdrawn_by,
       case when c.withdrawn_at is not null then 'withdrawn'
            when c.valid_to is not null and c.valid_to <= now() then 'expired'
            else 'active' end as status,
       c.id = (select x.id from public.name_likeness_consents x where x.person_id = c.person_id order by x.valid_from desc, x.id desc limit 1) as is_current
  from public.name_likeness_consents c;
revoke all on table public.name_consent_docs from public, anon, authenticated, service_role;
grant select on table public.name_consent_docs to service_role;

-- 공개: 현재 동의서 버전이 활성인 인물의 범위만
create view public.public_name_consents as
select d.person_id, d.scope
  from public.name_consent_docs d
 where d.is_current and d.status = 'active';
revoke all on table public.public_name_consents from public, anon, authenticated, service_role;
grant select on table public.public_name_consents to anon, authenticated, service_role;

-- 공개: 인물 페이지를 낼 수 있는 사람 = 공개 인물 + 현재 동의서 범위에 profile_page. 인물 페이지와 사이트맵(W7)이 같은 원본을 읽는다
create view public.public_profile_pages as
select p.id as person_id, p.slug, p.updated_at
  from public.people p
  join public.public_name_consents c on c.person_id = p.id
 where p.visibility = 'public' and 'profile_page' = any (c.scope);
revoke all on table public.public_profile_pages from public, anon, authenticated, service_role;
grant select on table public.public_profile_pages to anon, authenticated, service_role;

-- 공개: 증빙이 승인된 약력 항목만 (항목의 evidence_id = 같은 인물의 approved 증빙 번호). 항목 순서 유지, 증빙 위치·확인자 없음
create view public.public_person_bio as
select p.id as person_id,
       coalesce((
         select jsonb_agg(jsonb_build_object('item', b.item ->> 'item', 'evidence_id', btrim(b.item ->> 'evidence_id')) order by b.ord)
           from jsonb_array_elements(p.bio_items) with ordinality as b(item, ord)
          where jsonb_typeof(b.item) = 'object'
            and length(btrim(coalesce(b.item ->> 'item', ''))) > 0
            and exists (
              select 1 from public.people_evidence e
               where e.person_id = p.id and e.approved and e.id::text = btrim(b.item ->> 'evidence_id'))
       ), '[]'::jsonb) as bio_items
  from public.people p
 where p.visibility = 'public';
revoke all on table public.public_person_bio from public, anon, authenticated, service_role;
grant select on table public.public_person_bio to anon, authenticated, service_role;

-- 공개: 감수 표시 — 공개 기사의 가장 최근 세무 감수 기록으로만 계산한다 (손입력 칸 없음, 읽기 전용).
--   none = 감수 승인 기록 없음(또는 최근 기록이 반려·보류) · hidden_changed = 서명 뒤 오탈자 아닌 수정(새 버전) · shown = 그 밖
--   오탈자 수정(update_kind='typo')은 버전이 올라도 유지. none이면 서명자·시각을 내지 않는다
create view public.article_review_marks as
select s.article_id,
       case when s.state = 'none' then null else s.reviewer_id end as reviewer_person_id,
       case when s.state = 'none' then null else s.at end as reviewed_at,
       case when s.state = 'none' then null else s.version end as version,
       s.state
  from (
    select a.id as article_id, r.reviewer_id, r.at, r.version,
           case when r.decision is distinct from 'approve' then 'none'
                when (a.substantive_updated_at is not null and a.substantive_updated_at > r.at)
                  or exists (select 1 from public.article_revisions v
                              where v.article_id = a.id and v.version > r.version and v.update_kind is distinct from 'typo') then 'hidden_changed'
                else 'shown' end as state
      from public.articles a
      left join lateral (
        select x.reviewer_id, x.at, x.version, x.decision from public.editorial_reviews x
         where x.article_id = a.id and x.kind = 'tax_review' order by x.at desc, x.id desc limit 1
      ) r on true
     where a.status = 'published' and a.lead_media_cleared and not a.is_paid
  ) s;
revoke all on table public.article_review_marks from public, anon, authenticated, service_role;
grant select on table public.article_review_marks to anon, authenticated, service_role;

-- 관리용: 재감수 큐 — 서명 뒤 실질 수정이 생긴 공개 기사 (기사마다 1건). 감수위원이 현재 버전에 다시 서명하면 빠진다
create view public.tax_rereview_queue as
select m.article_id, m.reviewer_person_id, m.reviewed_at, m.version as reviewed_version, a.version as current_version, a.substantive_updated_at, a.title
  from public.article_review_marks m
  join public.articles a on a.id = m.article_id
 where m.state = 'hidden_changed';
revoke all on table public.tax_rereview_queue from public, anon, authenticated, service_role;
grant select on table public.tax_rereview_queue to service_role;

-- ─────────────────────────────────────────────────────────────
-- 설정 씨앗 + 기능 키(꺼짐)
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value, description, updated_by) values
  ('career_claim_approved', '{"approved": false, "basis_evidence_id": null, "approved_by": null, "approved_at": null}'::jsonb,
   '경력·직함·연수 표시 증빙 승인 — 승인 전 약력 문구·연수·시그니처 제목 0 (BR-01·04·07). 근거 증빙(승인된 people_evidence)이 있어야 approved', 'migration:20261022000035'),
  ('brand_copy_review', '{"reviewed": false, "record_id": null}'::jsonb,
   '경력 표시 광고 규정 감수 기록 — 없으면 brand_copy 켜기 거부 (PRD-01C 13장 #22)', 'migration:20261022000035')
on conflict (key) do nothing;

update public.settings
   set value = value || jsonb_build_object('people_pages', false),
       updated_by = 'migration:20261022000035'
 where key = 'feature_flags' and jsonb_typeof(value) = 'object' and not (value ? 'people_pages');
update public.settings
   set value = value || jsonb_build_object('brand_copy', false),
       updated_by = 'migration:20261022000035'
 where key = 'feature_flags' and jsonb_typeof(value) = 'object' and not (value ? 'brand_copy');

-- ─────────────────────────────────────────────────────────────
-- 설정 검사 — 승인 기록의 모양 + 기능 키 켜기 조건
--   career_claim_approved.approved=true → basis_evidence_id가 승인된 증빙 · approved_by · approved_at 필수
--   brand_copy_review.reviewed=true → record_id(감수 기록 위치) 필수
--   feature_flags.brand_copy 새로 켜기 → reviewed=true + approved=true(근거 증빙이 지금도 승인 상태)
--   feature_flags.people_pages 새로 켜기 → 인물 페이지를 낼 수 있는 사람 중 증빙 승인 약력이 1줄 이상인 사람이 있다
-- ─────────────────────────────────────────────────────────────
create function public.brand_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review jsonb;
  v_claim jsonb;
  v_basis text;
begin
  if new.key = 'career_claim_approved' and coalesce((new.value ->> 'approved')::boolean, false) then
    v_basis := btrim(coalesce(new.value ->> 'basis_evidence_id', ''));
    if v_basis = '' or not exists (select 1 from public.people_evidence e where e.id::text = v_basis and e.approved) then
      raise exception '경력 표시 승인(career_claim_approved)에는 승인된 근거 증빙(basis_evidence_id)이 필요합니다' using errcode = 'check_violation';
    end if;
    if length(btrim(coalesce(new.value ->> 'approved_by', ''))) = 0 or length(btrim(coalesce(new.value ->> 'approved_at', ''))) = 0 then
      raise exception '경력 표시 승인(career_claim_approved)에는 승인자(approved_by)와 승인 시각(approved_at)이 필요합니다' using errcode = 'check_violation';
    end if;
  end if;

  if new.key = 'brand_copy_review' and coalesce((new.value ->> 'reviewed')::boolean, false)
     and length(btrim(coalesce(new.value ->> 'record_id', ''))) = 0 then
    raise exception '광고 규정 감수(brand_copy_review)에는 감수 기록 위치(record_id)가 필요합니다' using errcode = 'check_violation';
  end if;

  if new.key = 'feature_flags' then
    if coalesce((new.value ->> 'brand_copy')::boolean, false)
       and (tg_op = 'INSERT' or not coalesce((old.value ->> 'brand_copy')::boolean, false)) then
      select value into v_review from public.settings where key = 'brand_copy_review';
      select value into v_claim from public.settings where key = 'career_claim_approved';
      if not coalesce((v_review ->> 'reviewed')::boolean, false)
         or not coalesce((v_claim ->> 'approved')::boolean, false)
         or not exists (select 1 from public.people_evidence e where e.id::text = btrim(coalesce(v_claim ->> 'basis_evidence_id', '')) and e.approved) then
        raise exception 'brand_copy는 경력 표시 광고 규정 감수 기록(brand_copy_review)과 경력 증빙 승인(career_claim_approved) 뒤에만 켤 수 있습니다'
          using errcode = 'check_violation';
      end if;
    end if;
    if coalesce((new.value ->> 'people_pages')::boolean, false)
       and (tg_op = 'INSERT' or not coalesce((old.value ->> 'people_pages')::boolean, false)) then
      if not exists (
        select 1 from public.public_profile_pages pp
          join public.public_person_bio b on b.person_id = pp.person_id
         where jsonb_array_length(b.bio_items) > 0) then
        raise exception 'people_pages는 활성 동의서(인물 페이지 범위)와 증빙 승인 약력이 있는 인물이 1명 이상일 때만 켤 수 있습니다'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.brand_settings_guard() from public, anon, authenticated;
create trigger settings_brand_guard
  before insert or update on public.settings
  for each row when (new.key in ('feature_flags', 'career_claim_approved', 'brand_copy_review'))
  execute function public.brand_settings_guard();

-- ─────────────────────────────────────────────────────────────
-- 칼럼 발행 — 기능 키와 상관없이 필자의 현재 동의서(범위 column)가 활성이어야 한다 (이름이 든 콘텐츠 — 12장 #12)
--   이미 공개된 칼럼은 그대로 두고(필자를 바꾸면 다시 검사), 새로 발행·예약할 때 검사한다
-- ─────────────────────────────────────────────────────────────
create function public.column_consent_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status not in ('published', 'scheduled') or new.content_type is distinct from 'opinion' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status in ('published', 'scheduled') and old.content_type is not distinct from new.content_type
     and old.author_id is not distinct from new.author_id then
    return new;
  end if;
  if new.author_id is null then
    return new; -- 필자 이름이 없는 글은 이름 사용이 아니다 (필자 요건은 칼럼 필자 체계 34가 따로 본다)
  end if;
  if not exists (select 1 from public.public_name_consents c where c.person_id = new.author_id and 'column' = any (c.scope)) then
    raise exception '필자의 이름·초상 동의서(현재 버전, 범위 column)가 없어 칼럼을 발행할 수 없습니다 (기사 %)', new.id using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.column_consent_guard() from public, anon, authenticated;
create trigger articles_column_consent_guard
  before insert or update on public.articles
  for each row execute function public.column_consent_guard();
