import { breadcrumbList, toJsonLdScriptContent } from "@ltr/structured-data";
import { Chip, Eyebrow, ProjectStageTimeline, SourceLine, TaxLensBox, UiLink, cx, type ProjectStage } from "@ltr/ui";
import { lensFor, type FilterChip, type ProjectCard, type ProjectCrumb, type StageLensView, type TimelineStage } from "@/lib/server/public/project-logic";
import type { ProjectDetailView, ProjectListView } from "@/lib/server/public/projects";
import { ArticleItem } from "./ArticleItem";
import { OfficialLinkCard, linkSiteLabel } from "./OfficialLinkCard";
import { SiteSection, TEXT_LINK } from "./SiteSection";

// 프로젝트 트래커 화면 (W4 15단계 — PRD-01B 3.2 '프로젝트 트래커' · PR-01 · PR-02 · PR-03 · PR-05, docs/dev/W4_설계.md 5장 · 12장 120번~).
//  · 목록 /realestate/projects — 거르개(지역·사업 유형·현재 단계 — 링크 칩, JS 없이) · 프로젝트 카드(지역 이름·코드·유형·현재 단계·출처·기준일·확인일) · 데이터 출처 줄
//  · 상세 /realestate/projects/[slug] — 지역 칩·사업 유형 칩·현재 단계 배지 → 단계 타임라인(첫 단계 … 마지막 단계, 권리 칩 없는 변형 — 고시 번호·고시일·확인일 고정폭 ·
//    [원문 보기] 새 창 · 공공누리 유형 · `검토 중`, 같은 내용의 표) → 확인된 연결 → 관련 기사 → 데이터 출처 줄
//  · 가격·분양가·분담금·수익률·시세 요소 0 (PR-05 — 공개 뷰에 칸이 없다). 원문 본문 전재 0(링크만 — #19). 이동 줄 = BreadcrumbList(같은 값)
//  · 단계별 「지방세로 읽기」(16단계 — PR-08) — 서명된 템플릿이 있는 단계 카드 아래에만 박스(CORE-01 TaxLensBox — 세목·포인트·해설·도서·전문가 링크·감수·기준일)와
//    SM 취득세 카드(공용 카드 — 새 창·noreferrer·저장 주소 그대로·입력값 0, 기능 키·주소가 있을 때만). 없는 단계는 요소 0('준비 중' 0). 측정은 24단계

/** 이동 줄 (홈 > 부동산 > 프로젝트 트래커 > 이름) — 구조화 데이터와 같은 값 */
function Crumbs({ crumbs }: { crumbs: readonly ProjectCrumb[] }) {
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

function JsonLd({ view }: { view: { breadcrumb: ProjectListView["breadcrumb"] } }) {
  const json = view.breadcrumb ? toJsonLdScriptContent([breadcrumbList(view.breadcrumb)]) : null;
  return json ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} /> : null;
}

/** 프로젝트 카드 — 지자체 허브 ③·목록이 같은 카드. 칸(지역·단계·출처·기준일)이 빈 카드는 만들지 않는다(project-logic projectCard) */
export function ProjectCardView({ card, headingLevel = 3 }: { card: ProjectCard; headingLevel?: 2 | 3 }) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <article
      data-project-card={card.slug}
      data-region-code={card.region.code}
      data-stage={card.stage.key}
      data-source={card.source}
      data-base-date={card.stage.noticeDate}
      data-verified={card.verifiedOn}
      className="relative flex h-full w-full flex-col rounded-2xl border border-navy-100 bg-white p-6 transition hover:border-hermes-400"
    >
      <p className="flex flex-wrap gap-2">
        <Chip>
          {card.region.name} <span className="ml-1 font-mono font-normal tracking-wide">{card.region.code}</span>
        </Chip>
        <Chip>{card.type.label}</Chip>
        {card.landmark && <Chip>대표 프로젝트</Chip>}
      </p>
      <H className="mt-3 text-[19px] leading-snug font-black text-navy-900 [overflow-wrap:anywhere]">
        {/* 카드 전체가 상세 링크 (기사 카드와 같은 문법 — 터치 영역 = 카드) */}
        <UiLink
          href={card.href}
          className="underline-offset-4 after:absolute after:inset-0 after:rounded-2xl after:content-[''] hover:underline focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-hermes-500"
        >
          {card.name}
        </UiLink>
      </H>
      <p className="mt-2 text-[15px] text-navy-700">
        현재 단계 <strong className="font-bold text-navy-900">{card.stage.label}</strong>
      </p>
      <p data-part="card-source" className="mt-auto pt-3 font-mono text-[13px] tracking-wide text-navy-600 [overflow-wrap:anywhere]">
        출처 {card.source} · 기준일 {card.stage.noticeDate} · 확인일 {card.verifiedOn}
      </p>
    </article>
  );
}

