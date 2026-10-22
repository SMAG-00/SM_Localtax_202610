// 지자체 허브 ⑤ 공식 자료/해설·지역 세금 연결 블록·/local 시·도 카드 (W4 9단계 — docs/dev/W4_설계.md 1장 9단계 · 2.3 · 2.8 · 12장 #25·#64~)
//  · 검수 공식 자료 = 대체 안 된 판 + 자료 종류(차단 4종 밖) + 원본 스냅샷 + 카드 칸 전부 — 하나라도 빠지면 0 (미검수·권리 미확인 0)
//  · 같은 원문 주소는 카드 한 장 + 다룬 기사 함께 · 검토 중 표시 · 한도 6/3/3/5 = 설계 2.3 · 세금 연결 블록 줄 숨김·블록째 0
// 시험용 기사·자료는 가짜다 (설계 8장)
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { RegionRouteRow } from "@/lib/site/region-route";
import type { OfficialLinkCard } from "./calc";
import { regionHubBlocks, regionSourceLine, sourceLineOf } from "./region-hub-logic";
import {
  REGION_OFFICIAL_LIMITS,
  STAGE3_SLOTS,
  issuerSummary,
  isVerifiedOfficial,
  openStage3Slots,
  regionOfficialCards,
  regionTaxLinks,
  regionalOfficial,
  reviewedExplainers,
  sidoCards,
  taxLinkSituations,
  type CardArticle,
  type RegionSourceRow,
} from "./region-official-logic";
import type { SituationRow } from "./rows";
import { listItem } from "./test-items";

const ROOT = path.resolve(__dirname, "../../../../..");
const DESIGN = fs.readFileSync(path.join(ROOT, "docs", "dev", "W4_설계.md"), "utf8");
const limitRow = (name: string) => {
  const line = DESIGN.split("\n").find((l) => l.startsWith(`| ${name} |`));
  if (!line) throw new Error(`설계 2.3에 '${name}' 줄이 없다`);
  return line;
};

let seq = 0;
function src(over: Partial<RegionSourceRow> = {}): RegionSourceRow {
  const id = over.id ?? ++seq;
  return {
    id,
    article_id: 1,
    kind: "official_doc",
    title: `시험용 공식 자료 ${id}`,
    source_url: `https://gov.example.test/doc/${id}`,
    source_name: "시험용 가상도청",
    provider: null,
    last_verified_at: "2026-10-10T01:00:00Z",
    published_on: "2026-09-01",
    reference_date: "2026-08-31",
    license_type: "kogl_1",
    source_type: "local_tax_revenue",
    region_unit: "시·군·구",
    snapshot_id: 900 + id,
    supersedes_id: null,
    ...over,
  };
}
const ART = new Map<number, CardArticle>([
  [1, { id: 1, title: "시험용 지역 기사 1", href: "/news/a-1" }],
  [2, { id: 2, title: "시험용 지역 기사 2", href: "/news/a-2" }],
  [3, { id: 3, title: "시험용 지역 기사 3", href: "/news/a-3" }],
  [4, { id: 4, title: "시험용 지역 기사 4", href: "/news/a-4" }],
]);
const NONE = new Set<number>();

