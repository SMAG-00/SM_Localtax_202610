// 관련 자료 패널 v2 (LAW-10) - 순수 모듈. 추천 이유는 저장된 이유 또는 관계 값에서만 만든다(AI 생성 0). 패널은 본문을 다루지 않는다.
import { DOC_TYPE_NOUN, type DocType, type LinkRelation } from "./related";

export type PanelKindV2 = "case" | "tribunal" | "interpretation" | "article" | "node" | "issue_article";
export const PANEL_KINDS_V2 = ["case", "tribunal", "interpretation", "article", "node", "issue_article"] as const;
export const PANEL_KIND_LABELS: Readonly<Record<PanelKindV2, string>> = { case: "판례", tribunal: "심판", interpretation: "해석", article: "기사", node: "지식창고", issue_article: "월간지" };
export type OriginV2 = "editor" | "auto" | "similarity";
export const ORIGIN_LABELS: Readonly<Record<OriginV2, string>> = { editor: "편집자 확인", auto: "자동 연결", similarity: "유사도 추천" };

export interface PanelItemV2 {
  linkId: number;
  kind: PanelKindV2;
  origin: OriginV2;
  relation: LinkRelation;
  title: string;
  /** 서버가 저장 이유 또는 관계 값으로 채운 한 줄 - 항상 비어 있지 않다 */
  reason: string;
  href: string;
  /** 결정일 - 결정례만 */
  decidedOn: string | null;
  similarity: number | null;
  /** 프리미엄 자료이고 이 열람자에게 열려 있지 않다 */
  locked: boolean;
  /** 분할 화면에 열 수 있는 패널 조각 (case:55 / node:9) - 열 수 없는 종류는 null */
  splitSpec: string | null;
}

export type PanelSort = "latest" | "relevance";

const VERB: Readonly<Record<LinkRelation, string>> = { interprets: "해석한", explains: "설명한", cites: "인용한" };
const NOUN: Readonly<Record<"article" | "node" | "issue_article", string>> = { article: "기사", node: "지식창고 항목", issue_article: "월간지 기사" };

/** 저장된 이유(앞뒤 공백 제거, 120자 한도)가 있으면 그것, 없으면 관계 값에서 만든 한 줄 */
export function reasonFor(stored: string | null | undefined, item: { kind: PanelKindV2; relation: LinkRelation; docType?: DocType | null }): string {
  const s = typeof stored === "string" ? stored.trim() : "";
  if (s) return Array.from(s).slice(0, 120).join("");
  const noun = item.kind === "case" ? DOC_TYPE_NOUN.case : item.kind === "tribunal" ? DOC_TYPE_NOUN.tribunal : item.kind === "interpretation" ? DOC_TYPE_NOUN[item.docType ?? "interpretation"] : NOUN[item.kind];
  return `이 조문을 ${VERB[item.relation]} ${noun}`;
}

/** 유사도 기준 {"min": 숫자} - 숫자가 아니거나 0~1 밖이면 null(유사도 추천 꺼짐). DB 뷰 public_link_similarity_min과 같은 규칙 */
export function parseSimilarityMin(value: unknown): number | null {
  const min = (value as { min?: unknown } | null | undefined)?.min;
  return typeof min === "number" && Number.isFinite(min) && min >= 0 && min <= 1 ? min : null;
}

/** 유사도 카드 통과 - 기준이 없으면 0, 점수가 기준 이상(경계 포함)이면 통과. 유사도가 아닌 카드는 항상 통과 */
export function passesSimilarity(item: Pick<PanelItemV2, "origin" | "similarity">, min: number | null): boolean {
  if (item.origin !== "similarity") return true;
  return min !== null && item.similarity !== null && item.similarity >= min;
}

/** 잠금: 프리미엄 자료 ∧ 권한 없음 */
export const isLocked = (tier: "public" | "premium" | null, entitled: boolean): boolean => tier === "premium" && !entitled;

const ORIGIN_RANK: Readonly<Record<OriginV2, number>> = { editor: 3, auto: 2, similarity: 1 };

export function filterByKind(items: readonly PanelItemV2[], kind: PanelKindV2 | "all"): PanelItemV2[] {
  return kind === "all" ? [...items] : items.filter((i) => i.kind === kind);
}

/** 최신순: 결정일 내림차순(없으면 뒤), 같으면 연결 번호 내림차순. 관련도순: 출처(편집자>자동>유사도) → 유사도 점수 내림차순 → 최신순 */
export function sortItems(items: readonly PanelItemV2[], sort: PanelSort): PanelItemV2[] {
  const latest = (a: PanelItemV2, b: PanelItemV2): number => {
    const x = a.decidedOn ?? "";
    const y = b.decidedOn ?? "";
    return x === y ? b.linkId - a.linkId : x < y ? 1 : -1;
  };
  const out = [...items];
  out.sort(sort === "latest" ? latest : (a, b) => ORIGIN_RANK[b.origin] - ORIGIN_RANK[a.origin] || (b.similarity ?? 0) - (a.similarity ?? 0) || latest(a, b));
  return out;
}

/** 유형별 개수 (필터 칩 숫자) */
export function countByKind(items: readonly PanelItemV2[]): Record<PanelKindV2 | "all", number> {
  const out = { all: items.length, case: 0, tribunal: 0, interpretation: 0, article: 0, node: 0, issue_article: 0 };
  for (const i of items) out[i.kind] += 1;
  return out;
}
