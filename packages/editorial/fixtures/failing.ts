// 실패 견본 — 통과 견본 한 곳만 바꿔 만든 원고와, 그 원고에서 나와야 하는 차단 항목 전부.
// 발행 API E2E와 패키지 시험이 같은 견본을 쓴다.
import type { RuleId } from "../src/findings";
import type { ArticleForPublish, PublishContext } from "../src/model";
import { BASE_CONTEXT } from "./context";
import { SOLVED_CASE, TAX_EXPLAINER } from "./explainer";
import { withBlock } from "./helpers";
import { QUALITATIVE_NEWS } from "./qualitative";
import { QUANTITATIVE_NEWS } from "./quantitative";

export interface FailingSample {
  id: string;
  description: string;
  article: ArticleForPublish;
  context: PublishContext;
  /** 나와야 하는 차단 항목 ID (규칙 목록 순서) */
  expectedBlockers: readonly RuleId[];
  /** 함께 나와야 하는 경고 항목 ID (규칙 목록 순서) — 바꾼 한 곳 때문에 생기는 경고만. 대개 빈 목록 (W4 8단계 REG1-14 지역 기사 편집 경고) */
  expectedWarnings: readonly RuleId[];
}

const q = QUANTITATIVE_NEWS;
const ql = QUALITATIVE_NEWS;
const ex = TAX_EXPLAINER;

function sample(
  id: string,
  description: string,
  article: ArticleForPublish,
  expectedBlockers: readonly RuleId[],
  context: PublishContext = BASE_CONTEXT,
  expectedWarnings: readonly RuleId[] = [],
): FailingSample {
  return { id, description, article, context, expectedBlockers, expectedWarnings };
}

