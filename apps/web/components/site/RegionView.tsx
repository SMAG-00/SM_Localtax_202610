import { breadcrumbList, toJsonLdScriptContent } from "@ltr/structured-data";
import { FieldTaxPoint, LocalHubBlocks, RegionHubHead, SourceLine, TopicFilter, UiLink, type HubBlockContent } from "@ltr/ui";
import type { RegionPage } from "@/lib/server/public";
import type { RegionHubBlock } from "@/lib/server/public/region-hub-logic";
import { ArticleItem } from "./ArticleItem";
import { SiteSection, TEXT_LINK } from "./SiteSection";

// 지역 화면 = 지자체 허브 (/local/[sido] · /local/[sido]/[sigungu] — W4 3·4단계 · LG-08 · REG1-02 · REG1-01 · REG1-12 · REG-10).
// 지역 허브 머리(홈 > 지자체뉴스 > 시·도 > 시·군·구 이동·시·군·구 바꾸기) → 지방세 포인트(서명본만) → 분야 필터(?topic= 링크 — JS 없이 동작)
// → LG-08 블록 ② 지방세·지방재정 ③ 부동산·개발 ⑤ 공식 자료/해설(①④는 W6 — 요소 0, 순서는 @ltr/ui LocalHubBlocks 코드 고정) → 데이터 출처 줄.
// 그 지역 기사가 0건이면 블록 위에 상위 지역 안내(noindex는 화면 metadata가 정한다). 빈 카드·'준비 중' 0. 명소·맛집·지도 0.
// 구조화 데이터 BreadcrumbList는 화면 이동 줄과 같은 값(regionCrumbs)으로 생성기가 만든다 (OPT-02).
// 지역 세금 연결 블록(⑤ 뒤)은 9단계가 RegionHubHead taxLinks 자리에 더한다.

/** 블록 한 칸 — 기사 카드(기자·발행/수정일), 상위 시·도 대체 문장, 0건 문장 */
function blockContent(block: RegionHubBlock | undefined): HubBlockContent | undefined {
  if (!block) return undefined;
  return {
    items: block.items.map((a) => (
      <div key={a.id} data-article-id={a.id} className="flex h-full">
        <ArticleItem item={a} withModified />
      </div>
    )),
    ...(block.fallbackNotice ? { fallbackNotice: block.fallbackNotice } : {}),
    ...(block.empty ? { empty: block.empty } : {}),
  };
}

export function RegionView({ page }: { page: RegionPage }) {
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
    >
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />}
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
              <LocalHubBlocks localTax={blockContent(find("local_tax"))} realEstate={blockContent(find("realestate"))} sources={blockContent(find("official"))} />
            </div>
          }
        />
        <div data-region-part="source" className="mt-20">
          <SourceLine source={page.source.source} latestPublished={page.source.latestPublished} />
        </div>
      </SiteSection>
    </div>
  );
}
