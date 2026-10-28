// 기사 편집 화면 '발행까지 할 일' 단계표 (F4) — 발행 판정(canPublish·failed·findings)을 순서 있는 단계로 바꾼다. 순수 함수 (시험: publish-steps.test.ts)
//  · 판정은 서버가 한 번만 한다(GET check와 같은 gateFor). 이 파일은 판정 결과를 '누가·어디서·무엇을' 순서로 옮길 뿐, 새로 판정하지 않는다.
//  · 규칙 ID → 단계 잇는 표는 이 파일 한 곳에만 둔다. 표에 없는 ID는 '그 밖의 막힘'으로 가서 메시지 그대로 보인다(사라지지 않음).
import type { Finding } from "@ltr/editorial";

export type StepStatus = "done" | "todo" | "other";

export const STEP_STATUS_LABELS: Record<StepStatus, string> = { done: "끝남 ✓", todo: "할 일", other: "다른 사람 차례" };

/** 바로 가기 — 같은 화면의 칸으로 스크롤·포커스(selector) 또는 다른 화면(href) */
export type StepTarget = { kind: "local"; selector: string } | { kind: "page"; href: string };

export interface StepItem {
  message: string;
  target: StepTarget;
}

export type StepId = "save" | "image-rights" | "sources" | "other-blockers" | "submit" | "tax-review" | "desk-edit" | "publish";

export interface PublishStep {
  id: StepId;
  number: number;
  title: string;
  status: StepStatus;
  /** 누가 하는지 — 역할 이름 */
  who: string;
  /** 지금 로그인한 계정이 이 단계를 할 수 있는가 */
  whoIsMe: boolean;
  description: string;
  /** 단계 단위 바로 가기 (없으면 null) */
  target: StepTarget | null;
  /** 막힘 문장 목록 (끝난 단계는 비어 있음) */
  items: StepItem[];
  /** 마지막에 하라는 등 덧붙이는 안내 */
  note: string | null;
  /** 눌러서 하는 단계인가 — 발행 단계는 모든 막힘이 풀려야 true */
  enabled: boolean;
}

export interface StepsViewer {
  canEdit: boolean;
  canSubmit: boolean;
  canConfirmRights: boolean;
  canDeskEdit: boolean;
  canTaxReview: boolean;
  canPublish: boolean;
  /** 지금 로그인한 계정이 이 기사의 작성자인가 */
  isAuthor: boolean;
}

export interface StepsInput {
  articleId: number;
  /** articles.status — draft·held·in_review·approved·published … */
  articleStatus: string;
  canPublish: boolean;
  failed: readonly string[];
  findings: readonly Finding[];
  /** 세무 감수 대상 이유 (gateReport.taxReviewReasons) — 비면 감수 대상이 아님 */
  taxReviewReasons: readonly string[];
  viewer: StepsViewer;
}

const WHO = { reporter: "기자", editor: "편집 책임자", reviewer: "세무 감수위원" } as const;

const IMAGE_RIGHTS_IDS = new Set(["nav04.image-rights"]);
const SOURCE_IDS = new Set(["nav04.sources-required", "pr13.bill-status-source", "pr07.license-required"]);
const BASIC_IDS = new Set(["nav03.author-required"]);
const BASIC_PREFIXES = ["art01."];
const BASIC_FIELDS = new Set(["title", "summary", "slug"]);
const DESK_EDIT_IDS = new Set(["nav03.desk-edit-required", "nav12.self-desk-edit"]);
const TAX_REVIEW_IDS = new Set(["nav03.tax-review-required"]);

const CHECK_PANEL = '[data-testid="check-panel"]';
export const SOURCE_FORM_FOCUS = "#source-suggest-button";

const FIELD_TARGET: Record<string, string> = {
  title: "#meta-title",
  summary: "#meta-summary",
  slug: "#meta-slug",
  leadImage: "#meta-lead-media",
  sources: "#sources",
  evidence: "#evidence",
  datasets: "#evidence",
  interviews: "#evidence",
  taxLens: "#taxlens",
  partner: "#meta-partner",
  editorialField: "#meta-editorial-field",
  publicQuestion: "#meta-public-question",
  regionCodes: "#meta-region-codes",
  relationTypes: "#meta-relation-types",
  coversBillStatus: "#meta-covers-bill-status",
  interestDisclosure: "#meta-interest-disclosure",
  editorialJudgement: "#regional",
  seoLint: CHECK_PANEL,
  reviews: CHECK_PANEL,
};