export const FAILING_SAMPLES: readonly FailingSample[] = [
  sample(
    "quant-no-denominator",
    "정량형 — 거래 자료의 분모를 지웠다",
    { ...q, datasets: [q.datasets[0]!, { ...q.datasets[1]!, denominator: null }] },
    ["nav10.indicator-definition"],
  ),
  sample(
    "quant-no-calculation",
    "정량형 — 징수 자료의 계산 과정(수식)과 재현 파일 해시를 지웠다",
    { ...q, datasets: [{ ...q.datasets[0]!, transform: "", reproFileHash: null }, q.datasets[1]!] },
    ["nav10.calculation"],
  ),
  sample(
    "quant-causal-unchecked",
    "정량형 — 편집자 확인 '인과 단정 없음'을 체크하지 않았다",
    { ...q, quantitativeChecklist: { ...q.quantitativeChecklist!, noCausalClaim: false } },
    ["nav10.no-causal-claim"],
  ),
  sample(
    "quant-press-release-only",
    "정량형 — 출처가 보도자료 표뿐이다",
    { ...q, sources: q.sources.filter((s) => s.kind === "press_release") },
    ["nav02.press-release-only"],
  ),
  sample(
    "quant-self-approval",
    "정량형 — 작성 기자 본인이 편집 승인했다",
    { ...q, reviews: [{ ...q.reviews[0]!, reviewerUserId: "user-reporter-01" }] },
    ["nav03.desk-edit-required", "nav12.self-desk-edit"],
  ),
  sample(
    "quant-tax-review-only",
    "보도기사 — 세무 감수만 있고 편집 승인이 없다",
    { ...q, reviews: [{ ...q.reviews[0]!, kind: "tax_review", reviewerUserId: "user-taxreviewer-01" }] },
    ["nav03.desk-edit-required"],
  ),
  // 지역 기사라 근거가 0건이면 수치 문단(1,284억 원)을 잇는 근거도 사라진다 — 근거 없는 지역 수치 경고 (REG1-14 · W4 8단계)
  sample("quant-no-evidence", "보도기사 — 자체 취재 근거가 0건이다", { ...q, evidence: [] }, ["nav04.own-evidence-required"], BASE_CONTEXT, ["reg1_14.unsupported-figure"]),
  sample(
    "quant-photo-rights",
    "보도기사 — 대표 사진 권리를 확인하지 않았다",
    { ...q, leadImage: { ...q.leadImage!, rightsStatus: "unconfirmed" } },
    ["nav04.image-rights"],
    BASE_CONTEXT,
    // 지역 기사 편집 경고 목록에도 같은 사진이 '권리 정보 누락'으로 모인다 (REG1-14 · W4 8단계)
    ["reg1_14.photo-rights"],
  ),
  sample("quant-no-tax-lens", "지자체뉴스 보도 — 「지방세로 읽기」 박스도 생략 사유도 없다", { ...q, taxLens: null }, [
    "core01.box-or-reason",
  ]),
  sample(
    "quant-tax-lens-stale",
    "지자체뉴스 보도 — 감수 뒤 박스를 고쳐 버전이 올라갔다(재감수 필요)",
    { ...q, taxLens: { ...q.taxLens!, reviewedForVersion: 2 } },
    ["core01.box-re-review"],
  ),
  sample(
    "quant-forbidden-phrase",
    "보도기사 — 문단에 금지 표현 '투자 적기'",
    withBlock(q, 5, { type: "paragraph", text: "이 수치는 거래량과 세수가 함께 줄었다는 사실을 보여 줄 뿐이다. 지금이 투자 적기라는 뜻은 아니다." }),
    ["ux01.forbidden-phrase"],
  ),
  sample(
    "qual-quote-without-interview",
    "정성형 — 임대인 인용의 인터뷰 기록이 없다",
    { ...ql, interviews: ql.interviews.filter((i) => i.evidenceId !== "ev-int-res") },
    ["nav11.quote-record"],
  ),
  sample(
    "qual-anonymous-no-reason",
    "정성형 — 익명 취재원에 익명 사유가 없다",
    { ...ql, interviews: ql.interviews.map((i) => (i.anonymity === "anonymous" ? { ...i, anonymityReason: " " } : i)) },
    ["nav11.anonymity-reason"],
  ),
  sample("qual-tax-issue-no-basis-date", "정성형 세금 쟁점 — 법령 기준일이 없다", { ...ql, legalBasisDate: null }, [
    "nav11.legal-basis-date",
  ]),
  sample(
    "qual-tax-issue-no-tax-review",
    "정성형 세금 쟁점 — 편집 승인만 있고 세무 감수가 없다",
    { ...ql, reviews: ql.reviews.filter((r) => r.kind === "desk_edit") },
    ["nav03.tax-review-required"],
  ),
  sample(
    "qual-perspective-missing",
    "지역 정책 쟁점 — 전문가 관점 기록이 없다",
    { ...ql, perspectives: { ...ql.perspectives, experts: null } },
    ["nav11.perspective"],
  ),
  sample(
    "qual-inheritance-unchecked",
    "상속·증여 사례 원고 — 동의·비식별 검토를 체크하지 않았다",
    { ...ql, isInheritanceGiftCase: true },
    ["nav11.inheritance-consent", "nav11.inheritance-deidentified"],
  ),
  sample(
    "explainer-desk-edit-only",
    "세법 해설 — 편집 승인만 있고 세무 감수가 없다",
    { ...ex, reviews: ex.reviews.filter((r) => r.kind === "desk_edit") },
    ["nav03.tax-review-required"],
  ),
  sample(
    "explainer-deadline-unchecked",
    "세법 해설 — '기한'·'가산세' 상자의 '할 일을 함께 썼다'를 체크하지 않았다",
    withBlock(ex, 5, {
      type: "callout",
      kind: "caution",
      title: "신고를 놓쳤다면",
      text: "신고 기한을 넘기면 가산세가 붙습니다.",
    }),
    ["ux03.action-not-written"],
  ),
  sample(
    "explainer-fear-phrase",
    "세법 해설 — '놓치면 끝'(금지 표현이자 공포 표현)",
    withBlock(ex, 2, { type: "paragraph", text: "과세표준은 원칙적으로 실제 거래 가격이다. 신고를 놓치면 끝이라고 겁먹을 필요는 없다." }),
    ["ux01.forbidden-phrase", "ux03.fear-phrase"],
  ),
  sample(
    "explainer-amendment-no-tracker",
    "개정 브리핑(지방세 > 개정) — 연결 트래커가 없다",
    { ...ex, category: { slug: "amendments", needsDisclaimer: true }, amendmentId: null },
    ["cat04.tracker-required"],
  ),
  sample(
    "explainer-label-not-sponsored",
    "공동 기획 표기를 했는데 유형이 해설(explainer)이다",
    {
      ...ex,
      label: "co_planned",
      partner: { id: "partner-01", name: "가온세무법인", contractFrom: "2026-01-01", contractTo: "2026-12-31" },
    },
    ["art10.label-requires-sponsored"],
  ),
  sample("explainer-seo-blocker", "최적화 점검(seo-lint)에 차단 항목 1개가 남았다", ex, ["opt03.seo-lint-blocker"], {
    ...BASE_CONTEXT,
    seoLint: { blockers: ["geo.author"], warnings: [] },
  }),
  sample(
    "solved-case-empty-lesson",
    "해결 사례 — 교훈 칸이 비었다",
    { ...SOLVED_CASE, solvedCase: { ...SOLVED_CASE.solvedCase!, lesson: "" } },
    ["cat05.cell-empty"],
  ),
  sample(
    "solved-case-phone",
    "해결 사례 — 상황 칸에 휴대전화 번호가 있다",
    {
      ...SOLVED_CASE,
      solvedCase: { ...SOLVED_CASE.solvedCase!, situation: "납세자(연락처 010-2345-6789)는 계약일부터 60일을 세어 신고했다." },
    },
    ["cat05.pii"],
  ),
];
