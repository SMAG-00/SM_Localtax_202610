-- W4 7단계 — 지역 기사 편집 게이트 (PRD-01B REG1-17, docs/dev/W4_설계.md 1장 7단계 · 2.1 · 2.2 · 3장 · 6장 · 12장 #7·#9·#30)
-- 이 파일에 실제 지역·기사·사업자 내용은 없다 — 값 목록과 발행·승인 규칙만 정한다. 발행 서비스(@ltr/editorial checks/regional.ts)와 같은 규칙을 DB가 한 번 더 본다.
-- · articles 칸 더하기 — 소재 종류 subject_kind(general·festival·attraction·commerce, 기본 general) · 관계 유형 relation_types[](예산·세수·공유재산·개발·거래·주거 영향 6종) ·
--     편집자 판정 editorial_judgement(news_candidate·travel_review·restaurant_pick·event_promo) + 판정자 judged_by·시각 judged_at(판정이 있으면 둘 다, 없으면 둘 다 빔) ·
--     다룬 제휴사 covered_partner_ids[](partners 번호 — 광고·협찬 계약 기록이 있는 지역 사업자를 다룬 원고 판정용) · 이해관계 표시 interest_disclosure
-- · 기사 발행 검사 (기사가 published·scheduled가 될 때):
--     ① 지자체뉴스(section = local) 기사는 지역 태그(region_codes)가 있어야 새로 발행·예약된다 — 이미 공개된 적 있는 기사(first_published_at 있음)는 그대로 (W2-b #17 · W4 12장 #30)
--     ② 지역 태그 기사(광고·협찬 sponsored 제외)는 편집 분야(4종)·공익적 질문이 있어야 한다
--     ③ 그 편집 분야에 판정 책임자가 없으면(설정 regional_judge_fields에 없음) 보류(held) — 발행 거부 (W4 12장 #7 권고안)
--     ④ 편집자가 여행 후기·맛집 추천·행사 홍보로 판정한 원고는 reported_news·explainer로 발행 거부 (별도 상품 검토 큐는 8단계 …44)
--     ⑤ 축제·명소·상권 소재 원고(sponsored 제외)는 관계 유형 1개 이상 + 근거(article_evidence, 반려 아님) 1건 이상 — 없으면 기사 후보가 아니다(held)
--     발행일을 넣어 들여오는 공개 행(이관 — first_published_at이 지금보다 앞)은 이미 공개된 기사로 보고 이 검사를 하지 않는다(발행 시각을 지어내지 않는다).
--     공개 중인 보도·해설에 비보도 판정(④)을 거는 것도 거부 — 먼저 내린 뒤 판정한다.
-- · 편집 승인 검사 (editorial_reviews desk_edit approve) — 지역 기사(지역 태그 또는 지자체뉴스, sponsored 제외)는 checklist 3항목
--     evidence(근거)·relation(관계)·ad_independence(광고 독립성)이 모두 true여야 승인 기록이 들어간다. 다룬 제휴사 중 광고·협찬 계약 기록
--     (contract_from·contract_to 중 하나라도)이 있는 곳이 있으면 이해관계 표시(interest_disclosure)가 없을 때 승인 거부 (NAV-06)
-- · 기획(story_assignments)의 subject_kind·relation_types 값 목록 — 새 값부터 검사 (NOT VALID, 1.1)
-- · 설정 씨앗 regional_judge_fields — 판정 책임자가 있는 편집 분야(초기값 4종 전부 = 편집 책임자 역할이 판정, 12장 #7). 비우거나 뺀 분야의 지역 기사는 발행 거부
-- · 기존 표·칸·제약·값은 바꾸지 않는다

-- ─────────────────────────────────────────────────────────────
-- 칸 더하기
-- ─────────────────────────────────────────────────────────────
alter table public.articles
  add column subject_kind text not null default 'general' constraint articles_subject_kind_check
    check (subject_kind in ('general', 'festival', 'attraction', 'commerce')),
  add column relation_types text[] not null default '{}' constraint articles_relation_types_check
    check (relation_types <@ array['budget', 'tax_revenue', 'public_property', 'development', 'transaction', 'housing']::text[]),
  add column editorial_judgement text constraint articles_editorial_judgement_check
    check (editorial_judgement in ('news_candidate', 'travel_review', 'restaurant_pick', 'event_promo')),
  add column judged_by text,
  add column judged_at timestamptz,
  add column covered_partner_ids bigint[] not null default '{}',
  add column interest_disclosure text,
  add constraint articles_judgement_record check (
    (editorial_judgement is null and judged_by is null and judged_at is null)
    or (editorial_judgement is not null and length(btrim(coalesce(judged_by, ''))) > 0 and judged_at is not null));

comment on column public.articles.subject_kind is '소재 종류 (REG1-17) — general 일반 · festival 축제 · attraction 명소 · commerce 상권. 축제·명소·상권은 관계 유형 + 근거가 있어야 기사 후보';
comment on column public.articles.relation_types is '관계 유형 (REG1-17) — budget 예산 · tax_revenue 세수 · public_property 공유재산 · development 개발 · transaction 거래 · housing 주거 영향';
comment on column public.articles.editorial_judgement is '편집자 판정 (REG1-17) — news_candidate 기사 후보 · travel_review 여행 후기 · restaurant_pick 맛집 추천 · event_promo 행사 홍보. 판정은 regional.judge(편집 책임자·관리자)만';
comment on column public.articles.covered_partner_ids is '원고가 다룬 제휴사(partners 번호) — 광고·협찬 계약 기록이 있는 곳을 다루면 이해관계 표시 없이 편집 승인 불가 (REG1-17 · NAV-06)';
comment on column public.articles.interest_disclosure is '이해관계 표시 (NAV-06) — 광고·협찬 계약 기록이 있는 제휴사를 다룬 원고에 필수';

alter table public.story_assignments
  add constraint story_assignments_subject_kind_values
    check (subject_kind is null or subject_kind in ('general', 'festival', 'attraction', 'commerce')) not valid,
  add constraint story_assignments_relation_types_values
    check (relation_types <@ array['budget', 'tax_revenue', 'public_property', 'development', 'transaction', 'housing']::text[]) not valid;

-- ─────────────────────────────────────────────────────────────
-- 설정 씨앗 — 판정 책임자가 있는 편집 분야 (12장 #7 권고안: 편집 책임자 역할이 판정, 1인 체제면 PO)
-- ─────────────────────────────────────────────────────────────
insert into public.settings (key, value, description, updated_by) values
  ('regional_judge_fields',
   '["local_tax", "realestate", "local_finance", "urban_policy"]'::jsonb,
   '판정 책임자가 있는 지역 기사 편집 분야 (REG1-17 · W4 12장 #7) — 지방세·부동산 세금·지방재정·도시/부동산 정책. 목록에 없는 분야의 지역 기사는 보류(held)이고 발행되지 않는다. 판정은 편집 책임자 역할(1인 체제면 관리자·PO)',
   'migration:20261022000043')
on conflict (key) do nothing;

create function public.regional_settings_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_seen text[] := '{}';
begin
  if jsonb_typeof(new.value) is distinct from 'array' or jsonb_array_length(new.value) > 4 then
    raise exception '판정 책임자가 있는 편집 분야(regional_judge_fields)는 편집 분야 0~4개의 목록입니다' using errcode = 'check_violation';
  end if;
  for v_item in select x.value from jsonb_array_elements(new.value) as x loop
    if jsonb_typeof(v_item) is distinct from 'string' or (v_item #>> '{}') not in ('local_tax', 'realestate', 'local_finance', 'urban_policy') then
      raise exception '편집 분야는 local_tax·realestate·local_finance·urban_policy 중 하나입니다 (지금 %)', v_item using errcode = 'check_violation';
    end if;
    if (v_item #>> '{}') = any (v_seen) then
      raise exception '편집 분야 %가 두 번 있습니다', v_item #>> '{}' using errcode = 'check_violation';
    end if;
    v_seen := v_seen || (v_item #>> '{}');
  end loop;
  return new;
end;
$$;
revoke all on function public.regional_settings_guard() from public, anon, authenticated;
create trigger settings_regional_guard
  before insert or update on public.settings
  for each row when (new.key = 'regional_judge_fields')
  execute function public.regional_settings_guard();

-- ─────────────────────────────────────────────────────────────
-- 발행 검사 한 곳 — 첫 문제 문장(없으면 null). p_fresh = 처음 발행(이전에 공개된 적 없음)
-- 글자는 편집 화면 칸 이름 + API 칸 이름 (@ltr/editorial checks/regional.ts와 같은 순서)
-- ─────────────────────────────────────────────────────────────
create function public.regional_publish_problem(p_article public.articles, p_fresh boolean) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_regional boolean := cardinality(p_article.region_codes) > 0;
  v_fields jsonb;
begin
  if p_fresh and p_article.section = 'local' and not v_regional then
    return format('지자체뉴스 기사는 지역 태그(regionCodes)가 있어야 새로 발행할 수 있습니다 (REG1-17 · W4 12장 #30, 기사 %s)', p_article.id);
  end if;
  if v_regional and p_article.content_type is distinct from 'sponsored' then
    if p_article.editorial_field is null then
      return format('지역 태그가 있는 기사는 편집 분야(editorialField — 지방세·부동산 세금·지방재정·도시/부동산 정책 중 하나)가 있어야 발행할 수 있습니다 (REG1-17, 기사 %s)', p_article.id);
    end if;
    if length(btrim(coalesce(p_article.public_question, ''))) = 0 then
      return format('지역 태그가 있는 기사는 공익적 질문(publicQuestion)이 있어야 발행할 수 있습니다 (REG1-17, 기사 %s)', p_article.id);
    end if;
    select s.value into v_fields from public.settings s where s.key = 'regional_judge_fields';
    if not coalesce(jsonb_typeof(v_fields) = 'array' and v_fields ? p_article.editorial_field, false) then
      return format('편집 분야 %s에 판정 책임자가 지정되지 않아 이 지역 기사는 보류(held)입니다 — 설정 regional_judge_fields (REG1-17 · W4 12장 #7, 기사 %s)', p_article.editorial_field, p_article.id);
    end if;
  end if;
  if p_article.content_type in ('reported_news', 'explainer') and p_article.editorial_judgement in ('travel_review', 'restaurant_pick', 'event_promo') then
    return format('편집자가 여행 후기·맛집 추천·행사 홍보(%s)로 판정한 원고는 보도기사·해설로 발행할 수 없습니다 — 별도 상품 검토 큐로 보냅니다 (REG1-17, 기사 %s)', p_article.editorial_judgement, p_article.id);
  end if;
  if p_article.subject_kind in ('festival', 'attraction', 'commerce') and p_article.content_type is distinct from 'sponsored' then
    if cardinality(p_article.relation_types) = 0 then
      return format('축제·명소·상권 소재 원고는 관계 유형(relationTypes — 예산·세수·공유재산·개발·거래·주거 영향) 1개 이상이 있어야 기사 후보가 됩니다 — 지금은 보류(held) (REG1-17, 기사 %s)', p_article.id);
    end if;
    if not exists (select 1 from public.article_evidence e where e.article_id = p_article.id and e.verification_status <> 'rejected') then
      return format('축제·명소·상권 소재 원고는 관계를 뒷받침하는 근거(evidence) 1건 이상이 있어야 기사 후보가 됩니다 — 지금은 보류(held) (REG1-17, 기사 %s)', p_article.id);
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.regional_publish_problem(public.articles, boolean) from public, anon, authenticated;

create function public.articles_regional_gate() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entering boolean;
  v_fresh boolean;
  v_problem text;
  v_missing bigint;
begin
  -- 값 모양 — 관계 유형 같은 값 두 번 0 · 다룬 제휴사는 있는 partners 번호만, 두 번 0
  if cardinality(new.relation_types) <> (select count(distinct x) from unnest(new.relation_types) x) then
    raise exception '관계 유형(relationTypes)에 같은 값이 두 번 있습니다 (REG1-17)' using errcode = 'check_violation';
  end if;
  if cardinality(new.covered_partner_ids) > 0 and (tg_op = 'INSERT' or new.covered_partner_ids is distinct from old.covered_partner_ids) then
    if cardinality(new.covered_partner_ids) <> (select count(distinct x) from unnest(new.covered_partner_ids) x) then
      raise exception '다룬 제휴사(coveredPartnerIds)에 같은 번호가 두 번 있습니다' using errcode = 'check_violation';
    end if;
    select x into v_missing from unnest(new.covered_partner_ids) x
     where not exists (select 1 from public.partners p where p.id = x) limit 1;
    if v_missing is not null then
      raise exception '없는 제휴사 번호입니다: % (coveredPartnerIds)', v_missing using errcode = 'check_violation';
    end if;
  end if;

  v_entering := new.status in ('published', 'scheduled') and (tg_op = 'INSERT' or old.status not in ('published', 'scheduled'));
  if v_entering then
    if tg_op = 'INSERT' then
      -- articles_guard가 먼저 돌아 처음 발행이면 first_published_at = now(). 지금보다 앞선 발행일을 넣어 오는 행은 이관(이미 공개된 기사)
      v_fresh := new.first_published_at is null or new.first_published_at >= now();
    else
      v_fresh := old.first_published_at is null;
    end if;
    if tg_op = 'UPDATE' or v_fresh then
      v_problem := public.regional_publish_problem(new, v_fresh);
      if v_problem is not null then
        raise exception '%', v_problem using errcode = 'check_violation';
      end if;
    end if;
  elsif new.status in ('published', 'scheduled')
        and new.content_type in ('reported_news', 'explainer')
        and new.editorial_judgement in ('travel_review', 'restaurant_pick', 'event_promo')
        and (new.editorial_judgement is distinct from old.editorial_judgement or new.content_type is distinct from old.content_type) then
    raise exception '공개(예약) 중인 보도기사·해설은 여행 후기·맛집 추천·행사 홍보로 판정할 수 없습니다 — 먼저 내린 뒤 판정하세요 (REG1-17, 기사 %)', new.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.articles_regional_gate() from public, anon, authenticated;
create trigger articles_regional_gate
  before insert or update on public.articles
  for each row execute function public.articles_regional_gate();

-- ─────────────────────────────────────────────────────────────
-- 편집 승인 검사 — 지역 기사 checklist 3항목 · 광고 계약 제휴사를 다룬 원고의 이해관계 표시
-- ─────────────────────────────────────────────────────────────
create function public.editorial_reviews_regional_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_article public.articles;
  v_missing text[];
  v_partner text;
begin
  if new.kind <> 'desk_edit' or new.decision <> 'approve' then
    return new;
  end if;
  select * into v_article from public.articles a where a.id = new.article_id;
  if v_article.id is null or v_article.content_type is not distinct from 'sponsored'
     or not (cardinality(v_article.region_codes) > 0 or v_article.section = 'local') then
    return new;
  end if;
  v_missing := array_remove(array[
    case when (new.checklist -> 'evidence') is distinct from 'true'::jsonb then '근거(evidence)' end,
    case when (new.checklist -> 'relation') is distinct from 'true'::jsonb then '관계(relation)' end,
    case when (new.checklist -> 'ad_independence') is distinct from 'true'::jsonb then '광고 독립성(ad_independence)' end
  ], null);
  if cardinality(v_missing) > 0 then
    raise exception '지역 기사 편집 승인에는 근거·관계·광고 독립성 세 항목 확인이 모두 필요합니다 — 빠진 항목: % (REG1-17, 기사 %)', array_to_string(v_missing, '·'), v_article.id
      using errcode = 'check_violation';
  end if;
  select p.name into v_partner from public.partners p
   where p.id = any (v_article.covered_partner_ids) and (p.contract_from is not null or p.contract_to is not null)
   order by p.id limit 1;
  if v_partner is not null and length(btrim(coalesce(v_article.interest_disclosure, ''))) = 0 then
    raise exception '광고·협찬 계약 기록이 있는 제휴사(%)를 다룬 원고는 이해관계 표시(interestDisclosure) 없이 승인할 수 없습니다 (REG1-17 · NAV-06, 기사 %)', v_partner, v_article.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.editorial_reviews_regional_guard() from public, anon, authenticated;
create trigger editorial_reviews_regional_guard
  before insert or update on public.editorial_reviews
  for each row execute function public.editorial_reviews_regional_guard();
