// DB 기사 한 판(ArticleGraph) → 발행 판정 입력(@ltr/editorial ArticleForPublish) · 점검 입력(@ltr/seo-lint ArticleForLint) ·
// 화면 데이터(@ltr/structured-data ArticleView)와 화면 값(RenderedFacts) · 유사도 입력(@ltr/similarity). 순수 함수 (시험: mapping.test.ts)
// 화면(4단계 기사 페이지)도 toArticleView·renderedFacts로 그린다 — JSON-LD와 화면이 같은 소스에서 나온다 (OPT-02).
import {
  ANONYMITIES,
  CONTENT_TYPES,
  EVIDENCE_TYPES,
  FORMATS,
  LABELS,
  LICENSE_TYPES,
  QUOTE_CONSENTS,
  REPORTING_METHODS,
  REVIEW_DECISIONS,
  REVIEW_KINDS,
  RIGHTS_STATUSES,
  SECTIONS,
  SOURCE_KINDS,
  SUBTYPES,
  UPDATE_KINDS,
  VERIFICATION_STATUSES,
  hasTaxLensContent,
  taxReviewReasons,
  type ArticleBlock,
  type ArticleForPublish,
  type LicenseType,
  type RightsStatus,
  type TaxLens,
} from "@ltr/editorial";
import type { AdLabel, ArticleForLint, LintContext, SimilarityStatus } from "@ltr/seo-lint";
import type { SimilaritySource } from "@ltr/similarity";
import { displayTitle, sponsorLabelText, type ArticleView, type RenderedFacts, type SponsorLabel } from "@ltr/structured-data";
import { evidenceRef, readChecklists, readStoredBody, readStoredSolvedCase, readStoredTaxLens, sourceRef, type StoredBlock } from "./content";
import type { ArticleGraph, ArticleRow, MediaRow, PartnerRow, PersonRow, ReviewRow } from "./rows";

export interface ViewOptions {
  /** 사이트 절대 주소 (NEXT_PUBLIC_SITE_URL, 끝 / 없음). 없으면 canonical을 만들지 않는다 */
  siteUrl: string | undefined;
  /** 매체 이름 — packages/ui brand */
  publisherName: string;
  /** 아직 발행 전이면 이 시각(ISO 8601)을 발행 시각으로 보고 점검한다 */
  now: string;
}

export const SECTION_NAMES: Record<string, string> = { tax: "지방세", realestate: "부동산", finance: "부동산개발금융", local: "지자체뉴스" };

const pick = <T extends string>(values: readonly T[], v: unknown): T | null =>
  typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : null;

const blank = (s: string | null | undefined) => s === null || s === undefined || s.trim() === "";

/** 인물 참조 — 작성자와 승인자를 같은 기준(people.id)으로 비교한다 (NAV-12) */
export const personRef = (id: number) => `person:${id}`;

function rights(v: unknown): RightsStatus {
  return pick(RIGHTS_STATUSES, v) ?? "unconfirmed";
}

/** 현재 버전의 가장 늦은 편집 승인 기록 — 시각, 같으면 번호 순 */
export function latestReview(reviews: readonly ReviewRow[], kind: string, version: number): ReviewRow | null {
  let best: ReviewRow | null = null;
  for (const r of reviews) {
    if (r.kind !== kind || r.version !== version) continue;
    if (best === null || Date.parse(r.at) > Date.parse(best.at) || (Date.parse(r.at) === Date.parse(best.at) && r.id > best.id)) best = r;
  }
  return best;
}

/** '인과 단정 없음'(NAV-10)은 편집자 확인 항목 — 현재 버전의 최근 편집 승인(approve, 작성자 아님) checklist에서 읽는다 */
function noCausalClaimConfirmed(graph: ArticleGraph): boolean {
  const latest = latestReview(graph.reviews, "desk_edit", graph.article.version);
  if (!latest || latest.decision !== "approve" || latest.reviewer_id === graph.article.author_id) return false;
  const checklist = latest.checklist as Record<string, unknown> | null;
  return typeof checklist === "object" && checklist !== null && checklist.noCausalClaim === true;
}

export function toTaxLens(json: unknown): TaxLens | null {
  const stored = readStoredTaxLens(json);
  if (!stored) return null;
  return {
    topics: stored.topics,
    points: stored.points,
    links: stored.links,
    omissionReason: stored.skip_reason,
    reviewed: stored.reviewed,
    reviewedForVersion: stored.reviewed_for_version,
  };
}

