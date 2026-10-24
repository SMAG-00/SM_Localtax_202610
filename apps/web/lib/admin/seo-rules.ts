// /admin/seo API 입력 검사 (W7 · OPT-07·09) — 순수 모듈 (시험 seo-rules.test.ts). 화면과 API가 같은 함수를 쓴다.
import { isMonth } from "@/lib/readiness/monthly";
import { parseEngines, parseQuestionLines, parseSampleInput, type Parsed } from "@/lib/seo/ai-citation";

export const SEO_OPS = ["freshness_resolve", "questions_save", "questions_activate", "samples_init", "sample_set"] as const;
export type SeoOp = (typeof SEO_OPS)[number];

export const FRESHNESS_RESOLUTIONS = ["no_change", "substantive", "correction"] as const;
export type FreshnessResolution = (typeof FRESHNESS_RESOLUTIONS)[number];
export const FRESHNESS_RESOLUTION_LABELS: Readonly<Record<FreshnessResolution, string>> = {
  no_change: "변경 없음 (날짜 그대로)",
  substantive: "실질 수정함 (기사 수정에서 ‘실질 수정’으로 저장)",
  correction: "정정함 (기사 수정에서 ‘정정’으로 저장)",
};
export const NOTE_MAX = 500;

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

export function parseFreshnessResolve(body: Record<string, unknown>): Parsed<{ id: number; resolution: FreshnessResolution; note: string }> {
  const errors: string[] = [];
  if (!isInt(body.id)) errors.push("id: 검수 항목 번호가 필요합니다");
  const resolution = (FRESHNESS_RESOLUTIONS as readonly unknown[]).includes(body.resolution) ? (body.resolution as FreshnessResolution) : null;
  if (resolution === null) errors.push(`resolution: ${FRESHNESS_RESOLUTIONS.join("·")} 중 하나입니다`);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note === "") errors.push("note: 처리 사유를 적어 주세요");
  else if ([...note].length > NOTE_MAX) errors.push(`note: ${NOTE_MAX}자 이하여야 합니다`);
  return errors.length ? { ok: false, errors } : { ok: true, value: { id: body.id as number, resolution: resolution!, note } };
}

export function parseQuestionsSave(body: Record<string, unknown>): Parsed<{ questions: string[]; activate: boolean }> {
  const parsed = parseQuestionLines(body.text);
  if (!parsed.ok) return parsed;
  return { ok: true, value: { questions: parsed.value, activate: body.activate === true } };
}

export function parseQuestionsActivate(body: Record<string, unknown>): Parsed<{ version: number }> {
  return isInt(body.version) ? { ok: true, value: { version: body.version } } : { ok: false, errors: ["version: 질문 목록 버전이 필요합니다"] };
}

export function parseSamplesInit(body: Record<string, unknown>): Parsed<{ month: string; version: number; engines: string[] }> {
  const errors: string[] = [];
  if (typeof body.month !== "string" || !isMonth(body.month)) errors.push("month: YYYY-MM 모양이어야 합니다");
  if (!isInt(body.version)) errors.push("version: 활성화된 질문 목록 버전이 필요합니다");
  const engines = parseEngines(body.engines);
  if (!engines.ok) errors.push(...engines.errors);
  return errors.length || !engines.ok ? { ok: false, errors } : { ok: true, value: { month: body.month as string, version: body.version as number, engines: engines.value } };
}

export { parseSampleInput };