describe("검수 공식 자료 (REG1-07 · REG1-13 · 9.2 '스냅샷이 있는 것만')", () => {
  test("카드 칸·자료 종류·스냅샷이 모두 있으면 검수 공식 자료", () => {
    expect(isVerifiedOfficial(src())).toBe(true);
    expect(isVerifiedOfficial(src({ kind: "dataset" }))).toBe(true);
  });

  test.each([
    ["스냅샷 없음", { snapshot_id: null }],
    ["자료 종류 빔 (법령 인용)", { source_type: null }],
    ["차단 종류 tourism", { source_type: "tourism" }],
    ["공공누리 유형 빔 (권리 미확인)", { license_type: null }],
    ["확인일 빔", { last_verified_at: null }],
    ["기준일 빔", { reference_date: null }],
    ["발표기관 빔", { source_name: " " }],
    ["원문 주소가 http 아님", { source_url: "ftp://gov.example.test/x" }],
    ["보도자료", { kind: "press_release" }],
  ])("%s → 0", (_, over) => {
    expect(isVerifiedOfficial(src(over as Partial<RegionSourceRow>))).toBe(false);
    expect(regionOfficialCards([src(over as Partial<RegionSourceRow>)], ART, NONE)).toEqual([]);
  });

  test("대체된 옛 판 0 — 새 판만 카드 · 목록에 없는 기사(비공개·다른 지역)의 출처 0", () => {
    const old = src({ id: 501 });
    const next = src({ id: 502, supersedes_id: 501, title: "시험용 새 판" });
    const hidden = src({ id: 503, article_id: 99 });
    const cards = regionOfficialCards([old, next, hidden], ART, NONE);
    expect(cards.map((c) => c.id)).toEqual([502]);
    expect(cards[0]!.title).toBe("시험용 새 판");
  });

  test("같은 원문 주소는 카드 한 장 — 가장 최근 확인한 행, 다룬 기사는 함께(3건까지), 검토 중은 하나라도 있으면", () => {
    const url = "https://gov.example.test/same";
    const rows = [
      src({ id: 601, article_id: 1, source_url: url, last_verified_at: "2026-10-01T00:00:00Z" }),
      src({ id: 602, article_id: 2, source_url: url, last_verified_at: "2026-10-05T00:00:00Z" }),
      src({ id: 603, article_id: 3, source_url: url, last_verified_at: "2026-10-02T00:00:00Z" }),
      src({ id: 604, article_id: 4, source_url: url, last_verified_at: "2026-10-03T00:00:00Z" }),
    ];
    const cards = regionOfficialCards(rows, ART, new Set([603]));
    expect(cards).toHaveLength(1);
    expect(cards[0]!.id).toBe(602);
    expect(cards[0]!.verifiedOn).toBe("2026-10-05");
    expect(cards[0]!.articles.map((a) => a.id)).toEqual([2, 4, 3]);
    expect(cards[0]!.underReview).toBe(true);
  });

  test("카드는 최근 확인 순 · 확인일은 한국 날짜 · 원본 스냅샷 글자·기자 해석 칸 0", () => {
    const cards = regionOfficialCards([src({ id: 701, last_verified_at: "2026-10-01T16:00:00Z" }), src({ id: 702, last_verified_at: "2026-10-03T00:00:00Z" })], ART, NONE);
    expect(cards.map((c) => [c.id, c.verifiedOn])).toEqual([
      [702, "2026-10-03"],
      [701, "2026-10-02"],
    ]);
    expect(Object.keys(cards[0]!).sort()).toEqual(["articles", "href", "id", "issuer", "license", "provider", "publishedOn", "referenceDate", "regionUnit", "title", "typeLabel", "underReview", "verifiedOn"]);
  });

  test("발표기관 둘까지는 그대로, 셋 이상은 '외 N곳'", () => {
    expect(issuerSummary([{ issuer: "가청" }, { issuer: "가청" }])).toBe("가청");
    expect(issuerSummary([{ issuer: "가청" }, { issuer: "나청" }])).toBe("가청·나청");
    expect(issuerSummary([{ issuer: "가청" }, { issuer: "나청" }, { issuer: "다청" }, { issuer: "라청" }])).toBe("가청·나청 외 2곳");
  });
});

describe("감수 해설 · 한도 (설계 2.3)", () => {
  test("설계 2.3 한도 글자 = 상수", () => {
    expect(limitRow("공식 자료/해설 블록")).toContain(`공식 자료 카드 최대 ${REGION_OFFICIAL_LIMITS.officialCards} + 감수 해설 최대 ${REGION_OFFICIAL_LIMITS.explainers}`);
    expect(limitRow("지역 세금 연결 블록")).toContain(`감수 해설 ≤ ${REGION_OFFICIAL_LIMITS.taxExplainers}`);
    expect(limitRow("지역 세금 연결 블록")).toContain(`공식 원문 최대 ${REGION_OFFICIAL_LIMITS.originals}건`);
  });

  test("해설·가이드 + 편집 분야 + 감수 표시(shown)만 — ⑤는 지방세 분야 밖, 세금 연결 블록은 지방세 분야", () => {
    const items = [
      listItem({ id: 1, section: "local", contentType: "explainer", editorialField: "local_tax" }),
      listItem({ id: 2, section: "local", contentType: "guide", editorialField: "realestate" }),
      listItem({ id: 3, section: "local", contentType: "reported_news", editorialField: "local_tax" }),
      listItem({ id: 4, section: "local", contentType: "explainer", editorialField: null }),
      listItem({ id: 5, section: "local", contentType: "explainer", editorialField: "local_tax" }),
      listItem({ id: 6, section: "tax", contentType: "explainer", editorialField: "local_tax" }),
      listItem({ id: 7, section: "realestate", contentType: "explainer", editorialField: "realestate" }),
    ];
    const shown = new Set([1, 2, 3, 4, 6, 7]);
    expect(reviewedExplainers(items, shown, "official", 3).map((a) => a.id)).toEqual([1, 2, 7]);
    expect(reviewedExplainers(items, shown, "tax", 3).map((a) => a.id)).toEqual([6]);
    expect(reviewedExplainers(items, new Set(), "official", 3)).toEqual([]);
  });

  test("카드 6장·원문 5건·해설 3건까지", () => {
    const sources = Array.from({ length: 9 }, (_, i) => src({ id: 800 + i, last_verified_at: `2026-10-${String(10 + i).padStart(2, "0")}T00:00:00Z` }));
    const pool = Array.from({ length: 5 }, (_, i) => listItem({ id: 10 + i, section: "local", contentType: "explainer", editorialField: "local_tax" }));
    const r = regionalOfficial({ sources, articles: ART, reviewing: NONE, explainerPool: pool, shown: new Set(pool.map((a) => a.id)) });
    expect(r.cards.map((c) => c.id)).toEqual([808, 807, 806, 805, 804, 803]);
    expect(r.originals.map((c) => c.id)).toEqual([808, 807, 806, 805, 804]);
    expect(r.explainers.map((a) => a.id)).toEqual([10, 11, 12]);
    expect(r.taxExplainers).toEqual([]);
  });
});

