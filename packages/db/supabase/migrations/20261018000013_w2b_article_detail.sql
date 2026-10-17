-- W2-b 4단계 DB — 칼럼 연재 회차 · 삭제된 기사 주소 (docs/dev/W2-b_설계.md 3장·4장·9장 #14·#42)
-- · articles.series_title·series_episode — 칼럼 연재 이름과 회차 (ART-04 '칼럼은 분야별 칼럼 목록에 연재 회차 순서로 나온다 —
--   연재 회차 순서가 목록과 상세에 보인다'). 칼럼(opinion)만 · 둘 다 있거나 둘 다 없다 · 회차는 1 이상 ·
--   같은 분야·같은 연재의 같은 회차는 하나만(삭제된 기사는 세지 않는다). 연재 없는 칼럼(단독 칼럼)은 둘 다 비운다.
-- · article_tombstones — 공개됐다가 삭제된 기사의 주소 (NAV-06 '삭제 기사 URL은 410 응답과 삭제 안내').
--   기사가 삭제(status → deleted)되는 순간 트리거가 한 줄 남긴다 — 직접 쓰지 않는다(service_role도 추가만, 고치기·지우기 거부).
--   발행된 적 없는 기사(첫 발행일 없음)는 공개 주소가 없었으므로 남기지 않는다 → 그 주소는 404.
--   anon은 주소(slug)·삭제 시각만 읽는다 — 공개 경로 확인(proxy.ts)이 이 표로 410을 정한다.
--   이관 기사의 옛 주소 이동(301·308·404·410 매핑)은 W9 MIG-02 `redirects` 표가 맡는다 — 이 표와 다르다.

-- ─────────────────────────────────────────────────────────────
-- 칼럼 연재 회차 (ART-04)
-- ─────────────────────────────────────────────────────────────
alter table public.articles
  add column series_title text,
  add column series_episode integer,
  add constraint articles_series_pair check ((series_title is null) = (series_episode is null)),
  add constraint articles_series_title_text check (series_title is null or length(btrim(series_title)) between 1 and 100),
  add constraint articles_series_episode_min check (series_episode is null or series_episode >= 1),
  add constraint articles_series_opinion_only check (series_title is null or content_type is not distinct from 'opinion');

comment on column public.articles.series_title is '칼럼 연재 이름 (ART-04) — 칼럼(opinion)만, 회차와 함께';
comment on column public.articles.series_episode is '칼럼 연재 회차 1부터 (ART-04) — 같은 분야·같은 연재에서 겹치지 않는다(삭제 기사 제외)';

create unique index articles_series_episode_unique on public.articles (section, series_title, series_episode)
  where series_title is not null and status <> 'deleted';

grant select (series_title, series_episode) on table public.articles to anon, authenticated;

-- 공개 기사 뷰 — 앞 칸 그대로 + 연재 칸 (칸은 뒤에만 더한다)
create or replace view public.public_articles
with (security_invoker = true) as
select id, slug, title, summary, body, format, section, content_type, reporting_method, origin, category_id, subtype, solved_case,
  label, partner_id, author_id, lead_media_id, version, first_published_at, substantive_updated_at, updated_reason, update_kind,
  legal_basis_date, tax_lens, digest_id, region_codes, editorial_field, public_question, amendment_id, legacy_url, legacy_source,
  reported_approved, series_title, series_episode
from public.articles
where status = 'published' and lead_media_cleared and not is_paid;

-- ─────────────────────────────────────────────────────────────
-- 삭제된 기사 주소 (NAV-06)
-- ─────────────────────────────────────────────────────────────
create table public.article_tombstones (
  article_id bigint primary key references public.articles (id),
  slug text not null unique check (length(btrim(slug)) > 0),
  removed_at timestamptz not null default now()
);

comment on table public.article_tombstones is '공개됐다가 삭제된 기사의 주소 (NAV-06 — 410 응답과 삭제 안내). 트리거가 추가만 한다';

create trigger article_tombstones_no_update_delete
  before update or delete on public.article_tombstones
  for each row execute function public.append_only_guard();

create trigger article_tombstones_no_truncate
  before truncate on public.article_tombstones
  for each statement execute function public.append_only_guard();

alter table public.article_tombstones enable row level security;
revoke all on table public.article_tombstones from anon, authenticated, service_role;
grant select, insert on table public.article_tombstones to service_role;

grant select (slug, removed_at) on table public.article_tombstones to anon, authenticated;
create policy article_tombstones_public_read on public.article_tombstones
  for select to anon, authenticated
  using (true);

-- 기사가 삭제되는 순간 주소를 남긴다 — 첫 발행일이 있는(공개 주소가 있었던) 기사만
create function public.article_tombstone_record() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'deleted' and new.first_published_at is not null and (tg_op = 'INSERT' or old.status is distinct from 'deleted') then
    insert into public.article_tombstones (article_id, slug) values (new.id, new.slug)
      on conflict (article_id) do nothing;
  end if;
  return null;
end;
$$;

revoke all on function public.article_tombstone_record() from public, anon, authenticated;

create trigger article_tombstone_record
  after insert or update of status on public.articles
  for each row execute function public.article_tombstone_record();
