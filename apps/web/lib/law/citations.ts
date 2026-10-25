// 본문 속 조문 인용·사건번호 찾기 (CASE-02 · ART-12) - AI 없는 패턴 추출. 순수 모듈.
//  · 법령 이름 목록은 DB에서 받는다(코드에 법령 이름을 적지 않는다). 긴 이름이 먼저 맞는다('OO법 시행령'이 'OO법'보다 먼저).
//  · '제11조의2'를 '제11조'로 자르지 않는다. 가지 번호는 '조의' 바로 뒤 숫자만.
//  · DB에 없는 조문·사건번호는 링크하지 않는다 - 이 모듈은 후보만 찾고, 존재 여부는 부르는 쪽이 정한다(keepExistingArticles).

export interface LawName {
  id: number;
  name: string;
}

export interface ArticleCitation {
  start: number;
  end: number;
  text: string;
  lawId: number;
  lawName: string;
  articleNo: number;
  branchNo: number;
  /** 항 번호 - 있으면 #p<항> 앵커 */
  paragraph: number | null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function extractArticleCitations(text: string, laws: readonly LawName[]): ArticleCitation[] {
  if (laws.length === 0) return [];
  const sorted = [...laws].sort((a, b) => b.name.length - a.name.length);
  const byName = new Map(sorted.map((l) => [l.name, l]));
  const re = new RegExp(`(${sorted.map((l) => escapeRe(l.name)).join("|")})\\s*제\\s*(\\d{1,4})\\s*조(?:\\s*의\\s*(\\d{1,3}))?(?:\\s*제\\s*(\\d{1,2})\\s*항)?`, "g");
  const out: ArticleCitation[] = [];
  for (const m of text.matchAll(re)) {
    const law = byName.get(m[1]!)!;
    out.push({
      start: m.index!,
      end: m.index! + m[0].length,
      text: m[0],
      lawId: law.id,
      lawName: law.name,
      articleNo: Number(m[2]),
      branchNo: m[3] ? Number(m[3]) : 0,
      paragraph: m[4] ? Number(m[4]) : null,
    });
  }
  return out;
}

export const provisionKey = (lawId: number, articleNo: number, branchNo: number) => `${lawId}:${articleNo}:${branchNo}`;

/** DB에 있는 조문만 남긴다 */
export function keepExistingArticles(found: readonly ArticleCitation[], exists: ReadonlySet<string>): ArticleCitation[] {
  return found.filter((c) => exists.has(provisionKey(c.lawId, c.articleNo, c.branchNo)));
}

export interface CaseNumberCitation {
  start: number;
  end: number;
  text: string;
  /** 공백을 지운 사건번호 - legal_docs.doc_no와 맞춘다 */
  normalized: string;
  family: "tribunal" | "court";
}

// 조세심판원 사건번호: 조심 + 연도 4자리 + 세목 글자 1자 + 일련번호 3~5자리 / 법원 사건번호: 연도 4자리 + 사건 부호 + 일련번호
const CASE_NO = /(?<![0-9가-힣])(조심\s?\d{4}\s?[가-힣]\s?\d{3,5}|\d{4}\s?(?:구합|구단|구확|재두|두|누)\s?\d{1,7})(?![0-9])/g;

export function extractCaseNumbers(text: string): CaseNumberCitation[] {
  const out: CaseNumberCitation[] = [];
  for (const m of text.matchAll(CASE_NO)) {
    const raw = m[1]!;
    out.push({ start: m.index!, end: m.index! + raw.length, text: raw, normalized: raw.replace(/\s+/g, ""), family: raw.startsWith("조심") ? "tribunal" : "court" });
  }
  return out;
}

export interface TextSegment<M> {
  text: string;
  match: M | null;
}

/** 겹치지 않게 앞에서부터 잘라 [글자, 링크 후보] 조각으로 - 겹치면 먼저 시작한 것만 */
export function segmentText<M extends { start: number; end: number }>(text: string, matches: readonly M[]): TextSegment<M>[] {
  const sorted = [...matches].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: TextSegment<M>[] = [];
  let at = 0;
  for (const m of sorted) {
    if (m.start < at) continue;
    if (m.start > at) out.push({ text: text.slice(at, m.start), match: null });
    out.push({ text: text.slice(m.start, m.end), match: m });
    at = m.end;
  }
  if (at < text.length) out.push({ text: text.slice(at), match: null });
  return out;
}
