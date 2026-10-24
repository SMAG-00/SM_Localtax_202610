// AI 검색 인용 표본 (W7 · OPT-09) — 핵심 질문 50개 입력 검사와 인용률 계산. 순수 모듈 (시험 ai-citation.test.ts).
//  · 질문·인용 여부는 사람이 화면에서 확인해 입력한다 — 외부 AI 서비스를 자동으로 부르는 코드는 없다
//  · 확인하지 못한 칸(unknown)은 인용 0으로 세지 않는다 — 인용률의 분모는 확인한 칸(yes+no)이고 미확인 수를 따로 보인다
export const QUESTION_COUNT = 50;
export const QUESTION_MAX_CHARS = 200;
export const ENGINE_MAX = 10;
export const CITED_VALUES = ["yes", "no", "unknown"] as const;
export type Cited = (typeof CITED_VALUES)[number];

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** 질문 목록 글(한 줄에 한 문항, 빈 줄 무시) → 정확히 50문항 */
export function parseQuestionLines(text: unknown): Parsed<string[]> {
  if (typeof text !== "string") return { ok: false, errors: ["질문 목록은 글이어야 합니다 (한 줄에 한 문항)"] };
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const errors: string[] = [];
  if (lines.length !== QUESTION_COUNT) errors.push(`핵심 질문은 정확히 ${QUESTION_COUNT}문항이어야 합니다 (지금 ${lines.length}문항)`);
  lines.forEach((l, i) => {
    if ([...l].length > QUESTION_MAX_CHARS) errors.push(`${i + 1}번 문항: ${QUESTION_MAX_CHARS}자 이하여야 합니다`);
  });
  if (new Set(lines).size !== lines.length) errors.push("같은 질문이 두 번 있습니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: lines };
}

export function parseEngines(raw: unknown): Parsed<string[]> {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\n]/) : null;
  if (!list) return { ok: false, errors: ["확인할 엔진 이름 목록이 필요합니다"] };
  const names = list.map((n) => (typeof n === "string" ? n.trim() : "")).filter((n) => n !== "");
  const errors: string[] = [];
  if (names.length === 0) errors.push("확인할 엔진을 하나 이상 적어 주세요");
  if (names.length > ENGINE_MAX) errors.push(`엔진은 ${ENGINE_MAX}개 이하여야 합니다`);
  if (names.some((n) => [...n].length > 40)) errors.push("엔진 이름은 40자 이하여야 합니다");
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) errors.push("같은 엔진 이름이 두 번 있습니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: names };
}

export interface CitationTally {
  yes: number;
  no: number;
  unknown: number;
  /** 확인한 칸 (yes + no) — 인용률의 분모 */
  checked: number;
  total: number;
  /** 인용률 = yes ÷ 확인한 칸. 확인한 칸이 없으면 null */
  rate: number | null;
}

export function citationTally(rows: readonly { cited: string }[]): CitationTally {
  let yes = 0;
  let no = 0;
  let unknown = 0;
  for (const r of rows) {
    if (r.cited === "yes") yes += 1;
    else if (r.cited === "no") no += 1;
    else unknown += 1;
  }
  const checked = yes + no;
  return { yes, no, unknown, checked, total: rows.length, rate: checked === 0 ? null : yes / checked };
}

/** 엔진별 인용률 */
export function tallyByEngine(rows: readonly { engine: string; cited: string }[]): { engine: string; tally: CitationTally }[] {
  const engines = [...new Set(rows.map((r) => r.engine))].sort();
  return engines.map((engine) => ({ engine, tally: citationTally(rows.filter((r) => r.engine === engine)) }));
}

/** 표본 한 칸 입력 검사 — cited와 주소 */
export function parseSampleInput(body: Record<string, unknown>): Parsed<{ id: number; cited: Cited; cited_url: string | null; expected_page: string | null; note: string | null }> {
  const errors: string[] = [];
  const id = typeof body.id === "number" && Number.isInteger(body.id) && body.id > 0 ? body.id : null;
  if (id === null) errors.push("id: 표본 번호가 필요합니다");
  const cited = (CITED_VALUES as readonly unknown[]).includes(body.cited) ? (body.cited as Cited) : null;
  if (cited === null) errors.push("cited: yes·no·unknown 중 하나입니다");
  const text = (k: string, max: number): string | null => {
    const v = body[k];
    if (v === undefined || v === null || v === "") return null;
    if (typeof v !== "string" || [...v.trim()].length > max) {
      errors.push(`${k}: ${max}자 이하의 글이어야 합니다`);
      return null;
    }
    return v.trim();
  };
  const url = text("cited_url", 500);
  if (url !== null && !/^https?:\/\/[^\s]+$/.test(url)) errors.push("cited_url: 주소(http/https) 모양이 아닙니다");
  if (cited === "yes" && url === null) errors.push("cited_url: 인용 있음(yes)은 인용된 주소가 필요합니다");
  const expected = text("expected_page", 300);
  const note = text("note", 500);
  return errors.length ? { ok: false, errors } : { ok: true, value: { id: id!, cited: cited!, cited_url: url, expected_page: expected, note } };
}
