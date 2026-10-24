-- W8 2단계 — 스토어 측정 이벤트 · 클릭 집계 (PRD-01C BIZ-09, docs/dev/W8_설계.md 1장 2단계 · 2장 · 11장, W2-c 설계 2.1~2.3)
-- · analytics_events.name 제약에 이벤트 2개를 더한다: product_clicked(자사 상품 카드·스토어 카드 누름) · order_link_clicked(주문 링크·문의 링크 누름).
--   속성 칸은 수집 API(apps/web/lib/analytics/events.ts)가 이벤트마다 정해진 칸만 받는다 - product_id · placement · mode · article_id. 가격·이름·주소 칸 없음.
-- · store_click_summary - 기간 안의 두 이벤트를 상품 x 위치 x 출처 기사로 센다. 봇·편집국 세션 제외. service_role 전용 (수익 대시보드가 읽는다).
--   금액·공헌이익은 1단계에 없다 (결제 없음, 비용 정의 미정).
-- 기존 표 칸·제약·값은 바꾸지 않고 더하기만 한다 (이름 제약은 값 2개를 더한 같은 이름 제약으로 바꾼다).
alter table public.analytics_events drop constraint analytics_events_name_check;
alter table public.analytics_events add constraint analytics_events_name_check check (name in (
  'home_entry_clicked', 'hub_viewed', 'article_viewed', 'article_engaged', 'article_shared', 'search_submitted', 'glossary_opened',
  'situation_card_clicked', 'next_action_clicked', 'hot_article_clicked', 'popular_article_clicked', 'video_played',
  'partner_content_viewed', 'signup_completed', 'brief_preregistered', 'inquiry_submitted', 'policy_page_viewed',
  'redirect_hit', 'not_found_viewed',
  'calculator_card_clicked', 'amendment_viewed', 'interpretation_viewed',
  'region_viewed', 'regional_news_opened', 'regional_source_opened', 'region_to_tax_clicked', 'region_to_realestate_clicked',
  'project_viewed', 'dev_method_viewed',
  'product_clicked', 'order_link_clicked'));

create function public.store_click_summary(p_from timestamptz, p_to timestamptz)
returns table (product_id bigint, placement text, article_id bigint, card_clicks bigint, order_clicks bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select (e.props ->> 'product_id')::bigint as product_id,
         e.props ->> 'placement' as placement,
         case when e.props ->> 'article_id' ~ '^[0-9]+$' then (e.props ->> 'article_id')::bigint end as article_id,
         count(*) filter (where e.name = 'product_clicked') as card_clicks,
         count(*) filter (where e.name = 'order_link_clicked') as order_clicks
    from public.analytics_events e
   where e.name in ('product_clicked', 'order_link_clicked')
     and e.occurred_at >= p_from and e.occurred_at < p_to
     and not e.is_bot and not e.is_staff
     and e.props ->> 'product_id' ~ '^[0-9]+$'
     and e.props ->> 'placement' in ('article', 'home', 'store')
   group by 1, 2, 3
   order by 1, 2, 3 nulls first;
$$;
revoke all on function public.store_click_summary(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.store_click_summary(timestamptz, timestamptz) to service_role;