function ChipRow({ label, chips, part }: { label: string; chips: readonly FilterChip[]; part: string }) {
  if (chips.length === 0) return null;
  return (
    <div data-part={part} className="mt-6">
      <p className="text-[13px] font-bold text-navy-600">{label}</p>
      <ul aria-label={label} className="mt-2 flex flex-wrap gap-2">
        {chips.map((c) => (
          <li key={c.value ?? "all"}>
            <UiLink
              href={c.href}
              aria-current={c.current ? "true" : undefined}
              data-filter-value={c.value ?? ""}
              className={cx(
                "inline-flex min-h-11 items-center rounded-md border px-3 text-[15px] font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500",
                c.current ? "border-navy-900 bg-navy-900 text-white" : "border-navy-100 bg-white text-navy-700 hover:border-hermes-400",
              )}
            >
              {c.label}
              {c.value !== null && <span className="ml-1.5 font-mono text-[13px] font-normal">{c.count}</span>}
            </UiLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProjectList({ view }: { view: ProjectListView }) {
  return (
    <div data-ui="project-list" data-project-total={String(view.total)}>
      <JsonLd view={view} />
      <SiteSection id="projects-head" tone="ivory" first data={{ "data-project-part": "head" }}>
        <Crumbs crumbs={view.crumbs} />
        <div className="mt-6">
          <Eyebrow>PROJECTS</Eyebrow>
          <h1 className="mt-3 text-[32px] leading-tight font-black tracking-tight text-navy-900 sm:text-[40px]">프로젝트 트래커</h1>
          <p className="mt-4 max-w-2xl text-[17px] text-navy-700">지역 개발 프로젝트의 단계를 고시 원문으로 확인합니다.</p>
        </div>
      </SiteSection>
      <SiteSection id="projects-list" tone="ivory-dark" data={{ "data-project-part": "list" }}>
        <div data-part="filters">
          <ChipRow label="지역" chips={view.chips.regions} part="filter-region" />
          <ChipRow label="사업 유형" chips={view.chips.types} part="filter-type" />
          <ChipRow label="현재 단계" chips={view.chips.stages} part="filter-stage" />
        </div>
        {view.items.length === 0 ? (
          <p data-part="empty" className="mt-10 text-[17px] text-navy-600">
            {view.total === 0 ? "공개된 프로젝트가 아직 없습니다." : "고른 조건의 프로젝트가 없습니다."}
          </p>
        ) : (
          <ul data-part="project-cards" className="mt-10 grid gap-4 sm:grid-cols-2">
            {view.items.map((c) => (
              <li key={c.id} className="flex">
                <ProjectCardView card={c} headingLevel={2} />
              </li>
            ))}
          </ul>
        )}
        {view.sourceLine && (
          <div data-project-part="source" className="mt-12">
            <SourceLine source={view.sourceLine.source} baseDate={view.sourceLine.baseDate} checkedAt={view.sourceLine.checkedAt} />
          </div>
        )}
      </SiteSection>
    </div>
  );
}

const LENS_BOX_KIND = { explainer: "explainer", book: "product", expert: "experts" } as const;

/** 단계별 「지방세로 읽기」 박스 + SM 취득세 카드 (PR-08 — 카드는 박스가 있을 때만) */
function StageLens({ stageKey, stage, lens, sm }: { stageKey: string; stage: string; lens: StageLensView; sm: ProjectDetailView["sm"] }) {
  const links = Object.fromEntries(lens.links.map((l) => [LENS_BOX_KIND[l.kind], { href: l.href, enabled: true }]));
  return (
    <div data-stage-lens={stageKey} className="space-y-3">
      <TaxLensBox taxes={lens.topics} points={lens.points} links={links} reviewer={lens.reviewer} basisDate={lens.basisDate} label={`${stage} 단계`} />
      {sm && (
        <ul data-part="lens-sm-card" aria-label={`${stage} 단계 세금 계산기 (별도 사이트)`}>
          <OfficialLinkCard card={sm.card} site={linkSiteLabel(sm.card.kind)} fallbacks={sm.fallbacks} rank={1} />
        </ul>
      )}
    </div>
  );
}

/** 타임라인 단계 → UI 컴포넌트 값 (기록 없는 단계·해당 없음은 기록 0). lenses가 있으면 서명된 템플릿 단계 아래에 박스 */
export function timelineStages(timeline: readonly TimelineStage[], lenses: ProjectDetailView["lenses"] = {}, sm: ProjectDetailView["sm"] = null): ProjectStage[] {
  return timeline.map((s) => ({
    name: s.label,
    ...(s.record
      ? {
          record: {
            noticeNo: s.record.noticeNo,
            noticeDate: s.record.noticeDate,
            agency: s.record.issuer,
            sourceUrl: s.record.sourceUrl,
            checkedAt: s.record.checkedOn,
            underReview: s.record.underReview,
            ...(s.record.licenseLabel ? { license: s.record.licenseLabel } : {}),
          },
        }
      : {}),
    ...(s.status === "not_applicable" ? { notApplicable: true } : {}),
    ...(lensFor(s, lenses) ? { after: <StageLens stageKey={s.key} stage={s.label} lens={lensFor(s, lenses)!} sm={sm} /> } : {}),
  }));
}

export function ProjectDetail({ view }: { view: ProjectDetailView }) {
  const c = view.card;
  return (
    <div data-ui="project-page" data-project={c.slug} data-project-stage={c.stage.key} data-source-recorded={String(view.coverage.recorded)} data-source-linked={String(view.coverage.linked)}>
      <JsonLd view={view} />
      <SiteSection id="project-head" tone="ivory" first data={{ "data-project-part": "head" }}>
        <Crumbs crumbs={view.crumbs} />
        <div className="mt-6">
          <Eyebrow>PROJECT</Eyebrow>
          <h1 className="mt-3 text-[32px] leading-tight font-black tracking-tight text-navy-900 [overflow-wrap:anywhere] sm:text-[40px]">{c.name}</h1>
          <p data-part="project-chips" className="mt-5 flex flex-wrap gap-2">
            {c.region.href ? (
              <UiLink href={c.region.href} className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500">
                <Chip className="min-h-11 transition hover:border-hermes-400">
                  {c.region.name} <span className="ml-1 font-mono font-normal tracking-wide">{c.region.code}</span>
                </Chip>
              </UiLink>
            ) : (
              <Chip className="min-h-11">
                {c.region.name} <span className="ml-1 font-mono font-normal tracking-wide">{c.region.code}</span>
              </Chip>
            )}
            <Chip className="min-h-11">{c.type.label}</Chip>
            <span data-part="current-stage" className="inline-flex min-h-11 items-center rounded-md bg-navy-900 px-3 text-[13px] font-bold text-white">
              현재 단계 {c.stage.label}
            </span>
          </p>
          {c.summary && <p className="mt-6 max-w-2xl text-[17px] leading-8 text-navy-700 [overflow-wrap:anywhere]">{c.summary}</p>}
        </div>
      </SiteSection>
      <SiteSection id="project-timeline" tone="ivory-dark" data={{ "data-project-part": "timeline" }}>
        <ProjectStageTimeline stages={timelineStages(view.timeline, view.lenses, view.sm)} title="단계 타임라인" />
        <p className="mt-6 text-[15px] text-navy-600">단계마다 고시 원문 링크만 둡니다. 원문 내용은 고시 기관 누리집에서 확인하세요.</p>
      </SiteSection>
      {view.links.length > 0 && (
        <SiteSection id="project-links" tone="ivory" heading={{ eyebrow: "LINKS", title: "확인된 연결" }} data={{ "data-project-part": "links" }}>
          <ul className="mt-6 space-y-3">
            {view.links.map((l) => (
              <li key={l.id} data-link-kind={l.kind} data-relation={l.relation} className="rounded-2xl border border-navy-100 bg-white p-5">
                <p className="flex flex-wrap gap-2">
                  <Chip>{l.kindLabel}</Chip>
                  <Chip>{l.relationLabel}</Chip>
                  {l.underReview && <Chip>검토 중</Chip>}
                </p>
                <p className="mt-2">
                  {l.external ? (
                    <a href={l.href} target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
                      {l.title}
                      <span className="sr-only"> (새 창)</span>
                    </a>
                  ) : (
                    <UiLink href={l.href} className={TEXT_LINK}>
                      {l.title}
                    </UiLink>
                  )}
                </p>
                {l.meta && <p className="mt-1 font-mono text-[13px] tracking-wide text-navy-600">{l.meta}</p>}
              </li>
            ))}
          </ul>
        </SiteSection>
      )}
      <SiteSection id="project-articles" tone={view.links.length > 0 ? "ivory-dark" : "ivory"} heading={{ eyebrow: "NEWS", title: "관련 기사" }} data={{ "data-project-part": "articles" }}>
        {view.articles.length === 0 ? (
          <p className="mt-6 text-[17px] text-navy-600">이 프로젝트와 연결된 기사가 아직 없습니다.</p>
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {view.articles.map((a) => (
              <li key={a.id} data-article-id={a.id} className="flex">
                <ArticleItem item={a} withModified />
              </li>
            ))}
          </ul>
        )}
        <div data-project-part="source" className="mt-12">
          <SourceLine source={c.source} baseDate={c.stage.noticeDate} checkedAt={c.verifiedOn} />
        </div>
      </SiteSection>
    </div>
  );
}