describe("⑤ 블록·데이터 출처 줄 (2.8)", () => {
  const base = { fields: { local_tax: ["local_tax", "local_finance"], realestate: ["realestate", "urban_policy"] } as const, topic: null, sidoName: "시험용 가상도", sigunguName: null, own: {}, parent: {} };

  test("⑤ = 공식 자료 카드 + 감수 해설 — 있으면 0건 문장 0, 둘 다 0이면 0건 문장", () => {
    const cards = regionOfficialCards([src({ id: 901 })], ART, NONE);
    const ex = [listItem({ id: 21, section: "local", contentType: "explainer", editorialField: "local_tax" })];
    const [, , official] = regionHubBlocks({ ...base, official: { cards, explainers: ex } });
    expect(official).toMatchObject({ key: "official", empty: null, fallbackNotice: null });
    expect(official!.sources.map((c) => c.id)).toEqual([901]);
    expect(official!.items.map((a) => a.id)).toEqual([21]);
    const [, , none] = regionHubBlocks({ ...base, official: { cards: [], explainers: [] } });
    expect(none!.empty).toBe("아직 확인된 공식 자료·감수 해설이 없습니다.");
  });

  test("⑤는 분야 필터와 상관없이 그대로 (4단계 #37)", () => {
    const cards = regionOfficialCards([src({ id: 902 })], ART, NONE);
    const blocks = regionHubBlocks({ ...base, topic: "urban_policy", official: { cards, explainers: [] } });
    expect(blocks.map((b) => b.key)).toEqual(["realestate", "official"]);
    expect(blocks[1]!.sources).toHaveLength(1);
  });

  test("데이터 출처 줄 — 공식 자료가 있으면 발표기관 · 가장 이른 기준일 · 가장 이른 확인일", () => {
    const cards = regionOfficialCards(
      [
        src({ id: 903, source_name: "시험용 가상도청", reference_date: "2026-06-30", last_verified_at: "2026-10-09T00:00:00Z" }),
        src({ id: 904, source_name: "시험용 가득구청", reference_date: "2026-03-31", last_verified_at: "2026-10-12T00:00:00Z" }),
      ],
      ART,
      NONE,
    );
    const blocks = regionHubBlocks({ ...base, official: { cards, explainers: [] } });
    expect(regionSourceLine(blocks)).toEqual({ source: "시험용 가득구청·시험용 가상도청", baseDate: "2026-03-31", checkedAt: "2026-10-09" });
    expect(sourceLineOf([], [listItem({ publishedOn: "2026-10-02" }), listItem({ publishedOn: "2026-10-07" })])).toEqual({ source: "편집국", latestPublished: "2026-10-07" });
  });
});

