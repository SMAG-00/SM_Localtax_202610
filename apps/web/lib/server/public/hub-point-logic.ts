// 허브 "이 분야의 지방세 포인트" 공개 값 (01B CORE-02 · W3 9단계) — 순수 함수 (시험 hub-point-logic.test.ts)
//  · 공개 뷰 public_hub_tax_points는 세무 감수 서명이 살아 있는 분야만 준다. 여기서는 모양을 한 번 더 본다 —
//    1~3줄·기준일·사이트 안 지방세 해설 링크 1~3개가 아니면 null(블록째 숨김 — 빈 블록·'준비 중' 0)
//  · 홈 4대 분야 카드의 '이 분야의 지방세 포인트' 한 줄 = 그 분야 포인트의 첫 줄 (HOME-01). 지방세 카드는 포인트 블록이 없어 줄도 없다
import { HUB_POINT_HREF, HUB_POINT_LINKS_MAX, HUB_POINT_MAX_LINES, isHubPointSection, isIsoDate, type HubPointSection } from "@/lib/admin/hub-point-rules";

export interface HubTaxPoint {
  points: string[];
  /** 기준일 YYYY-MM-DD */
  basisDate: string;
  links: { label: string; href: string }[];
}

export interface HubPointRow {
  section: string;
  lines: unknown;
  base_date: string | null;
  links: unknown;
}

export const HUB_POINT_COLUMNS = "section, lines, base_date, links";

const filled = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** 공개 뷰 행 하나 → 블록 값. 모양이 틀리면 null */
export function hubTaxPoint(row: HubPointRow): HubTaxPoint | null {
  if (!Array.isArray(row.lines) || !row.lines.every(filled)) return null;
  const points = row.lines.map((l: string) => l.trim());
  if (points.length < 1 || points.length > HUB_POINT_MAX_LINES) return null;
  if (!isIsoDate(row.base_date)) return null;
  if (!Array.isArray(row.links) || row.links.length < 1 || row.links.length > HUB_POINT_LINKS_MAX) return null;
  const links: HubTaxPoint["links"] = [];
  for (const l of row.links as unknown[]) {
    const o = (typeof l === "object" && l !== null ? l : {}) as Record<string, unknown>;
    if (!filled(o.label) || typeof o.href !== "string" || !HUB_POINT_HREF.test(o.href)) return null;
    links.push({ label: o.label.trim(), href: o.href });
  }
  return { points, basisDate: row.base_date, links };
}

/** 공개 뷰 행들 → 분야별 블록 (모르는 분야·모양이 틀린 행은 뺀다) */
export function hubTaxPoints(rows: readonly HubPointRow[]): Partial<Record<HubPointSection, HubTaxPoint>> {
  const out: Partial<Record<HubPointSection, HubTaxPoint>> = {};
  for (const r of rows) {
    if (!isHubPointSection(r.section)) continue;
    const p = hubTaxPoint(r);
    if (p) out[r.section] = p;
  }
  return out;
}

/** 홈 4대 분야 카드 한 줄 — 분야마다 첫 줄 */
export function fieldCardPoints(points: Partial<Record<HubPointSection, HubTaxPoint>>): Partial<Record<HubPointSection, string>> {
  const out: Partial<Record<HubPointSection, string>> = {};
  for (const [s, p] of Object.entries(points) as [HubPointSection, HubTaxPoint][]) out[s] = p.points[0];
  return out;
}
