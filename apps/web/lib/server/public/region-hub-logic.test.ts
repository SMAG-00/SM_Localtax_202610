// 지자체 허브 블록 (W4 4단계 — docs/dev/W4_설계.md 1장 4단계 · 2.1 · 2.2 · 2.8, PRD-01B LG-08 · REG1-02 · REG-06 · REG-10)
//  · 블록 다섯 자리·글자 = 설계 2.1 표 · 대응 설정 씨앗 = 설계 2.2 = 마이그레이션 …40 씨앗 · 대체 문장 = 설계 1장 4단계 글자
//  · 순서 ②③⑤ 고정(①④ 0) · 대응 밖 기사 0 · 분야 필터 · 시·군·구 0건 → 상위 시·도 + 그 사실 → 상위도 0 → 0건 문장 · 데이터 출처 줄
// 시험용 지역·기사는 가짜다 (접두 99 · '시험용' — 설계 8장)
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { RegionRouteRow } from "@/lib/site/region-route";
import { LIMITS } from "./constants";
import {
  ARTICLE_BLOCKS,
  LOCAL_HUB_BLOCKS,
  LOCAL_HUB_BLOCK_LABELS,
  blockEmptyText,
  blockTopics,
  fallbackNotice,
  localBlockFieldsErrors,
  parseLocalBlockFields,
  pickBlock,
  regionHubBlocks,
  regionSourceLine,
  topicHasOwnArticles,
  type LocalBlockFields,
} from "./region-hub-logic";
import { regionPage } from "./region-logic";
import { listItem } from "./test-items";

const ROOT = path.resolve(__dirname, "../../../../..");
const DESIGN = fs.readFileSync(path.join(ROOT, "docs", "dev", "W4_설계.md"), "utf8");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages", "db", "supabase", "migrations", "20261022000040_w4_local_hub.sql"), "utf8");

const row = (prefix: string) => {
  const line = DESIGN.split("\n").find((l) => l.startsWith(prefix));
  if (!line) throw new Error(`설계 문서에 '${prefix}' 줄이 없다`);
  return line;
};
const cell = (line: string, i: number) => line.split("|")[i]!.trim();

/** 설계 2.2 씨앗 값 (REG1-02 초기값) */
const DESIGN_SEED = JSON.parse(cell(row("| `local_block_fields` |"), 2).match(/`(\{[^`]+\})`/)![1]!) as LocalBlockFields;
const FIELDS = parseLocalBlockFields(DESIGN_SEED)!;
const local = (id: number, editorialField: string | null, over = {}) => listItem({ id, section: "local", editorialField, publishedOn: "2026-10-01", ...over });

describe("설계 문서와 같은 값", () => {
  test("블록 다섯 자리 = 2.1 local_hub.block (순서 고정) · 글자 = 2.1 local_hub.block 글자", () => {
    expect([...LOCAL_HUB_BLOCKS]).toEqual([...cell(row("| local_hub.block ("), 2).matchAll(/`([^`]+)`/g)].map((m) => m[1]));
    expect(LOCAL_HUB_BLOCKS.map((b) => LOCAL_HUB_BLOCK_LABELS[b])).toEqual(cell(row("| local_hub.block 글자 |"), 2).split(" · "));
  });

  test("대응 설정 씨앗 = 설계 2.2 = 마이그레이션 …40 씨앗 (REG1-02 초기값 — 지방세·지방재정 → ②, 부동산·도시정책 → ③)", () => {
    expect(DESIGN_SEED).toEqual({ local_tax: ["local_tax", "local_finance"], realestate: ["realestate", "urban_policy"] });
    const seeded = MIGRATION.match(/\('local_block_fields',\s*'([^']+)'::jsonb/)![1]!;
    expect(JSON.parse(seeded)).toEqual(DESIGN_SEED);
    expect(localBlockFieldsErrors(DESIGN_SEED)).toEqual([]);
  });

  test("대체 문장 = 설계 1장 4단계 글자 '○○ 기사가 없어 ○○ 기사를 보입니다'", () => {
    const pattern = row("| 4 지자체 허브 골격").match(/"(○○ 기사가 없어 ○○ 기사를 보입니다)"/)![1]!;
    expect(fallbackNotice("시험용 빈구", "시험용 가상도")).toBe(pattern.replace("○○", "시험용 빈구").replace("○○", "시험용 가상도"));
  });
});

