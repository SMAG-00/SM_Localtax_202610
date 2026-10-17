-- W2-a 1단계 DB — 공개 읽기 (FND-04 · W2-a 설계 3장)
-- anon·authenticated는 공개 상태·권리 확인 행의 공개 칸만 읽는다. 그 밖의 표는 정책이 없어 0행이다.
-- · 칸 단위 권한(grant select (칸…))으로 내부 칸을 막고, 행은 RLS 정책으로 거른다. 뷰는 security_invoker라 읽는 역할의 RLS를 그대로 따른다.
-- · 정책 안의 하위 질의는 읽는 역할의 권한·RLS로 돈다 — 출처·이미지·개정 단계는 "읽을 수 있는 기사·개정안에 딸린 행"이 된다.
-- · 기사 정책은 이미지 표를 참조하지 않는다(정책 순환 방지) — 대표 이미지 권리는 트리거가 계산한 lead_media_cleared로 거른다.
-- · 쓰기 권한은 주지 않는다. 함수 실행 권한도 주지 않는다 (verify-rls-remote — anon 실행 허용은 health_ping뿐).
-- 공개하지 않는 표: article_evidence · article_datasets · article_interviews · editorial_reviews · staff_roles · settings ·
--   story_assignments · story_assignment_events · article_revisions · article_corrections · seo_checks · inquiries ·
--   raw_snapshots · legacy_category_map · glossary_terms · tags · article_tags (서버가 service_role로 읽어 렌더한다)

-- 분야 — 공개 분야만 (CAT-01)
grant select on table public.categories to anon, authenticated;
create policy categories_public_read on public.categories
  for select to anon, authenticated
  using (visible);

-- 인물 — 공개 인물의 공개 칸만. 약력은 증빙 있는 항목만(bio_items_public). 계정·이해관계 메모·동의서 칸은 비공개 (BR-01·BR-02)
grant select (id, slug, name, roles, affiliation, bio_items_public, beat, last_verified_at, visibility) on table public.people to anon, authenticated;
create policy people_public_read on public.people
  for select to anon, authenticated
  using (visibility = 'public');

-- 기사 — 발행(published)이고 대표 이미지가 없거나 권리 확인된 기사의 공개 칸만 (NAV-05).
-- 2단계 유료 본문(is_paid)은 서버에서 차단하므로 anon 경로에서 뺀다 (PRD-00 6장).
-- 비공개 칸: editorial_status · tax_review_status · story_assignment_id · nav_candidate · check_log · publish_at · hot_pin_until
grant select (
  id, slug, title, summary, body, format, section, content_type, reporting_method, origin, category_id, subtype, solved_case,
  label, partner_id, author_id, lead_media_id, status, version, first_published_at, substantive_updated_at, updated_reason,
  update_kind, legal_basis_date, tax_lens, digest_id, region_codes, editorial_field, public_question, amendment_id,
  legacy_url, legacy_source, is_paid, lead_media_cleared, created_at, updated_at
) on table public.articles to anon, authenticated;
create policy articles_public_read on public.articles
  for select to anon, authenticated
  using (status = 'published' and lead_media_cleared and not is_paid);

-- 이미지 — 권리 확인되고, 읽을 수 있는 기사(위 정책)의 대표 이미지인 것만. 초안 기사의 사진·설명은 새지 않는다
grant select (id, path, alt, credit, photographer, license, source_url, kind) on table public.media to anon, authenticated;
create policy media_public_read on public.media
  for select to anon, authenticated
  using (
    rights_status = 'confirmed'
    and exists (select 1 from public.articles a where a.lead_media_id = media.id));

-- 제휴사 — 공개 제휴사만, 계약 기간 칸은 비공개 (ART-10)
grant select (id, name, kind, intro, logo_media_id, url) on table public.partners to anon, authenticated;
create policy partners_public_read on public.partners
  for select to anon, authenticated
  using (visible);

-- 공개 출처 — 읽을 수 있는 기사의 출처만 (NAV-03). 비공개 취재 근거(article_evidence)와는 다른 표다
grant select (
  id, article_id, version, kind, title, source_url, source_name, provider, last_verified_at, license_status, source_type,
  published_on, reference_date, region_code, region_unit, collected_at, snapshot_id, supersedes_id, revision_reason
) on table public.article_sources to anon, authenticated;
create policy article_sources_public_read on public.article_sources
  for select to anon, authenticated
  using (exists (select 1 from public.articles a where a.id = article_sources.article_id));

-- 개정 트래커 — 공개 개정안과 그 단계 기록 (TX-07 · CAT-04). 기록자(recorded_by) 칸은 비공개
grant select (id, slug, title, law_names, summary, status) on table public.amendments to anon, authenticated;
create policy amendments_public_read on public.amendments
  for select to anon, authenticated
  using (status = 'public');

grant select (id, amendment_id, stage, occurred_on, source_url, snapshot_id, skipped, skip_reason, correction_of, reason, recorded_at)
  on table public.amendment_events to anon, authenticated;
create policy amendment_events_public_read on public.amendment_events
  for select to anon, authenticated
  using (exists (select 1 from public.amendments m where m.id = amendment_events.amendment_id));

grant select on table public.amendment_current_stages to anon, authenticated;

-- 공개 뷰 — 공개 칸만 모은 읽기 전용 모양 (security_invoker: 읽는 역할의 칸 권한·RLS를 그대로 따른다)
create view public.public_articles
with (security_invoker = true) as
select id, slug, title, summary, body, format, section, content_type, reporting_method, origin, category_id, subtype, solved_case,
  label, partner_id, author_id, lead_media_id, version, first_published_at, substantive_updated_at, updated_reason, update_kind,
  legal_basis_date, tax_lens, digest_id, region_codes, editorial_field, public_question, amendment_id, legacy_url, legacy_source
from public.articles
where status = 'published' and lead_media_cleared and not is_paid;

comment on view public.public_articles is '발행 기사의 공개 칸 — 발행·대표 이미지 권리 확인(또는 없음)·무료 (security_invoker)';

create view public.public_people
with (security_invoker = true) as
select id, slug, name, roles, affiliation, bio_items_public as bio_items, beat, last_verified_at
from public.people
where visibility = 'public';

comment on view public.public_people is '공개 인물의 공개 칸 — 약력은 증빙 있는 항목만 (BR-01, security_invoker)';

revoke all on table public.public_articles from anon, authenticated, service_role;
revoke all on table public.public_people from anon, authenticated, service_role;
grant select on table public.public_articles to anon, authenticated, service_role;
grant select on table public.public_people to anon, authenticated, service_role;
