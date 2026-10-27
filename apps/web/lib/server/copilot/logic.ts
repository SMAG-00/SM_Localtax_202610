// 리서치 코파일럿 순수 규칙 (W13-e, RES-01~05) - 입력 경계·공개 판정·월 한도 값·작업 지시문. 네트워크·DB 없음.
// 이 디렉터리는 상속·증여 엔진을 불러오지 않고 국세 금액을 만들지 않는다(NT9).

export const COPILOT_KINDS = ["comparison", "history", "publications", "issue_memo"] as const;
export type CopilotKind = (typeof COPILOT_KINDS)[number];

/** 화면 표지 - PRD RES-01·04가 정한 고정 용어 */
export const DRAFT_LABEL = "AI 초안";

/** 이벤트 copilot_used의 feature 값 (events.ts PROP_VALUES) */
export const FEATURE_OF: Record<CopilotKind, "compare" | "history_summary" | "publication_summary" | "issue_memo"> = {
  comparison: "compare",
  history: "history_summary",
  publications: "publication_summary",
  issue_memo: "issue_memo",
};
export const PRD_ID: Record<CopilotKind, string> = { comparison: "RES-01", history: "RES-02", publications: "RES-03", issue_memo: "RES-04" };

/** RES-01 결정례 건수 경계 (PRD가 정한 값 - 1건·9건은 거부) */
export const COMPARE_MIN = 2;
export const COMPARE_MAX = 8;
/** RES-04 근거 건수 상한 */
export const MEMO_MAX_REFS = 8;
export const NOTE_MAX = 2000;
export const REF_MAX = 80;

const SOURCE_ID = /^[A-Za-z0-9_.:#-]{1,80}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export type CopilotRequest =
  | { kind: "comparison"; ids: string[] }
  | { kind: "history"; ref: string; from: string; to: string }
  | { kind: "publications"; ref: string }
  | { kind: "issue_memo"; ids: string[]; note: string };

export type ParseResult = { ok: true; value: CopilotRequest } | { ok: false; status: 400 | 422; code: string };

const bad = (code: string, status: 400 | 422 = 400): ParseResult => ({ ok: false, status, code });

function ids(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > 64) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string" || !SOURCE_ID.test(x.trim())) return null;
    if (!out.includes(x.trim())) out.push(x.trim());
  }
  return out;
}

function validDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const refText = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return t.length >= 2 && t.length <= REF_MAX ? t : null;
};

export function parseCopilotRequest(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return bad("bad_request");
  const b = body as Record<string, unknown>;
  switch (b.kind) {
    case "comparison": {
      const list = ids(b.ids);
      if (!list) return bad("bad_ids");
      // 중복 제거 뒤 2~8건. 1건·9건은 서버도 거부한다 (RES-01)
      if (list.length < COMPARE_MIN || list.length > COMPARE_MAX) return bad("count_out_of_range", 422);
      return { ok: true, value: { kind: "comparison", ids: list } };
    }
    case "history": {
      const ref = refText(b.ref);
      if (!ref) return bad("bad_ref");
      if (!validDate(b.from) || !validDate(b.to) || b.from > b.to) return bad("bad_period");
      // 기간은 최대 30년 - 기준일 표본이 끝없이 늘지 않게 한다
      if (Number(b.to.slice(0, 4)) - Number(b.from.slice(0, 4)) > 30) return bad("period_too_long", 422);
      return { ok: true, value: { kind: "history", ref, from: b.from, to: b.to } };
    }
    case "publications": {
      const ref = refText(b.ref);
      return ref ? { ok: true, value: { kind: "publications", ref } } : bad("bad_ref");
    }
    case "issue_memo": {
      const list = ids(b.ids);
      if (!list) return bad("bad_ids");
      if (list.length < 1 || list.length > MEMO_MAX_REFS) return bad("count_out_of_range", 422);
      const note = typeof b.note === "string" ? b.note.slice(0, NOTE_MAX + 1) : "";
      if (note.length > NOTE_MAX) return bad("note_too_long", 422);
      return { ok: true, value: { kind: "issue_memo", ids: list, note: note.trim() } };
    }
    default:
      return bad("bad_kind");
  }
}

