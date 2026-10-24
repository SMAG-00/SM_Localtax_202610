import { JsonLd } from "./JsonLd";
import { breadcrumbList, toJsonLdScriptContent } from "@ltr/structured-data";
import { Chip, DevMethodComparison, Eyebrow, TaxLensBox, UiLink } from "@ltr/ui";
import type { DevMethodCrumb } from "@/lib/server/public/dev-methods-logic";
import type { DevMethodDetailView, DevMethodsListView, SpecialLawView } from "@/lib/server/public/dev-methods";
import { ArticleItem } from "./ArticleItem";
import { MeasureCalculatorCards, MeasureView } from "./Measure";
import { ProjectCardView } from "./ProjectView";
import { SiteSection } from "./SiteSection";

// 개발방법 비교 화면 (W4 19단계 — PRD-01B 3.2 '개발방법 비교' · PR-09 · PR-10 · PR-11, docs/dev/W4_설계.md 1장 19단계 · 5장 · 12장 163번~).
//  · 목록 /realestate/development-methods — 강조 문단 '추천하거나 판정하지 않습니다' + 비교표(1024px 이상) / 방법별 탭(그보다 좁게, 가로 스크롤 0) — @ltr/ui DevMethodComparison
//  · 상세 /realestate/development-methods/[method] — 한 줄 설명 → 절차 단계 → 「지방세로 읽기」(서명본) → 관련 프로젝트 → 관련 기사(없으면 줄째 0) → 감수 줄
//  · 입력 폼·점수·순위·추천 배지·정렬 요소 0. 화면 고정 문구에는 숫자가 없다 — 숫자는 전부 서명된 DB 값(scripts/check-fixed-numbers.mjs가 소스를 본다)

const LENS_BOX_KIND = { explainer: "explainer", book: "product", expert: "experts" } as const;

/** 화면 고정 문구 — 숫자 요건·세율·기한을 쓰지 않는다 */
export const DEV_METHODS_COPY = {
  lead: "재개발·재건축 등 개발방법을 같은 비교 항목으로 나란히 놓았습니다. 숫자 요건은 근거 조문과 기준일, 감수한 세무 전문가 이름과 함께 보입니다.",
  reviewPrefix: "감수",
  reviewDatePrefix: "감수일",
  stepsTitle: "절차 단계",
  lensTitle: "지방세로 읽기",
  projectsTitle: "관련 프로젝트",
  articlesTitle: "관련 기사",
  backToList: "개발방법 비교표로",
  othersLabel: "다른 개발방법",
} as const;

