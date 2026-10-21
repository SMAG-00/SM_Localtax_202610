// 허브 "이 분야의 지방세 포인트" 입력 검사·저장 모양 (01B CORE-02 · W3 9단계 — docs/dev/W3_설계.md 2.2 · 2.3 · 2.8) — 순수 모듈.
// DB 트리거 home_points_settings_guard(마이그레이션 …37)와 같은 한도다: 분야 realestate·finance·local · 1~3줄(4줄 저장 거부) · 줄마다 1~60자(R8) ·
// 기준일(실제 날짜) · 사이트 안 지방세 해설 링크 1~3개 · 경력 연수 표기 0. 여기서는 그에 더해 세액 표현·금지 표현(CORE-01 박스와 같은 규칙)을 막는다.
// 문구는 편집국이 쓰고 세무 감수위원이 서명한다 — 이 모듈은 문구를 만들지 않는다. 초안을 고치면 서명은 지워진다(감수 전 → 블록째 숨김).
import { pointLineProblems } from "@ltr/editorial";
import { hasClaimToken } from "@/lib/brand/claim";

export const HUB_POINT_SECTIONS = ["realestate", "finance", "local"] as const;
export type HubPointSection = (typeof HUB_POINT_SECTIONS)[number];
export const isHubPointSection = (v: unknown): v is HubPointSection => typeof v === "string" && (HUB_POINT_SECTIONS as readonly string[]).includes(v);

