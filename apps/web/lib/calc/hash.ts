import { isAnswerValid, type Question } from "./shared";

// URL 해시(#) 입출력 (GROW-02 미리 채움 · CALC-06 결과 공유) - 해시는 서버로 가지 않는다(요청 URL에 실리지 않음).
// 형식: #t=<도구>&v=<룰셋 버전>&region=<지역 코드>&<질문 id>=<값> ... 질문 목록에 있는 id만, 질문 종류에 맞는 값만 받는다(나머지는 버린다).
// 값 표기: 선택지 = 값 글자, 예/아니요 = 1/0, 숫자 = 숫자, 공시가격 목록 = 쉼표, 날짜 = YYYY-MM-DD.

export interface ParsedHash {
  tool: string | null;
  version: string | null;
  region: string | null;
  /** 질문 id -> 검증된 값 */
  values: Record<string, unknown>;
  ids: string[];
}

const META = /^[A-Za-z0-9._-]{1,20}$/;

function decode<F>(q: Question<F>, raw: string): unknown {
  switch (q.kind) {
    case "choice":
    case "date":
      return raw;
    case "yesno":
      return raw === "1" ? true : raw === "0" ? false : undefined;
    case "wonlist":
      return raw.split(",").map((x) => (/^\d{1,15}$/.test(x) ? Number(x) : Number.NaN));
    default:
      return /^\d{1,15}(\.\d{1,4})?$/.test(raw) ? Number(raw) : undefined;
  }
}

export function parseHash<F>(hash: string, questions: readonly Question<F>[]): ParsedHash {
  const out: ParsedHash = { tool: null, version: null, region: null, values: {}, ids: [] };
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const meta = (k: string) => {
    const v = params.get(k);
    return v !== null && META.test(v) ? v : null;
  };
  out.tool = meta("t");
  out.version = meta("v");
  out.region = meta("region");
  const byId = new Map(questions.map((q) => [q.id as string, q]));
  for (const [k, raw] of params) {
    const q = byId.get(k);
    if (!q || k in out.values) continue;
    const v = decode(q, raw);
    if (v !== undefined && isAnswerValid(q, v)) {
      out.values[k] = v;
      out.ids.push(k);
    }
  }
  return out;
}

const encode = (v: unknown): string => (typeof v === "boolean" ? (v ? "1" : "0") : Array.isArray(v) ? v.join(",") : String(v));

/** 공유 링크 해시 - 답이 있는 질문만(모르겠어요·빈 칸은 싣지 않는다). 입력이 없으면 메타만 */
export function encodeHash<F>(tool: string, version: string | null, form: Readonly<Record<string, unknown>>, questions: readonly Question<F>[]): string {
  const params = new URLSearchParams();
  params.set("t", tool);
  if (version) params.set("v", version);
  for (const q of questions) {
    const v = form[q.id];
    if (v !== undefined && isAnswerValid(q, v)) params.set(q.id, encode(v));
  }
  return `#${params.toString()}`;
}