/**
 * 저장한 블록 + media 기록 → 판정 블록. media에서만 읽는 칸(권리 · 출처 · 이용 조건 · media 대체 텍스트 · 썸네일 크기)을 채운다 —
 * 작성자가 본문에 적어 넣을 수 없다 (NAV-04 · ART-08 · ART-09)
 */
export function withMediaFacts(
  b: StoredBlock,
  media: ReadonlyMap<string, Pick<MediaRow, "rights_status" | "alt" | "credit" | "license" | "width" | "height" | "license_type">>,
): ArticleBlock {
  if (b.type === "image") {
    const m = media.get(b.mediaId);
    return { ...b, rightsStatus: rights(m?.rights_status), credit: m?.credit ?? null, license: m?.license ?? null, mediaAlt: m?.alt ?? null, licenseType: licenseOf(m?.license_type) };
  }
  if (b.type === "infographic") {
    const m = media.get(b.mediaId);
    return { ...b, rightsStatus: rights(m?.rights_status), licenseType: licenseOf(m?.license_type) };
  }
  if (b.type === "video") {
    const m = b.thumbnailMediaId === null ? undefined : media.get(b.thumbnailMediaId);
    return { ...b, thumbnail: m ? { rightsStatus: rights(m.rights_status), width: m.width ?? null, height: m.height ?? null, licenseType: licenseOf(m.license_type) } : null };
  }
  return b;
}

/** 공공누리 유형 — 목록 밖·빈 값은 null(빈 것으로 판정 — PR-07) */
export const licenseOf = (v: string | null | undefined): LicenseType | null => pick(LICENSE_TYPES, v ?? null);

