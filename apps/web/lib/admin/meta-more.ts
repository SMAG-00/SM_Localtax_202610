// 기사 기본 정보의 '더 보기' 묶음 (PO 단순화 2026-10-31) — 기본 칸(제목·요약·분야·기사 유형·대표 이미지)만 처음부터 보이고,
// 나머지 칸은 접어 둔다. 값이 있거나 · 유형이 요구하거나 · 저장 오류가 가리키면 저장 없이도 자동으로 펼친다.
import type { EditorState } from "./editor-state";
import type { FieldErrors } from "./form-utils";

/** '더 보기' 안에 있는 칸의 id — 오류가 이 중 하나를 가리키면 묶음을 펼친다 */
export const MORE_FIELD_IDS = [
  "meta-slug",
  "meta-category",
  "meta-format",
  "meta-label",
  "meta-partner",
  "meta-legal-basis-date",
  "meta-series-title",
  "meta-series-episode",
  "meta-region-codes",
  "meta-editorial-field",
  "meta-public-question",
  "meta-subject-kind",
  "meta-relation-types",
  "meta-covered-partners",
  "meta-covers-bill-status",
  "meta-interest-disclosure",
] as const;

type MoreState = Pick<
  EditorState,
  | "slug"
  | "section"
  | "categoryId"
  | "format"
  | "label"
  | "partnerId"
  | "legalBasisDate"
  | "seriesTitle"
  | "seriesEpisodeText"
  | "regionCodesText"
  | "editorialField"
  | "publicQuestion"
  | "subjectKind"
  | "relationTypes"
  | "coveredPartnerIds"
  | "interestDisclosure"
  | "coversBillStatus"
>;

/** '더 보기'를 펼쳐야 하는 이유 — 없으면 null (접어 둠). 이유는 시험·안내 글에 쓴다 */
export function moreOpenReason(s: MoreState, errors: FieldErrors): string | null {
  const bad = MORE_FIELD_IDS.find((id) => errors[id]);
  if (bad) return `error:${bad}`;
  // 값이 비어 있으면 저장이 막히는 칸 — 주소(slug)는 새 기사에서 자동으로 채워지지만, 비어 있으면 눈에 보여야 한다
  if (s.slug.trim() === "") return "required:meta-slug";
  // 지방세 분야는 법령 기준일을 꼭 적는다 (세금 쟁점 점검)
  if (s.section === "tax" && s.legalBasisDate.trim() === "") return "required:meta-legal-basis-date";
  // 지자체뉴스는 지역 태그·편집 분야·공익적 질문이 있어야 새로 발행된다 (REG1-17)
  if (s.section === "local") return "required:region";
  const filled: [string, boolean][] = [
    ["meta-category", s.categoryId !== ""],
    ["meta-format", s.format !== "general"],
    ["meta-label", s.label !== "none"],
    ["meta-partner", s.partnerId !== ""],
    ["meta-legal-basis-date", s.legalBasisDate.trim() !== ""],
    ["meta-series-title", s.seriesTitle.trim() !== "" || s.seriesEpisodeText.trim() !== ""],
    ["meta-region-codes", s.regionCodesText.trim() !== ""],
    ["meta-editorial-field", s.editorialField !== ""],
    ["meta-public-question", s.publicQuestion.trim() !== ""],
    ["meta-subject-kind", s.subjectKind !== "" && s.subjectKind !== "general"],
    ["meta-relation-types", s.relationTypes.length > 0],
    ["meta-covered-partners", s.coveredPartnerIds.length > 0],
    ["meta-covers-bill-status", s.coversBillStatus],
    ["meta-interest-disclosure", s.interestDisclosure.trim() !== ""],
  ];
  const hit = filled.find(([, on]) => on);
  return hit ? `filled:${hit[0]}` : null;
}

/** 칸으로 포커스를 옮긴다 — 접힌 '더 보기' 안의 칸이면 먼저 펼친다(접힌 상자 안의 칸은 포커스를 받지 못한다) */
export function focusField(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
  el.focus();
}