function Crumbs({ crumbs }: { crumbs: readonly DevMethodCrumb[] }) {
  return (
    <nav aria-label="현재 위치" data-part="crumbs">
      <ol className="flex flex-wrap items-center gap-x-2 text-[15px]">
        {crumbs.map((c, i) => (
          <li key={c.href} className="inline-flex items-center gap-x-2">
            {i > 0 && (
              <span aria-hidden="true" className="text-navy-300">
                ›
              </span>
            )}
            <UiLink
              href={c.href}
              aria-current={i === crumbs.length - 1 ? "page" : undefined}
              className="inline-flex min-h-11 items-center font-semibold text-navy-600 transition hover:text-hermes-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500 aria-[current=page]:font-bold aria-[current=page]:text-navy-900 [overflow-wrap:anywhere]"
            >
              {c.name}
            </UiLink>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function BreadcrumbJsonLd({ breadcrumb }: { breadcrumb: DevMethodsListView["breadcrumb"] }) {
  const json = breadcrumb ? toJsonLdScriptContent([breadcrumbList(breadcrumb)]) : null;
  return <JsonLd content={json} />;
}

/** 특례법 근거 — 공포 확인과 행 확인이 맞는 행이 있을 때만 그린다(없으면 요소 0). 공포 원문은 링크만, 특례법 이름·요건 글자는 DB 값 그대로 */
function SpecialLawNote({ law }: { law: SpecialLawView | null }) {
  if (!law) return null;
  return (
    <aside data-part="special-law" aria-label="특례법 근거" className="mt-8 rounded-xl border border-navy-100 bg-white p-4 text-[15px] text-navy-800">
      <h2 className="text-[17px] font-black text-navy-900">특례법 근거</h2>
      <ul className="mt-2 list-disc pl-5">
        {law.items.map((i, n) => (
          <li key={`${i.slug}-${n}`} data-special-law-item={i.slug} className="[overflow-wrap:anywhere]">
            {i.method} · {i.label}
          </li>
        ))}
      </ul>
      <p className="mt-2 font-mono text-[13px] text-navy-600">
        공포일 {law.promulgatedOn} · <a className="underline" href={law.promulgationUrl} rel="noopener noreferrer" target="_blank">공포 원문</a>
      </p>
    </aside>
  );
}

export function DevMethodsList({ view }: { view: DevMethodsListView }) {
  return (
    <div data-ui="dev-methods-list" data-method-count={String(view.methods.length)}>
      <BreadcrumbJsonLd breadcrumb={view.breadcrumb} />
      <SiteSection id="dev-methods-head" tone="ivory" first data={{ "data-dev-methods-part": "head" }}>
        <Crumbs crumbs={view.crumbs} />
        <div className="mt-6">
          <Eyebrow>DEVELOPMENT METHODS</Eyebrow>
          <h1 className="mt-3 text-[32px] leading-tight font-black tracking-tight text-navy-900 sm:text-[40px]">개발방법 비교</h1>
          <p className="mt-4 max-w-2xl text-[17px] text-navy-700">{DEV_METHODS_COPY.lead}</p>
        </div>
      </SiteSection>
      <SiteSection id="dev-methods-compare" tone="ivory-dark" data={{ "data-dev-methods-part": "compare" }}>
        <DevMethodComparison methods={view.comparison} />
        <SpecialLawNote law={view.specialLaw} />
        {view.review && (
          <p data-part="review-line" className="mt-8 font-mono text-[13px] text-navy-600 [overflow-wrap:anywhere]">
            {`${DEV_METHODS_COPY.reviewPrefix} ${view.review.reviewers.join(", ")} · ${DEV_METHODS_COPY.reviewDatePrefix} ${view.review.reviewedOn}`}
          </p>
        )}
      </SiteSection>
    </div>
  );
}

export function DevMethodDetail({ view }: { view: DevMethodDetailView }) {
  const m = view.method;
  return (
    <div data-ui="dev-method-detail" data-method={m.slug}>
      <BreadcrumbJsonLd breadcrumb={view.breadcrumb} />
      {/* 측정 (W4 24단계) — 상세를 열면 dev_method_viewed 1건(방법 slug). 공용 연결 카드가 놓이면 calculator_card_clicked(dev_method)로 센다 */}
      <MeasureView name="dev_method_viewed" section="realestate" props={{ method: m.slug }} />
      <MeasureCalculatorCards screen="dev_method" section="realestate" />
      <SiteSection id="dev-method-head" tone="ivory" first data={{ "data-dev-method-part": "head" }}>
        <Crumbs crumbs={view.crumbs} />
        <div className="mt-6">
          <Eyebrow>DEVELOPMENT METHOD</Eyebrow>
          <h1 className="mt-3 flex flex-wrap items-center gap-3 text-[32px] leading-tight font-black tracking-tight text-navy-900 sm:text-[40px]">
            {m.name}
            {m.kind === "planning_support" && <Chip>계획 지원 절차</Chip>}
          </h1>
          <p className="mt-4 max-w-2xl text-[17px] text-navy-700 [overflow-wrap:anywhere]">{m.summary}</p>
          {m.legalBasisName && (
            <p data-part="legal-basis" className="mt-3 text-[15px] text-navy-600 [overflow-wrap:anywhere]">
              {m.legalBasisName}
            </p>
          )}
          <p className="mt-6">
            <UiLink href="/realestate/development-methods" className="inline-flex min-h-11 items-center font-bold text-navy-900 underline decoration-hermes-500 decoration-2 underline-offset-4">
              {DEV_METHODS_COPY.backToList}
            </UiLink>
          </p>
        </div>
      </SiteSection>
      <SiteSection id="dev-method-steps" tone="ivory-dark" heading={{ eyebrow: "PROCESS", title: DEV_METHODS_COPY.stepsTitle }} data={{ "data-dev-method-part": "steps" }}>
        <ol data-part="steps" className="mt-8 space-y-3">
          {m.steps.map((s, i) => (
            <li key={s} className="flex items-baseline gap-3 rounded-xl border border-navy-100 bg-white p-4 text-[16px] text-navy-900">
              <span className="font-mono text-[13px] font-bold text-navy-600">{i + 1}</span>
              <span className="[overflow-wrap:anywhere]">{s}</span>
            </li>
          ))}
        </ol>
      </SiteSection>
      {view.lens && (
        <SiteSection id="dev-method-lens" tone="ivory" heading={{ eyebrow: "LOCAL TAX", title: DEV_METHODS_COPY.lensTitle }} data={{ "data-dev-method-part": "lens" }}>
          <div className="mt-8" data-method-lens={m.slug}>
            <TaxLensBox
              taxes={view.lens.topics}
              points={view.lens.points}
              links={Object.fromEntries(view.lens.links.map((l) => [LENS_BOX_KIND[l.kind], { href: l.href, enabled: true }]))}
              reviewer={view.lens.reviewer}
              basisDate={view.lens.basisDate}
              label={m.name}
            />
          </div>
        </SiteSection>
      )}
      {view.projects.length > 0 && (
        <SiteSection id="dev-method-projects" tone="ivory-dark" heading={{ eyebrow: "PROJECTS", title: DEV_METHODS_COPY.projectsTitle }} data={{ "data-dev-method-part": "projects" }}>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {view.projects.map((c) => (
              <li key={c.id} className="flex">
                <ProjectCardView card={c} headingLevel={3} />
              </li>
            ))}
          </ul>
        </SiteSection>
      )}
      {view.articles.length > 0 && (
        <SiteSection id="dev-method-articles" tone="ivory" heading={{ eyebrow: "NEWS", title: DEV_METHODS_COPY.articlesTitle }} data={{ "data-dev-method-part": "articles" }}>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2">
            {view.articles.map((a) => (
              <li key={a.id} data-article-id={a.id} className="flex">
                <ArticleItem item={a} withModified />
              </li>
            ))}
          </ul>
        </SiteSection>
      )}
      <SiteSection id="dev-method-others" tone="ivory-dark" data={{ "data-dev-method-part": "others" }}>
        <nav aria-label={DEV_METHODS_COPY.othersLabel}>
          <ul className="flex flex-wrap gap-2">
            {view.others.map((o) => (
              <li key={o.slug}>
                <UiLink href={o.href} className="inline-flex min-h-11 items-center rounded-md border border-navy-100 bg-white px-3 text-[15px] font-bold text-navy-700 hover:border-hermes-400">
                  {o.name}
                </UiLink>
              </li>
            ))}
          </ul>
        </nav>
        <SpecialLawNote law={view.specialLaw} />
        <p data-part="review-line" className="mt-8 font-mono text-[13px] text-navy-600 [overflow-wrap:anywhere]">
          {`${DEV_METHODS_COPY.reviewPrefix} ${m.reviewer} · ${DEV_METHODS_COPY.reviewDatePrefix} ${m.reviewedOn}`}
        </p>
      </SiteSection>
    </div>
  );
}
