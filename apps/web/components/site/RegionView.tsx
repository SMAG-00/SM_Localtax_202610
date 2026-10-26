import { JsonLd } from "./JsonLd";
import { breadcrumbList, toJsonLdScriptContent } from "@ltr/structured-data";
import { FieldTaxPoint, LocalHubBlocks, RegionHubHead, SourceLine, TopicFilter, UiLink, type HubBlockContent } from "@ltr/ui";
import type { RegionPage } from "@/lib/server/public";
import type { RegionHubBlock } from "@/lib/server/public/region-hub-logic";
import { ArticleItem } from "./ArticleItem";
import { eventsBlockContent, weeklyBlockContent } from "./LocalNewsViews";
import { MeasureCalculatorCards, MeasureRegionHub, MeasureView } from "./Measure";
import { OfficialSourceCardView } from "./OfficialSourceCardView";
import { ProjectCardView } from "./ProjectView";
import { RegionTaxLinksBlock } from "./RegionTaxLinksBlock";
import { SUPPLY_COPY, SupplyCardView } from "./SupplyView";
import { SiteSection, TEXT_LINK } from "./SiteSection";

// 지역 화면 = 지자체 허브 (/local/[sido] · /local/[sido]/[sigungu] — W4 3·4단계 · LG-08 · REG1-02 · REG1-01 · REG1-12 · REG-10).
// 지역 허브 머리(홈 > 지자체뉴스 > 시·도 > 시·군·구 이동·시·군·구 바꾸기) → 지방세 포인트(서명본만) → 분야 필터(?topic= 링크 — JS 없이 동작)
// → LG-08 블록 ② 지방세·지방재정 ③ 부동산·개발 ⑤ 공식 자료/해설(①④는 W6 — 요소 0, 순서는 @ltr/ui LocalHubBlocks 코드 고정) → 데이터 출처 줄.
// 그 지역 기사가 0건이면 블록 위에 상위 지역 안내(noindex는 화면 metadata가 정한다). 빈 카드·'준비 중' 0. 명소·맛집·지도 0.
// 구조화 데이터 BreadcrumbList는 화면 이동 줄과 같은 값(regionCrumbs)으로 생성기가 만든다 (OPT-02).
// W4 9단계 — ⑤ 공식 자료/해설 = 묶음 '공식 자료 원문'(검수 공식 자료 카드 — 원문 블록, 기사 상세와 같은 카드)과 '감수 해설'(해석 — 기사 카드).
// 지역 세금 연결 블록은 RegionHubHead taxLinks 자리(⑤ 뒤). 3단계 자리(정비사업 현황·조례 원문)는 W4에 그릴 내용 0 — 요소 0.
// W4 15단계 — ③ 부동산·개발 안 묶음 '프로젝트'(그 지역 범위의 공개 프로젝트 카드 ≤ 4 — 지역·단계·출처·기준일, 기능 키 realestate_projects 꺼짐 → 요소 0)와 더 보기(목록 지역 거르개).
// W4 17단계 — ③ 안 묶음 '분양 정보'(그 지역 범위의 청약 마감 전 공개 항목 카드 ≤ 4 — 지역·청약 단계·출처·기준일, 기능 키 supply_notices 꺼짐 → 요소 0)와 묶음마다 더 보기.

/** ③ 프로젝트 묶음 글자 (W4 15단계) */
export const PROJECT_GROUP = { title: "프로젝트", note: "단계마다 고시 원문을 확인한 프로젝트입니다.", more: "이 지역 프로젝트 더 보기" } as const;
/** ③ 분양 정보 묶음 글자 (W4 17단계 — 정보 목록, 기사 아님) */
export const SUPPLY_GROUP = { title: "분양 정보", note: SUPPLY_COPY.groupNote, more: SUPPLY_COPY.groupMore } as const;

/** ⑤ 묶음 글자 */
export const OFFICIAL_GROUPS = {
  sources: { title: "공식 자료 원문", note: "발표기관이 낸 원자료입니다. 해석은 아래 감수 해설과 각 기사에서 읽습니다." },
  explainers: { title: "감수 해설" },
} as const;

/** 블록 한 칸 — 기사 카드(기자·발행/수정일), 상위 시·도 대체 문장, 0건 문장 */
function blockContent(block: RegionHubBlock | undefined): HubBlockContent | undefined {
  if (!block) return undefined;
  if (block.key === "official") {
    return {
      items: [],
      groups: [
        {
          key: "sources",
          ...OFFICIAL_GROUPS.sources,
          items: block.sources.map((c) => <OfficialSourceCardView key={c.id} card={c} as="article" articles={c.articles} />),
        },
        {
          key: "explainers",
          ...OFFICIAL_GROUPS.explainers,
          items: block.items.map((a) => (
            <div key={a.id} data-article-id={a.id} {...(a.editorialField ? { "data-article-field": a.editorialField } : {})} className="flex h-full">
              <ArticleItem item={a} withModified />
            </div>
          )),
        },
      ],
      ...(block.empty ? { empty: block.empty } : {}),
    };
  }
  return {
    items: block.items.map((a) => (
      <div key={a.id} data-article-id={a.id} {...(a.editorialField ? { "data-article-field": a.editorialField } : {})} className="flex h-full">
        <ArticleItem item={a} withModified />
      </div>
    )),
    ...(block.projects.length || block.supply.length
      ? {
          groups: [
            {
              key: "projects",
              title: PROJECT_GROUP.title,
              note: PROJECT_GROUP.note,
              items: block.projects.map((p) => <ProjectCardView key={p.id} card={p} />),
              ...(block.projectsMore ? { more: { href: block.projectsMore, label: PROJECT_GROUP.more } } : {}),
            },
            {
              key: "supply",
              title: SUPPLY_GROUP.title,
              note: SUPPLY_GROUP.note,
              items: block.supply.map((c) => <SupplyCardView key={c.id} card={c} />),
              ...(block.supplyMore ? { more: { href: block.supplyMore, label: SUPPLY_GROUP.more } } : {}),
            },
          ],
        }
      : {}),
    ...(block.fallbackNotice ? { fallbackNotice: block.fallbackNotice } : {}),
    ...(block.empty ? { empty: block.empty } : {}),
  };
}