export function toArticleForPublish(graph: ArticleGraph): ArticleForPublish {
  const a = graph.article;
  const media = new Map(graph.media.map((m) => [String(m.id), m]));
  const body = readStoredBody(a.body);
  const blocks: ArticleBlock[] = body.blocks.map((b) => withMediaFacts(b, media));
  const checklists = readChecklists(a.check_log);
  const reportingMethod = pick(REPORTING_METHODS, a.reporting_method);
  const lead = a.lead_media_id === null ? null : (media.get(String(a.lead_media_id)) ?? null);

  return {
    id: String(a.id),
    slug: a.slug,
    version: a.version,
    title: a.title,
    summary: a.summary ?? "",
    blocks,
    claims: body.claims,
    section: pick(SECTIONS, a.section),
    category: graph.category ? { slug: graph.category.slug, needsDisclaimer: graph.category.needs_disclaimer } : null,
    contentType: pick(CONTENT_TYPES, a.content_type),
    reportingMethod,
    format: pick(FORMATS, a.format) ?? "general",
    subtype: pick(SUBTYPES, a.subtype) ?? "general",
    solvedCase: readStoredSolvedCase(a.solved_case),
    label: pick(LABELS, a.label) ?? "none",
    partner: graph.partner
      ? { id: String(graph.partner.id), name: graph.partner.name, contractFrom: graph.partner.contract_from, contractTo: graph.partner.contract_to }
      : null,
    authorUserId: a.author_id === null ? null : personRef(a.author_id),
    firstPublishedAt: a.first_published_at,
    updateKind: pick(UPDATE_KINDS, a.update_kind),
    updatedReason: a.updated_reason,
    legalBasisDate: a.legal_basis_date,
    digestId: a.digest_id === null ? null : String(a.digest_id),
    amendmentId: a.amendment_id === null ? null : String(a.amendment_id),
    leadImage:
      a.lead_media_id === null
        ? null
        : { mediaId: String(a.lead_media_id), alt: lead?.alt ?? "", rightsStatus: rights(lead?.rights_status), licenseType: licenseOf(lead?.license_type) },
    sources: graph.sources.flatMap((s) => {
      const kind = pick(SOURCE_KINDS, s.kind);
      if (!kind) return [];
      return [
        {
          id: sourceRef(s.id),
          kind,
          title: s.title ?? "",
          url: s.source_url,
          provider: s.source_name ?? s.provider,
          accessedAt: s.last_verified_at,
          // 출처의 권리 상태 = license_status(이용 조건)가 적혀 있음 — 사진 출처 판정(NAV-04)에만 쓰인다
          rightsStatus: blank(s.license_status) ? "unconfirmed" : "confirmed",
          // W4 5단계 — 공공누리 유형(PR-07) · 자료 종류(REG1-07) · 공식 자료 필수 칸(REG1-09). 대체된 옛 판은 graph.sources에 없다
          licenseType: licenseOf(s.license_type),
          sourceType: s.source_type ?? null,
          publishedOn: s.published_on ?? null,
          referenceDate: s.reference_date ?? null,
          regionUnit: s.region_unit ?? null,
          collectedAt: s.collected_at ?? null,
        },
      ];
    }),
    evidence: graph.evidence.flatMap((e) => {
      const evidenceType = pick(EVIDENCE_TYPES, e.evidence_type);
      if (!evidenceType) return [];
      return [
        {
          id: evidenceRef(e.id),
          articleVersion: e.article_version,
          evidenceType,
          location: e.location,
          rightsStatus: rights(e.rights_status),
          verifiedAt: e.verified_at,
          ownerId: e.owner_id === null ? null : personRef(e.owner_id),
          retentionUntil: e.retention_until,
          verificationStatus: pick(VERIFICATION_STATUSES, e.verification_status) ?? "pending",
        },
      ];
    }),
    datasets: graph.datasets.map((d) => ({
      evidenceId: evidenceRef(d.evidence_id),
      definition: d.definition,
      period: d.period,
      unit: d.unit,
      regionUnit: d.region_unit,
      denominator: d.denominator,
      exclusions: d.exclusions,
      transform: d.transform,
      reproFileHash: d.repro_file_hash,
      provider: d.provider,
      sourceUrl: d.source_url,
      collectedAt: d.collected_at,
      license: d.license,
    })),
    interviews: graph.interviews.map((i) => ({
      evidenceId: evidenceRef(i.evidence_id),
      subjectRole: i.subject_role,
      contactedAt: i.contacted_at,
      recordLocation: i.record_location,
      quoteConsent: pick(QUOTE_CONSENTS, i.quote_consent),
      anonymity: pick(ANONYMITIES, i.anonymity) ?? "named",
      anonymityReason: i.anonymity_reason,
    })),
    reviews: graph.reviews.flatMap((r) => {
      const kind = pick(REVIEW_KINDS, r.kind);
      const decision = pick(REVIEW_DECISIONS, r.decision);
      return kind && decision ? [{ kind, decision, reviewerUserId: personRef(r.reviewer_id), signedAt: r.at, forVersion: r.version }] : [];
    }),
    taxLens: toTaxLens(a.tax_lens),
    hasTaxOrLegalClaims: checklists.hasTaxOrLegalClaims,
    isTaxIssue: checklists.isTaxIssue,
    isLocalPolicyIssue: checklists.isLocalPolicyIssue,
    perspectives: checklists.perspectives,
    originalTextChecks: checklists.originalTextChecks,
    isInheritanceGiftCase: checklists.isInheritanceGiftCase,
    inheritanceGiftChecks: checklists.inheritanceGift,
    quantitativeChecklist: {
      sourceCrossCheck: checklists.quantitative?.sourceCrossCheck ?? null,
      limitations: checklists.quantitative?.limitations ?? null,
      relatedPartyCheck: checklists.quantitative?.relatedPartyCheck ?? null,
      noCausalClaim: noCausalClaimConfirmed(graph),
    },
    qualitativeChecklist: checklists.qualitative,
  };
}

// ── 화면 데이터 · 구조화 데이터 ───────────────────────────

/**
 * 광고·제휴 표기 — 광고 "광고", 공동 기획은 제휴 배지 "공동 기획 ○○"(ART-10 · PRD-00 8.8, ○○ = 제휴사 이름).
 * 화면 제목·메타·JSON-LD headline·seo-lint 점검이 모두 이 값에서 나온다. 제휴사 이름이 없으면 발행 판정이 막는다.
 */
export function sponsorshipOf(label: string, partnerName: string | null | undefined): SponsorLabel | undefined {
  if (label === "ad") return { kind: "광고" };
  if (label === "co_planned") return { kind: "공동 기획", partnerName: partnerName ?? "" };
  return undefined;
}

export function canonicalUrl(siteUrl: string | undefined, slug: string): string | null {
  return siteUrl ? `${siteUrl}/news/${encodeURIComponent(slug)}` : null;
}