/** 줄 수 상한 (CORE-02 '3줄 이하' — 4줄 저장 거부) */
export const HUB_POINT_MAX_LINES = 3;
/** 줄 글자 상한 (R8 화면 안내 문장 60자 — 홈 핵심 메시지와 같다) */
export const HUB_POINT_LINE_MAX = 60;
export const HUB_POINT_LINKS_MAX = 3;
export const HUB_POINT_LABEL_MAX = 40;
/** 지방세 해설 링크 — 사이트 안 /tax… · /news/<주소>만 (쿼리·조각·바깥 주소 0). DB 트리거와 같은 식 */
export const HUB_POINT_HREF = /^\/(tax(\/[^\s/?#]+)*|news\/[^\s/?#]+)$/;

export interface HubPointLink {
  label: string;
  href: string;
}
export interface HubPointDraft {
  section: HubPointSection;
  lines: string[];
  baseDate: string;
  links: HubPointLink[];
}
/** settings.hub_tax_points 한 분야의 저장 모양 (DB 트리거가 같은 칸만 받는다) */
export interface StoredHubPoint {
  lines: string[];
  base_date: string;
  links: HubPointLink[];
  drafted_by: string;
  drafted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}
export type StoredHubPoints = Partial<Record<HubPointSection, StoredHubPoint>>;
export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const chars = (s: string) => [...s].length;

/** 실제 달력 날짜 YYYY-MM-DD */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** 편집 칸 글(한 줄에 하나) → 줄 목록 — 앞뒤 공백을 지우고 빈 줄은 뺀다. 화면과 서버가 같은 함수로 4번째 줄을 센다 */
export function splitPointLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/** 링크 편집 칸 글(한 줄에 "이름 | 주소") → 링크 목록. 빈 줄은 뺀다 */
export function splitPointLinks(text: string): HubPointLink[] {
  return splitPointLines(text).map((l) => {
    const at = l.lastIndexOf("|");
    return at === -1 ? { label: "", href: l } : { label: l.slice(0, at).trim(), href: l.slice(at + 1).trim() };
  });
}

/** 줄 수만 — 화면이 저장 전에 4번째 줄을 막는다 (서버도 같은 문장으로 422) */
export function lineCountError(lines: readonly string[]): string | null {
  if (lines.length === 0) return "lines: 포인트를 1줄 이상 적어 주세요";
  if (lines.length > HUB_POINT_MAX_LINES) return `lines: 포인트는 ${HUB_POINT_MAX_LINES}줄까지입니다 — ${lines.length}번째 줄은 저장하지 않습니다 (지금 ${lines.length}줄)`;
  return null;
}

/** 초안 입력 검사 — errors는 "칸: 문장" (칸 = section · lines · lines[i] · baseDate · links · links[i].label · links[i].href) */
export function parseHubPointDraft(raw: Record<string, unknown>, opts: { forbiddenPhrases: readonly string[] }): Parsed<HubPointDraft> {
  const errors: string[] = [];
  const section = raw.section;
  if (!isHubPointSection(section)) errors.push(`section: ${HUB_POINT_SECTIONS.join("·")} 중 하나여야 합니다 (지방세 허브에는 포인트 블록이 없습니다)`);

  const lines = Array.isArray(raw.lines) ? raw.lines : typeof raw.lines === "string" ? splitPointLines(raw.lines) : null;
  const cleanLines: string[] = [];
  if (!lines) errors.push("lines: 줄 목록이어야 합니다");
  else {
    lines.forEach((l, i) => {
      if (typeof l !== "string" || l.trim() === "") return errors.push(`lines[${i}]: 빈 줄은 저장하지 않습니다`);
      const t = l.trim();
      if (chars(t) > HUB_POINT_LINE_MAX) errors.push(`lines[${i}]: ${HUB_POINT_LINE_MAX}자 이하여야 합니다 (R8 — 지금 ${chars(t)}자)`);
      if (hasClaimToken(t)) errors.push(`lines[${i}]: 경력 연수 표기('50년' 등)는 쓰지 않습니다`);
      cleanLines.push(t);
    });
    const count = lineCountError(lines);
    if (count) errors.push(count);
    for (const p of pointLineProblems(cleanLines, opts.forbiddenPhrases)) errors.push(`lines[${p.index}]: ${p.message}`);
  }

  const baseDate = raw.baseDate;
  if (!isIsoDate(baseDate)) errors.push("baseDate: 기준일(YYYY-MM-DD)이 필요합니다");

  const links: HubPointLink[] = [];
  if (!Array.isArray(raw.links) || raw.links.length === 0) errors.push("links: 지방세 해설 링크를 1개 이상 넣어 주세요");
  else {
    if (raw.links.length > HUB_POINT_LINKS_MAX) errors.push(`links: 링크는 ${HUB_POINT_LINKS_MAX}개까지입니다`);
    raw.links.forEach((l, i) => {
      const o = (typeof l === "object" && l !== null ? l : {}) as Record<string, unknown>;
      const label = typeof o.label === "string" ? o.label.trim() : "";
      const href = typeof o.href === "string" ? o.href.trim() : "";
      if (label === "" || chars(label) > HUB_POINT_LABEL_MAX) errors.push(`links[${i}].label: 링크 이름은 1~${HUB_POINT_LABEL_MAX}자여야 합니다`);
      if (!HUB_POINT_HREF.test(href)) errors.push(`links[${i}].href: 사이트 안 지방세 해설 주소(/tax… 또는 /news/…)여야 합니다 — 바깥 주소·쿼리·조각 0`);
      links.push({ label, href });
    });
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { section: section as HubPointSection, lines: cleanLines, baseDate: baseDate as string, links } };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 저장된 설정 값 → 분야별 (모양이 틀린 분야는 뺀다 — DB 트리거가 이미 막는 모양) */
export function readStoredPoints(value: unknown): StoredHubPoints {
  const out: StoredHubPoints = {};
  if (!isObj(value)) return out;
  for (const s of HUB_POINT_SECTIONS) {
    const p = value[s];
    if (!isObj(p) || !Array.isArray(p.lines) || typeof p.base_date !== "string" || !Array.isArray(p.links)) continue;
    out[s] = {
      lines: p.lines.filter((l): l is string => typeof l === "string"),
      base_date: p.base_date,
      links: p.links.filter(isObj).map((l) => ({ label: String(l.label ?? ""), href: String(l.href ?? "") })),
      drafted_by: String(p.drafted_by ?? ""),
      drafted_at: String(p.drafted_at ?? ""),
      reviewed_by: typeof p.reviewed_by === "string" ? p.reviewed_by : null,
      reviewed_at: typeof p.reviewed_at === "string" ? p.reviewed_at : null,
    };
  }
  return out;
}

export type HubPointState = "none" | "draft" | "reviewed";
export const pointState = (p: StoredHubPoint | undefined): HubPointState => (!p ? "none" : p.reviewed_by ? "reviewed" : "draft");

/** 같은 내용인가 — 문구·기준일·링크 (서명 칸은 보지 않는다) */
export function sameContent(p: StoredHubPoint | undefined, d: HubPointDraft): boolean {
  return !!p && JSON.stringify([p.lines, p.base_date, p.links]) === JSON.stringify([d.lines, d.baseDate, d.links]);
}

/** 초안 저장 — 그 분야만 바꾸고 서명은 지운다(내용이 같으면 그대로 둔다 — 바뀐 것 없음) */
export function withDraft(current: StoredHubPoints, d: HubPointDraft, actor: string, nowIso: string): StoredHubPoints {
  if (sameContent(current[d.section], d)) return current;
  return {
    ...current,
    [d.section]: { lines: d.lines, base_date: d.baseDate, links: d.links, drafted_by: actor, drafted_at: nowIso, reviewed_by: null, reviewed_at: null },
  };
}

/** 세무 감수 서명 — 저장된 초안에만. 이미 서명된 분야는 그대로(바뀐 것 없음) */
export function withReview(current: StoredHubPoints, section: HubPointSection, actor: string, nowIso: string): Parsed<StoredHubPoints> {
  const p = current[section];
  if (!p) return { ok: false, errors: ["section: 저장된 초안이 없습니다 — 초안을 먼저 저장하세요"] };
  if (p.reviewed_by) return { ok: true, value: current };
  return { ok: true, value: { ...current, [section]: { ...p, reviewed_by: actor, reviewed_at: nowIso } } };
}

/** 분야 지우기 (블록째 숨김) */
export function withoutSection(current: StoredHubPoints, section: HubPointSection): StoredHubPoints {
  const { [section]: _removed, ...rest } = current;
  return rest;
}
