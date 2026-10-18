-- W2-c 5단계 DB — 공동 기획 배지의 제휴사 이름 (ART-10 '이미 붙은 배지는 남는다', W2-a 4-2 결정 · docs/dev/W2-c_설계.md 9장 #52·#56)
-- · 공개 화면(anon)은 공개 제휴사(visible) 행만 읽는다(RLS). 그래서 공동 기획 기사의 제휴사를 비공개로 내리면 이름을 읽지 못해
--   배지가 '공동 기획 ○○' 대신 유형 배지 '광고'로 바뀌었다(틀림). 공동 기획 기사가 배지 이름을 스스로 들고 있게 한다:
--   articles.partner_badge_name — 표기가 공동 기획(co_planned)이고 제휴사가 지정되면 그 제휴사 이름, 아니면 비움.
--   트리거가 넣은 값과 상관없이 다시 계산하고(직접 못 바꾼다), 제휴사 이름을 고치면 그 제휴사의 공동 기획 기사 이름도 함께 바뀐다.
-- · anon은 이 칸(이름 글자)만 더 읽는다 — 비공개 제휴사의 소개·누리집·계약 기간은 그대로 0(제휴사 RLS 그대로). 광고(ad) 기사는 이름 0.
-- · 제휴사 프로필 링크·제휴 콘텐츠 측정(partner_content_viewed)은 그대로 공개 제휴사만 — 비공개 제휴사 배지는 링크 없는 글자.

alter table public.articles add column partner_badge_name text;

comment on column public.articles.partner_badge_name is '공동 기획 배지의 제휴사 이름 (ART-10) — label=co_planned이면 제휴사 이름, 아니면 null. 트리거가 계산한다(직접 못 바꾼다)';

create function public.articles_partner_badge() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.label = 'co_planned' and new.partner_id is not null then
    select p.name into new.partner_badge_name from public.partners p where p.id = new.partner_id;
  else
    new.partner_badge_name := null;
  end if;
  return new;
end;
$$;

revoke all on function public.articles_partner_badge() from public, anon, authenticated;

create trigger articles_partner_badge
  before insert or update on public.articles
  for each row execute function public.articles_partner_badge();

-- 제휴사 이름을 고치면 그 제휴사의 공동 기획 기사 배지 이름도 같이 (프로필·카드·상세가 같은 글자)
create function public.partners_badge_sync() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.articles a
     set partner_badge_name = new.name
   where a.partner_id = new.id
     and a.label = 'co_planned'
     and a.partner_badge_name is distinct from new.name;
  return null;
end;
$$;

revoke all on function public.partners_badge_sync() from public, anon, authenticated;

create trigger partners_badge_sync
  after update of name on public.partners
  for each row execute function public.partners_badge_sync();

-- 이미 있는 공동 기획 기사 채우기
update public.articles a
   set partner_badge_name = p.name
  from public.partners p
 where a.partner_id = p.id
   and a.label = 'co_planned'
   and a.partner_badge_name is distinct from p.name;

grant select (partner_badge_name) on table public.articles to anon, authenticated;

-- 공개 기사 뷰 — 앞 칸 그대로 + 배지 이름 (칸은 뒤에만 더한다)
create or replace view public.public_articles
with (security_invoker = true) as
select id, slug, title, summary, body, format, section, content_type, reporting_method, origin, category_id, subtype, solved_case,
  label, partner_id, author_id, lead_media_id, version, first_published_at, substantive_updated_at, updated_reason, update_kind,
  legal_basis_date, tax_lens, digest_id, region_codes, editorial_field, public_question, amendment_id, legacy_url, legacy_source,
  reported_approved, series_title, series_episode, partner_badge_name
from public.articles
where status = 'published' and lead_media_cleared and not is_paid;