describe("대응 설정 검사 (DB 트리거 …40과 같은 규칙)", () => {
  test.each([
    ["객체가 아님", ["local_tax"], /JSON 객체/],
    ["블록 하나 빠짐", { local_tax: ["local_tax"] }, /realestate: 편집 분야가 1개 이상/],
    ["빈 목록", { local_tax: [], realestate: ["realestate"] }, /local_tax: 편집 분야가 1개 이상/],
    ["모르는 블록(순서·다른 블록은 설정이 아니다)", { ...DESIGN_SEED, weekly: ["local_tax"] }, /weekly: 블록은 local_tax/],
    ["목록 밖 편집 분야", { local_tax: ["local_tax", "tourism"], realestate: ["realestate"] }, /local_tax\[1\]: local_tax·local_finance·realestate·urban_policy 중 하나/],
    ["한 편집 분야가 두 블록에", { local_tax: ["local_tax", "urban_policy"], realestate: ["realestate", "urban_policy"] }, /realestate\[1\]: 편집 분야 urban_policy는 한 블록에 한 번만/],
    ["같은 블록 안 두 번", { local_tax: ["local_tax", "local_tax"], realestate: ["realestate"] }, /local_tax\[1\]: 편집 분야 local_tax는 한 블록에 한 번만/],
  ])("%s → 거부, 공개 화면은 닫힌 쪽(null)", (_name, value, error) => {
    expect(localBlockFieldsErrors(value).join("\n")).toMatch(error);
    expect(parseLocalBlockFields(value)).toBeNull();
  });

  test("없는 값(설정 행 0 — 원격 DB에 …40 전)도 null", () => {
    expect(parseLocalBlockFields(undefined)).toBeNull();
    expect(parseLocalBlockFields(null)).toBeNull();
  });
});

describe("분야 필터 ?topic= → 블록이 담을 편집 분야", () => {
  test("전체 보기 = 대응 그대로 · 분야를 고르면 그 분야를 담는 블록만 그 분야 하나, 나머지 블록 0", () => {
    expect(blockTopics(FIELDS, "local_tax", null)).toEqual(["local_tax", "local_finance"]);
    expect(blockTopics(FIELDS, "realestate", null)).toEqual(["realestate", "urban_policy"]);
    expect(blockTopics(FIELDS, "local_tax", "local_finance")).toEqual(["local_finance"]);
    expect(blockTopics(FIELDS, "realestate", "local_finance")).toEqual([]);
    expect(blockTopics(FIELDS, "realestate", "urban_policy")).toEqual(["urban_policy"]);
  });

  test("대응을 바꾸면 그 대응대로 (도시정책을 ②로 옮기면 ③에서 빠진다)", () => {
    const moved = parseLocalBlockFields({ local_tax: ["local_tax", "urban_policy"], realestate: ["realestate"] })!;
    expect(blockTopics(moved, "local_tax", "urban_policy")).toEqual(["urban_policy"]);
    expect(blockTopics(moved, "realestate", "urban_policy")).toEqual([]);
  });

  test("블록 카드 = 지자체뉴스 분야 + 블록 편집 분야 기사만, 4장까지 (대응 밖·편집 분야 없음·다른 분야 기사 0)", () => {
    const items = [local(1, "local_tax"), local(2, "realestate"), local(3, null), listItem({ id: 4, section: "tax", editorialField: "local_tax" }), ...[5, 6, 7, 8, 9].map((id) => local(id, "local_finance"))];
    expect(pickBlock(items, ["local_tax", "local_finance"]).map((a) => a.id)).toEqual([1, 5, 6, 7]);
    expect(LIMITS.localBlock).toBe(4);
  });
});

