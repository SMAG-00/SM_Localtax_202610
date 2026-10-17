// 글 다루기 — 문장 나누기·글자 수·표현 비교용 정리, 기사에서 검사할 글 단위(제목·요약·블록·박스·해결 사례 칸) 뽑기
import type { ArticleBlock, ArticleForPublish } from "./model";

/** 문장 끝 부호 (반각·전각) */
const TERMINATORS = new Set([".", "?", "!", "…", "。", "？", "！"]);
/** 문장 끝 부호 바로 뒤에 오면 앞 문장에 붙는 닫는 부호 */
const CLOSERS = new Set([")", "]", "）", "”", "’", '"', "'", "」", "』", "〉", "》"]);
/** 문장 첫머리 번호 표시 ("1." "가.") — 이 뒤의 마침표는 문장 끝이 아니다 */
const NUMBERING = /^(?:\d{1,3}|[가나다라마바사아자차카타파하])$/;
const CONTENT = /[\p{L}\p{N}]/u;
const LINE_BREAK = /\r\n|\r|\n/;

/** 비교용 정리 — 완성형(NFC)으로 맞추고, 연속 공백을 하나로, 앞뒤 공백을 지운다 */
export function normalizeText(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** 글자 수 — 공백·줄바꿈을 빼고 코드 포인트 단위로 센다 (e2e R1 글자 수 검사와 같은 셈법) */
export function countChars(text: string): number {
  let n = 0;
  for (const ch of text) if (!/\s/u.test(ch)) n++;
  return n;
}

export function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

/**
 * 한국어 문장 나누기. 줄바꿈은 언제나 문장을 가르고, 줄 안에서는 문장 끝 부호 + 띄어쓰기(또는 줄 끝)에서 나눈다.
 * 나누지 않는 곳: 소수점(18.4), 보도자료식 날짜(2026. 11. 2.), 문장 첫머리 번호(1. · 가.).
 * 닫는 따옴표·괄호는 앞 문장에 붙인다. 글자·숫자가 없는 조각은 버린다.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.normalize("NFC").split(LINE_BREAK)) splitLine(line, out);
  return out;
}

function splitLine(line: string, out: string[]): void {
  const push = (piece: string) => {
    const trimmed = piece.trim();
    if (CONTENT.test(trimmed)) out.push(trimmed);
  };
  let start = 0;
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (!TERMINATORS.has(ch)) {
      i++;
      continue;
    }
    let end = i + 1;
    while (end < line.length && (TERMINATORS.has(line[end]!) || CLOSERS.has(line[end]!))) end++;
    const next = line[end];
    const boundary = next === undefined || /\s/.test(next);
    if (boundary && !(ch === "." && isProtectedDot(line, start, i))) {
      push(line.slice(start, end));
      start = end;
    }
    i = end;
  }
  push(line.slice(start));
}

/** 마침표가 번호 표시이거나 숫자 사이(날짜 2026. 11.)에 있으면 문장 끝이 아니다 */
function isProtectedDot(line: string, start: number, dot: number): boolean {
  if (NUMBERING.test(line.slice(start, dot).trim())) return true;
  const prev = line[dot - 1];
  return prev !== undefined && /\d/.test(prev) && /^\d/.test(line.slice(dot + 1).trimStart());
}

/** 받침 유무에 따라 조사를 고른다 — 받침 있으면 withFinal(이·은·을), 없으면 withoutFinal(가·는·를) */
export function josa(word: string, withFinal: string, withoutFinal: string): string {
  const last = word.normalize("NFC").at(-1);
  if (last === undefined) return withFinal;
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return withFinal;
  return (code - 0xac00) % 28 === 0 ? withoutFinal : withFinal;
}

// ── 기사에서 검사할 글 단위 ──────────────────────────────────

/** 위치가 같은 글 묶음 — 문장 번호(sentenceIndex)는 이 목록의 순번이다 */
export interface TextUnit {
  field: string;
  blockIndex?: number;
  sentences: string[];
}

/**
 * 블록의 화면 글을 문서 순서대로 문장 목록으로 — 콜아웃은 제목이 0번, 인용은 발언 뒤에 발언자,
 * 표는 캡션 뒤에 칸, 이미지는 캡션 뒤에 대체 텍스트, FAQ는 질문·답 차례.
 */
export function blockSentences(block: ArticleBlock): string[] {
  switch (block.type) {
    case "paragraph":
      return splitSentences(block.text);
    case "quote":
      return [...splitSentences(block.text), ...splitSentences(block.speaker)];
    case "callout":
      return [...splitSentences(block.title), ...splitSentences(block.text)];
    case "table":
      return [...splitSentences(block.caption), ...block.rows.flat().flatMap(splitSentences)];
    case "image":
    case "infographic":
      return [...splitSentences(block.caption), ...splitSentences(block.alt)];
    case "video":
      return splitSentences(block.caption);
    case "faq":
      return block.items.flatMap((item) => [...splitSentences(item.question), ...splitSentences(item.answer)]);
    case "key_summary":
      return block.lines.flatMap(splitSentences);
  }
}

/** 상자 블록(콜아웃·핵심 요약 상자)의 본문 문장 — 상자 제목은 세지 않는다. 상자가 아니면 null */
export function boxBodySentences(block: ArticleBlock): string[] | null {
  if (block.type === "callout") return splitSentences(block.text);
  if (block.type === "key_summary") return block.lines.flatMap(splitSentences);
  return null;
}

export const SOLVED_CASE_CELLS = [
  ["situation", "상황"],
  ["issue", "쟁점"],
  ["result", "결과"],
  ["lesson", "교훈"],
] as const;

/** 기사에서 독자에게 보이는 글 전부 — 제목 · 요약 · 블록 · 「지방세로 읽기」(포인트 → 링크 이름) · 해결 사례 4칸 */
export function articleUnits(article: ArticleForPublish): TextUnit[] {
  const units: TextUnit[] = [
    { field: "title", sentences: isBlank(article.title) ? [] : [article.title.normalize("NFC").trim()] },
    { field: "summary", sentences: splitSentences(article.summary) },
    ...article.blocks.map((block, blockIndex) => ({ field: "blocks", blockIndex, sentences: blockSentences(block) })),
  ];
  if (article.taxLens) units.push(taxLensUnit(article.taxLens));
  if (article.solvedCase) {
    for (const [key] of SOLVED_CASE_CELLS) {
      units.push({ field: `solvedCase.${key}`, sentences: splitSentences(article.solvedCase[key]) });
    }
  }
  return units;
}

/** 「지방세로 읽기」 박스의 글 — 문장 번호는 포인트 순번, 그 뒤에 링크 이름 */
export function taxLensUnit(lens: { points: readonly string[]; links: readonly { label: string }[] }): TextUnit {
  return { field: "taxLens", sentences: [...lens.points, ...lens.links.map((l) => l.label)].map((s) => s.normalize("NFC")) };
}

export interface PhraseHit {
  unit: TextUnit;
  sentenceIndex: number;
  phrase: string;
}

/** 사전 표현 찾기 — 공백을 정리한 문장에 정리한 표현이 들어 있으면 걸린다(문장마다 표현당 1건) */
export function findPhrases(units: readonly TextUnit[], phrases: readonly string[]): PhraseHit[] {
  const wanted = [...new Set(phrases.map(normalizeText).filter((p) => p !== ""))];
  const hits: PhraseHit[] = [];
  for (const unit of units) {
    unit.sentences.forEach((sentence, sentenceIndex) => {
      const text = normalizeText(sentence);
      for (const phrase of wanted) if (text.includes(phrase)) hits.push({ unit, sentenceIndex, phrase });
    });
  }
  return hits;
}

/** 글 단위 + 문장 번호 → 위치 (블록이면 blockIndex 포함) */
export function unitLocation(unit: TextUnit, sentenceIndex: number, phrase?: string) {
  return {
    field: unit.field,
    ...(unit.blockIndex === undefined ? {} : { blockIndex: unit.blockIndex }),
    sentenceIndex,
    ...(phrase === undefined ? {} : { phrase }),
  };
}
