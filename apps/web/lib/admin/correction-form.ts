// 정정·반론·추후보도·삭제·제목 변경 결정 폼 (NAV-06) → POST /api/admin/articles/[id]/corrections 본문. 순수 함수 (시험: correction-form.test.ts)
//  · 이유는 모든 종류에 필수 — 없으면 저장하지 않는다
//  · 정정은 고친 내용(제목·요약·문단)이 있어야 하고, 제목 변경은 새 제목, 삭제는 고친 내용을 보내지 않는다
import type { StoredBlock, StoredBody } from "@/lib/server/articles/content";
import { blank, idOrNull, textOrNull, type FieldErrors } from "./form-utils";
import { CORRECTION_KIND_LABELS } from "./labels";

export interface CorrectionForm {
  kind: string;
  reason: string;
  readerNotice: string;
  title: string;
  summary: string;
  /** 문단 블록 번호 → 고친 글 */
  paragraphs: Record<number, string>;
  /** 정정 요청 창구(inquiries) 번호 — 처리 완료로 닫는다 */
  inquiryId: string;
}

export interface OriginalArticle {
  title: string;
  summary: string | null;
  body: StoredBody;
}

/** 정정 폼에서 고칠 수 있는 문단 — 문단 블록 */
export function editableParagraphs(body: StoredBody): { index: number; text: string }[] {
  return body.blocks.flatMap((b, index) => (b.type === "paragraph" ? [{ index, text: b.text }] : []));
}

function changesOf(form: CorrectionForm, original: OriginalArticle): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (form.title.trim() !== "" && form.title.trim() !== original.title) changes.title = form.title.trim();
  if ((textOrNull(form.summary) ?? "") !== (original.summary ?? "")) changes.summary = textOrNull(form.summary);
  let bodyChanged = false;
  const blocks = original.body.blocks.map((b, i): StoredBlock => {
    const next = form.paragraphs[i];
    if (b.type !== "paragraph" || next === undefined || next === b.text) return b;
    bodyChanged = true;
    return { ...b, text: next };
  });
  if (bodyChanged) changes.body = { blocks, claims: original.body.claims };
  return changes;
}

export function correctionPayload(form: CorrectionForm, original: OriginalArticle): { ok: true; body: Record<string, unknown> } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (!Object.hasOwn(CORRECTION_KIND_LABELS, form.kind)) errors["cor-kind"] = "정정·반론·추후보도·삭제·제목 변경 중 하나를 골라 주세요";
  if (blank(form.reason)) errors["cor-reason"] = "이유를 적어야 저장됩니다 — 무엇을 왜 고치는지 (NAV-06)";
  const changes = form.kind === "deletion" ? {} : changesOf(form, original);
  if (form.kind === "title_change" && changes.title === undefined) errors["cor-title"] = "새 제목을 적어 주세요 — 지금 제목과 달라야 합니다";
  if (form.kind === "correction" && Object.keys(changes).length === 0) errors["cor-changes"] = "정정에는 고친 내용(제목·요약·문단)이 필요합니다";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const body: Record<string, unknown> = { kind: form.kind, reason: form.reason.trim() };
  const notice = textOrNull(form.readerNotice);
  if (notice) body.readerNotice = notice;
  const inquiryId = idOrNull(form.inquiryId);
  if (inquiryId !== null) body.inquiryId = inquiryId;
  // 제목 변경은 제목만, 그 밖은 고친 칸 전부
  const sent = form.kind === "title_change" ? { title: changes.title } : changes;
  if (Object.keys(sent).length > 0) body.changes = sent;
  return { ok: true, body };
}

export function correctionRequestPayload(reason: string): { ok: true; body: { reason: string } } | { ok: false; error: string } {
  if (blank(reason)) return { ok: false, error: "무엇을 왜 고쳐야 하는지 적어 주세요 (NAV-06)" };
  return { ok: true, body: { reason: reason.trim() } };
}

/** 블록의 글 — 전후 비교용 한 줄 */
function blockText(b: unknown): string {
  if (typeof b !== "object" || b === null) return "";
  const o = b as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  switch (o.type) {
    case "paragraph":
    case "heading":
      return str(o.text);
    case "quote":
      return [str(o.text), str(o.speaker)].filter(Boolean).join(" — ");
    case "callout":
      return [str(o.title), str(o.text)].filter(Boolean).join(": ");
    case "key_summary":
      return Array.isArray(o.lines) ? o.lines.map(str).join(" / ") : "";
    case "slide":
      return [str(o.title), str(o.text)].filter(Boolean).join(": ");
    case "table":
      return [str(o.caption), ...(Array.isArray(o.rows) ? o.rows.map((r) => (Array.isArray(r) ? r.map(str).join(" | ") : "")) : [])].join(" / ");
    case "faq":
      return Array.isArray(o.items) ? o.items.map((i) => (typeof i === "object" && i ? `${str((i as Record<string, unknown>).question)} ${str((i as Record<string, unknown>).answer)}` : "")).join(" / ") : "";
    default:
      return [str(o.caption), str(o.alt), str(o.embedUrl)].filter(Boolean).join(" / ");
  }
}

/** 전후 버전 비교 — 글이 바뀐 블록만 (수정 이력 article_revisions의 body 두 개) */
export function changedBlocks(before: unknown, after: unknown): { index: number; before: string; after: string }[] {
  const list = (body: unknown): unknown[] => {
    if (Array.isArray(body)) return body;
    if (typeof body === "object" && body !== null && Array.isArray((body as { blocks?: unknown }).blocks)) return (body as { blocks: unknown[] }).blocks;
    return [];
  };
  const a = list(before);
  const b = list(after);
  const out: { index: number; before: string; after: string }[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = blockText(a[i]);
    const y = blockText(b[i]);
    if (x !== y) out.push({ index: i, before: x, after: y });
  }
  return out;
}
