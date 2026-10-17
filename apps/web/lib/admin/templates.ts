// 새 기사 템플릿 (ART-01 · NAV-10 · NAV-11 · CAT-05 · ART-10) — 템플릿은 기사 유형·취재 방식·하위 유형과 처음 블록·확인 목록을 정한다.
// 만든 요청 본문은 POST /api/admin/articles 입력 검사를 그대로 통과해야 한다 (templates.test.ts가 실제 검사 함수로 확인).
import { RESERVED_SLUGS, SECTIONS, type ContentType, type ReportingMethod, type Section } from "@ltr/editorial";
import { can, type Viewer } from "@/lib/access";
import { blank, idOrNull, isValidDate, textOrNull, type FieldErrors } from "./form-utils";

export type TemplateId = "quantitative" | "qualitative" | "explainer" | "solved_case" | "sponsored";

export interface ArticleTemplate {
  id: TemplateId;
  label: string;
  /** 한 줄 설명 (60자 이하 — R8) */
  summary: string;
  contentType: ContentType;
  reportingMethod: ReportingMethod | null;
  subtype: "general" | "solved_case";
  defaultSection: Section | null;
  needsLegalBasisDate: boolean;
  needsLabel: boolean;
}

export const ARTICLE_TEMPLATES: readonly ArticleTemplate[] = [
  {
    id: "quantitative",
    label: "정량형 보도",
    summary: "원자료를 직접 집계해 쓰는 보도입니다. 필수 7묶음이 미리 놓입니다.",
    contentType: "reported_news",
    reportingMethod: "quantitative",
    subtype: "general",
    defaultSection: "local",
    needsLegalBasisDate: false,
    needsLabel: false,
  },
  {
    id: "qualitative",
    label: "정성형 보도",
    summary: "인터뷰·현장 취재로 쓰는 보도입니다. 인용마다 인터뷰 기록이 필요합니다.",
    contentType: "reported_news",
    reportingMethod: "qualitative",
    subtype: "general",
    defaultSection: "local",
    needsLegalBasisDate: false,
    needsLabel: false,
  },
  {
    id: "explainer",
    label: "세법 해설",
    summary: "세법·제도를 풀어 쓰는 해설입니다. 법령 기준일과 세무 감수가 필요합니다.",
    contentType: "explainer",
    reportingMethod: null,
    subtype: "general",
    defaultSection: "tax",
    needsLegalBasisDate: true,
    needsLabel: false,
  },
  {
    id: "solved_case",
    label: "해결 사례",
    summary: "상황, 쟁점, 결과, 교훈 4칸으로 씁니다. 결과에는 근거를 답니다.",
    contentType: "explainer",
    reportingMethod: null,
    subtype: "solved_case",
    defaultSection: "tax",
    needsLegalBasisDate: false,
    needsLabel: false,
  },
  {
    id: "sponsored",
    label: "광고·협찬",
    summary: "광고·협찬 콘텐츠입니다. 공동 기획과 광고 중 표기 하나를 고릅니다.",
    contentType: "sponsored",
    reportingMethod: null,
    subtype: "general",
    defaultSection: null,
    needsLegalBasisDate: false,
    needsLabel: true,
  },
];

export function templateById(id: TemplateId): ArticleTemplate {
  return ARTICLE_TEMPLATES.find((t) => t.id === id)!;
}

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === "string" && ARTICLE_TEMPLATES.some((t) => t.id === value);
}

/** 이 사람이 새로 쓸 수 있는 템플릿 — 접근 판정 한 함수로 기사 유형별로 묻는다 (광고·협찬은 광고 담당만) */
export function templatesFor(viewer: Viewer): ArticleTemplate[] {
  return ARTICLE_TEMPLATES.filter((t) => can(viewer, "article.create", { kind: "article", authorUserId: viewer.userId, contentType: t.contentType, published: false }));
}

/** 기획의 취재 방식 → 템플릿. 혼합형은 정량형 템플릿에 정성형 기록 칸을 더한다 */
export function templateForMethod(method: string | null | undefined): { templateId: TemplateId; reportingMethod: ReportingMethod } {
  if (method === "qualitative") return { templateId: "qualitative", reportingMethod: "qualitative" };
  if (method === "mixed") return { templateId: "quantitative", reportingMethod: "mixed" };
  return { templateId: "quantitative", reportingMethod: "quantitative" };
}

const QUANT_CHECKLIST = { sourceCrossCheck: null, limitations: null, relatedPartyCheck: null };
const QUAL_CHECKLIST = { interviewQuestions: null, fieldRecord: null, counterPerspective: null, conflictsOfInterest: null };

