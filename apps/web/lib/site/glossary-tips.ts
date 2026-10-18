// 본문 첫 등장 용어 풀이(툴팁) 계획 (GLO-02 · BM-S5 — docs/dev/W2-d_설계.md 2.5 glossary.tip_blocks · 8.2). 순수 모듈 — 기사 상세 화면(서버)이 쓴다.
// 저장된 본문은 바꾸지 않는다 — 그릴 때마다 글을 조각으로 나눠 '이 자리가 이 용어의 첫 등장'이라는 표시만 더한다(계획의 글을 이으면 원래 글).
//  · 한 기사에서 같은 용어는 한 번만 — 블록 차례(위에서 아래)로 첫 등장 하나
//  · 긴 용어가 먼저 맞는다 — 같은 자리에서 시작하는 용어 가운데 가장 긴 것("지방교육세"가 "교육세"보다 먼저). 맞은 자리 안의 짧은 용어는 그 자리에서 0
//  · 낱말 가운데는 맞추지 않는다 — 한글로 시작하는 용어는 바로 앞 글자가 한글 음절이면 0("지방교육세" 안의 "교육세"),
//    영문·숫자로 시작·끝나는 용어는 앞·뒤 글자가 영문·숫자이면 0("PFV" 안의 "PF"). 뒤에 붙는 조사("취득세를")는 그대로 맞는다
//  · 붙이는 곳 — 문단·인용·상자 블록의 글(설계 2.5 glossary.tip_blocks). 문단 안 링크·글자로 남은 링크 표기 [글](주소)·상자 제목·인용 발언자·
//    기사 제목·요약·표·FAQ·핵심 요약 상자는 붙이지 않는다
//  · 그 블록에 쉬운 풀이가 이미 적혀 있으면("과세표준(세금을 매기는 기준 금액)") 풀어 쓴 것으로 보고 0 — 발행 점검(UX-01 '풀이 없는 첫 등장')과 같은 판단.
//    그 뒤 블록에서도 0(첫 등장은 이미 지났다)
//  · 공개 용어(visible) 가운데 쉬운 풀이가 있는 것만 — 공개 데이터 함수가 고른다
import type { StoredBlock } from "@/lib/server/articles/content";
import { MARKDOWN_LINK } from "@/lib/server/public/constants";
import { paragraphSegments } from "./article-view";

/** 툴팁을 붙이는 블록 종류 (설계 2.5 glossary.tip_blocks) */
export const TIP_BLOCK_TYPES = ["paragraph", "quote", "callout"] as const;

/** 툴팁 용어 — href는 용어사전 화면이 열렸을 때만(기능 키 glossary), 아니면 null(풀이만) */
export interface TipTerm {
  id: number;
  term: string;
  plain: string;
  href: string | null;
}

export type TipPiece = { kind: "text"; text: string } | { kind: "term"; text: string; term: TipTerm };

/** 블록 글의 한 조각 — 글(붙여도 되는지 표시) 또는 링크 */
export type TipRun = { kind: "text"; text: string; eligible: boolean } | { kind: "link"; text: string; href: string; external: boolean };
/** 계획한 조각 — 글은 툴팁 자리로 나눈 조각들, 링크는 그대로 */
export type PlannedRun = { kind: "text"; pieces: TipPiece[] } | { kind: "link"; text: string; href: string; external: boolean };

export interface TipUnit {
  runs: readonly TipRun[];
}

interface Candidate {
  term: TipTerm;
  re: RegExp;
  size: number;
  hangulStart: boolean;
  alnumStart: boolean;
  alnumEnd: boolean;
}

const HANGUL_SYLLABLE = /[가-힣]/u;
const ALNUM = /[A-Za-z0-9]/;
const WS = /\s+/gu;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const collapse = (s: string) => s.normalize("NFC").replace(WS, " ").trim();

/** 용어 → 같은 첫 글자끼리 묶은 후보(긴 것 먼저). 용어 안 띄어쓰기는 본문의 띄어쓰기 여러 칸·줄바꿈과도 맞는다 */
function compile(terms: readonly TipTerm[]): Map<string, Candidate[]> {
  const byFirst = new Map<string, Candidate[]>();
  for (const t of terms) {
    const text = collapse(t.term);
    if (text === "" || collapse(t.plain) === "") continue;
    const latin = /[A-Za-z]/.test(text);
    const re = new RegExp(text.split(" ").map(escape).join("\\s+"), `y${latin ? "i" : ""}u`);
    const first = text[0]!.toLowerCase();
    const list = byFirst.get(first) ?? [];
    list.push({ term: t, re, size: [...text.replace(/ /g, "")].length, hangulStart: HANGUL_SYLLABLE.test(text[0]!), alnumStart: ALNUM.test(text[0]!), alnumEnd: ALNUM.test(text.at(-1)!) });
    byFirst.set(first, list);
  }
  for (const list of byFirst.values()) list.sort((a, b) => b.size - a.size || a.term.term.localeCompare(b.term.term, "ko") || a.term.id - b.term.id);
  return byFirst;
}

