import { pageJsonLd, toJsonLdScriptContent } from "@ltr/structured-data";
import {
  ArticleTypeBadge,
  Chip,
  CorrectionHistory,
  EditorialFieldBadge,
  NextActionBand,
  PartnerBadge,
  ProgressStageBadge,
  ReporterBlock,
  SolvedCaseCard,
  TaxLensBox,
  UiLink,
  UpdateBanner,
  cx,
  type AmendmentStage,
  type CorrectionKind,
  type EditorialFieldBadgeKind,
} from "@ltr/ui";
import type { ArticleDetail } from "@/lib/server/public";
import { ARTICLE_DISCLAIMER, UPDATE_LABEL, articleParts, dateLines, partnerBadgeFor, reporterPolicyLinks, seriesLine, taxLensBoxLinks, typeBadgeFor, type ArticlePart } from "@/lib/site/article-view";
import { formatBadge, sectionTones, type SectionTone } from "@/lib/site/home-view";
import { ArticleBlocks } from "./ArticleBlocks";
import { ArticleGrid } from "./ArticleItem";
import { CardNewsSlider } from "./CardNewsSlider";
import { MeasureArticle } from "./Measure";
import { ShareButton } from "./ShareButton";
import { TEXT_LINK } from "./SiteSection";

// 기사 상세 (/news/[slug] — ART-02 · ART-03 · ART-04 · ART-05 · ART-06 · CAT-05 · CORE-01 · PRD-01A 3장 '기사 상세'·'해결 사례 상세')
// 부분 순서 고정(lib/site/article-view.ts ARTICLE_PARTS) — 부분마다 data-article-part. 내용 0건인 부분은 빠진다(빈 자리 0):
//  머리(분야 칩·유형 배지 또는 제휴 배지·형식 배지·편집 분야 배지 → 제목 → 연재 → 요약 → 기자·날짜 → 공유)
//  → 알림(업데이트 표시 '수정 날짜: 사유' · 갱신 배너 · 정정 이력 블록 — 본문 위, 있을 때만)
//  → 본문(대표 이미지 · 카드뉴스 장 · 해결 사례 카드 · 블록 · 개정 트래커 · 출처) → 「지방세로 읽기」(본문 뒤·기자 소개 앞) → 기자 소개
//  → 자사 상품(01C 전 0) → 면책(면책 대상 하위 분야만) → 관련 기사 → 다음 행동 띠 → 기사 하단 정책 링크(공개 승인된 것만)
// JSON-LD는 화면과 같은 데이터 객체(detail.view)를 structured-data 생성기에 넘긴다 (OPT-02 — 손으로 쓴 JSON-LD 0)

const CORRECTION_KIND: Record<string, CorrectionKind> = { correction: "correction", rebuttal: "rebuttal", follow_up: "follow-up", title_change: "title-change" };
const AMENDMENT_STAGES = new Set<string>(["발표", "입법예고", "국회 제출", "의결", "공포", "시행"]);
const EDITORIAL_FIELDS = new Set<string>(["local_tax", "realestate", "local_finance", "urban_policy"]);
const H2 = "text-[22px] leading-tight font-black tracking-tight text-navy-900";

function Part({ part, tone, first = false, children }: { part: ArticlePart; tone: SectionTone; first?: boolean; children: React.ReactNode }) {
  return (
    <section data-article-part={part} className={cx(!first && "border-t border-navy-100", tone === "ivory" ? "bg-ivory" : "bg-ivory-dark")}>
      <div className="mx-auto max-w-3xl px-4 py-20">{children}</div>
    </section>
  );
}

