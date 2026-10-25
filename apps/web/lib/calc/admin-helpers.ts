import type { GuideRow } from "./guide";

// 계산기 연결 백오피스의 순수 함수 - 지역 허브 주소표 · 전환 보고서 · 위택스 안내 입력 검사.

// ── 지역 허브로 돌아가기 (REG1-10) ─────────────────
export interface RegionLinkRow {
  code: string;
  parent_code: string | null;
  name: string;
  slug: string;
  valid_from: string | null;
  valid_to: string | null;
}
export type RegionLinks = Record<string, { name: string; href: string }>;

/** 지역 코드 -> 허브 주소. 오늘 유효한 행만, 시·군·구는 유효한 시·도가 있을 때만 */
export function buildRegionLinks(rows: readonly RegionLinkRow[], today: string): RegionLinks {
  const valid = rows.filter((r) => (r.valid_from === null || r.valid_from <= today) && (r.valid_to === null || r.valid_to >= today) && r.slug !== "");
  const byCode = new Map(valid.map((r) => [r.code, r]));
  const out: RegionLinks = {};
  for (const r of valid) {
    if (r.parent_code === null) out[r.code] = { name: r.name, href: `/local/${r.slug}` };
    else {
      const parent = byCode.get(r.parent_code);
      if (parent && parent.parent_code === null) out[r.code] = { name: r.name, href: `/local/${parent.slug}/${r.slug}` };
    }
  }
  return out;
}

// ── 콘텐츠 -> 도구 전환 보고서 (GROW-02) ─────────────
export interface ConversionRow {
  contentKind: string;
  tool: string;
  clicks: number;
  /** 그 콘텐츠 유형의 열람 수 - 알 수 없는 유형은 null */
  views: number | null;
  /** 전환율(%) 소수 첫째 자리, 열람 수를 모르면 null */
  rate: number | null;
}

export function conversionRows(events: readonly { props: Record<string, unknown> | null }[], views: Readonly<Record<string, number>>): ConversionRow[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    const kind = e.props?.content_kind;
    const tool = e.props?.tool;
    if (typeof kind !== "string" || typeof tool !== "string") continue;
    counts.set(`${kind}\u0000${tool}`, (counts.get(`${kind}\u0000${tool}`) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, clicks]) => {
      const [contentKind, tool] = key.split("\u0000") as [string, string];
      const v = views[contentKind];
      return { contentKind, tool, clicks, views: v ?? null, rate: v ? Math.round((clicks / v) * 1000) / 10 : null };
    })
    .sort((a, b) => b.clicks - a.clicks || (a.contentKind + a.tool).localeCompare(b.contentKind + b.tool));
}

// ── 위택스 안내 입력 (WETAX-02) ─────────────────────
export interface GuideInput {
  key: string;
  label: string;
  body: string;
  source: string | null;
  confirmedOn: string | null;
  active: boolean;
  sort: number;
}

export function parseGuideInput(b: Record<string, unknown>): { ok: true; value: GuideInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const key = s(b.key);
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) errors.push("key: 영문 소문자로 시작하는 2~41자");
  const label = s(b.label);
  if (label.length < 1 || label.length > 80) errors.push("label: 1~80자");
  const body = s(b.body);
  if (body.length < 1 || body.length > 300) errors.push("body: 1~300자");
  const source = s(b.source);
  if (source.length > 200) errors.push("source: 200자 이하");
  const confirmedOn = s(b.confirmedOn);
  if (confirmedOn !== "" && !(/^\d{4}-\d{2}-\d{2}$/.test(confirmedOn) && new Date(`${confirmedOn}T00:00:00Z`).toISOString().startsWith(confirmedOn))) errors.push("confirmedOn: 달력에 있는 YYYY-MM-DD");
  const sort = b.sort === undefined ? 0 : Number(b.sort);
  if (!Number.isSafeInteger(sort) || sort < 0 || sort > 9999) errors.push("sort: 0~9999");
  if (b.active !== undefined && typeof b.active !== "boolean") errors.push("active: 참/거짓");
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { key, label, body, source: source || null, confirmedOn: confirmedOn || null, active: b.active !== false, sort } };
}

/** 공개 화면에 아직 안 나오는 안내 (출처·확인일 부족) - 백오피스에서 채우라고 알려 준다 */
export const hiddenGuides = (rows: readonly (GuideRow & { active?: boolean })[]): string[] =>
  rows.filter((r) => (r.source ?? "").trim() === "" || r.confirmed_on === null).map((r) => r.key);
