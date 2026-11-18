// REG1-17 지역 기사 편집 게이트 — 2026-11-18 PO 결정으로 걷어냈다 (지자체뉴스는 지자체뉴스일 뿐, 지역 기사 판정 없음).
// 남은 것: 지역 기사 여부(isRegionalArticle — 다른 경고 검사가 쓴다)·비보도 판정 이름표·승인 3항목 이름(missingRegionalChecks).
// 같은 규칙을 DB 트리거가 한 번 더 걸었으나 마이그레이션 20261118000243이 지웠다.
import { type Finding } from "../findings";
import {
  NON_NEWS_JUDGEMENTS,
  REGIONAL_DESK_CHECKLIST,
  type ArticleForPublish,
  type PublishContext,
  type RegionalFacts,
} from "../model";

const EMPTY: RegionalFacts = {
  regionCodes: [],
  editorialField: null,
  publicQuestion: null,
  subjectKind: "general",
  relationTypes: [],
  judgement: null,
  contractedPartners: [],
  interestDisclosure: null,
};

export const regionalFacts = (a: ArticleForPublish): RegionalFacts => a.regional ?? EMPTY;

/** 지역 기사 — 지역 태그가 있거나 지자체뉴스 분야. 광고·협찬은 기사 게이트 밖 (편집 승인 3항목·편집 분야 판정 대상 아님) */
export function isRegionalArticle(a: ArticleForPublish): boolean {
  if (a.contentType === "sponsored") return false;
  return regionalFacts(a).regionCodes.length > 0 || a.section === "local";
}

/** 비보도 판정인가 — 여행 후기·맛집 추천·행사 홍보 */
export const isNonNewsJudgement = (j: string | null | undefined): boolean => (NON_NEWS_JUDGEMENTS as readonly (string | null | undefined)[]).includes(j);

/** 지역 기사 판정 상태 — 편집 화면 표시용 (발행 판정과 같은 규칙에서 나온다) */
export type RegionalState = "not_regional" | "candidate" | "held" | "separate_product";

/** 승인 checklist에서 빠진 지역 기사 3항목 (근거·관계·광고 독립성) — 편집 승인 API·DB 트리거와 같은 키 */
export function missingRegionalChecks(checklist: Readonly<Record<string, unknown>> | null | undefined): string[] {
  return REGIONAL_DESK_CHECKLIST.filter((k) => checklist?.[k] !== true);
}

/**
 * 2026-11-18 PO 결정: 지역 기사 판정(REG1-17)을 걷어냈다 — 지자체뉴스는 지자체뉴스일 뿐이다.
 * 지역 태그·편집 분야·공익적 질문·판정 책임자·관계 유형·편집 승인 3항목 어느 것도 발행을 막거나 경고하지 않는다. 지역 칸은 선택 입력이다.
 */
export function checkRegional(_article: ArticleForPublish, _ctx: PublishContext): Finding[] {
  return [];
}

/** 지역 기사 판정 상태 — 판정을 걷어냈으므로 늘 not_regional (편집 화면 패널도 없다) */
export function regionalState(_article: ArticleForPublish, _ctx: PublishContext): { state: RegionalState; reasons: string[] } {
  return { state: "not_regional", reasons: [] };
}
