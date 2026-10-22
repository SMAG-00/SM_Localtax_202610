// 발행 판정 — 검사 모듈을 모두 돌려 차단·경고를 결정론 순서로 모은다. 발행 API가 부르고, 결과는 422 응답·발행 기록(check_log)에 쓴다.
import { checkAmendment } from "./checks/amendment";
import { checkArticleBasics } from "./checks/article-basics";
import { checkCardNews } from "./checks/card-news";
import { checkExternal } from "./checks/external";
import { checkMediaFormats } from "./checks/media-formats";
import { checkOfficialSources } from "./checks/official-sources";
import { checkPartnership } from "./checks/partnership";
import { checkPlainLanguage } from "./checks/plain-language";
import { checkPressure } from "./checks/pressure";
import { checkQualitative } from "./checks/qualitative";
import { checkQuantitative } from "./checks/quantitative";
import { checkReviews } from "./checks/reviews";
import { checkRevision } from "./checks/revision";
import { checkSolvedCase } from "./checks/solved-case";
import { checkSourcing } from "./checks/sourcing";
import { checkTaxLens } from "./checks/tax-lens";
import { sortFindings, type Finding } from "./findings";
import type { ArticleForPublish, PublishContext } from "./model";

/** 검사 하나 — 순수 함수(입력을 바꾸지 않고, 시계·네트워크를 쓰지 않는다) */
export type PublishCheck = (article: ArticleForPublish, ctx: PublishContext) => readonly Finding[];

/** 내장 검사 — 순서는 결과 순서와 상관없다(결과는 sortFindings로 정렬) */
export const BUILT_IN_CHECKS: readonly PublishCheck[] = [
  checkArticleBasics,
  checkCardNews,
  checkMediaFormats,
  checkSourcing,
  checkOfficialSources,
  checkReviews,
  checkQuantitative,
  checkQualitative,
  checkTaxLens,
  checkAmendment,
  checkSolvedCase,
  checkPlainLanguage,
  checkPressure,
  checkPartnership,
  checkRevision,
  checkExternal,
];

export interface PublishOptions {
  /**
   * 확장 자리 — 후속 게이트(01B REG1-17 지역 기사 편집 분야·공익적 질문 등)를 여기에 붙인다.
   * 추가 검사의 항목 ID는 규칙 목록 밖이라 같은 등급 안에서 내장 항목 뒤에 ID 글자순으로 온다.
   */
  extraChecks?: readonly PublishCheck[];
}

export interface PublishEvaluation {
  /** 차단 항목이 0이면 true */
  canPublish: boolean;
  blockers: Finding[];
  /** 발행을 막지 않고 발행 기록에 남기는 항목 */
  warnings: Finding[];
  /** 차단 → 경고 순서의 전체 목록 */
  findings: Finding[];
}

export function evaluatePublish(article: ArticleForPublish, ctx: PublishContext, options: PublishOptions = {}): PublishEvaluation {
  const checks = [...BUILT_IN_CHECKS, ...(options.extraChecks ?? [])];
  const findings = sortFindings(checks.flatMap((check) => check(article, ctx)));
  const blockers = findings.filter((f) => f.level === "block");
  const warnings = findings.filter((f) => f.level === "warn");
  return { canPublish: blockers.length === 0, blockers, warnings, findings };
}
