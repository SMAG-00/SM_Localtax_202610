// 출처 후보 뽑기 (F5 출처 자동 채우기) — 기사 본문 블록의 [글](URL) 링크와 그 줄의 글자에서 출처 후보를 만든다. 순수 함수 (시험: source-suggest.test.ts)
//  · 이미 본문에 있는 글자·링크만 옮긴다. 근거 글자가 없는 칸은 비운다(지어내지 않음). LLM 호출 없음 — 규칙 기반, 칸마다 근거를 남긴다.
//  · 같은 주소는 하나로 합치고, 이미 기사에 등록된 출처 주소는 뺀다.
//  · 제목·발표일은 '출처:'로 시작하는 줄에서만 읽는다(일반 문장 속 날짜를 출처의 발표일로 오해하지 않기 위해). 날짜는 링크 바로 앞 구간 기준, 여러 개면 비운다.
import type { SourceForm } from "./records-form";
import { EMPTY_SOURCE_FORM } from "./records-form";
import { domainInfo } from "./source-domains";

/** 후보 칸마다의 근거 — 어느 글자·어느 표에서 왔는지 (비면 값도 비어 있다) */
export type CandidateBasis = Record<"kind" | "title" | "url" | "publisher" | "published_on" | "reference_date" | "region_unit" | "source_type" | "collected_on", string>;

export interface SourceCandidate {
  kind: string;
  title: string;
  url: string;
  publisher: string;
  /** YYYY-MM-DD 또는 "" */
  published_on: string;
  /** 기준일 YYYY-MM-DD 또는 "" — 문서 자료(법률안·고시·조례)만 발표일을 그대로 쓴다 */
  reference_date: string;
  /** 지역 단위 — 전국 기관이면 '전국', 모르면 "" */
  region_unit: string;
  source_type: string;
  /** 오늘(한국 날짜) */
  collected_on: string;
  basis: CandidateBasis;
}

/** 원문 페이지 확인 결과 (서버 fetch-check) — 확인하지 않은 후보는 null */
export interface SourceCheck {
  ok: boolean;
  /** 실패 이유 (ok면 null) */
  reason: string | null;
  /** 열렸을 때만 — 오늘(한국 날짜) */
  verified_on: string | null;
  /** 공공누리 유형 kogl_1~4 (못 찾으면 null) */
  license_type: string | null;
  /** 이용 조건 후보 글자 — 페이지에 적힌 표시 */
  license_status: string | null;
  /** 공공누리를 어디서 읽었는지 */
  license_basis: string | null;
  /** 자동 확인(주소 열림) 표시 — 출처 표에 칸이 없어 응답에만 둔다 */
  auto_verified: boolean;
}

export interface SuggestOptions {
  /** 한국 날짜 YYYY-MM-DD */
  today: string;
  coversBillStatus: boolean;
  /** settings.official_source_types */
  allowedSourceTypes: readonly string[];
  /** 이미 등록된 출처 주소 */
  existingUrls: readonly string[];
}

const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
const SOURCE_LINE = /^\s*출처\s*[:：]\s*/;
const DATE = /(?<!\d)(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})(?!\d)/g;
const MAX_CANDIDATES = 20;
const MAX_TITLE = 120;

export const normalizeUrl = (u: string): string => u.trim().replace(/#.*$/, "").replace(/\/+$/, "");

const pad = (n: string) => n.padStart(2, "0");

function validYmd(y: string, m: string, d: string): boolean {
  const t = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return t.getUTCFullYear() === Number(y) && t.getUTCMonth() === Number(m) - 1 && t.getUTCDate() === Number(d);
}

/** 글자 안의 날짜 — 서로 다른 날짜가 정확히 1개일 때만 돌려준다 (여러 개·없음이면 null) */
export function singleDateIn(text: string): { iso: string; raw: string } | null {
  const found = new Map<string, string>();
  for (const m of text.matchAll(DATE)) {
    if (!validYmd(m[1]!, m[2]!, m[3]!)) continue;
    found.set(`${m[1]}-${pad(m[2]!)}-${pad(m[3]!)}`, m[0]);
  }
  if (found.size !== 1) return null;
  const [iso, raw] = [...found.entries()][0]!;
  return { iso, raw };
}

const cleanSegment = (s: string): string =>
  s
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s·,;|\-–—]+|[\s·,;|\-–—]+$/g, "")
    .trim();

/** 블록 하나에서 줄 목록 — 문단·인용·안내 상자의 글자, 표의 제목·칸. 소제목 등은 링크 표기를 쓰지 않으므로 보지 않는다 */
function linesOf(block: unknown): string[] {
  if (typeof block !== "object" || block === null) return [];
  const b = block as Record<string, unknown>;
  const texts: string[] = [];
  if (b.type === "paragraph" || b.type === "quote" || b.type === "callout") {
    if (typeof b.text === "string") texts.push(b.text);
    if (b.type === "callout" && typeof b.title === "string") texts.push(b.title);
  } else if (b.type === "table") {
    if (typeof b.caption === "string") texts.push(b.caption);
    if (Array.isArray(b.rows)) for (const row of b.rows) if (Array.isArray(row)) for (const cell of row) if (typeof cell === "string") texts.push(cell);
  }
  return texts.flatMap((t) => t.split(/\r?\n/));
}

interface Raw {
  url: string;
  linkText: string;
  title: string;
  titleFromSourceLine: boolean;
  date: { iso: string; raw: string } | null;
}

