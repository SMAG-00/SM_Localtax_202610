import type { DraftSentence } from "./types";

/** 문장 끝 부호 (반각·전각) */
const TERMINATORS = new Set([".", "?", "!", "…", "‥", "。", "｡", "．", "？", "！"]);
/** 문장 끝 부호 바로 뒤에 오면 앞 문장에 붙이는 닫는 부호 */
const CLOSERS = new Set([")", "]", "}", "）", "〕", "》", "〉", "”", "’", '"', "'", "」", "』"]);
/** 짝 따옴표 — 여는 부호 → 닫는 부호 */
const PAIRED_QUOTES = new Map([
  ["“", "”"],
  ["‘", "’"],
  ["「", "」"],
  ["『", "』"],
]);
/** 문장 첫머리 번호 표시 ("1." "가.") — 이 뒤의 마침표는 문장 끝이 아니다 */
const NUMBERING_MARKER = /^(?:\d{1,3}|[가나다라마바사아자차카타파하])$/;
const CONTENT = /[\p{L}\p{N}]/u;
const WHITESPACE = /\s/;
const LINE_BREAK = /\r\n|\r|\n/;
/** 직접 인용 블록 줄 표시 — 줄 첫머리(앞 공백 허용)의 '>' (여러 겹 허용) */
const QUOTE_BLOCK_MARKER = /^\s*(?:>\s?)+/;

/**
 * 한국어 문장 분리. 줄바꿈은 언제나 문장을 가르고, 줄 안에서는 문장 끝 부호에서 나눈다.
 * 나누지 않는 곳: 소수점·주소·이메일, 보도자료식 날짜(2026. 11. 2.), 문장 첫머리 번호(1. · 가.),
 * 짝이 맞는 따옴표 안. 글자·숫자가 없는 조각은 버리고 앞뒤 공백을 다듬어 돌려준다.
 */
export function splitSentences(text: string): string[] {
  return text.split(LINE_BREAK).flatMap(splitLine);
}

/** 원고를 문장으로 나누고, '>'로 시작하는 줄의 문장은 직접 인용 블록(inQuote)으로 표시한다. 원고 순서를 지킨다 */
export function segmentDraft(draft: string): DraftSentence[] {
  const sentences: DraftSentence[] = [];
  for (const line of draft.split(LINE_BREAK)) {
    const marker = QUOTE_BLOCK_MARKER.exec(line);
    const inQuote = marker !== null;
    const body = marker ? line.slice(marker[0].length) : line;
    for (const text of splitLine(body)) sentences.push({ text, inQuote });
  }
  return sentences;
}

function splitLine(line: string): string[] {
  const sentences: string[] = [];
  const push = (piece: string) => {
    const trimmed = piece.trim();
    if (CONTENT.test(trimmed)) sentences.push(trimmed);
  };

  const protectedDots = protectedPositions(line);
  const { inside, closeToOpen } = quoteSpans(line);
  let start = 0;
  let i = 0;
  while (i < line.length) {
    if (inside[i]) {
      // 짝 따옴표가 종결부호로 끝나고 닫힌 뒤 띄어쓰기가 오면 닫는 따옴표 뒤에서 나눈다: “…다.” 시는 …
      const open = closeToOpen.get(i);
      if (open !== undefined && quotedTextEndsSentence(line, open, i) && WHITESPACE.test(line[i + 1] ?? "")) {
        push(line.slice(start, i + 1));
        start = i + 1;
      }
      i++;
      continue;
    }
    if (!isSentenceEnd(line, i, start, protectedDots)) {
      i++;
      continue;
    }
    let end = i + 1;
    while (
      end < line.length &&
      !inside[end] &&
      ((TERMINATORS.has(line[end]!) && !protectedDots.has(end)) || CLOSERS.has(line[end]!))
    ) {
      end++;
    }
    push(line.slice(start, end));
    start = end;
    i = end;
  }
  push(line.slice(start));
  return sentences;
}

