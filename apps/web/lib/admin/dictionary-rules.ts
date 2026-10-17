// 금지 표현·공포 표현 사전 (UX-01 · UX-03) — settings의 forbidden_phrases·fear_phrases 값 { version, phrases }.
// 발행 판정(lib/server/articles/gate.ts parseGateSettings)이 읽는 키·모양 그대로 쓴다. 바꾸면 배포 없이 다음 점검·저장부터 적용된다.
// 순수 모듈 — 서버(사전 API·설정 API)와 화면(사전 화면)이 같이 쓴다.
import { normalizeText } from "@ltr/editorial";

export const PHRASE_DICTIONARIES = {
  forbidden: { key: "forbidden_phrases", label: "금지 표현", ruleRef: "UX-01", effect: "기사에 들어 있으면 발행이 막히고 위치를 알려 줍니다" },
  fear: { key: "fear_phrases", label: "공포 표현", ruleRef: "UX-03", effect: "기사에 들어 있으면 발행이 막힙니다" },
} as const;
export type PhraseKind = keyof typeof PHRASE_DICTIONARIES;
export const PHRASE_KINDS = Object.keys(PHRASE_DICTIONARIES) as PhraseKind[];
export const isPhraseKind = (v: unknown): v is PhraseKind => typeof v === "string" && Object.hasOwn(PHRASE_DICTIONARIES, v);

export const PHRASE_MAX = 40;

export interface PhraseDictionary {
  version: string;
  phrases: string[];
}

/** settings 값 → 사전. 모양이 다르면 null */
export function readPhraseDictionary(value: unknown): PhraseDictionary | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as { version?: unknown; phrases?: unknown };
  if (!Array.isArray(v.phrases) || !v.phrases.every((p) => typeof p === "string")) return null;
  return { version: typeof v.version === "string" ? v.version : "", phrases: [...(v.phrases as string[])] };
}

/** 표현 하나의 문제 — 없으면 null */
export function phraseError(phrase: string): string | null {
  if (/[\r\n]/.test(phrase)) return "표현은 한 줄로 씁니다";
  const p = normalizeText(phrase);
  if (p === "") return "표현을 적어 주세요";
  if ([...p].length > PHRASE_MAX) return `표현은 ${PHRASE_MAX}자 이하로 씁니다`;
  return null;
}

/** 사전 버전 — 오늘 날짜.번호 (같은 날이면 번호를 올린다). 발행 기록에는 이 버전이 아니라 판정 결과가 남는다 */
export function nextDictionaryVersion(version: string, today: string): string {
  const m = version.match(/^(\d{4}-\d{2}-\d{2})\.(\d+)$/);
  return m && m[1] === today ? `${today}.${Number(m[2]) + 1}` : `${today}.1`;
}

export type PhraseChange = { ok: true; value: PhraseDictionary } | { ok: false; status: 404 | 409 | 422; message: string };

/** 표현 더하기·빼기 — 공백만 다른 표현은 같은 표현이다 (판정도 연속 공백을 하나로 맞춰 비교한다) */
export function applyPhraseChange(dict: PhraseDictionary, op: "add" | "remove", phrase: string, today: string): PhraseChange {
  const problem = phraseError(phrase);
  if (problem) return { ok: false, status: 422, message: problem };
  const p = normalizeText(phrase);
  const index = dict.phrases.findIndex((x) => normalizeText(x) === p);
  if (op === "add") {
    if (index !== -1) return { ok: false, status: 409, message: `이미 사전에 있는 표현입니다: ${dict.phrases[index]}` };
    return { ok: true, value: { version: nextDictionaryVersion(dict.version, today), phrases: [...dict.phrases, p] } };
  }
  if (index === -1) return { ok: false, status: 404, message: `사전에 없는 표현입니다: ${p}` };
  if (dict.phrases.length === 1) return { ok: false, status: 422, message: "사전을 비울 수 없습니다 — 표현이 하나 이상 있어야 발행 판정이 돕니다" };
  return { ok: true, value: { version: nextDictionaryVersion(dict.version, today), phrases: dict.phrases.filter((_, i) => i !== index) } };
}
