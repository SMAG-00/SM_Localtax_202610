// 가이드 배치 규칙 (W11-c c1 - TRU-01·02 · RDV-01·03 · DF-08). 순수 함수 - 읽기 부분은 W11-c 화면이 `public_guide_placements`·`public_guides`에서 가져온 행을 넘긴다.
//  · 같은 해설이 두 경로에 따로 있지 않다: 원고는 public_guides 한 곳, 배치는 가이드 식별(slug)만 가진다. 화면은 배치 행에서 본문을 읽지 않는다.
//  · 서명 전(공개 뷰에 없는) 가이드는 숨긴다 - 빈 상자·"준비 중" 표시 0.
//  · TRU-02 = DF-08: 같은 가이드(slug)는 어느 화면에서 열어도 같은 버전·본문 해시다.
import type { FeatureKey } from "@/lib/server/public/constants";

export const PLACEMENT_SURFACES = ["trust_type", "finance_tax_hub", "dev_method", "stage", "situation"] as const;
export type PlacementSurface = (typeof PLACEMENT_SURFACES)[number];

/** 화면 종류가 열리는 기능 키 (DB 뷰 public_guide_placements와 같은 대응) */
export const SURFACE_FEATURE: Readonly<Record<PlacementSurface, FeatureKey>> = {
  trust_type: "trust_tax_guide",
  finance_tax_hub: "finance_tax_guide",
  dev_method: "redevelopment_tax",
  stage: "redevelopment_tax",
  situation: "tax_lifecycle",
};

export interface PlacementRow {
  surface: string;
  target_key: string;
  sort: number;
  hub: string;
  topic: string;
  slug: string;
  version: number;
  body_sha256: string;
}

/** public_guides 한 행의 필요한 칸 */
export interface PublicGuideRow {
  hub: string;
  topic: string;
  slug: string;
  version: number;
  title: string;
  tax_scope: "local" | "national" | "both";
  last_reviewed_at: string | null;
  body_sha256: string;
}

export interface PlacedGuide {
  slug: string;
  hub: string;
  topic: string;
  title: string;
  version: number;
  bodySha256: string;
  taxScope: "local" | "national" | "both";
  lastReviewedOn: string | null;
  sort: number;
}

const isSurface = (s: string): s is PlacementSurface => (PLACEMENT_SURFACES as readonly string[]).includes(s);

const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);

/**
 * 한 화면(surface, target)에 붙은 가이드 목록. 기능 키가 꺼졌거나, 공개 가이드에 없거나(서명 전·내려감),
 * 배치 행의 버전·본문 해시가 공개 가이드와 다르면(배치 뷰와 가이드 뷰 사이 갱신 틈) 그 항목은 뺀다.
 */
export function guidesForSurface(
  rows: readonly PlacementRow[],
  guides: readonly PublicGuideRow[],
  surface: PlacementSurface,
  targetKey: string,
  features: Readonly<Partial<Record<FeatureKey, boolean>>>,
): PlacedGuide[] {
  if (features[SURFACE_FEATURE[surface]] !== true) return [];
  const bySlug = new Map(guides.map((g) => [g.slug, g]));
  const out: PlacedGuide[] = [];
  const seen = new Set<string>();
  for (const r of [...rows].sort((a, b) => a.sort - b.sort || a.slug.localeCompare(b.slug))) {
    if (!isSurface(r.surface) || r.surface !== surface || r.target_key !== targetKey) continue;
    const g = bySlug.get(r.slug);
    if (!g || g.version !== r.version || g.body_sha256 !== r.body_sha256) continue;
    if (seen.has(g.slug)) continue;
    seen.add(g.slug);
    out.push({
      slug: g.slug,
      hub: g.hub,
      topic: g.topic,
      title: g.title,
      version: g.version,
      bodySha256: g.body_sha256,
      taxScope: g.tax_scope,
      lastReviewedOn: g.last_reviewed_at ? kstDate(g.last_reviewed_at) : null,
      sort: r.sort,
    });
  }
  return out;
}

/** TRU-02 = DF-08: 두 화면에 나온 같은 가이드가 같은 버전·본문 해시인지 (다르면 false, 한쪽에 없으면 false) */
export function sameGuideVersion(a: readonly PlacedGuide[], b: readonly PlacedGuide[], slug: string): boolean {
  const x = a.find((g) => g.slug === slug);
  const y = b.find((g) => g.slug === slug);
  return x !== undefined && y !== undefined && x.version === y.version && x.bodySha256 === y.bodySha256;
}

/** 같은 주제가 두 허브에 따로 있는 가이드 (예: 허브 finance_tax 에 신탁 주제를 또 둔 경우) - 있으면 중복 원고 */
export function duplicateTopicProblems(guides: readonly Pick<PublicGuideRow, "hub" | "topic" | "slug">[]): string[] {
  const out: string[] = [];
  const hubsOfTopic = new Map<string, Set<string>>();
  for (const g of guides) {
    if (!hubsOfTopic.has(g.topic)) hubsOfTopic.set(g.topic, new Set());
    hubsOfTopic.get(g.topic)!.add(g.hub);
  }
  for (const [topic, hubs] of hubsOfTopic) {
    if (hubs.size > 1) out.push(`주제 ${topic}이(가) 허브 ${[...hubs].sort().join("·")}에 따로 있습니다`);
  }
  return out;
}

/** 한 가이드가 한 화면 종류에 한 번만 붙는지 (같은 해설이 같은 화면에 두 번 나오지 않음) */
export function duplicatePlacementProblems(rows: readonly PlacementRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const k = `${r.surface}|${r.target_key}|${r.slug}`;
    if (seen.has(k)) out.push(`같은 배치가 겹칩니다: ${k}`);
    seen.add(k);
  }
  return out;
}
