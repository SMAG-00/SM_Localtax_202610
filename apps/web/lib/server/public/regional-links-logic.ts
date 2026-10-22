// 공개 지역 연결 모양 (W4 13단계 — PRD-01B REG1-10 · LG-14, docs/dev/W4_설계.md 1장 13단계 · 12장 100번~) — 순수 함수
// 공개 뷰 public_regional_links(확인된 연결 중 두 끝이 지금 공개인 것만 — 마이그레이션 …48)의 줄과 도착 대상(anon으로 다시 읽은 공개 행)을 화면 항목으로 바꾼다.
//  · 도착 화면이 지금 있는 것만 링크 — 기사(/news/[slug], 금주 핫뉴스 제외) · 공식 자료(원문 주소 새 창) · 지역 허브(/local/…, region_hubs 켜짐 — 뷰가 본다)
//  · 프로젝트 도착은 공개 화면(15단계 /realestate/projects/[slug])이 생기기 전 0 — 빈 링크·글자만 카드 0 (12장 103번)
//  · 도착 행을 다시 읽지 못한 줄(그 사이 비공개)도 0 — 404 링크 0 · 같은 주소는 한 번 · 종류 순(기사 → 공식 자료 → 지역 허브) 안에서 최근 확인 순 · 최대 PUBLIC_LINK_LIMIT건
import { LINK_RELATION_LABELS, type RegionalLinkRelation, type RegionalLinkType } from "@/lib/admin/regional-link-rules";

/** 기사 상세 '확인된 연결' 최대 건수 (12장 104번) */
export const PUBLIC_LINK_LIMIT = 10;
/** 공개 화면이 있는 도착 종류 — 순서 = 화면 순서. 프로젝트는 15단계가 더한다 */
export const RENDERED_LINK_TYPES = ["article", "official_source", "region"] as const satisfies readonly RegionalLinkType[];
export type RenderedLinkType = (typeof RENDERED_LINK_TYPES)[number];
export const RENDERED_TYPE_LABELS: Readonly<Record<RenderedLinkType, string>> = { article: "기사", official_source: "공식 원문", region: "지역 허브" };

export interface PublicLinkRow {
  id: number | string;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relation: string;
  confirmed_at: string | null;
}

export interface LinkTargets {
  /** 공개 기사 — 번호 → 주소·제목·유형 */
  articles: ReadonlyMap<string, { slug: string; title: string; content_type: string | null }>;
  /** 공개 공식 자료 — 번호 → 원문 주소·제목·발표기관·기준일·검토 중 */
  sources: ReadonlyMap<string, { title: string | null; source_url: string | null; source_name: string | null; reference_date: string | null; under_review: boolean }>;
  /** 지역 허브 — 코드 → 이름·주소 (오늘 유효 + region_hubs 켜짐일 때만 넣는다) */
  regions: ReadonlyMap<string, { name: string; href: string }>;
}

export interface RegionalLinkItem {
  id: number;
  kind: RenderedLinkType;
  kindLabel: string;
  relation: RegionalLinkRelation;
  relationLabel: string;
  title: string;
  href: string;
  /** 바깥 주소 — 새 창·noreferrer */
  external: boolean;
  /** 한 줄 덧붙임 — 공식 자료의 발표기관·기준일 */
  meta: string | null;
  underReview: boolean;
}

const HTTP = /^https?:\/\/\S+$/i;
const isRelation = (v: string): v is RegionalLinkRelation => v in LINK_RELATION_LABELS && v !== "related_event";
const isRendered = (v: string): v is RenderedLinkType => (RENDERED_LINK_TYPES as readonly string[]).includes(v);

/** 공개 뷰 줄 + 도착 행 → 화면 항목 */
export function regionalLinkItems(rows: readonly PublicLinkRow[], targets: LinkTargets, limit = PUBLIC_LINK_LIMIT): RegionalLinkItem[] {
  const items: (RegionalLinkItem & { at: number })[] = [];
  for (const r of rows) {
    if (!isRendered(r.to_type) || !isRelation(r.relation)) continue;
    const base = { id: Number(r.id), kind: r.to_type, kindLabel: RENDERED_TYPE_LABELS[r.to_type], relation: r.relation, relationLabel: LINK_RELATION_LABELS[r.relation], at: Date.parse(r.confirmed_at ?? "") || 0 };
    if (r.to_type === "article") {
      const a = targets.articles.get(r.to_id);
      if (!a || a.content_type === "digest" || !a.slug) continue; // 금주 핫뉴스는 기사 상세 0 (주간 페이지는 W6)
      items.push({ ...base, title: a.title, href: `/news/${a.slug}`, external: false, meta: null, underReview: false });
    } else if (r.to_type === "official_source") {
      const s = targets.sources.get(r.to_id);
      const url = s?.source_url?.trim() ?? "";
      if (!s || !HTTP.test(url)) continue;
      const meta = [s.source_name, s.reference_date ? `기준일 ${s.reference_date}` : null].filter(Boolean).join(" · ") || null;
      items.push({ ...base, title: s.title?.trim() || s.source_name || url, href: url, external: true, meta, underReview: s.under_review });
    } else {
      const g = targets.regions.get(r.to_id);
      if (!g) continue;
      items.push({ ...base, title: g.name, href: g.href, external: false, meta: null, underReview: false });
    }
  }
  const order = (k: RenderedLinkType) => RENDERED_LINK_TYPES.indexOf(k);
  items.sort((x, y) => order(x.kind) - order(y.kind) || y.at - x.at || y.id - x.id);
  const seen = new Set<string>();
  const out: RegionalLinkItem[] = [];
  for (const { at: _at, ...item } of items) {
    if (seen.has(item.href)) continue;
    seen.add(item.href);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}