/** i 자리에서 시작하는 가장 긴 용어 (낱말 가운데 0) */
function longestAt(text: string, i: number, byFirst: Map<string, Candidate[]>): { c: Candidate; length: number } | null {
  const list = byFirst.get(text[i]!.toLowerCase());
  if (!list) return null;
  const prev = i > 0 ? text[i - 1]! : "";
  for (const c of list) {
    if (c.hangulStart && prev && HANGUL_SYLLABLE.test(prev)) continue;
    if (c.alnumStart && prev && ALNUM.test(prev)) continue;
    c.re.lastIndex = i;
    const m = c.re.exec(text);
    if (!m) continue;
    const next = text[i + m[0].length] ?? "";
    if (c.alnumEnd && next && ALNUM.test(next)) continue;
    return { c, length: m[0].length };
  }
  return null;
}

/** 블록 묶음 → 블록마다 계획한 조각. used·explained는 기사 하나에서 함께 쓴다(첫 등장 한 번) */
export function markUnits(units: readonly TipUnit[], terms: readonly TipTerm[]): PlannedRun[][] {
  const byFirst = compile(terms);
  const used = new Set<number>();
  return units.map((unit) => {
    const whole = collapse(unit.runs.map((r) => r.text).join(""));
    return unit.runs.map((run): PlannedRun => {
      if (run.kind === "link") return run;
      const text = run.text.normalize("NFC");
      if (!run.eligible || byFirst.size === 0) return { kind: "text", pieces: [{ kind: "text", text }] };
      const pieces: TipPiece[] = [];
      let buf = "";
      for (let i = 0; i < text.length; ) {
        const hit = longestAt(text, i, byFirst);
        if (!hit) {
          buf += text[i];
          i++;
          continue;
        }
        const matched = text.slice(i, i + hit.length);
        i += hit.length;
        const id = hit.c.term.id;
        if (used.has(id)) {
          buf += matched;
          continue;
        }
        used.add(id);
        // 그 블록에 풀이가 이미 있으면 풀어 쓴 첫 등장 — 툴팁 0
        if (whole.includes(collapse(hit.c.term.plain))) {
          buf += matched;
          continue;
        }
        if (buf) pieces.push({ kind: "text", text: buf });
        buf = "";
        pieces.push({ kind: "term", text: matched, term: hit.c.term });
      }
      if (buf || pieces.length === 0) pieces.push({ kind: "text", text: buf });
      return { kind: "text", pieces };
    });
  });
}

/** 문단 글 → 조각 — 열린 링크는 링크 조각, 글자로 남은 링크 표기 [글](주소)는 붙이지 않는 글 */
function paragraphRuns(text: string): TipRun[] {
  const out: TipRun[] = [];
  for (const seg of paragraphSegments(text)) {
    if (seg.kind === "link") {
      out.push(seg);
      continue;
    }
    let last = 0;
    for (const m of seg.text.matchAll(MARKDOWN_LINK)) {
      if (m.index! > last) out.push({ kind: "text", text: seg.text.slice(last, m.index), eligible: true });
      out.push({ kind: "text", text: m[0], eligible: false });
      last = m.index! + m[0].length;
    }
    if (last < seg.text.length) out.push({ kind: "text", text: seg.text.slice(last), eligible: true });
  }
  return out;
}

/** 툴팁을 붙일 블록의 글 조각 — 붙이지 않는 블록이면 null */
function blockRuns(block: StoredBlock): TipRun[] | null {
  switch (block.type) {
    case "paragraph":
      return paragraphRuns(block.text);
    case "quote":
    case "callout":
      return [{ kind: "text", text: block.text, eligible: true }];
    default:
      return null;
  }
}

/** 기사 본문 → 블록 번호마다 계획한 조각 (툴팁을 붙일 수 있는 블록만 — 나머지 블록은 화면이 원래대로 그린다) */
export function articleTipPlan(blocks: readonly StoredBlock[], terms: readonly TipTerm[]): Map<number, PlannedRun[]> {
  const eligible = blocks.flatMap((b, i) => {
    const runs = blockRuns(b);
    return runs ? [{ index: i, runs }] : [];
  });
  const planned = markUnits(eligible, terms);
  return new Map(eligible.map((e, k) => [e.index, planned[k]!]));
}

/** 계획에 툴팁이 하나라도 있는가 (화면이 보조 스크립트를 붙일지) */
export const hasTips = (plan: ReadonlyMap<number, readonly PlannedRun[]>) =>
  [...plan.values()].some((runs) => runs.some((r) => r.kind === "text" && r.pieces.some((p) => p.kind === "term")));
