// 내 관심 분야 새 글 — 순수 규칙 (시험 member-feed-logic.test.ts). 설계 5.2: 최근 14일 · 최신순 6건

export const MEMBER_FEED_DAYS = 14;
export const MEMBER_FEED_LIMIT = 6;

export interface MemberFeedRow {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  section: string;
  first_published_at: string;
}
export interface MemberFeedItem {
  id: number;
  href: string;
  title: string;
  summary: string;
  section: string;
  /** 최초 발행일 (한국 날짜 YYYY-MM-DD) */
  publishedOn: string;
}

const KST = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });

export function memberFeedItems(rows: readonly MemberFeedRow[]): MemberFeedItem[] {
  return rows.slice(0, MEMBER_FEED_LIMIT).map((r) => ({
    id: Number(r.id),
    href: `/news/${r.slug}`,
    title: r.title,
    summary: r.summary ?? "",
    section: r.section,
    publishedOn: KST.format(new Date(r.first_published_at)),
  }));
}

export interface InterestLimits {
  interestMax: number;
  interestRegionLimit: number;
}
export type InterestCheck = { ok: true; interests: string[]; regionCodes: string[] } | { ok: false; field: "interests" | "regionCodes"; message: string };

const INTEREST_SHAPE = /^(tax|realestate|finance|local|(tax|realestate|finance):[a-z0-9]+(-[a-z0-9]+)*)$/;
const REGION_SHAPE = /^[0-9]{10}$/;

/** 관심 분야·지역 저장 요청의 모양·중복·상한 검사 (DB 트리거와 같은 결과를 화면 오류로) — 없는/폐지 코드는 DB 트리거가 마지막으로 막는다 */
export function checkInterestInput(interests: readonly string[], regionCodes: readonly string[], limits: InterestLimits): InterestCheck {
  const i = [...new Set(interests.map((v) => v.trim()))];
  const r = [...new Set(regionCodes.map((v) => v.trim()))];
  if (i.some((v) => !INTEREST_SHAPE.test(v))) return { ok: false, field: "interests", message: "관심 분야 값이 목록 밖입니다 — 목록에서 다시 골라 주세요" };
  if (i.length > limits.interestMax) return { ok: false, field: "interests", message: `관심 분야는 ${limits.interestMax}개까지 고를 수 있습니다` };
  if (r.some((v) => !REGION_SHAPE.test(v))) return { ok: false, field: "regionCodes", message: "관심 지역 코드가 맞지 않습니다 — 목록에서 다시 골라 주세요" };
  if (r.length > limits.interestRegionLimit) return { ok: false, field: "regionCodes", message: `관심 지역은 ${limits.interestRegionLimit}곳까지 고를 수 있습니다` };
  return { ok: true, interests: i, regionCodes: r };
}
