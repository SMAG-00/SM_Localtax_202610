// 용어사전 화면 값 (GLO-01 — /glossary 가나다 색인·분야 거르개·관련 용어, /glossary/[번호] 용어 쪽 · docs/dev/W2-d_설계.md 2.5 · 8.2). 순수 모듈 (시험 glossary-logic.test.ts).
//  · 가나다 색인 — 첫 글자(앞의 문장부호는 건너뛴다)의 첫소리. 된소리는 예사소리 묶음(ㄲ→ㄱ·ㄸ→ㄷ·ㅃ→ㅂ·ㅆ→ㅅ·ㅉ→ㅈ), 영문·숫자는 한 묶음, 그 밖은 기타
//  · 묶음 안은 가나다 차례(한국어 정렬 — 숫자는 크기 차례), 같으면 번호
//  · 관련 용어 — 칸에는 용어 이름이 적혀 있다. 공개 용어와 이름(띄어쓰기·기호를 뺀 정규형)이 같으면 링크: 같은 쪽에 있으면 쪽 안 자리(#term-번호), 아니면 용어 쪽.
//    사전에 없거나 숨긴 용어는 글자만 · 자기 자신은 뺀다
//  · 숨긴 용어는 공개 읽기(RLS — visible)에 없어 여기 오지 않는다
import { SECTION_INFO, SECTION_KEYS, glossaryAnchor, glossaryIndexHref, glossaryTermHref, isOpenPath, isSectionKey, type Features, type SectionKey } from "./constants";
import { squash } from "./search-normalize";

/** 가나다 색인 묶음 — 차례 (설계 2.5 glossary.initials) */
export const GLOSSARY_INITIALS = ["ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ", "A–Z·0–9", "기타"] as const;
export type GlossaryInitial = (typeof GLOSSARY_INITIALS)[number];
const HANGUL_INITIALS = 14;
const LATIN: GlossaryInitial = "A–Z·0–9";
const OTHER: GlossaryInitial = "기타";

/** 첫소리 19자 (유니코드 한글 음절 차례) → 색인 묶음 */
const CHOSEONG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"] as const;
const PLAIN_CONSONANT: Readonly<Record<string, GlossaryInitial>> = { ㄲ: "ㄱ", ㄸ: "ㄷ", ㅃ: "ㅂ", ㅆ: "ㅅ", ㅉ: "ㅈ" };
const toGroup = (c: string): GlossaryInitial => PLAIN_CONSONANT[c] ?? (c as GlossaryInitial);

/** 용어의 가나다 색인 묶음 */
export function initialOf(term: string): GlossaryInitial {
  const first = [...term.normalize("NFKC")].find((ch) => /[\p{L}\p{N}]/u.test(ch));
  if (!first) return OTHER;
  const cp = first.codePointAt(0)!;
  if (cp >= 0xac00 && cp <= 0xd7a3) return toGroup(CHOSEONG[Math.floor((cp - 0xac00) / 588)]!);
  // 첫소리 글자(ᄀ~ᄒ — NFKC가 호환 자모 ㄱ을 이 글자로 바꾼다)
  if (cp >= 0x1100 && cp <= 0x1112) return toGroup(CHOSEONG[cp - 0x1100]!);
  if (/[A-Za-z0-9]/.test(first)) return LATIN;
  return OTHER;
}

const groupAnchor = (initial: GlossaryInitial) => `glossary-group-${GLOSSARY_INITIALS.indexOf(initial) + 1}`;
const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });

/** 공개 읽기 행 (rows.ts GLOSSARY_COLUMNS) */
export interface GlossaryRow {
  id: number | string;
  term: string;
  reading: string | null;
  definition: string | null;
  plain: string | null;
  related: string[] | null;
  section: string[] | null;
  source: string | null;
}

export interface RelatedLink {
  label: string;
  href: string | null;
}

export interface GlossaryEntry {
  id: number;
  term: string;
  reading: string | null;
  definition: string | null;
  plain: string | null;
  sections: SectionKey[];
  sectionNames: string[];
  source: string | null;
  related: RelatedLink[];
  /** 쪽 안 자리 (id) */
  anchor: string;
  /** 용어 쪽 주소 */
  href: string;
}

export interface GlossaryGroup {
  initial: GlossaryInitial;
  anchor: string;
  entries: GlossaryEntry[];
}

export interface GlossaryTab {
  id: "all" | SectionKey;
  label: string;
  href: string;
  count: number;
}

export interface GlossaryIndexView {
  section: SectionKey | null;
  /** 지금 쪽(분야)의 용어 수 */
  total: number;
  tabs: GlossaryTab[];
  /** 가나다 색인 줄 — 용어가 없는 자음은 자리 표시 null(링크 0) */
  nav: { label: GlossaryInitial; anchor: string | null }[];
  groups: GlossaryGroup[];
}

export interface GlossaryTermView extends GlossaryEntry {
  initial: GlossaryInitial;
  /** 색인 화면의 이 용어 자리 */
  indexHref: string;
}

const text = (v: string | null | undefined) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const sectionsOf = (r: GlossaryRow): SectionKey[] => SECTION_KEYS.filter((s) => (r.section ?? []).includes(s));
const sortRows = (rows: readonly GlossaryRow[]) => [...rows].sort((a, b) => collator.compare(a.term, b.term) || Number(a.id) - Number(b.id));

