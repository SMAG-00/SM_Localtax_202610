-- W2-b 1단계 DB — 공개 읽기 (docs/dev/W2-b_설계.md 4장). W2-a(20261018000008)와 같은 방식:
-- 칸 단위 권한으로 내부 칸을 막고 RLS 정책으로 행을 거른다. 정책 안의 하위 질의는 읽는 역할의 RLS로 돈다
-- ("읽을 수 있는 기사·개정안에 딸린 행"). 쓰기 권한·함수 실행 권한은 주지 않는다.
-- 공개 데이터 함수(apps/web/lib/server/public)는 anon 키로 읽는다 — 이 정책이 경계다.

-- ─────────────────────────────────────────────────────────────
-- articles 계산 칸 2개 — 직접 쓸 수 없다 (generated)
--  · reported_approved: 편집 승인된 보도기사 (HOME-04 '편집 승인된 reported_news만' · CAT-02 뉴스 전체).
--    편집 승인 상태(editorial_status) 자체는 W2-a대로 비공개 — 공개 칸은 보도기사의 승인 여부 한 가지뿐이다
--  · body_media_ids: 본문 이미지·인포그래픽 블록이 가리키는 media 번호 — 본문 이미지 공개 읽기 정책이 쓴다 (ART-02)
-- ─────────────────────────────────────────────────────────────
alter table public.articles
  add column reported_approved boolean generated always as (coalesce(content_type = 'reported_news' and editorial_status = 'approved', false)) stored,
  add column body_media_ids jsonb generated always as (
    jsonb_path_query_array(body, '$.blocks[*] ? (@.type == "image" || @.type == "infographic").mediaId')) stored;

comment on column public.articles.reported_approved is '편집 승인된 보도기사 — content_type=reported_news이고 editorial_status=approved (계산 칸, 공개)';
comment on column public.articles.body_media_ids is '본문 이미지·인포그래픽 블록의 media 번호 (계산 칸) — media 공개 읽기 정책이 쓴다';

create index articles_body_media_idx on public.articles using gin (body_media_ids jsonb_path_ops);
create index articles_reported_idx on public.articles (reported_approved, first_published_at desc) where status = 'published';

grant select (reported_approved, body_media_ids) on table public.articles to anon, authenticated;

-- 공개 기사 뷰 — W2-a 칸 그대로 + 편집 승인된 보도기사 표시 (칸은 뒤에만 더한다)
create or replace view public.public_articles
with (security_invoker = true) as
select id, slug, title, summary, body, format, section, content_type, reporting_method, origin, category_id, subtype, solved_case,
  label, partner_id, author_id, lead_media_id, version, first_published_at, substantive_updated_at, updated_reason, update_kind,
  legal_basis_date, tax_lens, digest_id, region_codes, editorial_field, public_question, amendment_id, legacy_url, legacy_source,
  reported_approved
from public.articles
where status = 'published' and lead_media_cleared and not is_paid;

-- 하위 분야별 목록 기사 수 — 메뉴·허브 탭이 '기사 0건인 하위 분야 숨김'(CAT-02 · HOME-02)에 쓴다.
-- 목록 기사 = 유형이 있고(이관 미분류 제외) 금주 핫뉴스(digest — 주간 페이지 경로)가 아닌 공개 기사. security_invoker라 읽는 역할의 RLS로 센다
create view public.public_category_article_counts
with (security_invoker = true) as
select category_id, count(*)::int as article_count
from public.public_articles
where category_id is not null and content_type is not null and content_type <> 'digest'
group by category_id;

comment on view public.public_category_article_counts is '하위 분야별 공개 목록 기사 수 (CAT-02) — security_invoker';

revoke all on table public.public_category_article_counts from anon, authenticated, service_role;
grant select on table public.public_category_article_counts to anon, authenticated, service_role;

-- 이미지 — W2-a(대표 이미지만)를 넓힌다: 권리 확인이고, 읽을 수 있는 기사의 대표 이미지 또는 본문 이미지·인포그래픽 (ART-02)
drop policy media_public_read on public.media;
create policy media_public_read on public.media
  for select to anon, authenticated
  using (
    rights_status = 'confirmed'
    and exists (
      select 1 from public.articles a
       where a.lead_media_id = media.id
          or a.body_media_ids @> jsonb_build_array(media.id::text)
          or a.body_media_ids @> jsonb_build_array(media.id)));

-- ─────────────────────────────────────────────────────────────
-- 새 표
-- ─────────────────────────────────────────────────────────────

-- 행정구역 — 공개 참조 자료 (REG1-01 · CAT-03)
grant select on table public.regions to anon, authenticated;
create policy regions_public_read on public.regions
  for select to anon, authenticated
  using (true);

-- 상황 — 공개(visible)만. 감수자·마지막 수정자 칸은 비공개 (UX-05)
grant select (
  id, slug, section, title, subtitle, pictogram, checks, checklist, mistakes, external_link_id, article_ids, solved_case_ids,
  glossary_ids, tool_links, region_select, hub_slot, sort, visible, reviewed_at, created_at, updated_at
) on table public.situations to anon, authenticated;
create policy situations_public_read on public.situations
  for select to anon, authenticated
  using (visible);

