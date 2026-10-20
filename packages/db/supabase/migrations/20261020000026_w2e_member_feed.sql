-- W2-e 3-A: 내 관심 분야 새 글 (HOME-07, docs/dev/W2-e_설계.md 5.2)
-- member_feed(관심 분야, 관심 지역 코드, 일수, 건수) — 공개 기사(발행·대표 이미지 권리 확인·무료) 중 최근 p_days일 안에 처음 발행된 것.
--  · 관심 분야: 4분야 값 = 기사 분야(section), 'section:slug' = 그 하위 분야(categories)
--  · 관심 지역: 시·도 코드(뒤 8자리 0)면 그 시·도와 아래 시·군·구의 지역 태그 기사, 시·군·구면 그 코드의 지역 태그 기사 (검색 search_public과 같은 규칙)
--  · 분야 조건 또는 지역 조건 — 둘 중 하나만 맞아도 된다. 광고(sponsored)·금주 핫뉴스(digest)·유형 없는 이관 기사는 넣지 않는다
--  · 최신순 p_limit건. analytics_events 등 행동 기록은 읽지 않는다 (행동 추적 개인화 0)
-- 서버가 viewer.userId로 읽은 본인의 관심 값만 넘긴다. service_role만 실행한다 (익명 실행 목록은 늘리지 않는다).
create or replace function public.member_feed(
  p_interests text[],
  p_region_codes text[],
  p_days integer default 14,
  p_limit integer default 6)
returns table (id bigint, slug text, title text, summary text, section text, first_published_at timestamptz, region_codes text[], category_slug text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_interests text[] := coalesce(p_interests, '{}'::text[]);
  v_regions text[] := coalesce(p_region_codes, '{}'::text[]);
begin
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception using errcode = '22023', message = '일수는 1~365여야 합니다';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception using errcode = '22023', message = '건수는 1~50이어야 합니다';
  end if;
  if cardinality(v_interests) = 0 and cardinality(v_regions) = 0 then
    return;
  end if;
  return query
    select a.id, a.slug, a.title, a.summary, a.section, a.first_published_at, a.region_codes, c.slug
      from public.articles a
      left join public.categories c on c.id = a.category_id
     where a.status = 'published' and a.lead_media_cleared and not a.is_paid
       and a.content_type is not null
       and a.content_type not in ('digest', 'sponsored')
       and a.first_published_at >= now() - make_interval(days => p_days)
       and (
         a.section = any (v_interests)
         or (c.slug is not null and (a.section || ':' || c.slug) = any (v_interests))
         or exists (
           select 1 from unnest(a.region_codes) rc, unnest(v_regions) want
            where rc = want or (right(want, 8) = '00000000' and left(rc, 2) = left(want, 2))))
     order by a.first_published_at desc, a.id desc
     limit p_limit;
end;
$$;

revoke all on function public.member_feed(text[], text[], integer, integer) from public, anon, authenticated;
grant execute on function public.member_feed(text[], text[], integer, integer) to service_role;

comment on function public.member_feed(text[], text[], integer, integer) is
  '내 관심 분야 새 글 (W2-e 5.2) — 공개 기사만·최근 p_days일·분야 또는 지역 조건·광고/핫뉴스 제외·최신순. 행동 기록 안 읽음. service_role만 실행';