/** 사이트 주소를 붙인 절대 주소 — 이미 http(s) 주소면 그대로 (화면 이미지 주소와 JSON-LD 이미지 주소가 같은 함수에서 나온다) */
export function absolute(siteUrl: string | undefined, path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${siteUrl ?? ""}/${path.replace(/^\/+/, "")}`;
}

/**
 * 화면 데이터가 쓰는 칸만 — 편집국 기사 한 판(ArticleGraph)과 공개 기사 보기(lib/server/public, anon으로 읽은 공개 칸)가
 * 같은 함수로 화면 제목·저자·날짜·대표 이미지·JSON-LD를 만든다 (OPT-02 — 화면과 구조화 데이터가 같은 소스)
 */
export interface ArticleViewSource {
  article: Pick<ArticleRow, "slug" | "title" | "label" | "summary" | "section" | "first_published_at" | "substantive_updated_at" | "lead_media_id">;
  /** slug가 null이면 인물 페이지가 없는 사람(동의서 없음·철회 — BR-07) — 저자 url을 넣지 않는다 */
  author: (Pick<PersonRow, "name"> & { slug: string | null }) | null;
  partner: Pick<PartnerRow, "name"> | null;
  media: readonly Pick<MediaRow, "id" | "path" | "rights_status">[];
}

export function toArticleView(graph: ArticleViewSource, opts: ViewOptions): ArticleView {
  const a = graph.article;
  const lead = a.lead_media_id === null ? undefined : graph.media.find((m) => m.id === a.lead_media_id);
  const sponsorship = sponsorshipOf(a.label, graph.partner?.name);
  return {
    url: canonicalUrl(opts.siteUrl, a.slug) ?? `/news/${encodeURIComponent(a.slug)}`,
    title: a.title,
    ...(sponsorship ? { sponsorship } : {}),
    ...(a.summary ? { summary: a.summary } : {}),
    ...(SECTION_NAMES[a.section] ? { sectionName: SECTION_NAMES[a.section] } : {}),
    authors: graph.author
      ? [{ kind: "person" as const, name: graph.author.name, ...(graph.author.slug ? { url: absolute(opts.siteUrl, `/people/${graph.author.slug}`) } : {}) }]
      : [],
    publisher: { name: opts.publisherName, ...(opts.siteUrl ? { url: opts.siteUrl } : {}) },
    datePublished: a.first_published_at ?? opts.now,
    ...(a.substantive_updated_at ? { dateModified: a.substantive_updated_at } : {}),
    // 권리 확인된 대표 이미지만 화면·구조화 데이터에 나온다 (NAV-04)
    ...(lead && lead.rights_status === "confirmed" ? { mainImage: { url: absolute(opts.siteUrl, lead.path) } } : {}),
  };
}

/** 화면에 그리는 값 — 기사 페이지가 화면 제목·저자·날짜·대표 이미지를 이 값으로 그린다 */
export function renderedFacts(view: ArticleView): RenderedFacts {
  return {
    title: displayTitle(view.title, view.sponsorship),
    authorNames: view.authors.map((au) => au.name),
    datePublished: view.datePublished,
    ...(view.dateModified ? { dateModified: view.dateModified } : {}),
    ...(view.mainImage ? { mainImageUrl: view.mainImage.url } : {}),
    // 감수 표시 '감수 ○○' — 서명 기록이 있을 때만 화면과 구조화 데이터에 함께 (W3 10단계)
    ...(view.reviewer ? { reviewerName: view.reviewer.name } : {}),
  };
}

// ── 점검 입력 (seo-lint) ──────────────────────────────────

const AD_LABELS: Record<string, AdLabel> = { none: "없음", co_planned: "공동 기획", ad: "광고" };

function internalLinkCount(article: ArticleForPublish, siteUrl: string | undefined): number {
  const urls = new Set<string>();
  const isInternal = (u: string) => u.startsWith("/") || (siteUrl !== undefined && u.startsWith(`${siteUrl}/`));
  for (const link of article.taxLens?.links ?? []) if (isInternal(link.url)) urls.add(link.url);
  for (const block of article.blocks) {
    if (block.type !== "paragraph") continue;
    // 문단 안 마크다운 링크 [글](주소)
    for (const m of block.text.matchAll(/\]\(([^)\s]+)\)/g)) if (isInternal(m[1]!)) urls.add(m[1]!);
  }
  return urls.size;
}

export interface LintExtras {
  similarityStatus: SimilarityStatus;
  structuredDataMismatches: readonly string[];
  /** 구조화 데이터(JSON-LD) headline 값 */
  structuredHeadline: string;
}

export function toLintArticle(graph: ArticleGraph, article: ArticleForPublish, view: ArticleView, opts: ViewOptions, extras: LintExtras): ArticleForLint {
  const a = graph.article;
  const sponsorship = view.sponsorship;
  const marker = sponsorship ? `[${sponsorLabelText(sponsorship)}] ` : "";
  const screenTitle = displayTitle(a.title, sponsorship);
  const summaryBox = article.blocks.find((b) => b.type === "key_summary");
  return {
    id: String(a.id),
    title: screenTitle,
    metaTitle: screenTitle,
    metaDescription: a.summary ? `${marker}${a.summary}` : "",
    canonical: canonicalUrl(opts.siteUrl, a.slug),
    section: article.section ?? "tax",
    taxReviewTarget: taxReviewReasons(article).length > 0,
    hasTaxLens: article.taxLens !== null && hasTaxLensContent(article.taxLens),
    lawBasisDate: a.legal_basis_date,
    authors: graph.author ? [{ peopleId: String(graph.author.id), name: graph.author.name }] : [],
    dates: {
      data: { publishedAt: a.first_published_at ?? opts.now, updatedAt: a.substantive_updated_at },
      displayed: { publishedAt: view.datePublished, updatedAt: view.dateModified ?? null },
    },
    claims: article.claims.map((c) => ({ id: c.id, text: c.text, evidenceIds: c.evidenceIds })),
    sources: article.sources.map((s) => ({ id: s.id, kind: s.kind, title: s.title })),
    evidence: article.evidence.map((e) => ({ id: e.id })),
    structuredDataMismatches: extras.structuredDataMismatches,
    similarity: { status: extras.similarityStatus },
    sponsorship: {
      label: AD_LABELS[a.label] ?? "없음",
      partnerName: a.label === "co_planned" ? (graph.partner?.name ?? null) : null,
      pageBadge: sponsorship ? sponsorLabelText(sponsorship) : null,
      structuredHeadline: extras.structuredHeadline,
    },
    // 블록 모델에 소제목 블록이 없다 — 질문형 소제목 점검은 경고로 남는다
    headings: [],
    internalLinkCount: internalLinkCount(article, opts.siteUrl),
    images: [
      ...(article.leadImage ? [{ alt: article.leadImage.alt }] : []),
      ...article.blocks.flatMap((b) => (b.type === "image" || b.type === "infographic" ? [{ alt: b.alt }] : [])),
    ],
    summaryBoxLines: summaryBox?.type === "key_summary" ? [...summaryBox.lines] : [],
    faqs: article.blocks.flatMap((b) => (b.type === "faq" ? b.items.map((i) => ({ question: i.question, answer: i.answer })) : [])),
  };
}

/** 같은 제목을 쓰는 다른 공개 기사 (고유 제목·canonical 중복 점검) — 공동 기획이면 제휴사 이름까지 */
export interface TitlePeer {
  id: number;
  slug: string;
  title: string;
  label: string;
  partnerName: string | null;
}

/** 같은 제목을 쓰는 다른 공개 기사 → seo-lint 문맥 */
export function lintContext(peers: readonly TitlePeer[], siteUrl: string | undefined): LintContext {
  return {
    publishedArticles: peers.map((p) => ({
      id: String(p.id),
      canonical: canonicalUrl(siteUrl, p.slug) ?? `/news/${p.slug}`,
      title: displayTitle(p.title, sponsorshipOf(p.label, p.partnerName)),
    })),
  };
}

// ── 유사도 입력 ───────────────────────────────────────────

/** 원고 글 — 요약과 본문 블록. 인용 블록은 '>' 줄(유사도 비율에서 따로 센다) */
export function similarityDraft(article: ArticleForPublish): string {
  const lines: string[] = [];
  if (article.summary.trim()) lines.push(article.summary);
  for (const b of article.blocks) {
    switch (b.type) {
      case "paragraph":
        lines.push(b.text);
        break;
      case "key_summary":
        lines.push(...b.lines);
        break;
      case "callout":
        lines.push(b.text);
        break;
      case "slide":
        lines.push(...[b.title, b.text].filter((t) => t.trim() !== ""));
        break;
      case "faq":
        for (const item of b.items) lines.push(item.answer);
        break;
      case "quote":
        for (const line of b.text.split(/\r?\n/)) lines.push(`> ${line}`);
        break;
      default:
        break;
    }
  }
  return lines.join("\n");
}

/** 비교 원문 — 보도자료 출처의 스냅샷은 press_release, 그 밖의 출처 스냅샷은 raw_snapshot (OPT-06) */
export function similaritySources(graph: ArticleGraph): SimilaritySource[] {
  const payload = new Map(graph.snapshots.map((s) => [s.id, s.payload]));
  return graph.sources.flatMap((s) => {
    const text = s.snapshot_id === null ? undefined : payload.get(s.snapshot_id);
    if (text === undefined || text.trim() === "") return [];
    return [{ id: sourceRef(s.id), kind: s.kind === "press_release" ? ("press_release" as const) : ("raw_snapshot" as const), text }];
  });
}
