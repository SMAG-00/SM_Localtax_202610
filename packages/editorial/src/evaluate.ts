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
import { checkBillStatus } from "./checks/bill-status";
import { checkColumnInterest } from "./checks/column-interest";
import { checkRegional } from "./checks/regional";
import { checkRegionalWarnings } from "./checks/regional-warnings";
import { checkReviews } from "./checks/reviews";
import { checkRevision } from "./checks/revision";
import { checkSolvedCase } from "./checks/solved-case";
import { checkSourcing } from "./checks/sourcing";
import { checkSponsorMaterial } from "./checks/sponsor-material";
import { checkTaxLens } from "./checks/tax-lens";
import { sortFindings, type Finding, type RuleId } from "./findings";
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
  checkRegional,
  checkBillStatus,
  checkColumnInterest,
  checkRegionalWarnings,
  checkReviews,
  checkQuantitative,
  checkQualitative,
  checkTaxLens,
  checkAmendment,
  checkSolvedCase,
  checkPlainLanguage,
  checkPressure,
  checkPartnership,
  checkSponsorMaterial,
  checkRevision,
  checkExternal,
];

/**
 * 간편 발행 (2026-10-31 PO 결정 — "기사는 전문기자·회계사·세무사가 써서 올린다, 복잡한 절차는 모두 뺀다").
 * 이 정책에서 발행을 막는 규칙은 아래뿐입니다. 나머지 차단 규칙은 경고(발행 기록에만 남음)로 낮춥니다.
 *  · 법적 의무 — 광고·협찬 표시(ART-01·ART-10·PR-04·REG1-17 이해관계), 사진·공공 자료 저작권(ART-09·NAV-04·PR-07), 상속·증여 사례 동의·비식별과 개인정보 형식(NAV-11·CAT-05)
 *  · 기술적 고장 — 예약 주소, 동영상 임베드 주소, 작성자·분야·기사 유형 없음
 *  · DB가 같은 조건으로 다시 막는 규칙 — 지역 기사(REG1-17), 법안 상태 출처(PR-13), 부동산 칼럼 자문 관계(PR-14), 공식 자료 종류·칸(REG1-07·09)
 * 편집 승인·세무 감수(NAV-03)는 막지 않습니다 — 작성자가 바로 발행하고, 세무 감수는 작성자 본인 책임으로 대체합니다(발행 기록에 남김).
 */
export const SIMPLE_PUBLISH_BLOCKERS: ReadonlySet<RuleId> = new Set<RuleId>([
  "art01.section-required",
  "art01.content-type-required",
  "art01.sponsored-label-required",
  "art01.reserved-slug",
  "art08.embed-url",
  "art09.photo-credit",
  "art09.photo-license",
  "nav03.author-required",
  "nav04.image-rights",
  "reg1_07.source-type",
  "reg1_09.official-fields",
  "pr07.license-required",
  "pr07.photo-license",
  "pr07.full-text",
  "pr04.sponsor-material-sponsored",
  "reg1_17.region-tag-required",
  "reg1_17.editorial-field",
  "reg1_17.public-question",
  "reg1_17.field-judge-missing",
  "reg1_17.non-news-judgement",
  "reg1_17.relation-required",
  "reg1_17.relation-evidence",
  "reg1_17.interest-disclosure",
  "pr13.bill-status-source",
  "pr14.column-interest",
  "nav11.inheritance-consent",
  "nav11.inheritance-deidentified",
  "cat05.pii",
  "art10.label-requires-sponsored",
  "art10.co-planned-partner-required",
  "art10.partner-requires-label",
  "art10.partner-contract-expired",
  "art05.update-kind-required",
  "art05.reason-required",
]);

/** 판정 정책 — strict는 규칙 목록의 등급 그대로, simple은 간편 발행(SIMPLE_PUBLISH_BLOCKERS 밖의 차단을 경고로) */
export type PublishPolicy = "strict" | "simple";

export interface PublishOptions {
  /** 기본 strict. 편집국 발행 판정은 simple을 씁니다 (2026-10-31 PO 결정) */
  policy?: PublishPolicy;
  /**
   * 확장 자리 — 후속 게이트를 여기에 붙인다 (01B REG1-17 지역 기사 게이트는 W4 7단계에서 내장 검사 checkRegional이 되었다).
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
  const raw = checks.flatMap((check) => check(article, ctx));
  const findings = sortFindings(options.policy === "simple" ? raw.map(simplify) : raw);
  const blockers = findings.filter((f) => f.level === "block");
  const warnings = findings.filter((f) => f.level === "warn");
  return { canPublish: blockers.length === 0, blockers, warnings, findings };
}

/** 간편 발행 — 남길 차단이 아닌 차단 항목은 경고로 낮춘다 (항목 ID·근거·문장은 그대로) */
function simplify(f: Finding): Finding {
  return f.level === "block" && !SIMPLE_PUBLISH_BLOCKERS.has(f.id as RuleId) ? { ...f, level: "warn" } : f;
}