/** 데이터 출처 줄 (REG-10) — 공식 자료가 있으면 출처·기준일·정보 확인일, 없으면 출처 편집국·최신 발행일 */
export function RegionSourceLineView({ line }: { line: RegionPage["source"] }) {
  return "latestPublished" in line ? <SourceLine source={line.source} latestPublished={line.latestPublished} /> : <SourceLine source={line.source} baseDate={line.baseDate} checkedAt={line.checkedAt} />;
}

/** 더 보기 링크 주소 → 도착 종류 (프로젝트 더 보기·분양 더 보기) — region_to_realestate_clicked의 target */
function moreTargetsOf(blocks: readonly RegionHubBlock[]): Record<string, "project_list" | "supply_list"> {
  const out: Record<string, "project_list" | "supply_list"> = {};
  for (const b of blocks) {
    if ("projectsMore" in b && b.projectsMore) out[b.projectsMore] = "project_list";
    if ("supplyMore" in b && b.supplyMore) out[b.supplyMore] = "supply_list";
  }
  return out;
}

export function RegionView({ page, stage3 }: { page: RegionPage; stage3?: React.ReactNode }) {
  const jsonLd = page.breadcrumb ? toJsonLdScriptContent([breadcrumbList(page.breadcrumb)]) : null;
  const find = (key: RegionHubBlock["key"]) => page.blocks.find((b) => b.key === key);
  return (
    <div
      data-ui="region-page"
      data-region={page.code}
      data-region-level={page.level}
      data-region-empty={page.empty ? "true" : "false"}
      data-region-topic={page.topic ?? "all"}
      // 이 주소의 검색 노출 제외(화면 metadata와 같은 값) — 루트가 운영 전환 전 모두 noindex라 meta만으로는 구별되지 않는다
      data-region-noindex={page.noindex ? "true" : "false"}
      // 제외 사유 (W4 11단계 — empty 빈 지역 · topic_empty 고른 분야 0건 · below_minimum 최소선 미달 — 이 순서로 하나, 없으면 빈 글자)
      data-region-noindex-reason={page.noindexReason ?? ""}
      // 최소선 판정 (색인 대상 = 두 항목 모두 최소선 이상 — 사이트맵 원본 public_region_index에 있음)
      data-region-indexable={page.indexable ? "true" : "false"}
    >
      {/* 측정 (W4 24단계) — 허브를 열면 region_viewed 1건 · 허브 안 누름 · SM 취득세 카드 누름(calculator_card_clicked region_hub). 그리는 것 0 */}
      <MeasureView name="region_viewed" section="local" props={{ region_code: page.code, level: page.level }} />
      <MeasureRegionHub regionCode={page.code} moreTargets={moreTargetsOf(page.blocks)} />
      <MeasureCalculatorCards screen="region_hub" section="local" />
      <JsonLd content={jsonLd} />
      <SiteSection id="region-head" tone="ivory" first data={{ "data-region-part": "head" }}>
        <RegionHubHead
          sido={page.sido}
          sigungu={page.sigungu ?? undefined}
          sigunguOptions={page.sigunguOptions}
          taxPoint={page.taxPoint ? <FieldTaxPoint points={page.taxPoint.points} basisDate={page.taxPoint.basisDate} links={page.taxPoint.links} /> : undefined}
          filter={<TopicFilter basePath={page.href} topic={page.topic} />}
          blocks={
            <div data-region-part="blocks">
              {page.guide && (
                <div data-part="empty-guide" className="mb-12 space-y-2">
                  <p className="text-[17px] text-navy-700">{page.guide.text}</p>
                  <ul className="flex flex-wrap gap-x-6">
                    {page.guide.links.map((l) => (
                      <li key={l.href}>
                        <UiLink href={l.href} className={TEXT_LINK}>
                          {l.label}
                        </UiLink>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <LocalHubBlocks weekly={page.localNews.weekly ? weeklyBlockContent(page.localNews.weekly) : undefined} events={page.localNews.events ? eventsBlockContent(page.localNews.events) : undefined} localTax={blockContent(find("local_tax"))} realEstate={blockContent(find("realestate"))} sources={blockContent(find("official"))} />
              {stage3}
            </div>
          }
          taxLinks={page.taxLinks ? <RegionTaxLinksBlock view={page.taxLinks} /> : undefined}
        />
        <div data-region-part="source" className="mt-20">
          <RegionSourceLineView line={page.source} />
        </div>
      </SiteSection>
    </div>
  );
}
