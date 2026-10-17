// NAV-11 정성형 — 필수 기록(취재 질문·현장 확인·독립 근거·반대/보완 관점·문서 근거·이해관계)은 정성형·혼합형 보도기사,
// 인용 기록·익명 사유·미확인 기록·세금 쟁점·지역 정책 쟁점·상속·증여 사례는 표시가 있는 모든 원고에 적용한다.
import { finding, type Finding, type RuleId } from "../findings";
import { PERSPECTIVE_KEYS, type ArticleForPublish, type PerspectiveKey, type QualitativeChecklist } from "../model";
import { isBlank } from "../text";

const TEMPLATE_RECORDS: readonly [keyof QualitativeChecklist, RuleId, string][] = [
  ["interviewQuestions", "nav11.interview-questions", "취재 질문 기록이 없습니다"],
  ["fieldRecord", "nav11.field-record", "현장 확인 기록이 없습니다"],
  ["counterPerspective", "nav11.counter-perspective", "반대/보완 관점 기록이 없습니다"],
  ["conflictsOfInterest", "nav11.conflicts-of-interest", "이해관계 확인 기록이 없습니다 — 관계가 없으면 '없음'이라고 적어 주세요"],
];

export const PERSPECTIVE_LABELS: Record<PerspectiveKey, string> = {
  local_gov: "지자체",
  residents_taxpayers: "주민·납세자",
  experts: "전문가",
};

/** 서로 독립적인 근거로 치는 유형 */
const INDEPENDENT_TYPES = new Set(["interview", "field", "document"]);
/** 독립 근거 최소 건수 — '서로 독립적인 취재원'(복수) */
const MIN_INDEPENDENT = 2;

export function isQualitative(article: ArticleForPublish): boolean {
  return article.contentType === "reported_news" && (article.reportingMethod === "qualitative" || article.reportingMethod === "mixed");
}