function Head({ a }: { a: ArticleDetail }) {
  const type = typeBadgeFor(a.contentType, a.sponsor);
  const partner = partnerBadgeFor(a.sponsor);
  const format = formatBadge(a.format);
  const field = a.editorialField && EDITORIAL_FIELDS.has(a.editorialField) ? (a.editorialField as EditorialFieldBadgeKind) : undefined;
  const dates = dateLines(a);
  const series = seriesLine(a.series);
  return (
    <header data-part="article-head">
      <div className="flex flex-wrap items-center gap-2">
        <UiLink href={a.subsection?.href ?? a.sectionHref} className="inline-flex min-h-11 items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500">
          <Chip>{a.subsection ? `${a.sectionName} › ${a.subsection.name}` : a.sectionName}</Chip>
        </UiLink>
        {type && <ArticleTypeBadge type={type} />}
        {partner && <PartnerBadge partner={partner} />}
        {format && (
          <span data-format-badge className="inline-flex items-center rounded-md bg-navy-50 px-2 py-0.5 text-[12px] font-bold text-navy-700">
            {format}
          </span>
        )}
        {field && <EditorialFieldBadge field={field} />}
        {a.regionLabel && <Chip>{a.regionLabel}</Chip>}
      </div>
      <h1 data-part="title" className="mt-5 text-[28px] leading-[1.3] font-black tracking-tight text-navy-900 [overflow-wrap:anywhere] sm:text-[36px]">
        {a.title}
      </h1>
      {series && (
        <p data-part="series" className="mt-3 text-[15px] font-bold text-hermes-800">
          {series}
        </p>
      )}
      {a.summary && <p className="mt-5 text-[17px] leading-relaxed text-navy-700">{a.summary}</p>}
      <div className="mt-6 space-y-1">
        {a.author && (
          <p data-part="byline" className="text-[15px] text-navy-700">
            <span className="mr-1">{a.author.kind === "opinion" ? "필자" : "기자"}</span>
            <UiLink href={a.author.href} className="inline-flex min-h-11 min-w-11 items-center justify-center font-bold text-navy-900 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500">
              {a.author.name}
            </UiLink>
          </p>
        )}
        <p data-part="dates" className="font-mono text-[13px] tracking-wide text-navy-600">
          {dates.published && (
            <span>
              최초 발행{" "}
              <time data-date="published" dateTime={dates.published.iso}>
                {dates.published.text}
              </time>
            </span>
          )}
          {dates.modified && (
            <span>
              <span aria-hidden="true"> · </span>실질 수정{" "}
              <time data-date="modified" dateTime={dates.modified.iso}>
                {dates.modified.text}
              </time>
            </span>
          )}
          {dates.basis && (
            <span>
              <span aria-hidden="true"> · </span>법령 기준일{" "}
              <time data-date="basis" dateTime={dates.basis}>
                {dates.basis}
              </time>
            </span>
          )}
        </p>
      </div>
      <div className="mt-6">
        <ShareButton url={a.share.url} title={a.title} measure={{ articleId: a.id, section: a.section }} />
      </div>
    </header>
  );
}

function Notices({ a }: { a: ArticleDetail }) {
  const banner = a.amendment?.banner;
  return (
    <div className="space-y-6">
      {a.updates.length > 0 && (
        <section data-part="update-notes" aria-label="업데이트 표시">
          <ul className="space-y-2 text-[15px] text-navy-800">
            {a.updates.map((u) => (
              <li key={u.version} data-update-version={u.version} className="border-l-2 border-navy-300 pl-3">
                <span className="font-bold">{`${UPDATE_LABEL} `}</span>
                <time className="font-mono text-[13px] tracking-wide" dateTime={u.date}>
                  {u.date}
                </time>
                {`: ${u.reason}`}
              </li>
            ))}
          </ul>
        </section>
      )}
      {banner && a.amendment?.href && AMENDMENT_STAGES.has(banner.stageLabel) && (
        <UpdateBanner stage={banner.stageLabel as AmendmentStage} changedAt={banner.changedAt} trackerHref={a.amendment.href} articleModifiedAt={a.substantiveUpdatedAt ?? undefined} />
      )}
      <CorrectionHistory entries={a.corrections.flatMap((c) => (CORRECTION_KIND[c.kind] ? [{ id: String(c.id), kind: CORRECTION_KIND[c.kind]!, date: c.date, what: c.what, why: c.why }] : []))} />
    </div>
  );
}