function isSentenceEnd(line: string, i: number, start: number, protectedDots: Set<number>): boolean {
  const ch = line[i]!;
  if (!TERMINATORS.has(ch) || protectedDots.has(i)) return false;
  if (ch === "." && NUMBERING_MARKER.test(line.slice(start, i).trim()) && WHITESPACE.test(line[i + 1] ?? "")) {
    return false;
  }
  return true;
}

function quotedTextEndsSentence(line: string, open: number, close: number): boolean {
  for (let k = close - 1; k > open; k--) {
    const ch = line[k]!;
    if (WHITESPACE.test(ch)) continue;
    return TERMINATORS.has(ch);
  }
  return false;
}

/** 문장 끝으로 보지 않는 부호 위치 */
function protectedPositions(line: string): Set<number> {
  const positions = new Set<number>();
  const add = (pattern: RegExp, offset: (m: RegExpMatchArray) => number) => {
    for (const m of line.matchAll(pattern)) positions.add(offset(m));
  };

  // 누리집 주소 — 주소 안의 . ? ! 전부. 주소 끝에 붙은 문장 끝 부호·닫는 부호는 주소가 아니다
  for (const m of line.matchAll(/(?:https?:\/\/|www\.)\S+/giu)) {
    const from = m.index!;
    let to = from + m[0].length;
    while (to > from && (TERMINATORS.has(line[to - 1]!) || CLOSERS.has(line[to - 1]!))) to--;
    for (let k = from; k < to; k++) positions.add(k);
  }
  // 영문·숫자 사이 마침표 — 소수점(3.5), 도메인·이메일(gaon-si.example), 약어 안(U.S)
  add(/(?<=[A-Za-z0-9])\.(?=[A-Za-z0-9])/g, (m) => m.index!);
  // 숫자 뒤 마침표 + (공백 한 칸) + 숫자 — 보도자료식 날짜 "2026. 11. 2", "12. 15"
  add(/(?<=\d)\.(?=\s?\d)/g, (m) => m.index!);
  // 숫자 뒤 마침표에 띄어쓰기 없이 글자가 붙음 — "15.까지", "2.(월)"
  add(/(?<=\d)\.(?=[^\s\d.?!…)\]}”’"'」』])/gu, (m) => m.index!);
  // 연·월·일을 다 쓴 날짜의 마지막 마침표 — "2026. 1. 1. 이후" (줄 끝이면 문장 끝)
  add(/\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\.(?!\s*$)/g, (m) => m.index! + m[0].length - 1);
  return positions;
}

/** 짝이 맞는 따옴표 구간 (바깥 구간만). 짝 없는 여는 부호는 무시한다 */
function quoteSpans(line: string): { inside: Uint8Array; closeToOpen: Map<number, number> } {
  const inside = new Uint8Array(line.length);
  const closeToOpen = new Map<number, number>();
  let i = 0;
  while (i < line.length) {
    const close = matchingClose(line, i);
    if (close === -1) {
      i++;
      continue;
    }
    inside.fill(1, i, close + 1);
    closeToOpen.set(close, i);
    i = close + 1;
  }
  return { inside, closeToOpen };
}

function matchingClose(line: string, i: number): number {
  const ch = line[i]!;
  const paired = PAIRED_QUOTES.get(ch);
  if (paired !== undefined) return line.indexOf(paired, i + 1);
  if (ch === '"') return line.indexOf('"', i + 1);
  if (ch === "'" && !isApostrophe(line, i)) {
    for (let k = i + 1; k < line.length; k++) {
      if (line[k] === "'" && !isApostrophe(line, k)) return k;
    }
  }
  return -1;
}

/** 따옴표가 아닌 작은따옴표 — 영어 축약(don't), 연도 생략('26년) */
function isApostrophe(line: string, i: number): boolean {
  const prev = line[i - 1] ?? "";
  const next = line[i + 1] ?? "";
  if (/[A-Za-z]/.test(prev) && /[A-Za-z]/.test(next)) return true;
  return !CONTENT.test(prev) && /^\d{2}(?!\d)/.test(line.slice(i + 1));
}