function rawLinks(blocks: readonly unknown[]): Raw[] {
  const out: Raw[] = [];
  for (const block of blocks) {
    for (const line of linesOf(block)) {
      const prefix = SOURCE_LINE.exec(line);
      const isSource = prefix !== null;
      let from = prefix ? prefix[0].length : 0;
      for (const m of line.matchAll(LINK)) {
        const before = cleanSegment(line.slice(from, m.index));
        from = (m.index ?? 0) + m[0].length;
        const usable = isSource && before !== "" && before.length <= MAX_TITLE;
        out.push({
          url: m[2]!,
          linkText: cleanSegment(m[1]!),
          title: usable ? before : cleanSegment(m[1]!),
          titleFromSourceLine: usable,
          date: usable ? singleDateIn(before) : null,
        });
      }
    }
  }
  return out;
}

/** 기준일을 발표일과 같게 두는 문서 자료 종류 — 데이터(세수·거래 등)는 기준 시점이 따로 있어 비운다 */
const DOCUMENT_SOURCE_TYPES: ReadonlySet<string> = new Set(["bill", "notice", "ordinance"]);

/** 본문 블록 → 출처 후보 목록 (주소 하나에 후보 하나, 등록된 주소 제외, 본문에 나온 순서) */
export function suggestSources(blocks: readonly unknown[], opts: SuggestOptions): SourceCandidate[] {
  const existing = new Set(opts.existingUrls.map(normalizeUrl));
  const merged = new Map<string, Raw>();
  for (const r of rawLinks(blocks)) {
    const key = normalizeUrl(r.url);
    if (existing.has(key)) continue;
    const prev = merged.get(key);
    if (!prev || (!prev.titleFromSourceLine && r.titleFromSourceLine)) merged.set(key, r);
  }
  const out: SourceCandidate[] = [];
  for (const raw of merged.values()) {
    if (out.length >= MAX_CANDIDATES) break;
    const info = domainInfo(raw.url);
    const bill = opts.coversBillStatus && info.kind === "official_doc" && opts.allowedSourceTypes.includes("bill");
    const sourceType = bill ? "bill" : "";
    const refFromPublished = info.kind === "official_doc" && DOCUMENT_SOURCE_TYPES.has(sourceType) && raw.date !== null && raw.date !== undefined;
    const national = info.kind === "official_doc" && info.national;
    out.push({
      kind: info.kind,
      title: raw.title,
      url: raw.url.trim(),
      publisher: info.publisher,
      published_on: raw.date?.iso ?? "",
      reference_date: refFromPublished ? (raw.date?.iso ?? "") : "",
      region_unit: national ? "전국" : "",
      source_type: sourceType,
      collected_on: opts.today,
      basis: {
        kind: info.known ? `도메인 표: ${info.host}` : info.kind === "official_doc" ? `정부 도메인(.go.kr): ${info.host}` : `도메인 표에 없는 주소: ${info.host}`,
        title: raw.titleFromSourceLine ? `'출처:' 줄 글자 "${raw.title}"` : `링크 글자 "${raw.linkText}"`,
        url: `본문 링크 [${raw.linkText}]`,
        publisher: info.known ? `도메인 표: ${info.host} → ${info.publisher}` : "",
        published_on: raw.date ? `'출처:' 줄 날짜 ${raw.date.raw}` : "",
        reference_date: refFromPublished ? `문서 자료(${sourceType})는 발표일을 기준일로 씁니다 — '출처:' 줄 날짜 ${raw.date?.raw}` : "",
        region_unit: national ? `도메인 표: ${info.host} → ${info.publisher}(전국 기관)` : "",
        source_type: bill ? "법안 상태를 다룬 기사 + 공식 문서 (허용 목록에 bill 있음)" : "",
        collected_on: "오늘 (한국 시각)",
      },
    });
  }
  return out;
}

/** 후보(+확인 결과) → 출처 더하기 폼 값. 확인 결과가 없으면 확인일·공공누리·이용 조건은 비운다 */
export function candidateToForm(c: SourceCandidate, check: SourceCheck | null): SourceForm {
  const ok = check?.ok === true;
  return {
    ...EMPTY_SOURCE_FORM,
    kind: c.kind,
    title: c.title,
    url: c.url,
    sourceName: c.publisher,
    lastVerifiedDate: ok ? (check?.verified_on ?? "") : "",
    licenseStatus: ok ? (check?.license_status ?? "") : "",
    licenseType: ok ? (check?.license_type ?? "") : "",
    sourceType: c.source_type,
    publishedOn: c.published_on,
    referenceDate: c.reference_date,
    regionUnit: c.region_unit,
    collectedDate: c.collected_on,
  };
}

const OFFICIAL = new Set(["official_doc", "dataset"]);

/**
 * [이대로 추가]를 막는 빈 칸 — 공식 자료는 발표기관·확인일·이용 조건·공공누리 유형이 있어야 저장됩니다(FND-04 · PR-07).
 * 비어 있으면 '고쳐서 추가'로 유도합니다.
 */
export function addBlockers(f: SourceForm): string[] {
  if (!OFFICIAL.has(f.kind)) return [];
  const need: [string, string][] = [
    [f.sourceName, "발표기관"],
    [f.lastVerifiedDate, "확인일"],
    [f.licenseStatus, "이용 조건"],
    [f.licenseType, "공공누리 유형"],
  ];
  return need.filter(([v]) => v.trim() === "").map(([, name]) => name);
}

/** 저장은 되지만 발행 전에 채워야 하는 공식 자료 칸 (REG1-09) — 카드에서 강조만 한다 */
export function publishGaps(f: SourceForm): string[] {
  if (!OFFICIAL.has(f.kind)) return [];
  const need: [string, string][] = [
    [f.publishedOn, "발표일"],
    [f.referenceDate, "기준일"],
    [f.regionUnit, "지역 단위"],
    [f.collectedDate, "수집일"],
  ];
  return need.filter(([v]) => v.trim() === "").map(([, name]) => name);
}
