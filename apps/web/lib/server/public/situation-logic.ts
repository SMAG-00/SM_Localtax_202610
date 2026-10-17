// 상황 페이지 규칙 (UX-05 · FAM-02 · CAT-03) — 순수 함수 (시험 situation-logic.test.ts)
import { PICTOGRAM_NAMES, type PictogramName } from "@ltr/ui";
import type { ArticleListItem } from "./cards";
import { FEATURE_KEYS, NEXT_ACTION_KEYS, situationHref, type FeatureKey, type NextActionKey, type SectionKey } from "./constants";
import type { RegionRow, SituationRow } from "./rows";

export interface CheckItem {
  title: string;
  when?: string;
  note?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

/** 먼저 확인할 것 — 단계 타임라인 항목 (DB가 공개 행은 정확히 3개를 보장한다) */
export function readChecks(json: unknown): CheckItem[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((x) => {
    if (!isObj(x) || !text(x.title)) return [];
    const when = text(x.when);
    const note = text(x.note);
    return [{ title: text(x.title)!, ...(when ? { when } : {}), ...(note ? { note } : {}) }];
  });
}

/** 일반적 체크리스트와 고지 (FAM-02) — 모양이 틀리면 상자째 없다 */
export function readChecklist(json: unknown): { items: string[]; notice: string } | null {
  if (!isObj(json) || !Array.isArray(json.items)) return null;
  const items = json.items.flatMap((i) => (text(i) ? [text(i)!] : []));
  const notice = text(json.notice);
  return items.length && notice ? { items, notice } : null;
}

/** 연결 칸의 기능 키 (tool_links [{ feature }]) — 모르는 키는 뺀다 */
export function readToolFeatures(json: unknown): FeatureKey[] {
  if (!Array.isArray(json)) return [];
  const out: FeatureKey[] = [];
  for (const x of json) {
    const f = isObj(x) ? x.feature : undefined;
    if ((FEATURE_KEYS as readonly unknown[]).includes(f) && !out.includes(f as FeatureKey)) out.push(f as FeatureKey);
  }
  return out;
}

/** 연결 칸의 기능 키 가운데 다음 행동 버튼이 되는 것 */
export function toolActionKeys(features: readonly FeatureKey[]): NextActionKey[] {
  return features.filter((f): f is FeatureKey & NextActionKey => (NEXT_ACTION_KEYS as readonly string[]).includes(f));
}

export const isPictogram = (v: string): v is PictogramName => (PICTOGRAM_NAMES as readonly string[]).includes(v);

/** 지정한 번호 순서 그대로, 읽히는(공개) 것만 — 비공개로 바뀐 기사는 링크째 빠진다 (UX-05 링크 검사 404 0) */
export function inIdOrder<T extends { id: number }>(ids: readonly number[], rows: readonly T[]): T[] {
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const seen = new Set<number>();
  return ids.flatMap((id) => {
    const r = byId.get(Number(id));
    if (!r || seen.has(Number(id))) return [];
    seen.add(Number(id));
    return [r];
  });
}

export interface SituationCard {
  slug: string;
  href: string;
  title: string;
  subtitle: string;
  pictogram: PictogramName;
  section: SectionKey;
}

export function toSituationCard(row: Pick<SituationRow, "slug" | "title" | "subtitle" | "pictogram" | "section">): SituationCard | null {
  if (!isPictogram(row.pictogram)) return null;
  return { slug: row.slug, href: situationHref(row.slug), title: row.title, subtitle: row.subtitle ?? "", pictogram: row.pictogram, section: row.section as SectionKey };
}

/** 허브 상황 카드 줄 — 그 분야의 허브 자리(1..상한) 순, 상한까지. 0장이면 빈 목록 → 줄 숨김 (UX-05) */
export function hubSituationCards(rows: readonly SituationRow[], section: SectionKey, limit: number): SituationCard[] {
  return rows
    .filter((r) => r.section === section && r.hub_slot !== null && r.hub_slot >= 1 && r.hub_slot <= limit)
    .sort((a, b) => (a.hub_slot ?? 0) - (b.hub_slot ?? 0))
    .flatMap((r) => toSituationCard(r) ?? []);
}

// ── 지역 선택 (UX-05 '집을 샀어요' · CAT-03) ──────────────────

export interface RegionChoice {
  code: string;
  name: string;
  level: string;
}

export interface RegionArticles {
  region: RegionChoice;
  items: ArticleListItem[];
  /** 고른 지역(시·군·구) 기사가 0건이라 상위 시·도 기사를 보인다 — 화면이 그 사실을 알린다 */
  fallbackTo: RegionChoice | null;
}

const valid = (r: RegionRow, today: string) => (r.valid_to === null || r.valid_to >= today) && (r.valid_from === null || r.valid_from <= today);

/** 고를 수 있는 지역 — 시·도(유효) 전부, 시·도를 골랐으면 그 시·군·구도 */
export function regionChoices(regions: readonly RegionRow[], selected: RegionRow | null, today: string): { sido: RegionChoice[]; sigungu: RegionChoice[] } {
  const pick = (r: RegionRow): RegionChoice => ({ code: r.code, name: r.name, level: r.level });
  const sido = regions.filter((r) => r.level === "sido" && valid(r, today)).sort((a, b) => a.code.localeCompare(b.code)).map(pick);
  const parentCode = selected ? (selected.level === "sido" ? selected.code : selected.parent_code) : null;
  const sigungu = parentCode
    ? regions.filter((r) => r.parent_code === parentCode && valid(r, today)).sort((a, b) => a.code.localeCompare(b.code)).map(pick)
    : [];
  return { sido, sigungu };
}

/** 지역 코드와 그 하위 코드 — 시·군·구 태그 기사는 상위 시·도 목록에도 나온다 (CAT-03) */
export function codesWithin(code: string, regions: readonly RegionRow[]): string[] {
  return [code, ...regions.filter((r) => r.parent_code === code).map((r) => r.code)];
}

/**
 * 고른 지역의 기사 — 그 지역(과 하위) 태그 기사만. 0건이고 고른 지역이 시·군·구면 상위 시·도 기사와 그 사실(fallbackTo).
 * 상위에도 없으면 빈 목록 — 없는 기사를 만들지 않는다
 */
export function regionArticles(selected: RegionRow, regions: readonly RegionRow[], items: readonly ArticleListItem[]): RegionArticles {
  const choice = (r: RegionRow): RegionChoice => ({ code: r.code, name: r.name, level: r.level });
  const within = (code: string) => new Set(codesWithin(code, regions));
  const own = within(selected.code);
  const mine = items.filter((a) => a.regionCodes.some((c) => own.has(c)));
  if (mine.length || selected.level === "sido" || !selected.parent_code) return { region: choice(selected), items: mine, fallbackTo: null };
  const parent = regions.find((r) => r.code === selected.parent_code);
  if (!parent) return { region: choice(selected), items: [], fallbackTo: null };
  const up = within(parent.code);
  return { region: choice(selected), items: items.filter((a) => a.regionCodes.some((c) => up.has(c))), fallbackTo: choice(parent) };
}
