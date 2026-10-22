// REG1-14 지역 기사 편집 경고 4종 · 단계 순서 (01B W4 8단계 — docs/dev/W4_설계.md 1장 8단계 · 2.2 · 2.3 · 12장 #57~)
// 경고는 발행을 막지 않는다(편집 화면 점검 패널 '편집 경고'·발행 기록에 남는다). 지역 기사(isRegionalArticle — 지역 태그 또는 지자체뉴스, 광고·협찬 제외)만 본다.
//  · 보도자료 재게시 — 본문 문장 중 같은 보도자료 문장과 기준 이상 같은 문장의 비율이 유사도 설정(similarity_internal)의 기사 비율 기준 이상
//    (비율 계산은 판정 입력이 유사도 검사기 결과로 한다 — ctx.similarity.reposted). 출처가 보도자료뿐인 보도기사 거부는 NAV-02(sourcing.ts)
//  · 근거 없는 지역 수치 — 숫자 + 단위가 있는 문단을 가리키는 핵심 주장이 공식 자료 출처나 반려 아닌 취재 근거를 잇지 않음
//  · 사진 권리 누락 — 권리 미확인 · 공공누리 유형 없음 · (본문 이미지) 출처 없음 — 앞의 둘은 발행 차단(NAV-04 · PR-07)과 겹쳐도 편집 경고 목록에 모은다
//  · 오래된 통계 — 통계 자료의 기준일이 오늘(KST)보다 stale_statistics_days(씨앗 365)일을 넘겨 앞섬 — 기준 당일 0건, 하루 넘김 1건
// 단계 순서(stageSkipProblem)는 DB 트리거(마이그레이션 20261022000044 articles_stage_order)와 같은 규칙 — 발행 API·DB가 함께 막는다.
import { finding, type Finding } from "../findings";
import {
  OFFICIAL_SOURCE_KINDS,
  STALE_STATISTICS_DAYS_DEFAULT,
  STATISTICS_SOURCE_TYPES,
  type ArticleForPublish,
  type ArticleSource,
  type LicenseType,
  type PublishContext,
  type RightsStatus,
} from "../model";
import { isBlank } from "../text";
import { isRegionalArticle } from "./regional";

/** 지역 수치로 보는 단위 — 금액 · 비율 · 사람·가구 · 건수·곳 · 면적 · 배수 (날짜·시각 낱말은 넣지 않는다) */
export const REGIONAL_FIGURE_UNITS = ["원", "%p", "%", "퍼센트", "명", "가구", "세대", "건", "곳", "개소", "채", "㎡", "m²", "㎢", "평", "배"] as const;
/** 단위 없이도 수치로 보는 큰 수 낱말 (예: 3억, 120만) */
const BIG_NUMBER_WORDS = ["조", "억", "만", "천"] as const;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NUMBER = String.raw`\d[\d,]*(?:\.\d+)?`;
const BIG = `(?:${BIG_NUMBER_WORDS.join("|")})`;
const UNIT = `(?:${[...REGIONAL_FIGURE_UNITS].sort((a, b) => b.length - a.length).map(escape).join("|")})`;
// 숫자 [큰 수 낱말]* [단위] — 단위가 없으면 큰 수 낱말이 하나 이상 있어야 한다 (예: 1,284억 원 · 18.4% · 3억 · 120만 명)
const FIGURE_RE = new RegExp(`${NUMBER}\\s*(?:${BIG}+\\s*${UNIT}|${UNIT}|${BIG}+)`, "gu");

/** 글에서 지역 수치(숫자 + 단위) 표현 — 나온 순서대로 */
export function regionalFigures(text: string): string[] {
  return [...text.matchAll(FIGURE_RE)].map((m) => m[0].trim());
}

const DAY = 86_400_000;
/** YYYY-MM-DD 두 날짜 사이 일수 (to − from). 날짜가 아니면 null */
export function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / DAY);
}

