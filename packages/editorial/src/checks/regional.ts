// REG1-17 지역 기사 편집 게이트 (01B W4 7단계 — docs/dev/W4_설계.md 1장 7단계 · 2.1 · 12장 #7·#9·#30)
// DB 트리거(마이그레이션 20261022000043 regional_publish_problem · editorial_reviews_regional_guard)와 같은 규칙을 발행 서비스 쪽에서 한 번 더 본다.
//  · 지자체뉴스 기사는 지역 태그가 있어야 새로 발행 (이미 공개된 적 있는 기사는 그대로 — 12장 #30)
//  · 지역 태그 기사(광고·협찬 제외)는 편집 분야·공익적 질문, 그 분야에 판정 책임자(설정 regional_judge_fields)가 있어야 한다 — 없으면 보류(held)
//  · 여행 후기·맛집 추천·행사 홍보 판정 원고는 보도기사·해설로 발행하지 않는다 (별도 상품 검토 큐 — 8단계)
//  · 축제·명소·상권 소재(광고·협찬 제외)는 관계 유형 1개 이상 + 근거 1건 이상이어야 기사 후보 — 아니면 보류(held)
//  · 지역 기사 편집 승인은 근거·관계·광고 독립성 3항목 확인, 광고·협찬 계약 제휴사를 다룬 원고는 이해관계 표시
import { finding, type Finding } from "../findings";
import {
  EDITORIAL_FIELD_NAMES,
  EDITORIAL_JUDGEMENT_LABELS,
  NON_NEWS_BLOCKED_TYPES,
  NON_NEWS_JUDGEMENTS,
  REGIONAL_DESK_CHECKLIST,
  REGIONAL_JUDGE_FIELDS_DEFAULT,
  RELATION_SUBJECT_KINDS,
  SUBJECT_KIND_LABELS,
  type ArticleForPublish,
  type EditorialField,
  type EditorialReview,
  type PublishContext,
  type RegionalDeskCheck,
  type RegionalFacts,
} from "../model";
import { isBlank } from "../text";
import { countsAsDeskReview } from "./reviews";

/** 3항목 짧은 이름 — 문장 안에 쓴다 (긴 글자는 REGIONAL_DESK_CHECKLIST_LABELS) */
const REGIONAL_CHECK_NAMES: Readonly<Record<RegionalDeskCheck, string>> = { evidence: "근거", relation: "관계", ad_independence: "광고 독립성" };

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

const HELD_IDS: ReadonlySet<string> = new Set([
  "reg1_17.region-tag-required",
  "reg1_17.editorial-field",
  "reg1_17.public-question",
  "reg1_17.field-judge-missing",
  "reg1_17.relation-required",
  "reg1_17.relation-evidence",
]);

/**
 * 편집 승인 기록 중 현재 버전의 가장 늦은 desk_edit(작성 기자 본인 제외 — 인정되는 본인 발행 승인은 넣는다, 서명된 것) — isApproved와 같은 기준.
 * 승인 3항목 판정에 쓴다
 */
function latestDeskReview(a: ArticleForPublish): EditorialReview | null {
  let best: EditorialReview | null = null;
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const r of a.reviews) {
    if (r.kind !== "desk_edit" || r.forVersion !== a.version || !countsAsDeskReview(a, r) || r.signedAt === null) continue;
    const t = Date.parse(r.signedAt);
    if (Number.isNaN(t) || t < bestTime) continue;
    bestTime = t;
    best = r;
  }
  return best;
}

/** 승인 checklist에서 빠진 지역 기사 3항목 (근거·관계·광고 독립성) — 편집 승인 API·DB 트리거와 같은 키 */
export function missingRegionalChecks(checklist: Readonly<Record<string, unknown>> | null | undefined): string[] {
  return REGIONAL_DESK_CHECKLIST.filter((k) => checklist?.[k] !== true);
}