/** 월 한도 설정값 → 양의 정수 또는 null(= 실행 0). 모양: 숫자 n 또는 { per_user: n } */
export function parseMonthlyLimit(raw: unknown): number | null {
  const v = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>).per_user : raw;
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 100000 ? v : null;
}

export type Stage = "none" | "4a" | "4b" | "4c";
export type GateReason = "feature_off" | "model_unset" | "stage_none" | "limit_unset" | "audience" | "entitlement_missing";

export interface GateInput {
  featureOn: boolean;
  modelConfigured: boolean;
  stage: Stage;
  /** 월 한도 설정 파싱 결과 (null = 비어 있음) */
  limit: number | null;
  /** 직원·초청 전문가 역할 계정 */
  internal: boolean;
  loggedIn: boolean;
  /** copilot 권한(권한 판정 함수) */
  entitled: boolean;
}

/** 실행 버튼·API 공통 판정 - 기능 키 ∧ 모델 ∧ 공개 단계(리포트+승인) ∧ 한도 값 ∧ 계정 (4a·4b: 내부만, 4c: 프리미엄 권한) */
export function decideCopilotGate(g: GateInput): { open: true } | { open: false; reason: GateReason } {
  if (!g.featureOn) return { open: false, reason: "feature_off" };
  if (!g.modelConfigured) return { open: false, reason: "model_unset" };
  if (g.stage === "none") return { open: false, reason: "stage_none" };
  if (g.limit === null) return { open: false, reason: "limit_unset" };
  if (!g.loggedIn) return { open: false, reason: "audience" };
  if (g.stage === "4c") return g.entitled || g.internal ? { open: true } : { open: false, reason: "entitlement_missing" };
  return g.internal ? { open: true } : { open: false, reason: "audience" };
}

/** 모델에게 보내는 작업 지시문. 날짜는 ISO 형식으로만 써서 질문 속 기준일 추출(한글 연월일)에 걸리지 않게 한다 */
export function buildTaskMessage(req: CopilotRequest): string {
  const rules = "제공된 문서에 있는 내용만 쓰고, 모든 문장에 문서 인용을 답니다. 금액·세율은 문서에 적힌 값만 옮기고 새로 계산하거나 만들지 않습니다. 개정 전 규정을 언급하는 문장에는 개정 전(종전) 규정임을 밝힙니다.";
  switch (req.kind) {
    case "comparison":
      return `[코파일럿 결정례 비교표] 제공된 결정례 ${req.ids.length}건을 쟁점, 사실관계, 결론, 근거 조문 항목으로 비교해 정리하세요. 항목마다 결정례별 한 문단씩 쓰세요. ${rules}`;
    case "history":
      return `[코파일럿 조문 연혁 요약] ${req.ref}의 ${req.from}부터 ${req.to}까지 개정 이력과 취지를 시간 순서로 요약하세요. 개정 일자는 문서 메타의 시행일을 그대로 쓰세요. ${rules}`;
    case "publications":
      return `[코파일럿 관련 출판물 요약] ${req.ref}을 다룬 제공된 출판물 각각이 무엇을 말하는지 요약하세요. 출판물마다 한 문단씩 쓰세요. ${rules}`;
    case "issue_memo":
      return `[코파일럿 쟁점 메모 초안] 제공된 조문·결정례를 근거로 쟁점을 정리한 메모 초안을 쓰세요. 쟁점별로 근거와 상반된 시각을 나누어 쓰세요.${req.note ? ` 사용자 메모: ${req.note}` : ""} ${rules}`;
  }
}

/** 거부 사유 → HTTP 상태. 권한만 없는 로그인 회원은 403(요금 안내로 연결), 그 밖은 있다는 사실도 숨기는 404 */
export function statusOfRefusal(reason: GateReason): 403 | 404 {
  return reason === "entitlement_missing" ? 403 : 404;
}
