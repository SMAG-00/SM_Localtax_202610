// 요건 사전 연결 - 순수 (W12-c c5, PRD-04 6.2·6.2.1·6.2.2). 3단계 공개 요건 사전(public_requirement_dictionary)의 본문을 지방세봇 역질문 사전으로 옮긴다.
//  · 질문 문장·선택지·주제 낱말은 사전 본문(감수 입력)의 글이다. 이 파일에 요건·질문 문장이 없다.
//  · 본문에 `question`(질문 문장), 비어 있지 않은 `options`, `keywords`(주제 낱말)가 없는 칸·주제는 건너뛴다 - 지어내지 않는다.
//  · 필수가 아닌 칸(`required: false`)은 역질문 대상이 아니다.
import type { RequirementDictionary, Slot, Topic } from "./clarify";

export interface DictionaryRow {
  topic: string;
  version: string;
  body: unknown;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strs = (v: unknown, max = 20): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").slice(0, max) : []);

function slotOf(topicId: string, f: unknown): Slot | null {
  if (!isRec(f)) return null;
  const id = typeof f.id === "string" && /^[a-z][a-z0-9_]{1,39}$/u.test(f.id) ? f.id : null;
  const question = typeof f.question === "string" ? f.question.trim() : "";
  if (!id || question === "" || f.required === false) return null;
  const options = (Array.isArray(f.options) ? f.options : [])
    .map((o, i) => (typeof o === "string" && o.trim() !== "" ? { id: `o${i + 1}`, label: o.trim() } : isRec(o) && typeof o.id === "string" && typeof o.label === "string" && o.label.trim() !== "" ? { id: o.id, label: o.label.trim() } : null))
    .filter((o): o is { id: string; label: string } => o !== null)
    .slice(0, 6);
  if (options.length === 0) return null;
  return { id: `${topicId}.${id}`, question, options, satisfiedBy: strs(f.keywords) };
}

export function topicsFromDictionary(rows: readonly DictionaryRow[]): RequirementDictionary {
  const topics: Topic[] = [];
  for (const r of rows) {
    if (!isRec(r.body) || !/^[a-z][a-z0-9_]{1,39}$/u.test(r.topic)) continue;
    const keywords = strs(r.body.keywords);
    const fields = Array.isArray(r.body.fields) ? r.body.fields : [];
    const required = fields.map((f) => slotOf(r.topic, f)).filter((s): s is Slot => s !== null);
    if (keywords.length === 0 || required.length === 0) continue;
    topics.push({ id: r.topic, taxItems: strs(r.body.tax_items, 10), keywords, required });
  }
  return { version: rows.map((r) => `${r.topic}@${r.version}`).sort().join("+") || "empty", topics };
}