/** 템플릿의 처음 본문 블록 — 빈 칸으로 미리 놓는다 */
function templateBlocks(id: TemplateId): Record<string, unknown>[] {
  switch (id) {
    case "quantitative":
      return [
        { type: "key_summary", lines: [] },
        { type: "paragraph", text: "" },
        { type: "table", caption: "", rows: [], chart: { axis: "", unit: "", source: "" } },
        { type: "paragraph", text: "" },
      ];
    case "qualitative":
      return [
        { type: "key_summary", lines: [] },
        { type: "paragraph", text: "" },
        { type: "quote", text: "", speaker: "", origin: "interview", refId: null },
        { type: "paragraph", text: "" },
      ];
    case "explainer":
      return [
        { type: "key_summary", lines: [] },
        { type: "paragraph", text: "" },
        {
          type: "faq",
          items: [
            { question: "", answer: "" },
            { question: "", answer: "" },
          ],
        },
      ];
    case "solved_case":
      return [{ type: "paragraph", text: "" }];
    case "sponsored":
      return [{ type: "paragraph", text: "" }];
  }
}

function templateChecklists(id: TemplateId, method: string): Record<string, unknown> {
  if (id !== "quantitative" && id !== "qualitative") return {};
  if (method === "mixed") return { quantitative: { ...QUANT_CHECKLIST }, qualitative: { ...QUAL_CHECKLIST } };
  return id === "quantitative" ? { quantitative: { ...QUANT_CHECKLIST } } : { qualitative: { ...QUAL_CHECKLIST } };
}

export interface NewArticleForm {
  templateId: TemplateId;
  title: string;
  slug: string;
  summary: string;
  section: string;
  categoryId: string;
  /** 보도 템플릿만 — quantitative · qualitative · mixed */
  reportingMethod: string;
  legalBasisDate: string;
  label: string;
  partnerId: string;
  storyAssignmentId: number | null;
}

const SLUG = /^[^\s/]+$/;

/** 새 기사 입력 확인 — 칸 id는 화면의 입력창 id (new-…) */
export function validateNewArticle(form: NewArticleForm): FieldErrors {
  const t = templateById(form.templateId);
  const errors: FieldErrors = {};
  if (blank(form.title)) errors["new-title"] = "제목을 적어 주세요";
  const slug = form.slug.trim();
  if (slug === "") errors["new-slug"] = "주소(slug)를 적어 주세요";
  else if (!SLUG.test(slug)) errors["new-slug"] = "주소에는 공백과 '/'를 쓸 수 없습니다";
  else if (RESERVED_SLUGS.includes(slug)) errors["new-slug"] = "video·photo·popular는 목록 주소라 쓸 수 없습니다";
  if (!(SECTIONS as readonly string[]).includes(form.section)) errors["new-section"] = "분야를 골라 주세요";
  if (t.contentType === "reported_news" && !["quantitative", "qualitative", "mixed"].includes(form.reportingMethod)) {
    errors["new-reporting-method"] = "취재 방식을 골라 주세요";
  }
  if (t.needsLegalBasisDate && !isValidDate(form.legalBasisDate.trim())) errors["new-legal-basis-date"] = "법령 기준일을 YYYY-MM-DD로 적어 주세요";
  if (t.needsLabel) {
    if (form.label !== "co_planned" && form.label !== "ad") errors["new-label"] = "공동 기획과 광고 중 하나를 골라 주세요";
    else if (form.label === "co_planned" && idOrNull(form.partnerId) === null) errors["new-partner"] = "공동 기획에는 제휴사가 필요합니다";
  }
  return errors;
}

/** 새 기사 요청 본문 (POST /api/admin/articles) — 빈 칸은 보내지 않는다 */
export function newArticlePayload(form: NewArticleForm): Record<string, unknown> {
  const t = templateById(form.templateId);
  const payload: Record<string, unknown> = {
    slug: form.slug.trim(),
    title: form.title.trim(),
    section: form.section,
    contentType: t.contentType,
    subtype: t.subtype,
    body: { blocks: templateBlocks(t.id), claims: [] },
    checklists: templateChecklists(t.id, form.reportingMethod),
  };
  const summary = textOrNull(form.summary);
  if (summary) payload.summary = summary;
  const categoryId = idOrNull(form.categoryId);
  if (categoryId !== null) payload.categoryId = categoryId;
  if (t.contentType === "reported_news") payload.reportingMethod = form.reportingMethod || t.reportingMethod;
  if (t.needsLegalBasisDate || !blank(form.legalBasisDate)) payload.legalBasisDate = form.legalBasisDate.trim();
  if (t.subtype === "solved_case") payload.solvedCase = { situation: "", issue: "", result: "", lesson: "", resultEvidence: [] };
  if (t.needsLabel) {
    payload.label = form.label;
    const partnerId = idOrNull(form.partnerId);
    if (partnerId !== null) payload.partnerId = partnerId;
  }
  if (form.storyAssignmentId !== null) payload.storyAssignmentId = form.storyAssignmentId;
  return payload;
}

/** 주소 제안 — 한국 날짜 YYYYMMDD + 짧은 글자 (편집자가 고쳐 쓴다) */
export function suggestSlug(now: Date, token: string): string {
  const kst = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10).replaceAll("-", "");
  return `${kst}-${token}`;
}