/** 통계 자료인가 — 자료(dataset)는 모두, 공식 문서는 예산/결산·지방세 세수·부동산 거래 종류만 */
export function isStatisticsSource(s: Pick<ArticleSource, "kind" | "sourceType">): boolean {
  if (s.kind === "dataset") return true;
  return s.kind === "official_doc" && (STATISTICS_SOURCE_TYPES as readonly (string | null | undefined)[]).includes(s.sourceType?.trim());
}

const sourceName = (s: ArticleSource) => `「${s.title || s.id}」(${s.id})`;

interface PhotoFacts {
  where: string;
  field: string;
  blockIndex?: number;
  mediaId: string;
  rightsStatus: RightsStatus | undefined;
  licenseType: LicenseType | null | undefined;
  /** undefined = 출처 칸을 보지 않는 사진(대표 사진·인포그래픽·썸네일·사진 출처) */
  credit?: string | null;
}

function photos(article: ArticleForPublish): PhotoFacts[] {
  const out: PhotoFacts[] = [];
  const lead = article.leadImage;
  if (lead) out.push({ where: "대표 사진", field: "leadImage", mediaId: lead.mediaId, rightsStatus: lead.rightsStatus, licenseType: lead.licenseType });
  article.blocks.forEach((b, blockIndex) => {
    if (b.type === "image") out.push({ where: "본문 이미지", field: "blocks", blockIndex, mediaId: b.mediaId, rightsStatus: b.rightsStatus, licenseType: b.licenseType, credit: b.credit ?? null });
    if (b.type === "infographic") out.push({ where: "인포그래픽", field: "blocks", blockIndex, mediaId: b.mediaId, rightsStatus: b.rightsStatus, licenseType: b.licenseType });
    if (b.type === "video" && b.thumbnailMediaId) {
      out.push({ where: "동영상 썸네일", field: "blocks", blockIndex, mediaId: b.thumbnailMediaId, rightsStatus: b.thumbnail?.rightsStatus, licenseType: b.thumbnail?.licenseType });
    }
  });
  for (const s of article.sources) {
    if (s.kind === "photo") out.push({ where: "사진 출처", field: "sources", mediaId: s.id, rightsStatus: s.rightsStatus, licenseType: s.licenseType });
  }
  return out;
}

export function checkRegionalWarnings(article: ArticleForPublish, ctx: PublishContext): Finding[] {
  if (!isRegionalArticle(article)) return [];
  const out: Finding[] = [];

  // ① 보도자료 재게시
  for (const r of ctx.similarity?.reposted ?? []) {
    const s = article.sources.find((x) => x.id === r.sourceId && x.kind === "press_release");
    if (!s) continue;
    out.push(
      finding(
        "reg1_14.press-release-repost",
        `본문 문장의 ${Math.round(r.ratio * 1000) / 10}%가 보도자료 ${sourceName(s)}와 같습니다 — 같은 보도자료의 단순 재게시입니다. 자체 취재·해석을 더하세요 (REG1-14 · 기준 = 유사도 설정 similarity_internal)`,
        { field: "sources", phrase: s.id },
      ),
    );
  }

  // ② 근거 없는 지역 수치 — 문단을 가리키는 핵심 주장이 공식 자료 출처 또는 반려 아닌 취재 근거를 잇는가
  const backing = new Set<string>([
    ...article.sources.filter((s) => (OFFICIAL_SOURCE_KINDS as readonly string[]).includes(s.kind)).map((s) => s.id),
    ...article.evidence.filter((e) => e.verificationStatus !== "rejected").map((e) => e.id),
  ]);
  article.blocks.forEach((block, blockIndex) => {
    if (block.type !== "paragraph") return;
    const figures = regionalFigures(block.text);
    if (figures.length === 0) return;
    const backed = article.claims.some((c) => c.blockIndex === blockIndex && c.evidenceIds.some((id) => backing.has(id)));
    if (backed) return;
    out.push(
      finding("reg1_14.unsupported-figure", `지역 수치 ‘${figures[0]}’가 있는 문단에 공식 자료·취재 근거 연결이 없습니다 — 그 문장을 핵심 주장으로 표시하고 근거를 이으세요 (REG1-14)`, {
        field: "blocks",
        blockIndex,
        phrase: figures[0],
      }),
    );
  });

  // ③ 사진 권리 누락
  for (const p of photos(article)) {
    const missing: string[] = [];
    if (p.rightsStatus !== "confirmed") missing.push("이용 권리 확인");
    if (!p.licenseType) missing.push("공공누리 유형");
    if (p.credit !== undefined && isBlank(p.credit)) missing.push("출처(촬영자)");
    if (missing.length === 0) continue;
    out.push(
      finding("reg1_14.photo-rights", `${p.where}의 권리 정보가 빠졌습니다: ${missing.join("·")} (REG1-14)`, {
        field: p.field,
        ...(p.blockIndex === undefined ? {} : { blockIndex: p.blockIndex }),
        phrase: p.mediaId,
      }),
    );
  }

  // ④ 오래된 통계
  const limit = ctx.staleStatisticsDays ?? STALE_STATISTICS_DAYS_DEFAULT;
  for (const s of article.sources) {
    if (!isStatisticsSource(s) || isBlank(s.referenceDate)) continue;
    const age = daysBetween(s.referenceDate!, ctx.today);
    if (age === null || age <= limit) continue;
    out.push(
      finding("reg1_14.stale-statistics", `통계 ${sourceName(s)}의 기준일 ${s.referenceDate!.slice(0, 10)}이 ${age}일 전입니다 — 기준 ${limit}일보다 오래됐습니다. 최신 자료가 있는지 확인하세요 (REG1-14 · 설정 stale_statistics_days)`, {
        field: "sources.referenceDate",
        phrase: s.id,
      }),
    );
  }
  return out;
}