/** 관련 용어 이름 → 링크 (onPage에 있으면 쪽 안 자리) */
function relatedOf(r: GlossaryRow, byKey: ReadonlyMap<string, number>, onPage: ReadonlySet<number> | null): RelatedLink[] {
  const self = Number(r.id);
  const seen = new Set<string>();
  const out: RelatedLink[] = [];
  for (const raw of r.related ?? []) {
    const label = raw.trim();
    const key = squash(label);
    if (label === "" || seen.has(key || label)) continue;
    seen.add(key || label);
    const id = key ? byKey.get(key) : undefined;
    if (id === self) continue;
    out.push({ label, href: id === undefined ? null : onPage?.has(id) ? `#${glossaryAnchor(id)}` : glossaryTermHref(id) });
  }
  return out;
}

function keysOf(rows: readonly GlossaryRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of sortRows(rows)) {
    const k = squash(r.term);
    if (k && !m.has(k)) m.set(k, Number(r.id));
  }
  return m;
}

function entryOf(r: GlossaryRow, byKey: ReadonlyMap<string, number>, onPage: ReadonlySet<number> | null): GlossaryEntry {
  const id = Number(r.id);
  const sections = sectionsOf(r);
  return {
    id,
    term: r.term,
    reading: text(r.reading),
    definition: text(r.definition),
    plain: text(r.plain),
    sections,
    sectionNames: sections.map((s) => SECTION_INFO[s].name),
    source: text(r.source),
    related: relatedOf(r, byKey, onPage),
    anchor: glossaryAnchor(id),
    href: glossaryTermHref(id),
  };
}

/** 색인 화면 (/glossary · /glossary?section=) */
export function glossaryIndexView(rows: readonly GlossaryRow[], section: SectionKey | null): GlossaryIndexView {
  const byKey = keysOf(rows);
  const picked = sortRows(section ? rows.filter((r) => sectionsOf(r).includes(section)) : rows);
  const onPage = new Set(picked.map((r) => Number(r.id)));
  const groups = new Map<GlossaryInitial, GlossaryEntry[]>();
  for (const r of picked) {
    const g = initialOf(r.term);
    groups.set(g, [...(groups.get(g) ?? []), entryOf(r, byKey, onPage)]);
  }
  const counts = Object.fromEntries(SECTION_KEYS.map((s) => [s, rows.filter((r) => sectionsOf(r).includes(s)).length])) as Record<SectionKey, number>;
  const tabs: GlossaryTab[] = [
    { id: "all", label: "전체", href: glossaryIndexHref(null), count: rows.length },
    ...SECTION_KEYS.filter((s) => counts[s] > 0 || s === section).map((s) => ({ id: s, label: SECTION_INFO[s].name, href: glossaryIndexHref(s), count: counts[s] })),
  ];
  return {
    section,
    total: picked.length,
    tabs,
    nav: GLOSSARY_INITIALS.flatMap((initial, i) => {
      const has = groups.has(initial);
      if (i >= HANGUL_INITIALS && !has) return [];
      return [{ label: initial, anchor: has ? groupAnchor(initial) : null }];
    }),
    groups: GLOSSARY_INITIALS.flatMap((initial) => {
      const entries = groups.get(initial);
      return entries ? [{ initial, anchor: groupAnchor(initial), entries }] : [];
    }),
  };
}

/** 용어 쪽 (/glossary/[번호]) — 공개 용어 목록에 없으면 null */
export function glossaryTermView(rows: readonly GlossaryRow[], id: number): GlossaryTermView | null {
  const r = rows.find((x) => Number(x.id) === id);
  if (!r) return null;
  const entry = entryOf(r, keysOf(rows), null);
  return { ...entry, initial: initialOf(r.term), indexHref: `${glossaryIndexHref(null)}#${entry.anchor}` };
}

/** 허브·상황 페이지의 용어 칩 — 용어사전이 열렸으면(기능 키 glossary) 그 용어 쪽 링크, 아니면 글자와 쉬운 풀이만 */
export interface TermChip {
  id: number;
  term: string;
  plain: string | null;
  href: string | null;
}

export function termChip(r: Pick<GlossaryRow, "id" | "term" | "plain">, features: Features): TermChip {
  const id = Number(r.id);
  const href = glossaryTermHref(id);
  return { id, term: r.term, plain: text(r.plain), href: isOpenPath(href, features) ? href : null };
}

/** 본문 툴팁 용어 (GLO-02) — 쉬운 풀이가 있는 공개 용어만. '용어사전에서 보기'는 용어사전이 열렸을 때만 */
export function tipTerms(rows: readonly Pick<GlossaryRow, "id" | "term" | "plain">[], features: Features): { id: number; term: string; plain: string; href: string | null }[] {
  return rows.flatMap((r) => {
    const chip = termChip(r, features);
    return chip.plain && r.term.trim() ? [{ id: chip.id, term: r.term.trim(), plain: chip.plain, href: chip.href }] : [];
  });
}

/** 용어 쪽 주소의 번호 — 1 이상 정수(앞 0 없음, 16자리까지), 아니면 null(404) */
export function parseGlossaryId(raw: string): number | null {
  return /^[1-9]\d{0,15}$/.test(raw) ? Number(raw) : null;
}

/** 색인 화면 주소의 분야 — 4대 분야가 아니면 null(전체) */
export function parseGlossarySection(raw: string | string[] | undefined): SectionKey | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return isSectionKey(v) ? v : null;
}
