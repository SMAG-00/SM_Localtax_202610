// GET /api/regions/{code}/articles?topic=&page= 요청 검사·응답 모양 (W4 9단계 — PRD-01B 5.6 · REG1-02 · REG1-13 · REG1-17, 설계 1장 9단계 · 4장) — 순수 모듈 (시험 region-articles-logic.test.ts)
//  · 그 지역(시·도 = 자기 + 하위 시·군·구 태그, 시·군·구 = 자기 태그 — 12장 #26)의 공개 지역 기사 — 편집 분야가 있고(REG1-17) 자체 기사 유형(보도·해설·가이드·칼럼 —
//    광고·금주 핫뉴스 0). 비공개·보류(held)·별도 상품 검토 큐 원고는 공개 뷰에 없다(DB가 공개를 거부 — 7·8단계)
//  · topic = 편집 분야 4종(local_tax·realestate·local_finance·urban_policy) — 생략하면 전체, 목록 밖 값(빈 값 포함)·두 번 → 400. page = 1~500 정수 — 밖이면 400
//  · 모르는 쿼리 칸 → 400 · 코드 형식(법정동코드 10자리) 밖 → 400 · 형식은 맞는데 오늘 유효한 지역이 아니면 404(화면 함수가 null)
//  · 기사마다 source(공식 자료 발표기관 — 없으면 '편집국')·verifiedAt(검수 공식 자료의 가장 이른 확인일 — 없으면 null)·status(published · under_review = 열린 원문 검수)
//  · 어떤 입력에도 500을 내지 않는다 — 검사는 DB를 부르기 전에 끝난다
import type { LocalTopic } from "@ltr/ui";
import { LOCAL_TOPICS, isLocalTopic } from "./constants";
import type { ArticleListItem } from "./cards";
import { issuerSummary, isVerifiedOfficial, supersededIds, type RegionSourceRow } from "./region-official-logic";
import { officialCard } from "@/lib/site/source-cards";

export const REGION_ARTICLES_API = { params: ["topic", "page"], pageSize: 20, maxPage: 500 } as const;

export type RegionArticlesRequest = { ok: true; code: string; topic: LocalTopic | null; page: number } | { ok: false; errors: string[] };

const CODE = /^\d{10}$/;
const PAGE = /^[1-9]\d{0,2}$/;

/** 경로 코드 + 쿼리 → 조건. 틀린 칸마다 사유 (모두) */
export function parseRegionArticlesRequest(code: string, params: URLSearchParams): RegionArticlesRequest {
  const errors: string[] = [];
  if (!CODE.test(code)) errors.push("code: 행정구역 법정동코드 10자리 숫자입니다");
  const seen = new Map<string, number>();
  for (const key of params.keys()) seen.set(key, (seen.get(key) ?? 0) + 1);
  for (const [key, n] of seen) {
    if (!(REGION_ARTICLES_API.params as readonly string[]).includes(key)) errors.push(`${key}: 모르는 칸입니다 — ${REGION_ARTICLES_API.params.join("·")}`);
    else if (n > 1) errors.push(`${key}: 같은 칸을 두 번 보냈습니다`);
  }
  const topicRaw = seen.get("topic") === 1 ? params.get("topic") : null;
  if (topicRaw !== null && !isLocalTopic(topicRaw)) errors.push(`topic: ${LOCAL_TOPICS.map((t) => t.topic).join("·")} 중 하나입니다 (생략하면 전체)`);
  const pageRaw = seen.get("page") === 1 ? params.get("page") : null;
  if (pageRaw !== null && (!PAGE.test(pageRaw) || Number(pageRaw) > REGION_ARTICLES_API.maxPage)) errors.push(`page: 1~${REGION_ARTICLES_API.maxPage} 정수입니다`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, code, topic: topicRaw !== null && isLocalTopic(topicRaw) ? topicRaw : null, page: pageRaw === null ? 1 : Number(pageRaw) };
}

export const ARTICLE_STATUSES = ["published", "under_review"] as const;
export type RegionArticleStatus = (typeof ARTICLE_STATUSES)[number];

export interface RegionArticleApiItem {
  id: number;
  title: string;
  summary: string;
  url: string;
  section: string;
  contentType: string | null;
  editorialField: string | null;
  regionCodes: string[];
  author: string | null;
  publishedOn: string;
  modifiedOn: string | null;
  /** 검수 공식 자료의 발표기관 — 없으면 '편집국' */
  source: string;
  /** 검수 공식 자료 중 가장 이른 확인일 (한국 날짜) — 없으면 null */
  verifiedAt: string | null;
  /** published · under_review(그 기사의 출처에 열린 원문 검수 항목 — REG1-13 '검토 중') */
  status: RegionArticleStatus;
}

export interface RegionArticlesBody {
  region: { code: string; name: string; level: string };
  topic: LocalTopic | null;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  items: RegionArticleApiItem[];
}

/** 기사 목록 + 그 기사들의 출처·검수 표시 → 응답 항목 */
export function regionArticleItems(items: readonly ArticleListItem[], sources: readonly RegionSourceRow[], reviewing: ReadonlySet<number>): RegionArticleApiItem[] {
  const superseded = supersededIds(sources);
  return items.map((a) => {
    const own = sources.filter((s) => Number(s.article_id) === a.id && !superseded.has(Number(s.id)));
    const cards = own.filter(isVerifiedOfficial).flatMap((s) => officialCard(s) ?? []);
    const verified = cards.map((c) => c.verifiedOn).sort();
    return {
      id: a.id,
      title: a.title,
      summary: a.summary,
      url: a.href,
      section: a.section,
      contentType: a.contentType,
      editorialField: a.editorialField,
      regionCodes: [...a.regionCodes],
      author: a.authorName,
      publishedOn: a.publishedOn,
      modifiedOn: a.modifiedOn,
      source: cards.length ? issuerSummary(cards) : "편집국",
      verifiedAt: verified[0] ?? null,
      status: own.some((s) => reviewing.has(Number(s.id))) ? "under_review" : "published",
    };
  });
}
