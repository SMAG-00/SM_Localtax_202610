import { Callout, Eyebrow, NextActionBand, Pictogram, SolvedCaseCard, StatusBox, StepTimeline, UiLink, cx } from "@ltr/ui";
import type { RegionChoice, SituationPage } from "@/lib/server/public";
import { SECTION_INFO } from "@/lib/server/public/constants";
import { sectionTones } from "@/lib/site/home-view";
import { regionHref, reviewedLine, situationSteps } from "@/lib/site/hub-view";
import { ArticleGrid, ArticleItem } from "./ArticleItem";
import { TermChipList } from "./GlossaryView";
import { MeasureNextActions } from "./Measure";
import { SiteSection } from "./SiteSection";

// 상황 페이지 (UX-05 · FAM-02 · CAT-03 · PRD-01A 3장) — 아이브로 · 픽토그램 + 상황 제목 · 먼저 확인할 것 3가지(단계 타임라인) ·
// (상속·증여 상황) 일반적 체크리스트와 고지 · 지역 선택 칩(이 상황만) · 자주 틀리는 점(상태 상자, 있을 때만) · 해결 사례 · 기사 · 용어 칩 · 다음 행동 띠.
// 내용 0건인 부분은 빠진다. 부분마다 data-situation-part. 해결 사례는 해결 사례 카드(4칸·결론 배지·근거 — CAT-05)로, 카드 값이 모자란 사례만 기사 카드로 보인다.

type Part = "head" | "checks" | "checklist" | "region" | "mistakes" | "solved" | "articles" | "terms" | "next";

const CHIP_LINK =
  "inline-flex min-h-11 items-center rounded-md border px-3 text-[14px] font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";

function RegionChips({ label, items, selected, base }: { label: string; items: readonly RegionChoice[]; selected: string | null; base: string }) {
  return (
    <ul aria-label={label} className="mt-3 flex flex-wrap gap-2">
      {items.map((r) => {
        const current = r.code === selected;
        return (
          <li key={r.code}>
            <UiLink
              href={regionHref(base, r.code)}
              aria-current={current ? "true" : undefined}
              data-region-code={r.code}
              className={cx(CHIP_LINK, current ? "border-navy-900 bg-navy-900 text-white" : "border-navy-100 bg-ivory text-navy-700 hover:border-hermes-400")}
            >
              {r.name}
            </UiLink>
          </li>
        );
      })}
    </ul>
  );
}

