import { FieldHubHead, OPINION_NOTICE, UiLink } from "@ltr/ui";
import type { ColumnListData } from "@/lib/server/public";
import { episodeLabel } from "@/lib/server/public/column-logic";
import { ArticleItem } from "./ArticleItem";
import { ClaimBasisLink } from "./ClaimBasisLink";
import { SiteSection, TEXT_LINK } from "./SiteSection";

// 칼럼 목록 (/tax/columns · /finance/columns — ART-04 · PRD-01A 3장 '칼럼 목록') — 허브와 같은 머리(분야 허브 머리 + 허브 탭) ·
// "의견이며 개별 자문이 아닙니다" 고지 한 번(TX-16) · 연재마다 회차 순서(1회부터)로 칼럼 카드, 단독 칼럼은 끝에 최신 순. 카드의 필자 이름은 글자,
// 필자 페이지(/people/[slug]) 링크는 묶음 아래 필자 목록에 둔다(카드 전체가 기사 링크라 카드 안에 링크를 겹치지 않는다).
// 칼럼 0건이면 상위 허브 안내 + noindex (화면 metadata가 정한다)

export function ColumnView({ list }: { list: ColumnListData }) {
  const empty = list.total === 0;
  return (
    <div data-ui="column-list" data-section={list.section}>
      <SiteSection id="column-head" tone="ivory" first data={{ "data-hub-part": "head" }}>
        <FieldHubHead field={list.section} eyebrow={list.hub.eyebrow} title={list.category.name} intro={list.category.intro} tabs={{ items: list.tabs, current: list.category.slug, label: "하위 분야" }} />
        <p data-part="opinion-notice" className="mt-6 text-[15px] font-bold text-navy-700">
          {`칼럼 — ${OPINION_NOTICE}`}
        </p>
      </SiteSection>
      <SiteSection id="column-items" tone="ivory-dark" heading={{ eyebrow: "COLUMNS", title: empty ? "아직 칼럼이 없습니다" : `칼럼 ${list.total}편` }} data={{ "data-hub-part": "latest" }}>
        {empty ? (
          <div data-part="empty-guide" className="mt-6 space-y-2">
            <p className="text-[17px] text-navy-700">{`${list.category.name}에는 아직 공개된 칼럼이 없습니다. ${list.hub.name} 허브에서 다른 기사를 보세요.`}</p>
            <UiLink href={list.hub.href} className={TEXT_LINK}>
              {`${list.hub.name} 허브로 가기`}
            </UiLink>
          </div>
        ) : (
          <div className="mt-8 space-y-12">
            {list.groups.map((g, gi) => {
              const writers = [...new Map(g.items.filter((a) => a.authorHref && a.authorName).map((a) => [a.authorHref!, a.authorName!])).entries()];
              // 시그니처 연재 제목에 경력 연수 표기가 있으면 근거 링크를 제목 옆에 늘 함께 (W3 8단계 — 연재 틀이 입힌 카드만 갖는다)
              const basisHref = g.items.find((a) => a.seriesBasisHref)?.seriesBasisHref ?? null;
              const headingId = `column-group-${gi}`;
              return (
                <section key={g.series ?? "single"} data-column-series={g.series ?? ""} aria-labelledby={headingId}>
                  <h3 id={headingId} className="text-[22px] leading-tight font-black text-navy-900">
                    {g.series ? `연재 「${g.series}」` : "단독 칼럼"}
                    {g.series && basisHref && <ClaimBasisLink href={basisHref} />}
                  </h3>
                  <ol data-part="column-articles" className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {g.items.map((a) => (
                      <li key={a.id} data-article-id={a.id} data-episode={a.seriesEpisode ?? ""} className="flex flex-col gap-2">
                        {episodeLabel(a) && <p className="font-mono text-[13px] tracking-wide text-navy-600">{episodeLabel(a)}</p>}
                        <ArticleItem item={a} />
                      </li>
                    ))}
                  </ol>
                  {writers.length > 0 && (
                    <p className="mt-3 flex flex-wrap items-center gap-x-4 text-[15px] text-navy-700">
                      <span>필자</span>
                      {writers.map(([href, name]) => (
                        <UiLink key={href} href={href} data-part="writer-link" className={TEXT_LINK}>
                          {name}
                        </UiLink>
                      ))}
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </SiteSection>
    </div>
  );
}