/** YYYY-MM-DD이고 실제 있는 날짜 */
export function isValidDate(value: string | null): boolean {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function checkQualitative(article: ArticleForPublish): Finding[] {
  return [
    ...(isQualitative(article) ? templateRecords(article) : []),
    ...quoteRecords(article),
    ...anonymity(article),
    ...unverified(article),
    ...taxIssue(article),
    ...localPolicy(article),
    ...inheritanceGift(article),
  ];
}

function templateRecords(article: ArticleForPublish): Finding[] {
  const out: Finding[] = [];
  const checklist = article.qualitativeChecklist;
  for (const [key, id, message] of TEMPLATE_RECORDS) {
    if (isBlank(checklist?.[key])) out.push(finding(id, message));
  }
  const verified = article.evidence.filter((e) => e.verificationStatus === "verified");
  const independent = verified.filter((e) => INDEPENDENT_TYPES.has(e.evidenceType)).length;
  if (independent < MIN_INDEPENDENT) {
    out.push(
      finding(
        "nav11.independent-sources",
        `서로 독립적인 근거(인터뷰·현장·문서)가 ${MIN_INDEPENDENT}건 이상 있어야 합니다 — 지금 ${independent}건`,
      ),
    );
  }
  if (!verified.some((e) => e.evidenceType === "document")) {
    out.push(finding("nav11.document-evidence", "문서 근거가 없습니다 — 원문·공문 등 문서 근거를 1건 이상 연결해 주세요"));
  }
  return out;
}

/** 인용 블록마다 — 취재원 발언은 인터뷰 기록(접촉일·기록 보존 위치·인용 동의), 문서 인용은 출처 또는 문서 근거 */
function quoteRecords(article: ArticleForPublish): Finding[] {
  const out: Finding[] = [];
  article.blocks.forEach((block, blockIndex) => {
    if (block.type !== "quote") return;
    const location = { field: "blocks", blockIndex, ...(block.refId === null ? {} : { phrase: block.refId }) };
    if (block.refId === null) {
      out.push(finding("nav11.quote-record", "인용에 연결한 기록이 없습니다 — 인터뷰 기록이나 문서 출처를 연결해 주세요", location));
      return;
    }
    if (block.origin === "document") {
      const known =
        article.sources.some((s) => s.id === block.refId) ||
        article.evidence.some((e) => e.id === block.refId && e.evidenceType === "document");
      if (!known) out.push(finding("nav11.quote-record", "문서 인용에 연결한 출처·문서 근거가 없습니다", location));
      return;
    }
    const interview = article.interviews.find((i) => i.evidenceId === block.refId);
    if (interview === undefined) {
      out.push(finding("nav11.quote-record", "인용에 인터뷰 기록이 없습니다 — 접촉일·기록 보존 위치·인용 동의를 남겨 주세요", location));
      return;
    }
    const missing = [
      isBlank(interview.contactedAt) ? "접촉일" : null,
      isBlank(interview.recordLocation) ? "기록 보존 위치" : null,
      interview.quoteConsent === null ? "인용 동의" : null,
    ].filter((x): x is string => x !== null);
    if (missing.length > 0) {
      out.push(finding("nav11.quote-record", `인터뷰 기록에 비어 있는 칸: ${missing.join(", ")}`, location));
    } else if (interview.quoteConsent === "none") {
      out.push(finding("nav11.quote-record", "취재원이 인용에 동의하지 않았습니다 — 인용할 수 없습니다", location));
    }
  });
  return out;
}

function anonymity(article: ArticleForPublish): Finding[] {
  return article.interviews
    .filter((i) => i.anonymity === "anonymous" && isBlank(i.anonymityReason))
    .map((i) =>
      finding("nav11.anonymity-reason", `익명 취재원(${i.subjectRole})의 익명 처리 사유가 없습니다`, { field: "interviews", phrase: i.evidenceId }),
    );
}

/** 확인되지 않은 인터뷰·현장 기록은 반려 (AI가 만든 인용·미확인 방문 기록 포함) */
function unverified(article: ArticleForPublish): Finding[] {
  return article.evidence
    .filter((e) => (e.evidenceType === "interview" || e.evidenceType === "field") && e.verificationStatus !== "verified")
    .map((e) =>
      finding("nav11.unverified-evidence", "확인되지 않은 인터뷰·현장 기록입니다 — 확인 전에는 발행할 수 없습니다", { field: "evidence", phrase: e.id }),
    );
}

/** 세금 쟁점 — 법령 기준일 (세무 감수는 reviews.ts의 감수 대상 이유로 함께 본다) */
function taxIssue(article: ArticleForPublish): Finding[] {
  if (!article.isTaxIssue || isValidDate(article.legalBasisDate)) return [];
  return [finding("nav11.legal-basis-date", "세금 쟁점 원고는 법령 기준일(YYYY-MM-DD)이 있어야 합니다")];
}

function localPolicy(article: ArticleForPublish): Finding[] {
  if (!article.isLocalPolicyIssue) return [];
  const out: Finding[] = [];
  for (const key of PERSPECTIVE_KEYS) {
    const record = article.perspectives[key];
    const ok =
      record !== null &&
      (record.status === "interviewed"
        ? record.evidenceId !== null && article.evidence.some((e) => e.id === record.evidenceId)
        : !isBlank(record.contactedAt));
    if (!ok) {
      out.push(
        finding(
          "nav11.perspective",
          `지역 정책 쟁점 — ${PERSPECTIVE_LABELS[key]} 관점의 취재 기록 또는 '접촉했으나 응답 없음' 기록이 없습니다`,
          { field: "perspectives", phrase: key },
        ),
      );
    }
  }
  const checked = article.originalTextChecks.some(
    (c) => !isBlank(c.checkedAt) && article.sources.some((s) => s.id === c.sourceId),
  );
  if (!checked) {
    out.push(finding("nav11.original-text-check", "지역 정책 쟁점 — 해당 원문과 대조한 기록이 1건 이상 있어야 합니다"));
  }
  return out;
}

function inheritanceGift(article: ArticleForPublish): Finding[] {
  if (!article.isInheritanceGiftCase) return [];
  const out: Finding[] = [];
  if (!article.inheritanceGiftChecks.consent) {
    out.push(finding("nav11.inheritance-consent", "상속·증여 사례 — 당사자 동의를 확인해야 발행됩니다"));
  }
  if (!article.inheritanceGiftChecks.deidentified) {
    out.push(finding("nav11.inheritance-deidentified", "상속·증여 사례 — 비식별 검토를 확인해야 발행됩니다"));
  }
  return out;
}