describe("지역 세금 연결 블록 (REG1-10 · 12장 #25)", () => {
  const sit = (slug: string, section: string, hub_slot: number | null): SituationRow =>
    ({ id: 0, slug, section, title: `시험용 ${slug}`, subtitle: "부제", pictogram: "acquisition", checks: [], checklist: {}, mistakes: [], external_link_id: null, article_ids: [], solved_case_ids: [], glossary_ids: [], tool_links: [], region_select: false, hub_slot, sort: 0, reviewed_at: null }) as unknown as SituationRow;
  const sm: { card: OfficialLinkCard; fallbacks: OfficialLinkCard[] } = {
    card: { id: 1, kind: "sm_calculator", key: "acquisition", label: "취득세 계산기", url: "https://sm.example.test/acq", termsNote: null, status: "ok", checkedOn: "2026-10-01" },
    fallbacks: [],
  };
  const empty = { cards: [], explainers: [], originals: [], taxExplainers: [] };

  test("상황 카드 = 지자체뉴스 허브 줄 → 부동산 허브 줄, 같은 상황 한 번, 상한까지 · 허브 자리 없는 상황 0", () => {
    const rows = [sit("re-1", "realestate", 1), sit("lo-2", "local", 2), sit("lo-1", "local", 1), sit("tax-1", "tax", 1), sit("re-x", "realestate", null), sit("re-2", "realestate", 2)];
    expect(taxLinkSituations(rows, 4).map((s) => s.slug)).toEqual(["lo-1", "lo-2", "re-1", "re-2"]);
    expect(taxLinkSituations(rows, 3).map((s) => s.slug)).toEqual(["lo-1", "lo-2", "re-1"]);
  });

  test("줄마다 0이면 줄 숨김(빈 목록), 모두 0이면 null — 블록째 0", () => {
    expect(regionTaxLinks({ situations: [], situationLimit: 4, official: empty, sm: null })).toBeNull();
    const onlySm = regionTaxLinks({ situations: [], situationLimit: 4, official: empty, sm });
    expect(onlySm).toEqual({ situations: [], explainers: [], sm, originals: [] });
    const cards = regionOfficialCards([src({ id: 951, title: "시험용 세입 결산" })], ART, new Set([951]));
    const withOriginals = regionTaxLinks({ situations: [], situationLimit: 4, official: { ...empty, originals: cards }, sm: null });
    expect(withOriginals?.originals).toEqual([{ id: 951, label: "시험용 세입 결산", issuer: "시험용 가상도청", typeLabel: "지방세 세수", href: "https://gov.example.test/doc/951", underReview: true }]);
  });
});

describe("3단계 자리 · /local 시·도 카드", () => {
  test("3단계 자리 = 정비사업 현황(③)·조례 원문(⑤), 키가 켜진 자리만 — 그릴 내용은 W4에 없다", () => {
    expect(STAGE3_SLOTS.map((s) => [s.block, s.feature])).toEqual([
      ["realestate", "redevelopment_status"],
      ["official", "ordinance_texts"],
    ]);
    expect(openStage3Slots({})).toEqual([]);
    expect(openStage3Slots({ redevelopment_status: true, ordinance_texts: false }).map((s) => s.feature)).toEqual(["redevelopment_status"]);
  });

  const r = (code: string, over: Partial<RegionRouteRow> = {}): RegionRouteRow => ({ code, parent_code: null, level: "sido", name: `시험용 ${code}`, slug: `s${code}`, valid_from: null, valid_to: null, ...over }) as RegionRouteRow;

  test("오늘 유효한 시·도만, 코드 순 — region_hubs가 켜졌을 때만 링크(꺼지면 글자만)", () => {
    const rows = [r("9902000000"), r("9900000000"), r("9901100000", { level: "sigungu", parent_code: "9900000000" }), r("9903000000", { valid_to: "2026-01-01" }), r("9904000000", { valid_from: "2027-01-01" })];
    expect(sidoCards(rows, "2026-10-22", true)).toEqual([
      { code: "9900000000", name: "시험용 9900000000", href: "/local/s9900000000", pilot: false, indexed: false },
      { code: "9902000000", name: "시험용 9902000000", href: "/local/s9902000000", pilot: false, indexed: false },
    ]);
    expect(sidoCards(rows, "2026-10-22", false).map((c) => c.href)).toEqual([null, null]);
  });

  test("11단계 칩 — 시범 지역 = 그 시·도 또는 그 아래 시·군·구가 pilot_regions에, 색인 대상 = public_region_index에 그 시·도", () => {
    const rows = [r("9700000000"), r("9800000000"), r("9900000000")];
    const cards = sidoCards(rows, "2026-10-22", true, { pilots: ["9800000000", "9901100000"], indexed: new Set(["9700000000", "9901100000"]) });
    expect(cards.map((c) => [c.code, c.pilot, c.indexed])).toEqual([
      ["9700000000", false, true],
      ["9800000000", true, false],
      ["9900000000", true, false], // 시·군·구만 시범·색인 대상 — 시범 표시는 상위 시·도 카드에, 색인 표시는 시·도 행 판정만
    ]);
  });
});
