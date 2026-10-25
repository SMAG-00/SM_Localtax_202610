// 관련 자료 패널 (LAW-06 · TX-11) - 순수 모듈. "왜 관련 있나"는 연결의 관계 값에서만 만든다(AI 생성 0).
export type LinkRelation = "cites" | "interprets" | "explains";
export type DocType = "ruling" | "circular" | "interpretation" | "tribunal" | "case";

export const DOC_TYPE_NOUN: Readonly<Record<DocType, string>> = { ruling: "예규", circular: "통칙", interpretation: "유권해석", tribunal: "심판 결정례", case: "판례" };
/** 패널 탭: 판례[판] · 심판[심] · 해석[해](예규·통칙·유권해석) · 기사 */
export const PANEL_TABS = ["case", "tribunal", "interpretation", "article"] as const;
export type PanelTab = (typeof PANEL_TABS)[number];
export const PANEL_TAB_LABELS: Readonly<Record<PanelTab, string>> = { case: "판", tribunal: "심", interpretation: "해", article: "기사" };
export const PANEL_TAB_NAMES: Readonly<Record<PanelTab, string>> = { case: "판례", tribunal: "심판", interpretation: "해석", article: "기사" };

export interface RelatedItem {
  linkId: number;
  kind: "legal_doc" | "article";
  docType: DocType | null;
  relation: LinkRelation;
  origin: "auto" | "editor";
  title: string;
  href: string;
  /** 문서 결정일 - 기사는 null */
  decidedOn: string | null;
}

export const tabOf = (i: Pick<RelatedItem, "kind" | "docType">): PanelTab =>
  i.kind === "article" ? "article" : i.docType === "case" ? "case" : i.docType === "tribunal" ? "tribunal" : "interpretation";

/** 조문 쪽에서 본 이유 한 줄 */
export function reasonForProvision(i: Pick<RelatedItem, "kind" | "docType" | "relation">): string {
  const noun = i.kind === "article" ? "기사" : DOC_TYPE_NOUN[i.docType ?? "ruling"];
  const verb = i.relation === "interprets" ? "해석한" : i.relation === "explains" ? "설명한" : "인용한";
  return `이 조문을 ${verb} ${noun}`;
}

/** 문서 쪽에서 본 연결 기사의 이유 */
export function reasonForArticleOfDoc(relation: LinkRelation): string {
  return relation === "explains" ? "이 문서를 해설한 기사" : "이 문서를 인용한 기사";
}

/** 기준일 이후 문서인가 - 결정일이 기준일보다 뒤여야 한다(당일은 이후가 아니다) (TX-11) */
export const isAfterAsOf = (decidedOn: string | null, asOf: string): boolean => decidedOn !== null && decidedOn > asOf;

export function groupByTab(items: readonly RelatedItem[]): Record<PanelTab, RelatedItem[]> {
  const out: Record<PanelTab, RelatedItem[]> = { case: [], tribunal: [], interpretation: [], article: [] };
  for (const i of items) out[tabOf(i)].push(i);
  for (const t of PANEL_TABS) {
    out[t].sort((a, b) => {
      const x = a.decidedOn ?? "";
      const y = b.decidedOn ?? "";
      return x === y ? b.linkId - a.linkId : x < y ? 1 : -1;
    });
  }
  return out;
}