// ── 단계 순서 (REG1-14 '초안 → 취재 검증 → 편집/세무 감수 → 승인 → 공개') ─────────────

/** 공개 상태 — 발행 · 예약 */
const PUBLIC_STATUSES = ["published", "scheduled"] as const;

export interface StageTransition {
  from: string;
  to: string;
  /** 지역 기사인가 (지역 태그 또는 지자체뉴스, 광고·협찬 제외 — DB is_regional_article와 같다) */
  regional: boolean;
  /** 이미 공개된 적 있는 기사(first_published_at 있음) — 다시 공개는 이 규칙 밖 */
  firstPublished: boolean;
  /** 현재 판 편집 승인 상태 `editorial_status` */
  editorialStatus: string;
  /** 세무 감수 상태 `tax_review_status` */
  taxReviewStatus: string;
}

/**
 * 단계를 건너뛴 전환이면 그 문장, 아니면 null (DB articles_stage_order와 같은 규칙).
 *  · 초안·검토 중·보류 → 공개(발행·예약): 승인(approved)을 거쳐야 한다 — 처음 공개만(다시 공개는 밖)
 *  · → 승인(approved): 현재 판 편집 승인 기록(editorial_status = approved)이 있어야 하고, 세무 감수가 반려·보류면 거부
 */
export function stageSkipProblem(t: StageTransition): string | null {
  if (!t.regional || t.from === t.to) return null;
  const isPublic = (s: string) => (PUBLIC_STATUSES as readonly string[]).includes(s);
  if (isPublic(t.to) && !isPublic(t.from) && !t.firstPublished && t.from !== "approved") {
    return `지역 기사는 승인 단계를 거쳐야 공개합니다 — 지금 상태(${t.from})에서 바로 공개할 수 없습니다 (초안 → 취재 검증 → 편집/세무 감수 → 승인 → 공개, REG1-14)`;
  }
  if (t.to === "approved") {
    if (t.editorialStatus !== "approved") {
      return "편집 승인 기록 없이 승인 단계로 갈 수 없습니다 — 편집 감수를 먼저 받으세요 (취재 검증 → 승인 건너뛰기 금지, REG1-14)";
    }
    if (t.taxReviewStatus === "rejected" || t.taxReviewStatus === "held") {
      return "세무 감수가 반려·보류된 원고는 승인 단계로 갈 수 없습니다 (REG1-14)";
    }
  }
  return null;
}