function Body({ a, today }: { a: ArticleDetail; today: string }) {
  return (
    <div data-part="article-body">
      {/* 본문 구역 제목 — 상태 상자·FAQ 제목(h3·h2)이 h1 다음 단계 순서를 지키게 (화면 읽기용) */}
      <h2 className="sr-only">본문</h2>
      {a.leadImage && (
        <figure data-part="lead-figure">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img data-part="lead-image" src={a.leadImage.src} alt={a.leadImage.alt} className="block h-auto w-full rounded-2xl border border-navy-100 bg-white" />
          {a.leadImage.credit && <figcaption className="mt-2 text-[14px] text-navy-600">{`사진·그림 ${a.leadImage.credit}`}</figcaption>}
        </figure>
      )}
      {a.slides.length > 0 && <CardNewsSlider slides={a.slides} title={a.title} />}
      {a.solvedCase && (
        <div data-part="solved-case" className="mt-8">
          <SolvedCaseCard situation={a.solvedCase.situation} issue={a.solvedCase.issue} result={a.solvedCase.result} lesson={a.solvedCase.lesson} />
        </div>
      )}
      <ArticleBlocks blocks={a.blocks} media={a.media} />
      {a.amendment && (
        <aside data-part="amendment" aria-label="이 기사가 다룬 개정안" className="mt-10 rounded-2xl border border-navy-100 bg-white p-6">
          <p className="text-[13px] font-bold text-hermes-800">개정 트래커</p>
          <p className="mt-1 text-[17px] font-black text-navy-900">
            {a.amendment.href ? (
              <UiLink href={a.amendment.href} className="underline-offset-4 hover:underline">
                {a.amendment.title}
              </UiLink>
            ) : (
              a.amendment.title
            )}
          </p>
          <div className="mt-3">
            <ProgressStageBadge events={a.amendment.stage.events} today={today} confirmStage={a.amendment.stage.confirmStage} />
          </div>
        </aside>
      )}
      {a.sources.some((s) => s.title || s.source_name) && (
        <section data-part="sources" aria-labelledby="article-sources" className="mt-10">
          <h2 id="article-sources" className="text-[17px] font-black text-navy-900">
            출처
          </h2>
          <ul className="mt-2 space-y-1 text-[15px] text-navy-700">
            {a.sources
              .filter((s) => s.title || s.source_name)
              .map((s) => (
                <li key={s.id}>
                  {s.source_url && /^https?:\/\//.test(s.source_url) ? (
                    <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-hermes-900">
                      {s.title ?? s.source_name}
                      <span className="sr-only"> (새 창)</span>
                    </a>
                  ) : (
                    (s.title ?? s.source_name)
                  )}
                  {s.title && s.source_name && <span className="text-navy-600">{` · ${s.source_name}`}</span>}
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function ArticleView({ article: a, today }: { article: ArticleDetail; today: string }) {
  const parts = articleParts({ ...a, banner: a.amendment?.banner && a.amendment.href ? a.amendment.banner : null });
  // 바탕은 보이는 부분 순서대로 ivory와 ivory-dark를 번갈아 (머리가 ivory)
  const tones = new Map(sectionTones(parts).map((t) => [t.key, t.tone]));
  const tone = (p: ArticlePart): SectionTone => tones.get(p) ?? "ivory";
  const links = reporterPolicyLinks(a.policyLinks);
  const jsonLd = toJsonLdScriptContent(pageJsonLd({ kind: "article", article: a.view }));

  return (
    <article data-ui="article-page" data-article-id={a.id} data-format={a.format ?? "general"} data-content-type={a.contentType ?? "none"}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      {/* 측정 (W2-c — article_viewed · 30초 article_engaged). 그리는 것 0 */}
      {a.contentType && <MeasureArticle articleId={a.id} section={a.section} format={a.format ?? "general"} contentType={a.contentType} />}
      {parts.map((part) => {
        switch (part) {
          case "head":
            return (
              <Part key={part} part={part} tone={tone(part)} first>
                <Head a={a} />
              </Part>
            );
          case "notices":
            return (
              <Part key={part} part={part} tone={tone(part)}>
                <Notices a={a} />
              </Part>
            );
          case "body":
            return (
              <Part key={part} part={part} tone={tone(part)}>
                <Body a={a} today={today} />
              </Part>
            );
          case "tax-lens":
            return (
              a.taxLens && (
                <Part key={part} part={part} tone={tone(part)}>
                  <TaxLensBox taxes={a.taxLens.topics} points={a.taxLens.points} links={taxLensBoxLinks(a.taxLens.links)} reviewer={a.taxLens.reviewer} basisDate={a.taxLens.basisDate} />
                </Part>
              )
            );
          case "reporter":
            return (
              a.author &&
              a.firstPublishedAt && (
                <Part key={part} part={part} tone={tone(part)}>
                  {a.author.kind === "opinion" ? (
                    <ReporterBlock
                      kind="opinion"
                      interest=""
                      author={{ name: a.author.name, slug: a.author.slug, beat: a.author.beat ?? a.sectionName, bio: a.author.bio.join(" · ") || undefined }}
                      publishedAt={a.firstPublishedAt}
                      modifiedAt={a.substantiveUpdatedAt ?? undefined}
                      correctionHref={links.correctionHref}
                      editorialPolicyHref={links.editorialPolicyHref}
                    />
                  ) : (
                    <ReporterBlock
                      kind={a.author.kind === "explainer" ? "explainer" : a.author.kind === "guide" ? "guide" : "report"}
                      author={{ name: a.author.name, slug: a.author.slug, beat: a.author.beat ?? a.sectionName, bio: a.author.bio.join(" · ") || undefined }}
                      publishedAt={a.firstPublishedAt}
                      modifiedAt={a.substantiveUpdatedAt ?? undefined}
                      correctionHref={links.correctionHref}
                      editorialPolicyHref={links.editorialPolicyHref}
                    />
                  )}
                </Part>
              )
            );
          case "product":
            return null;
          case "disclaimer":
            return (
              <Part key={part} part={part} tone={tone(part)}>
                <p data-part="disclaimer" className="text-[15px] text-navy-700">
                  {ARTICLE_DISCLAIMER}
                </p>
              </Part>
            );
          case "related":
            return (
              <Part key={part} part={part} tone={tone(part)}>
                <h2 className={H2}>관련 기사</h2>
                <ArticleGrid part="related-articles" items={a.related} />
              </Part>
            );
          case "next":
            return (
              <Part key={part} part={part} tone={tone(part)}>
                {/* 640px 미만은 띠를 화면 폭으로 펼친다 — 버튼 너비 = 화면 폭 − 32px (UX-06) */}
                <div className="-mx-4 sm:mx-0">
                  <NextActionBand similarCases={a.similarCases.map((c) => ({ href: c.href, title: c.title, kind: c.kind }))} actions={a.nextActions.map((n) => ({ key: n.key, label: n.label, href: n.href, enabled: true, external: n.external }))} />
                </div>
              </Part>
            );
          case "policy":
            return (
              <Part key={part} part={part} tone={tone(part)}>
                <nav aria-label="회사·정책" className="flex flex-wrap gap-x-6">
                  {a.policyLinks.map((l) => (
                    <UiLink key={l.key} href={l.href} data-policy={l.key} className={TEXT_LINK}>
                      {l.label}
                    </UiLink>
                  ))}
                </nav>
              </Part>
            );
        }
      })}
    </article>
  );
}