export function checkRegional(article: ArticleForPublish, ctx: PublishContext): Finding[] {
  const out: Finding[] = [];
  const r = regionalFacts(article);
  const sponsored = article.contentType === "sponsored";
  const tagged = r.regionCodes.length > 0;
  const judgeFields: readonly EditorialField[] = ctx.regionalJudgeFields ?? REGIONAL_JUDGE_FIELDS_DEFAULT;

  if (article.firstPublishedAt === null && article.section === "local" && !tagged) {
    out.push(finding("reg1_17.region-tag-required", "지자체뉴스 기사는 지역 태그가 있어야 새로 발행할 수 있습니다 — 지역 코드를 적으세요 (REG1-17 · W4 12장 #30)", { field: "regionCodes" }));
  }
  if (tagged && !sponsored) {
    if (r.editorialField === null) {
      out.push(finding("reg1_17.editorial-field", "지역 태그가 있는 기사는 편집 분야(지방세·부동산 세금·지방재정·도시/부동산 정책 중 하나)를 골라야 발행됩니다 (REG1-17)", { field: "editorialField" }));
    } else if (!judgeFields.includes(r.editorialField)) {
      out.push(
        finding("reg1_17.field-judge-missing", `편집 분야 '${EDITORIAL_FIELD_NAMES[r.editorialField]}'에 판정 책임자가 지정되지 않아 이 지역 기사는 보류(held)입니다 — 운영 설정 regional_judge_fields (REG1-17 · W4 12장 #7)`, {
          field: "editorialField",
        }),
      );
    }
    if (isBlank(r.publicQuestion)) {
      out.push(finding("reg1_17.public-question", "지역 태그가 있는 기사는 공익적 질문을 적어야 발행됩니다 (REG1-17)", { field: "publicQuestion" }));
    }
  }
  if (r.judgement !== null && isNonNewsJudgement(r.judgement) && (NON_NEWS_BLOCKED_TYPES as readonly (string | null)[]).includes(article.contentType)) {
    out.push(
      finding("reg1_17.non-news-judgement", `편집자가 '${EDITORIAL_JUDGEMENT_LABELS[r.judgement]}'(으)로 판정한 원고는 보도기사·해설로 발행할 수 없습니다 — 별도 상품 검토 큐로 보냅니다 (REG1-17)`, {
        field: "editorialJudgement",
      }),
    );
  }
  if ((RELATION_SUBJECT_KINDS as readonly string[]).includes(r.subjectKind) && !sponsored) {
    const subject = SUBJECT_KIND_LABELS[r.subjectKind];
    if (r.relationTypes.length === 0) {
      out.push(
        finding("reg1_17.relation-required", `${subject} 소재 원고는 관계 유형(예산·세수·공유재산·개발·거래·주거 영향) 1개 이상이 있어야 기사 후보가 됩니다 — 지금은 보류(held) (REG1-17)`, {
          field: "relationTypes",
        }),
      );
    }
    if (!article.evidence.some((e) => e.verificationStatus !== "rejected")) {
      out.push(finding("reg1_17.relation-evidence", `${subject} 소재 원고는 관계를 뒷받침하는 취재 근거 1건 이상이 있어야 기사 후보가 됩니다 — 지금은 보류(held) (REG1-17)`, { field: "evidence" }));
    }
  }

  if (isRegionalArticle(article)) {
    // 편집 승인 3항목 — 승인 기록이 있을 때만 본다 (승인 자체가 없으면 nav03.desk-edit-required)
    const desk = latestDeskReview(article);
    if (desk && desk.decision === "approve") {
      const missing = missingRegionalChecks(desk.checklist);
      if (missing.length > 0) {
        out.push(
          finding("reg1_17.desk-checklist", `지역 기사 편집 승인에 확인 항목이 빠졌습니다: ${missing.map((k) => REGIONAL_CHECK_NAMES[k as RegionalDeskCheck]).join("·")} — 다시 승인받으세요 (REG1-17)`, {
            field: "reviews",
          }),
        );
      }
    }
    if (r.contractedPartners.length > 0 && isBlank(r.interestDisclosure)) {
      out.push(
        finding("reg1_17.interest-disclosure", `광고·협찬 계약 기록이 있는 제휴사(${r.contractedPartners.map((p) => p.name).join("·")})를 다룬 원고는 이해관계 표시가 있어야 승인·발행됩니다 (REG1-17 · NAV-06)`, {
          field: "interestDisclosure",
        }),
      );
    }
  }
  return out;
}

/** 지역 기사 판정 상태와 이유 — 편집 화면 '지역 기사 판정' 줄 (발행 판정과 같은 검사 결과에서) */
export function regionalState(article: ArticleForPublish, ctx: PublishContext): { state: RegionalState; reasons: string[] } {
  const r = regionalFacts(article);
  const findings = checkRegional(article, ctx);
  if (!isRegionalArticle(article) && !(RELATION_SUBJECT_KINDS as readonly string[]).includes(r.subjectKind) && r.judgement === null) {
    return { state: "not_regional", reasons: [] };
  }
  if (isNonNewsJudgement(r.judgement)) {
    return { state: "separate_product", reasons: findings.filter((f) => f.id === "reg1_17.non-news-judgement").map((f) => f.message) };
  }
  const held = findings.filter((f) => HELD_IDS.has(f.id));
  return held.length > 0 ? { state: "held", reasons: held.map((f) => f.message) } : { state: "candidate", reasons: [] };
}