-- 홈 배치 — 오늘(한국 날짜)이 노출 기간 안이고 대상(공개 개정안·읽을 수 있는 기사)이 읽히는 행 (HOME-03 '기간이 끝난 카드는 자동으로 빠진다')
grant select (id, kind, amendment_id, article_id, sort, starts_on, ends_on) on table public.home_curations to anon, authenticated;
create policy home_curations_public_read on public.home_curations
  for select to anon, authenticated
  using (
    starts_on <= (now() at time zone 'Asia/Seoul')::date
    and (ends_on is null or ends_on >= (now() at time zone 'Asia/Seoul')::date)
    and (
      (kind = 'tracker' and exists (select 1 from public.amendments m where m.id = home_curations.amendment_id))
      or (kind = 'story' and exists (select 1 from public.articles a where a.id = home_curations.article_id))));

-- ─────────────────────────────────────────────────────────────
-- W2-a 비공개 표 가운데 공개 화면이 쓰는 것 — 공개 행·칸만 연다
-- ─────────────────────────────────────────────────────────────

-- 용어사전 — 비회원 공개 (PRD-00 6장, GLO-01). 전문 용어 표시(jargon)는 점검용 내부 칸
grant select (id, term, reading, definition, plain, related, section, source) on table public.glossary_terms to anon, authenticated;
create policy glossary_terms_public_read on public.glossary_terms
  for select to anon, authenticated
  using (true);

-- 태그 — 읽을 수 있는 기사에 붙은 것만 (ART-06 비슷한 사례 선정)
grant select on table public.article_tags to anon, authenticated;
create policy article_tags_public_read on public.article_tags
  for select to anon, authenticated
  using (exists (select 1 from public.articles a where a.id = article_tags.article_id));

grant select on table public.tags to anon, authenticated;
create policy tags_public_read on public.tags
  for select to anon, authenticated
  using (exists (select 1 from public.article_tags t where t.tag_id = tags.id));

-- 정정 이력 — 게재된 정정만 (NAV-06 · ART-02 정정 이력 블록). 결정자·문의·전후 버전 번호는 비공개
grant select (id, article_id, kind, reason, reader_notice, published_at, created_at) on table public.article_corrections to anon, authenticated;
create policy article_corrections_public_read on public.article_corrections
  for select to anon, authenticated
  using (
    published_at is not null and published_at <= now()
    and exists (select 1 from public.articles a where a.id = article_corrections.article_id));

-- 업데이트 표시 — 실질 수정 기록의 날짜·사유만 (ART-05). 이전 판의 제목·본문·편집자는 비공개
grant select (id, article_id, version, edited_at, reason, update_kind) on table public.article_revisions to anon, authenticated;
create policy article_revisions_public_read on public.article_revisions
  for select to anon, authenticated
  using (
    update_kind = 'substantive'
    and exists (select 1 from public.articles a where a.id = article_revisions.article_id));

-- 운영 설정 — 공개 화면 문구·기능 공개 목록·기준값 키만 (설계 2.3 settings.public_keys). 사전·유사도 기준은 비공개
grant select (key, value, updated_at) on table public.settings to anon, authenticated;
create policy settings_public_read on public.settings
  for select to anon, authenticated
  using (key = any (array[
    'home_core_message', 'home_search_chips', 'hub_intros', 'amendment_confirmed_stage',
    'hub_situation_limit', 'feature_flags', 'next_action_priority']::text[]));

-- ─────────────────────────────────────────────────────────────
-- 공개 설정 씨앗 (설계 2.4)
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value, description, updated_by) values
  ('home_core_message', to_jsonb('부동산과 지자체의 변화를 읽고 대응하려면 지방세 이해가 필수다'::text),
   '홈 히어로 핵심 메시지 (HOME-01 · CORE-02) — 화면 문구는 이 값 한 곳에서 온다',
   'migration:20261018000012'),
  ('home_search_chips', '[]'::jsonb,
   '홈 추천 검색어 칩 (HOME-01) — 글자 3~6개, 비우면 칩 줄을 숨긴다',
   'migration:20261018000012'),
  ('hub_intros', '{}'::jsonb,
   '4대 분야 허브 머리의 한 줄 소개 (CAT-02) — { "tax": "…", "realestate": "…", "finance": "…", "local": "…" }, 없으면 소개 줄 없음',
   'migration:20261018000012'),
  ('feature_flags', jsonb_build_object(
     'calc', false, 'experts', false, 'store', false, 'edu', false, 'search', false,
     'sm_calculator', false, 'expert_finder', false, 'self_calculator', false, 'taxbot', false, 'region_hubs', false, 'amendments', false,
     'page_about', false, 'page_editorial_policy', false, 'page_ethics', false, 'page_corrections', false,
     'page_ad_policy', false, 'page_privacy', false, 'page_help', false),
   '기능 공개 목록 (HOME-02 · ART-06 · UX-05 · HELP-05) — true인 기능만 메뉴·링크·버튼이 나온다. 공개 승인 전에는 false',
   'migration:20261018000012'),
  ('next_action_priority', jsonb_build_array('situation', 'same_section', 'local_news', 'sm_calculator', 'expert_finder', 'self_calculator', 'taxbot'),
   '다음 행동 띠 버튼 우선순위 (ART-06) — 열린 버튼 중 앞의 2개만 보인다',
   'migration:20261018000012');
