// 개정 트래커 관리 입력 검사 (순수 모듈 — W3 3·4단계, TX-07). 서버 API·시험이 같은 함수를 쓴다.
// 세법 내용(문구·날짜·원문)은 사람이 입력한다 — 여기서 만들어 채우는 값은 없다.
import { PROGRESS_STAGE_ORDER, type ProgressStageKey } from "@ltr/ui";

export type AmendmentOp = "create" | "event" | "correct" | "link" | "unlink";
export const AMENDMENT_OPS: readonly AmendmentOp[] = ["create", "event", "correct", "link", "unlink"];

export interface AmendmentCreateInput {
  slug: string;
  title: string;
  lawNames: string[];
  summary: string | null;
}
export interface EventEvidence {
  occurredOn: string;
  sourceUrl: string;
  /** 이미 있는 원본 스냅샷 번호 — 또는 snapshotPayload(붙여 넣은 원문 글자)로 새로 만든다 */
  snapshotId: number | null;
  snapshotPayload: string | null;
}
export interface AmendmentEventInput {
  amendmentId: number;
  stage: ProgressStageKey;
  skipped: boolean;
  skipReason: string | null;
  evidence: EventEvidence | null;
}
export interface AmendmentCorrectInput extends AmendmentEventInput {
  correctionOf: number;
  reason: string;
}
export interface AmendmentLinkInput {
  articleId: number;
  amendmentId: number;
}

type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const posInt = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^[1-9]\d{0,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

export function isRealDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseCreate(body: Record<string, unknown>): Result<AmendmentCreateInput> {
  const errors: string[] = [];
  const slug = str(body.slug);
  const title = str(body.title);
  if (!SLUG.test(slug)) errors.push("slug: 영문 소문자·숫자·'-'만 (예: sample-amendment)");
  if (title === "") errors.push("title: 제목을 입력하세요");
  const lawNames = Array.isArray(body.lawNames) ? body.lawNames.map(str).filter((s) => s !== "") : [];
  const summary = str(body.summary) || null;
  return errors.length ? { ok: false, errors } : { ok: true, value: { slug, title, lawNames, summary } };
}

function parseEvidence(body: Record<string, unknown>, errors: string[]): EventEvidence {
  const occurredOn = str(body.occurredOn);
  const sourceUrl = str(body.sourceUrl);
  const snapshotId = body.snapshotId === undefined || body.snapshotId === "" ? null : posInt(body.snapshotId);
  const snapshotPayload = str(body.snapshotPayload) || null;
  if (!isRealDate(occurredOn)) errors.push("occurredOn: 단계 날짜를 YYYY-MM-DD로 입력하세요");
  if (!isHttpUrl(sourceUrl)) errors.push("sourceUrl: 원문 주소(http·https)를 입력하세요");
  if (snapshotId === null && snapshotPayload === null) errors.push("snapshot: 원본 스냅샷 번호 또는 원문 글자를 입력하세요 (단계 기록은 스냅샷이 필수)");
  if (snapshotId !== null && snapshotPayload !== null) errors.push("snapshot: 스냅샷 번호와 원문 글자 중 하나만 입력하세요");
  return { occurredOn, sourceUrl, snapshotId, snapshotPayload };
}

export function parseEvent(body: Record<string, unknown>): Result<AmendmentEventInput> {
  const errors: string[] = [];
  const amendmentId = posInt(body.amendmentId);
  if (amendmentId === null) errors.push("amendmentId: 개정안 번호를 확인하세요");
  const stage = str(body.stage);
  if (!(PROGRESS_STAGE_ORDER as readonly string[]).includes(stage)) errors.push("stage: 단계 값을 확인하세요");
  const skipped = body.skipped === true;
  const skipReason = str(body.skipReason) || null;
  let evidence: EventEvidence | null = null;
  if (skipped) {
    if (skipReason === null) errors.push("skipReason: 해당 없음은 사유가 필수입니다");
  } else {
    evidence = parseEvidence(body, errors);
  }
  if (errors.length || amendmentId === null) return { ok: false, errors };
  return { ok: true, value: { amendmentId, stage: stage as ProgressStageKey, skipped, skipReason: skipped ? skipReason : null, evidence } };
}

export function parseCorrect(body: Record<string, unknown>): Result<AmendmentCorrectInput> {
  const base = parseEvent(body);
  const errors = base.ok ? [] : [...base.errors];
  const correctionOf = posInt(body.correctionOf);
  const reason = str(body.reason);
  if (correctionOf === null) errors.push("correctionOf: 정정할 기록 번호를 확인하세요");
  if (reason === "") errors.push("reason: 정정은 사유가 필수입니다");
  if (errors.length || !base.ok || correctionOf === null) return { ok: false, errors };
  return { ok: true, value: { ...base.value, correctionOf, reason } };
}

export function parseLink(body: Record<string, unknown>): Result<AmendmentLinkInput> {
  const articleId = posInt(body.articleId);
  const amendmentId = posInt(body.amendmentId);
  const errors: string[] = [];
  if (articleId === null) errors.push("articleId: 기사 번호를 확인하세요");
  if (amendmentId === null) errors.push("amendmentId: 개정안 번호를 확인하세요");
  return errors.length || articleId === null || amendmentId === null ? { ok: false, errors } : { ok: true, value: { articleId, amendmentId } };
}