/** 막힘 한 줄이 가리키는 칸 — location의 field·blockIndex로 정한다. 모르는 칸은 점검 패널 */
export function targetOfFinding(f: Pick<Finding, "location">): StepTarget {
  const loc = f.location;
  if (!loc) return { kind: "local", selector: CHECK_PANEL };
  if (loc.field === "blocks") {
    return { kind: "local", selector: loc.blockIndex === undefined ? "#blocks" : `[data-testid="block-${loc.blockIndex}"]` };
  }
  return { kind: "local", selector: FIELD_TARGET[loc.field] ?? CHECK_PANEL };
}

const toItem = (f: Finding): StepItem => ({ message: f.message, target: targetOfFinding(f) });

function isBasic(f: Finding): boolean {
  return BASIC_IDS.has(f.id) || BASIC_PREFIXES.some((p) => f.id.startsWith(p)) || (f.location !== undefined && BASIC_FIELDS.has(f.location.field));
}

/** 발행까지 할 일 8단계 — 순서는 발행 절차 순. 막힘(level=block)만 단계에 넣고, 경고는 점검 패널에 맡긴다 */
export function publishSteps(input: StepsInput): PublishStep[] {
  const { viewer, articleId } = input;
  const blocking = input.findings.filter((f) => f.level === "block");
  const taken = new Set<Finding>();
  const take = (pred: (f: Finding) => boolean) => {
    const out = blocking.filter((f) => !taken.has(f) && pred(f));
    for (const f of out) taken.add(f);
    return out;
  };

  const rights = take((f) => IMAGE_RIGHTS_IDS.has(f.id));
  const tax = take((f) => TAX_REVIEW_IDS.has(f.id));
  const desk = take((f) => DESK_EDIT_IDS.has(f.id));
  const sources = take((f) => SOURCE_IDS.has(f.id));
  const basic = take(isBasic);
  const rest = take(() => true);
  // 판정은 막았는데 막힘 문장이 없는 규칙 ID — 사라지지 않게 점검 패널로 보낸다
  const known = new Set(blocking.map((f) => f.id));
  const restItems: StepItem[] = [
    ...rest.map(toItem),
    ...input.failed.filter((id) => !known.has(id)).map((id) => ({ message: `발행 점검에서 막혔습니다 (${id}) — 점검 패널에서 내용을 확인하세요`, target: { kind: "local", selector: CHECK_PANEL } as StepTarget })),
  ];

  const submitted = input.articleStatus !== "draft" && input.articleStatus !== "held";
  const status = (open: boolean, mine: boolean): StepStatus => (!open ? "done" : mine ? "todo" : "other");
  const authorNote = "작성자 본인은 승인할 수 없습니다";

  const steps: PublishStep[] = [
    {
      id: "save",
      number: 1,
      title: "본문·기본 정보 저장",
      status: status(basic.length > 0, viewer.canEdit),
      who: WHO.reporter,
      whoIsMe: viewer.canEdit,
      description: basic.length > 0 ? "제목·요약·분야·본문을 채워 저장합니다. 고친 뒤에는 꼭 [저장]을 누릅니다." : "기본 정보에 막힘이 없습니다. 고친 내용이 있으면 [저장]을 누릅니다.",
      target: basic[0] ? targetOfFinding(basic[0]) : { kind: "local", selector: "#meta-title" },
      items: basic.map(toItem),
      note: null,
      enabled: true,
    },
    {
      id: "image-rights",
      number: 2,
      title: "사진 권리 확인",
      status: status(rights.length > 0, viewer.canConfirmRights),
      who: WHO.editor,
      whoIsMe: viewer.canConfirmRights,
      description: rights.length > 0 ? "본문·대표 사진마다 이용 권리를 사진 보관함에서 확인합니다. 확인 버튼은 편집 책임자만 누릅니다." : "쓴 사진의 이용 권리가 모두 확인됐습니다.",
      target: { kind: "page", href: "/admin/media" },
      items: rights.map((f) => ({ message: f.message, target: { kind: "page", href: "/admin/media" } as StepTarget })),
      note: null,
      enabled: true,
    },
    {
      id: "sources",
      number: 3,
      title: "출처 더하기",
      status: status(sources.length > 0, viewer.canEdit),
      who: WHO.reporter,
      whoIsMe: viewer.canEdit,
      description:
sources.length > 0 ? "본문 링크에서 자동으로 채워 드립니다 — 확인 후 추가" : "필요한 출처가 갖춰졌습니다.",
      target: { kind: "local", selector: SOURCE_FORM_FOCUS },
      items: sources.map((f) => ({ message: f.message, target: { kind: "local", selector: SOURCE_FORM_FOCUS } as StepTarget })),
      note: null,
      enabled: true,
    },
    {
      id: "other-blockers",
      number: 4,
      title: "그 밖의 막힘",
      status: status(restItems.length > 0, viewer.canEdit),
      who: WHO.reporter,
      whoIsMe: viewer.canEdit,
      description: restItems.length > 0 ? "아래 문장대로 해당 칸을 고칩니다." : "그 밖의 막힘이 없습니다.",
      target: restItems[0]?.target ?? null,
      items: restItems,
      note: null,
      enabled: true,
    },
    {
      id: "submit",
      number: 5,
      title: "검수 요청",
      status: status(!submitted, viewer.canSubmit),
      who: WHO.reporter,
      whoIsMe: viewer.canSubmit,
      description: submitted ? "검토를 요청했습니다." : "1~4단계를 마치고 저장한 뒤 [검토 요청]을 누르면 편집 책임자가 승인할 수 있습니다.",
      target: { kind: "local", selector: "#submit-for-review" },
      items: [],
      note: null,
      enabled: true,
    },
    {
      id: "tax-review",
      number: 6,
      title: "세무 감수 서명",
      status: status(tax.length > 0, viewer.canTaxReview),
      who: WHO.reviewer,
      whoIsMe: viewer.canTaxReview,
      description:
        tax.length > 0
          ? "세무 감수위원이 검토·발행 화면의 감수 칸에서 서명합니다."
          : input.taxReviewReasons.length > 0
            ? "세무 감수 서명이 있습니다."
            : "이 기사는 세무 감수 대상이 아닙니다.",
      target: { kind: "page", href: `/admin/reviews/${articleId}#tax-review` },
      items: tax.map((f) => ({ message: f.message, target: { kind: "page", href: `/admin/reviews/${articleId}#tax-review` } as StepTarget })),
      note: null,
      enabled: true,
    },
    {
      id: "desk-edit",
      number: 7,
      title: "편집 승인",
      status: status(desk.length > 0, viewer.canDeskEdit && !viewer.isAuthor),
      who: WHO.editor,
      whoIsMe: viewer.canDeskEdit && !viewer.isAuthor,
      description:
        desk.length === 0
          ? "현재 버전에 편집 승인이 있습니다."
          : viewer.isAuthor
            ? `${authorNote} — 작성자가 아닌 편집 책임자 계정으로 로그인해 승인합니다.`
            : "작성자가 아닌 편집 책임자 계정으로 로그인해 검토·발행 화면에서 승인합니다.",
      target: { kind: "page", href: `/admin/reviews/${articleId}#desk-edit` },
      items: desk.map((f) => ({ message: f.message, target: { kind: "page", href: `/admin/reviews/${articleId}#desk-edit` } as StepTarget })),
      note: desk.length > 0 ? "편집 승인은 기사 버전에 묶입니다. 다른 단계를 다 끝낸 뒤 마지막에 받습니다 — 승인 뒤에 고치면 다시 받아야 합니다." : null,
      enabled: true,
    },
    {
      id: "publish",
      number: 8,
      title: "발행",
      status: input.canPublish && input.failed.length === 0 ? (viewer.canPublish ? "todo" : "other") : "todo",
      who: WHO.editor,
      whoIsMe: viewer.canPublish,
      description: input.canPublish && input.failed.length === 0 ? "모든 막힘이 풀렸습니다. 점검·발행 칸의 [발행]을 누릅니다." : "1~7단계의 막힘이 모두 풀리면 [발행] 버튼이 켜집니다.",
      target: { kind: "local", selector: "#publish-button" },
      items: [],
      note: null,
      enabled: input.canPublish && input.failed.length === 0,
    },
  ];
  return steps;
}