describe("지역 허브 블록 (LG-08 ②③⑤ · REG1-02 · REG-06)", () => {
  const sigungu = { fields: FIELDS, topic: null, sidoName: "시험용 가상도", sigunguName: "시험용 빈구" } as const;

  test("순서는 ② 지방세·지방재정 → ③ 부동산·개발 → ⑤ 공식 자료/해설 — ①④(W6) 자리 0", () => {
    const blocks = regionHubBlocks({ ...sigungu, own: { local_tax: [local(1, "local_tax")], realestate: [local(2, "urban_policy")] }, parent: {} });
    expect(blocks.map((b) => b.key)).toEqual(["local_tax", "realestate", "official"]);
    expect(blocks.map((b) => b.title)).toEqual(["지방세·지방재정", "부동산·개발", "공식 자료/해설"]);
    expect(blocks.some((b) => (b.key as string) === "weekly" || (b.key as string) === "events")).toBe(false);
    expect(blocks.map((b) => b.items.map((a) => a.id))).toEqual([[1], [2], []]);
    expect(blocks.map((b) => b.fallbackNotice)).toEqual([null, null, null]);
  });

  test("블록에 대응 밖 기사가 넘어와도 0 — ②에 부동산 기사, ③에 지방세 기사를 넣어도 빠진다", () => {
    const blocks = regionHubBlocks({ ...sigungu, own: { local_tax: [local(1, "realestate")], realestate: [local(2, "local_tax")] }, parent: {} });
    expect(blocks[0]!.items).toEqual([]);
    expect(blocks[1]!.items).toEqual([]);
  });

  test("시·군·구 블록 0건 → 상위 시·도 기사 + 대체 문장, 블록마다 따로 (기사 있는 블록은 자기 기사)", () => {
    const blocks = regionHubBlocks({ ...sigungu, own: { local_tax: [], realestate: [local(2, "realestate")] }, parent: { local_tax: [local(10, "local_tax"), local(11, "local_finance")] } });
    expect(blocks[0]).toMatchObject({ key: "local_tax", fallbackNotice: "시험용 빈구 기사가 없어 시험용 가상도 기사를 보입니다", empty: null });
    expect(blocks[0]!.items.map((a) => a.id)).toEqual([10, 11]);
    expect(blocks[1]).toMatchObject({ key: "realestate", fallbackNotice: null, empty: null });
  });

  test("상위 시·도도 0건 → 없는 기사를 만들지 않고 0건 문장만 (빈 카드·'준비 중' 0)", () => {
    const blocks = regionHubBlocks({ ...sigungu, own: { local_tax: [], realestate: [] }, parent: { local_tax: [], realestate: [] } });
    expect(blocks.map((b) => [b.items.length, b.fallbackNotice, b.empty])).toEqual([
      [0, null, "아직 공개된 지방세·지방재정 기사가 없습니다."],
      [0, null, "아직 공개된 부동산·개발 기사가 없습니다."],
      [0, null, "아직 확인된 공식 자료·감수 해설이 없습니다."],
    ]);
    expect(blocks.map((b) => b.empty).join("")).not.toMatch(/준비 중|관광|명소|맛집/);
  });

  test("시·도 허브는 대체 표시가 없다 — 0건이면 바로 0건 문장", () => {
    const blocks = regionHubBlocks({ ...sigungu, sigunguName: null, own: { local_tax: [] }, parent: { local_tax: [local(10, "local_tax")] } });
    expect(blocks[0]).toMatchObject({ items: [], fallbackNotice: null, empty: "아직 공개된 지방세·지방재정 기사가 없습니다." });
  });

  test("?topic=local_tax → ②에 지방세 기사만(지방재정 0), ③ 블록 0, ⑤는 그대로 · 0건 문장은 고른 분야 이름", () => {
    const own = { local_tax: [local(1, "local_tax"), local(2, "local_finance")], realestate: [local(3, "realestate")] };
    const blocks = regionHubBlocks({ ...sigungu, topic: "local_tax", own, parent: {} });
    expect(blocks.map((b) => b.key)).toEqual(["local_tax", "official"]);
    expect(blocks[0]!.items.map((a) => a.id)).toEqual([1]);
    const none = regionHubBlocks({ ...sigungu, topic: "urban_policy", own: { realestate: [] }, parent: { realestate: [] } });
    expect(none.map((b) => [b.key, b.empty])).toEqual([
      ["realestate", "아직 공개된 도시정책 기사가 없습니다."],
      ["official", blockEmptyText("official", null)],
    ]);
  });

  test("대응 설정을 읽지 못하면(null) 기사 블록 0 — ⑤ 0건 문장만", () => {
    const blocks = regionHubBlocks({ ...sigungu, fields: null, own: { local_tax: [local(1, "local_tax")] }, parent: {} });
    expect(blocks.map((b) => b.key)).toEqual(["official"]);
  });

  test("고른 분야의 그 지역 기사 유무 — 상위 시·도 대체 기사는 세지 않는다 (noindex 판정)", () => {
    expect(topicHasOwnArticles(FIELDS, "local_tax", { local_tax: [local(1, "local_tax")] })).toBe(true);
    expect(topicHasOwnArticles(FIELDS, "local_finance", { local_tax: [local(1, "local_tax")] })).toBe(false);
    expect(topicHasOwnArticles(null, "local_tax", { local_tax: [local(1, "local_tax")] })).toBe(false);
  });

  test("ARTICLE_BLOCKS는 설정 칸 두 개", () => {
    expect([...ARTICLE_BLOCKS]).toEqual(["local_tax", "realestate"]);
  });
});