export function SituationView({ page }: { page: SituationPage }) {
  const present: Part[] = ["head", "checks"];
  if (page.checklist) present.push("checklist");
  if (page.regionSelect) present.push("region");
  if (page.mistakes.length) present.push("mistakes");
  if (page.solvedCases.length) present.push("solved");
  if (page.articles.length) present.push("articles");
  if (page.terms.length) present.push("terms");
  if (page.nextActions.length) present.push("next");
  const tones = new Map(sectionTones(present).map((t) => [t.key, t.tone]));
  const tone = (p: Part) => tones.get(p) ?? "ivory";
  const base = page.card.href;
  const reviewed = reviewedLine(page.reviewedOn);

  return (
    <div data-ui="situation-page" data-situation={page.card.slug} data-section={page.section}>
      {/* 다음 행동 띠 누름 → next_action_clicked (W2-c 3단계). 그리는 것 0 */}
      <MeasureNextActions section={page.section} screen="situation" />
      <SiteSection id="situation-head" tone={tone("head")} first data={{ "data-situation-part": "head" }}>
        <Eyebrow>{`SITUATION · ${SECTION_INFO[page.section].eyebrow}`}</Eyebrow>
        <h1 className="mt-4">
          <Pictogram name={page.card.pictogram} label={page.card.title} size={48} layout="start" labelClassName="text-[32px] leading-tight font-black tracking-tight text-navy-900 sm:text-[40px]" />
        </h1>
        {page.card.subtitle && <p className="mt-3 text-[17px] text-navy-600">{page.card.subtitle}</p>}
      </SiteSection>

      <SiteSection id="situation-checks" tone={tone("checks")} heading={{ eyebrow: "CHECK FIRST", title: "먼저 확인할 것" }} data={{ "data-situation-part": "checks" }}>
        <div className="mt-8">
          <StepTimeline label="먼저 확인할 것" steps={situationSteps(page.checks)} />
        </div>
        {reviewed && <p className="mt-4 font-mono text-[13px] tracking-wide text-navy-600">{reviewed}</p>}
      </SiteSection>

      {page.checklist && (
        <SiteSection id="situation-checklist" tone={tone("checklist")} heading={{ eyebrow: "CHECKLIST", title: "일반적인 체크리스트" }} data={{ "data-situation-part": "checklist" }}>
          <ul className="mt-6 list-disc space-y-1 pl-5 text-[17px] text-navy-800">
            {page.checklist.items.map((item, i) => (
              <li key={`${i}-${item}`}>{item}</li>
            ))}
          </ul>
          <Callout className="mt-4">{page.checklist.notice}</Callout>
        </SiteSection>
      )}

      {page.regionSelect && (
        <SiteSection id="situation-region" tone={tone("region")} heading={{ eyebrow: "REGION", title: "지역을 고르면 그 지역 기사를 보여 드립니다" }} data={{ "data-situation-part": "region" }}>
          <RegionChips label="시·도" items={page.regionSelect.sido} selected={page.regionSelect.selected} base={base} />
          {page.regionSelect.sigungu.length > 0 && <RegionChips label="시·군·구" items={page.regionSelect.sigungu} selected={page.regionSelect.selected} base={base} />}
          {page.regionArticles && (
            <div data-part="region-articles" className="mt-8">
              {page.regionArticles.fallbackTo && (
                <p data-part="region-fallback" className="text-[15px] text-navy-600">{`${page.regionArticles.region.name} 기사가 없어 ${page.regionArticles.fallbackTo.name} 기사를 보여 드립니다.`}</p>
              )}
              {page.regionArticles.items.length > 0 ? (
                <ArticleGrid part="region-article-list" items={page.regionArticles.items} />
              ) : (
                <p className="text-[15px] text-navy-600">{`${page.regionArticles.region.name} 기사가 아직 없습니다.`}</p>
              )}
            </div>
          )}
        </SiteSection>
      )}

      {page.mistakes.length > 0 && (
        <SiteSection id="situation-mistakes" tone={tone("mistakes")} data={{ "data-situation-part": "mistakes" }}>
          <StatusBox kind="mistake" title="자주 틀리는 점">
            <ul className="list-disc space-y-1 pl-5">
              {page.mistakes.map((m, i) => (
                <li key={`${i}-${m}`}>{m}</li>
              ))}
            </ul>
          </StatusBox>
        </SiteSection>
      )}

      {page.solvedCases.length > 0 && (
        <SiteSection id="situation-solved" tone={tone("solved")} heading={{ eyebrow: "SOLVED CASES", title: "해결 사례" }} data={{ "data-situation-part": "solved" }}>
          <ul data-part="solved-cases" className="mt-8 grid gap-4 lg:grid-cols-2">
            {page.solvedCases.map((a) => {
              const card = page.solvedCaseCards[a.id];
              return (
                <li key={a.id} data-article-id={a.id} data-solved-card={card ? "true" : "false"} className="flex flex-col">
                  {card ? <SolvedCaseCard title={a.title} href={a.href} situation={card.situation} issue={card.issue} result={card.result} lesson={card.lesson} /> : <ArticleItem item={a} />}
                </li>
              );
            })}
          </ul>
        </SiteSection>
      )}

      {page.articles.length > 0 && (
        <SiteSection id="situation-articles" tone={tone("articles")} heading={{ eyebrow: "ARTICLES", title: "관련 기사" }} data={{ "data-situation-part": "articles" }}>
          <ArticleGrid part="situation-articles" items={page.articles} />
        </SiteSection>
      )}

      {page.terms.length > 0 && (
        <SiteSection id="situation-terms" tone={tone("terms")} heading={{ eyebrow: "GLOSSARY", title: "알아 둘 용어" }} data={{ "data-situation-part": "terms" }}>
          {/* 용어 칩 — 용어사전(기능 키 glossary — W2-d 3단계)이 열렸으면 칩이 그 용어 쪽 링크 */}
          <TermChipList terms={page.terms} className="mt-6 grid gap-3 sm:grid-cols-2" />
        </SiteSection>
      )}

      {page.nextActions.length > 0 && (
        <SiteSection id="situation-next" tone={tone("next")} data={{ "data-situation-part": "next" }}>
          {/* 640px 미만은 띠를 화면 폭으로 펼친다 — 버튼 너비 = 화면 폭 − 32px (UX-06) */}
          <div className="-mx-4 sm:mx-0">
            <NextActionBand similarCases={[]} actions={page.nextActions.map((a) => ({ key: a.key, label: a.label, href: a.href, enabled: true, external: a.external }))} />
          </div>
        </SiteSection>
      )}
    </div>
  );
}
