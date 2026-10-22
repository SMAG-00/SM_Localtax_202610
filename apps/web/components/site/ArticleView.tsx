import { pageJsonLd, toJsonLdScriptContent } from "@ltr/structured-data";
import {
  ArticleTypeBadge,
  Chip,
  CorrectionHistory,
  EditorialFieldBadge,
  NextActionBand,
  PartnerBadge,
  PopularArticles,
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
import { ClaimBasisLink } from "./ClaimBasisLink";
import { ARTICLE_DISCLAIMER, UPDATE_LABEL, articleParts, dateLines, partnerBadgeFor, reporterPolicyLinks, seriesLine, taxLensBoxLinks, typeBadgeFor, type ArticlePart } from "@/lib/site/article-view";
import { formatBadge, sectionTones, type SectionTone } from "@/lib/site/home-view";
import { articleTipPlan, hasTips, type PlannedRun } from "@/lib/site/glossary-tips";
import { ArticleBlocks } from "./ArticleBlocks";
import { GlossaryTips } from "./GlossaryTips";
import { ArticleGrid } from "./ArticleItem";
import { CardNewsSlider } from "./CardNewsSlider";
import { popularClickItems } from "@/lib/site/popular-view";
import { MeasureArticle, MeasureClicks, MeasureNextActions, MeasurePartnerContent } from "./Measure";
import { ShareButton } from "./ShareButton";
import { sourceCards } from "@/lib/site/source-cards";
import { TEXT_LINK } from "./SiteSection";

// 기사 상세 (/news/[slug] — ART-02 · ART-03 · ART-04 · ART-05 · ART-06 · CAT-05 · CORE-01 · PRD-01A 3장 '기사 상세'·'해결 사례 상세')
// 부분 순서 고정(lib/site/article-view.ts ARTICLE_PARTS) — 부분마다 data-article-part. 내용 0건인 부분은 빠진다(빈 자리 0):
//  머리(분야 칩·유형 배지 또는 제휴 배지·형식 배지·편집 분야 배지 → 제목 → 연재 → 요약 → 기자·날짜 → 공유)
//  → 알림(업데이트 표시 '수정 날짜: 사유' · 갱신 배너 · 정정 이력 블록 — 본문 위, 있을 때만)
//  → 본문(대표 이미지 · 카드뉴스 장 · 해결 사례 카드 · 블록 · 개정 트래커 · 출처) → 「지방세로 읽기」(본문 뒤·기자 소개 앞) → 기자 소개
//  → 자사 상품(01C 전 0) → 면책(면책 대상 하위 분야만) → 관련 기사 → 다음 행동 띠 → 기사 하단 정책 링크(공개 승인된 것만)
// JSON-LD는 화면과 같은 데이터 객체(detail.view)를 structured-data 생성기에 넘긴다 (OPT-02 — 손으로 쓴 JSON-LD 0)
// 본문 용어 풀이(GLO-02 — W2-d 3단계)는 본문 블록 안에서만 그린다 — 제목·저자·날짜·대표 이미지(구조화 데이터와 대조하는 화면 값)는 그대로
// 많이 본 기사 목록(ART-11 — 지금 보는 기사 제외, 설정 sidebar_size건): 1024px 이상은 본문 오른쪽 열, 그 아래는 본문 뒤. 목록이 있으면
// 모든 부분이 같은 두 칸 틀(본문 칸 + 오른쪽 열)을 써서 왼쪽 선이 맞는다. 누르면 popular_article_clicked(순위·위치 sidebar) 1건

const CORRECTION_KIND: Record<string, CorrectionKind> = { correction: "correction", rebuttal: "rebuttal", follow_up: "follow-up", title_change: "title-change" };
const AMENDMENT_STAGES = new Set<string>(["발표", "입법예고", "국회 제출", "의결", "공포", "시행"]);
const EDITORIAL_FIELDS = new Set<string>(["local_tax", "realestate", "local_finance", "urban_policy"]);
const H2 = "text-[22px] leading-tight font-black tracking-tight text-navy-900";

const RAIL = "lg:grid lg:max-w-6xl lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-x-12";
/**
 * 좁은 화면(sm 미만)의 기사 머리 첫 화면 — 분야 칩·제목·요약·기자가 첫 화면(머리글 64px · 위 여백 80px 아래 화면 높이)을 맡고, 기자 줄은 그 아래 끝에 붙는다.
 * 날짜 줄·공유 버튼·알림(업데이트·정정)·본문은 첫 화면 바로 아래에서 시작한다 — 머리 길이·줄바꿈에 따라 날짜·알림·본문이 첫 화면 끝에 걸쳐 들어와
 * 첫 화면 글자(R1 150자)가 기사마다 흔들리지 않게 (W2-b 설계 9장 #R1). 넓은 화면은 그대로 흐른다(칩 → 제목 → 요약 → 기자 → 날짜 → 공유)
 */
const HEAD_COVER = "max-sm:flex max-sm:min-h-[calc(100svh-144px)] max-sm:flex-col";

function Part({ part, tone, first = false, rail = false, aside, children }: { part: ArticlePart; tone: SectionTone; first?: boolean; rail?: boolean; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section data-article-part={part} className={cx(!first && "border-t border-navy-100", tone === "ivory" ? "bg-ivory" : "bg-ivory-dark")}>
      <div className={cx("mx-auto max-w-3xl px-4 py-20", rail && RAIL)}>
        <div className="min-w-0">{children}</div>
        {aside}
      </div>
    </section>
  );
}

/** 많이 본 기사 사이드바 — 1024px 이상 오른쪽 열(따라 내려옴), 그 아래는 본문 뒤 */
function PopularRail({ a }: { a: ArticleDetail }) {
  return (
    <div data-part="popular-sidebar" className="mt-12 min-w-0 lg:mt-0">
      <div className="lg:sticky lg:top-6">
        <MeasureClicks name="popular_article_clicked" items={popularClickItems(a.popular, "sidebar")}>
          <PopularArticles items={a.popular.map((p) => ({ href: p.href, title: p.title }))} limit={a.popular.length} />
        </MeasureClicks>
        <p className="mt-3">
          <UiLink href="/news/popular" className={TEXT_LINK}>
            많이 본 기사 더 보기
          </UiLink>
        </p>
      </div>
    </div>
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
      <div data-part="head-cover" className={HEAD_COVER}>
        <div className="flex flex-wrap items-center gap-2">
          <UiLink href={a.subsection?.href ?? a.sectionHref} className="inline-flex min-h-11 items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500">
            <Chip>{a.subsection ? `${a.sectionName} › ${a.subsection.name}` : a.sectionName}</Chip>
          </UiLink>
          {type && <ArticleTypeBadge type={type} />}
          {partner &&
            (a.partner ? (
              // 제휴 배지 → 제휴사 프로필 (ART-10). 배지 글자는 목록 카드와 같다 — 링크 이름에 '제휴사 소개'를 덧붙인다(화면 읽기용)
              <UiLink href={a.partner.href} data-part="partner-link" className="inline-flex min-h-11 items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500">
                <PartnerBadge partner={partner} />
                <span className="sr-only"> 제휴사 소개</span>
              </UiLink>
            ) : (
              <PartnerBadge partner={partner} />
            ))}
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
            {/* 연재 제목에 경력 연수 표기가 있으면 근거 링크를 늘 함께 (BR-01·04 — W3 8단계) */}
            {a.series?.basisHref && <ClaimBasisLink href={a.series.basisHref} />}
          </p>
        )}
        {a.summary && <p data-part="summary" className="mt-5 text-[17px] leading-relaxed text-navy-700 [overflow-wrap:anywhere]">{a.summary}</p>}
        {a.author && (
          <p data-part="byline" className="mt-6 text-[15px] text-navy-700 max-sm:mt-auto max-sm:pt-6">
            <span className="mr-1">{a.author.kind === "opinion" ? "필자" : "기자"}</span>
            {a.author.href ? (
              <UiLink href={a.author.href} className="inline-flex min-h-11 min-w-11 items-center justify-center font-bold text-navy-900 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500">
                {a.author.name}
              </UiLink>
            ) : (
              // 인물 페이지가 없는 사람(동의서 없음·철회) — 이름만, 링크 0 (BR-07)
              <span className="font-bold text-navy-900">{a.author.name}</span>
            )}
          </p>
        )}
      </div>
      <p data-part="dates" className={cx("font-mono text-[13px] tracking-wide text-navy-600 max-sm:mt-6", a.author ? "mt-1" : "mt-6")}>
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

function Body({ a, today, tips }: { a: ArticleDetail; today: string; tips: ReadonlyMap<number, readonly PlannedRun[]> }) {
  return (
    <div data-part="article-body">
      {/* 본문 구역 제목 — 상태 상자·FAQ 제목(h3·h2)이 h1 다음 단계 순서를 지키게 (화면 읽기용) */}
      <h2 className="sr-only">본문</h2>
      {a.leadImage && (
        <figure data-part="lead-figure">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            data-part="lead-image"
            src={a.leadImage.src}
            alt={a.leadImage.alt}
            {...(a.leadImage.width && a.leadImage.height ? { width: a.leadImage.width, height: a.leadImage.height } : {})}
            className="block h-auto w-full rounded-2xl border border-navy-100 bg-white"
          />
          {a.leadImage.credit && <figcaption className="mt-2 text-[14px] text-navy-600">{`사진·그림 ${a.leadImage.credit}`}</figcaption>}
        </figure>
      )}
      {a.slides.length > 0 && <CardNewsSlider slides={a.slides} title={a.title} />}
      {a.solvedCase && (
        <div data-part="solved-case" className="mt-8">
          <SolvedCaseCard situation={a.solvedCase.situation} issue={a.solvedCase.issue} result={a.solvedCase.result} lesson={a.solvedCase.lesson} />
        </div>
      )}
      <ArticleBlocks blocks={a.blocks} media={a.media} article={{ id: a.id, section: a.section, title: a.title, format: a.format }} tips={tips} />
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
      <SourceSections sources={a.sources} />
    </div>
  );
}

/**
 * 출처 (W4 5단계 — REG1-07 · REG1-09 · REG1-13 · PR-07): ① 공식 자료 원문 — 발표기관 자료의 사실만 담은 카드(원문 블록). 기자의 해석인 본문 블록과
 * 다른 구역이다 — 카드에 본문 글자 0. 칸이 모두 찬 공식 자료만(lib/site/source-cards.ts) ② 출처 줄 — 나머지 출처, 공공누리 유형 글자를 함께
 */
function SourceSections({ sources }: { sources: ArticleDetail["sources"] }) {
  const { official, lines } = sourceCards(sources);
  return (
    <>
      {official.length > 0 && (
        <section data-part="official-sources" aria-labelledby="article-official-sources" className="mt-10">
          <h2 id="article-official-sources" className="text-[17px] font-black text-navy-900">
            공식 자료 원문
          </h2>
          <p className="mt-1 text-[14px] text-navy-600">발표기관이 낸 원자료입니다. 이 자료에 대한 해석은 위 기사 본문이 편집국의 판단으로 씁니다.</p>
          <ul className="mt-3 space-y-3">
            {official.map((c) => (
              <li key={c.id} data-part="official-source-card" data-source-id={c.id} className="rounded-2xl border border-navy-100 bg-white p-5">
                <p data-part="official-source-type" className="text-[13px] font-bold text-hermes-800">
                  {c.typeLabel}
                </p>
                <p className="mt-1 text-[16px] font-black text-navy-900 [overflow-wrap:anywhere]">{c.title}</p>
                <p className="mt-1 text-[14px] text-navy-700 [overflow-wrap:anywhere]">
                  {c.issuer}
                  {c.provider && <span className="text-navy-600">{` · 제공 ${c.provider}`}</span>}
                </p>
                <dl data-part="official-source-dates" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[13px] tracking-wide text-navy-700">
                  {c.publishedOn && (
                    <div className="flex gap-1">
                      <dt>발표일</dt>
                      <dd>
                        <time dateTime={c.publishedOn}>{c.publishedOn}</time>
                      </dd>
                    </div>
                  )}
                  <div className="flex gap-1">
                    <dt>기준일</dt>
                    <dd>
                      <time dateTime={c.referenceDate}>{c.referenceDate}</time>
                    </dd>
                  </div>
                  {c.regionUnit && (
                    <div className="flex gap-1">
                      <dt>지역 단위</dt>
                      <dd>{c.regionUnit}</dd>
                    </div>
                  )}
                  <div className="flex gap-1">
                    <dt>확인일</dt>
                    <dd>
                      <time dateTime={c.verifiedOn}>{c.verifiedOn}</time>
                    </dd>
                  </div>
                </dl>
                <p data-part="license-badge" className="mt-2 inline-flex rounded-md border border-navy-200 bg-navy-50 px-2.5 py-0.5 text-[13px] font-bold text-navy-800">
                  {c.license}
                </p>
                <p className="mt-2">
                  <a href={c.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-[15px] font-bold underline underline-offset-4 hover:text-hermes-900">
                    원문 보기 (새 창)
                  </a>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {lines.length > 0 && (
        <section data-part="sources" aria-labelledby="article-sources" className="mt-10">
          <h2 id="article-sources" className="text-[17px] font-black text-navy-900">
            출처
          </h2>
          <ul className="mt-2 space-y-1 text-[15px] text-navy-700">
            {lines.map((s) => (
              <li key={s.id} data-source-id={s.id}>
                {s.href ? (
                  <a href={s.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-hermes-900">
                    {s.text}
                    <span className="sr-only"> (새 창)</span>
                  </a>
                ) : (
                  s.text
                )}
                {s.issuer && <span className="text-navy-600">{` · ${s.issuer}`}</span>}
                {s.license && (
                  <span data-part="license-badge" className="text-navy-600">
                    {` · ${s.license}`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function ArticleView({ article: a, today }: { article: ArticleDetail; today: string }) {
  const parts = articleParts({ ...a, banner: a.amendment?.banner && a.amendment.href ? a.amendment.banner : null });
  // 바탕은 보이는 부분 순서대로 ivory와 ivory-dark를 번갈아 (머리가 ivory)
  const tones = new Map(sectionTones(parts).map((t) => [t.key, t.tone]));
  const tone = (p: ArticlePart): SectionTone => tones.get(p) ?? "ivory";
  const links = reporterPolicyLinks(a.policyLinks);
  const jsonLd = toJsonLdScriptContent(pageJsonLd({ kind: "article", article: a.view }));
  const rail = a.popular.length > 0;
  // 본문 첫 등장 용어 풀이 (GLO-02) — 공개 용어 가운데 이 기사에 처음 나오는 자리만. 저장된 본문은 그대로
  const tips = articleTipPlan(a.blocks, a.glossary);

  return (
    <article data-ui="article-page" data-article-id={a.id} data-format={a.format ?? "general"} data-content-type={a.contentType ?? "none"}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      {/* 측정 (W2-c — article_viewed · 30초 article_engaged). 그리는 것 0 */}
      {a.contentType && <MeasureArticle articleId={a.id} section={a.section} format={a.format ?? "general"} contentType={a.contentType} />}
      {/* 다음 행동 띠 누름 → next_action_clicked (W2-c 3단계 — 첫 방문 깔때기). 그리는 것 0 */}
      <MeasureNextActions section={a.section} screen="article" />
      {/* 제휴 기사 열람 → partner_content_viewed(제휴사·기사) 1건 (ART-10). 그리는 것 0 */}
      {a.partner && <MeasurePartnerContent partnerId={a.partner.id} articleId={a.id} section={a.section} />}
      {/* 본문 용어 풀이 보조 스크립트 — 누르기·Esc·자리 맞추기·glossary_opened. 그리는 것 0 */}
      {hasTips(tips) && <GlossaryTips articleId={a.id} section={a.section} />}
      {parts.map((part) => {
        switch (part) {
          case "head":
            return (
              <Part key={part} part={part} tone={tone(part)} first rail={rail}>
                <Head a={a} />
              </Part>
            );
          case "notices":
            return (
              <Part key={part} part={part} tone={tone(part)} rail={rail}>
                <Notices a={a} />
              </Part>
            );
          case "body":
            return (
              <Part key={part} part={part} tone={tone(part)} rail={rail} aside={rail ? <PopularRail a={a} /> : undefined}>
                <Body a={a} today={today} tips={tips} />
              </Part>
            );
          case "tax-lens":
            return (
              a.taxLens && (
                <Part key={part} part={part} tone={tone(part)} rail={rail}>
                  <TaxLensBox taxes={a.taxLens.topics} points={a.taxLens.points} links={taxLensBoxLinks(a.taxLens.links)} reviewer={a.taxLens.reviewer} basisDate={a.taxLens.basisDate} />
                </Part>
              )
            );
          case "reporter":
            return (
              a.author &&
              a.firstPublishedAt && (
                <Part key={part} part={part} tone={tone(part)} rail={rail}>
                  {a.author.kind === "opinion" ? (
                    <ReporterBlock
                      kind="opinion"
                      interest=""
                      author={{ name: a.author.name, slug: a.author.href ? a.author.slug : null, beat: a.author.beat ?? a.sectionName, bio: a.author.bio.join(" · ") || undefined }}
                      publishedAt={a.firstPublishedAt}
                      modifiedAt={a.substantiveUpdatedAt ?? undefined}
                      correctionHref={links.correctionHref}
                      editorialPolicyHref={links.editorialPolicyHref}
                    />
                  ) : (
                    <ReporterBlock
                      kind={a.author.kind === "explainer" ? "explainer" : a.author.kind === "guide" ? "guide" : "report"}
                      author={{ name: a.author.name, slug: a.author.href ? a.author.slug : null, beat: a.author.beat ?? a.sectionName, bio: a.author.bio.join(" · ") || undefined }}
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
              <Part key={part} part={part} tone={tone(part)} rail={rail}>
                <p data-part="disclaimer" className="text-[15px] text-navy-700">
                  {ARTICLE_DISCLAIMER}
                </p>
              </Part>
            );
          case "related":
            return (
              <Part key={part} part={part} tone={tone(part)} rail={rail}>
                <h2 className={H2}>관련 기사</h2>
                <ArticleGrid part="related-articles" items={a.related} />
              </Part>
            );
          case "next":
            return (
              <Part key={part} part={part} tone={tone(part)} rail={rail}>
                {/* 640px 미만은 띠를 화면 폭으로 펼친다 — 버튼 너비 = 화면 폭 − 32px (UX-06) */}
                <div className="-mx-4 sm:mx-0">
                  <NextActionBand similarCases={a.similarCases.map((c) => ({ href: c.href, title: c.title, kind: c.kind }))} actions={a.nextActions.map((n) => ({ key: n.key, label: n.label, href: n.href, enabled: true, external: n.external }))} />
                </div>
              </Part>
            );
          case "policy":
            return (
              <Part key={part} part={part} tone={tone(part)} rail={rail}>
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