describe("데이터 출처 줄 (REG-10 · 2.8 — 공식 자료 0이면 출처 편집국 + 최신 발행일)", () => {
  test("블록에 쓰인 기사(대체 기사 포함) 중 가장 늦은 발행일", () => {
    const blocks = regionHubBlocks({
      fields: FIELDS,
      topic: null,
      sidoName: "시험용 가상도",
      sigunguName: "시험용 빈구",
      own: { local_tax: [local(1, "local_tax", { publishedOn: "2026-10-02" })], realestate: [] },
      parent: { realestate: [local(2, "realestate", { publishedOn: "2026-10-09" }), local(3, "urban_policy", { publishedOn: "2026-09-30" })] },
    });
    expect(regionSourceLine(blocks)).toEqual({ source: "편집국", latestPublished: "2026-10-09" });
  });

  test("기사가 하나도 없으면 발행일 null (지어내지 않는다)", () => {
    expect(regionSourceLine(regionHubBlocks({ fields: FIELDS, topic: null, sidoName: "가", sigunguName: null, own: {}, parent: {} }))).toEqual({ source: "편집국", latestPublished: null });
  });
});

describe("지역 화면 값 — 블록·분야 필터·noindex (regionPage)", () => {
  const r = (code: string, slug: string, name: string): RegionRouteRow => ({
    code,
    parent_code: /^[0-9]{2}0{8}$/.test(code) ? null : `${code.slice(0, 2)}00000000`,
    level: /^[0-9]{2}0{8}$/.test(code) ? "sido" : "sigungu",
    name,
    slug,
    valid_from: null,
    valid_to: null,
  });
  const SIDO = r("9900000000", "gasang", "시험용 가상도");
  const GU = r("9901100000", "gadeuk-gu", "시험용 가득구");
  const base = { sido: SIDO, sigungu: GU, regions: [SIDO, GU], today: "2026-10-22", siteUrl: undefined, fields: FIELDS };

  test("기사 있는 지역 + 최소선 이상 + 고른 분야 기사 있음 → 색인 대상 · topic 값 그대로", () => {
    const p = regionPage({ ...base, total: 1, topic: "local_tax", own: { local_tax: [local(1, "local_tax")] }, indexable: true });
    expect(p).toMatchObject({ topic: "local_tax", noindex: false, noindexReason: null, empty: false });
    expect(p.blocks.map((b) => b.key)).toEqual(["local_tax", "official"]);
  });

  test("고른 분야에 그 지역 기사 0(상위 대체만) → noindex · 상위 안내(empty-guide)는 지역 전체가 0일 때만", () => {
    const p = regionPage({ ...base, total: 1, topic: "local_finance", own: { local_tax: [] }, parent: { local_tax: [local(9, "local_finance")] }, indexable: true });
    expect(p).toMatchObject({ noindex: true, noindexReason: "topic_empty", empty: false, guide: null });
    expect(p.blocks[0]).toMatchObject({ fallbackNotice: "시험용 가득구 기사가 없어 시험용 가상도 기사를 보입니다" });
  });

  test("기사 0건 시·군·구 → noindex + 상위 안내 + 블록은 상위 시·도 기사와 대체 문장", () => {
    const p = regionPage({ ...base, total: 0, own: { local_tax: [], realestate: [] }, parent: { local_tax: [local(9, "local_tax")], realestate: [] } });
    expect(p).toMatchObject({ empty: true, noindex: true, noindexReason: "empty" });
    expect(p.guide?.text).toBe("시험용 가상도 시험용 가득구에는 아직 공개된 기사가 없습니다. 상위 지역 시험용 가상도 소식을 보세요.");
    expect(p.blocks.map((b) => [b.key, b.items.length, b.fallbackNotice !== null, b.empty !== null])).toEqual([
      ["local_tax", 1, true, false],
      ["realestate", 0, false, true],
      ["official", 0, false, true],
    ]);
    expect(p.source).toEqual({ source: "편집국", latestPublished: "2026-10-01" });
  });

  test("지방세 포인트는 받은 서명본 그대로, 없으면 null", () => {
    const point = { points: ["시험용 포인트 한 줄입니다."], basisDate: "2026-10-01", links: [{ label: "시험용 해설", href: "/tax" }] };
    expect(regionPage({ ...base, total: 1, taxPoint: point }).taxPoint).toEqual(point);
    expect(regionPage({ ...base, total: 1 }).taxPoint).toBeNull();
  });
});
