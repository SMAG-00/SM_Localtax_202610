import { breadcrumbList, toJsonLdScriptContent } from "@ltr/structured-data";
import { RegionHubHead, UiLink } from "@ltr/ui";
import type { RegionPage } from "@/lib/server/public";
import { ArticleGrid } from "./ArticleItem";
import { SiteSection, TEXT_LINK } from "./SiteSection";

// 지역 화면 (/local/[sido] · /local/[sido]/[sigungu] — W4 3단계 · REG1-01 · REG1-12) — 지역 허브 머리(홈 > 지자체뉴스 > 시·도 > 시·군·구 이동·시·군·구 바꾸기)와
// 그 지역 지자체뉴스 기사. 기사 0건이면 목록 대신 상위 지역 안내(noindex는 화면 metadata가 정한다) — 빈 카드·'준비 중' 0.
// 구조화 데이터 BreadcrumbList는 화면 이동 줄과 같은 값(regionCrumbs)으로 생성기가 만든다 (OPT-02).
// LG-08 블록(②③⑤)·분야 필터·지방세 포인트·지역 세금 연결 블록·데이터 출처 줄은 4·9단계가 이 머리 아래에 더한다.

export function RegionView({ page }: { page: RegionPage }) {
  const jsonLd = page.breadcrumb ? toJsonLdScriptContent([breadcrumbList(page.breadcrumb)]) : null;
  return (
    <div data-ui="region-page" data-region={page.code} data-region-level={page.level} data-region-empty={page.empty ? "true" : "false"}>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />}
      <SiteSection id="region-head" tone="ivory" first data={{ "data-region-part": "head" }}>
        <RegionHubHead sido={page.sido} sigungu={page.sigungu ?? undefined} sigunguOptions={page.sigunguOptions} />
      </SiteSection>
      <SiteSection
        id="region-articles"
        tone="ivory-dark"
        heading={{ eyebrow: "ARTICLES", title: page.empty ? "아직 기사가 없습니다" : `기사 ${page.total}건` }}
        data={{ "data-region-part": "articles" }}
      >
        {page.guide ? (
          <div data-part="empty-guide" className="mt-6 space-y-2">
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
        ) : (
          <ArticleGrid part="region-articles" items={page.articles} />
        )}
      </SiteSection>
    </div>
  );
}
