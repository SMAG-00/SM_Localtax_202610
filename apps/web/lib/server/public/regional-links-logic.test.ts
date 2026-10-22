// 공개 지역 연결 모양 (W4 13단계 — PRD-01B REG1-10, docs/dev/W4_설계.md 12장 103번·104번) — 화면이 있는 도착만 링크, 404 링크 0, 순서·한도
import { describe, expect, test } from "vitest";
import { PUBLIC_LINK_LIMIT, RENDERED_LINK_TYPES, regionalLinkItems, type LinkTargets, type PublicLinkRow } from "./regional-links-logic";

const row = (id: number, to_type: string, to_id: string, over: Partial<PublicLinkRow> = {}): PublicLinkRow => ({
  id,
  from_type: "article",
  from_id: "1",
  to_type,
  to_id,
  relation: "related_tax",
  confirmed_at: `2026-10-${String(10 + (id % 18)).padStart(2, "0")}T00:00:00Z`,
  ...over,
});
const targets = (over: Partial<LinkTargets> = {}): LinkTargets => ({
  articles: new Map([
    ["11", { slug: "siheom-a", title: "시험용 연결 기사", content_type: "reported_news" }],
    ["12", { slug: "siheom-b", title: "시험용 둘째 기사", content_type: "explainer" }],
    ["13", { slug: "siheom-digest", title: "시험용 금주 핫뉴스", content_type: "digest" }],
  ]),
  sources: new Map([
    ["21", { title: "시험용 공식 자료", source_url: "https://gov.example.test/doc", source_name: "시험용 연결도청", reference_date: "2026-08-31", under_review: false }],
    ["22", { title: null, source_url: "https://gov.example.test/review", source_name: "시험용 연결구청", reference_date: null, under_review: true }],
    ["23", { title: "주소 없는 자료", source_url: "javascript:alert(1)", source_name: "x", reference_date: null, under_review: false }],
  ]),
  regions: new Map([["9901100000", { name: "시험용 연결도 시험용 연결구", href: "/local/siheom-do/siheom-gu" }]]),
  ...over,
});

describe("화면이 있는 도착만 링크 (404 링크 0)", () => {
  test("기사 → /news/[slug] · 공식 자료 → 원문 새 창(발표기관·기준일) · 지역 → 허브 주소", () => {
    const items = regionalLinkItems([row(1, "article", "11"), row(2, "official_source", "21"), row(3, "region", "9901100000", { relation: "same_region" })], targets());
    expect(items.map((i) => [i.kind, i.href, i.external])).toEqual([
      ["article", "/news/siheom-a", false],
      ["official_source", "https://gov.example.test/doc", true],
      ["region", "/local/siheom-do/siheom-gu", false],
    ]);
    expect(items[1]).toMatchObject({ kindLabel: "공식 원문", meta: "시험용 연결도청 · 기준일 2026-08-31", title: "시험용 공식 자료", underReview: false });
    expect(items[2]).toMatchObject({ kindLabel: "지역 허브", relationLabel: "같은 지역", title: "시험용 연결도 시험용 연결구" });
    expect(items[0]).toMatchObject({ kindLabel: "기사", relationLabel: "관련 세금", meta: null });
  });
  test("프로젝트 도착은 공개 화면(15단계) 전 0 · 다시 읽지 못한 도착(그 사이 비공개) 0 · 금주 핫뉴스 0 · http(s) 아닌 원문 0 · 모르는 종류·관계 0", () => {
    expect(RENDERED_LINK_TYPES).not.toContain("project");
    const items = regionalLinkItems(
      [
        row(1, "project", "5", { relation: "related_project" }),
        row(2, "article", "99"),
        row(3, "official_source", "98"),
        row(4, "region", "9909900000"),
        row(5, "article", "13"),
        row(6, "official_source", "23"),
        row(7, "attraction", "1"),
        row(8, "local_event", "1"),
        row(9, "article", "12", { relation: "related_event" }),
        row(10, "article", "12", { relation: "nearby" }),
      ],
      targets(),
    );
    expect(items).toEqual([]);
  });
  test("검토 중 표시 · 제목 없는 자료는 발표기관", () => {
    const [item] = regionalLinkItems([row(1, "official_source", "22")], targets());
    expect(item).toMatchObject({ title: "시험용 연결구청", underReview: true, meta: "시험용 연결구청" });
  });
});

describe("순서·같은 주소·한도", () => {
  test("종류 순(기사 → 공식 원문 → 지역 허브) 안에서 최근 확인 순 · 같은 주소는 한 번", () => {
    const items = regionalLinkItems(
      [
        row(1, "region", "9901100000", { confirmed_at: "2026-10-20T00:00:00Z" }),
        row(2, "official_source", "21", { confirmed_at: "2026-10-21T00:00:00Z" }),
        row(3, "article", "11", { confirmed_at: "2026-10-01T00:00:00Z" }),
        row(4, "article", "12", { confirmed_at: "2026-10-22T00:00:00Z" }),
        row(5, "article", "12", { confirmed_at: "2026-10-02T00:00:00Z", relation: "related_policy" }),
      ],
      targets(),
    );
    expect(items.map((i) => i.id)).toEqual([4, 3, 2, 1]);
  });
  test(`최대 ${PUBLIC_LINK_LIMIT}건`, () => {
    const many = new Map(Array.from({ length: 15 }, (_, i) => [String(100 + i), { slug: `siheom-${i}`, title: `시험용 ${i}`, content_type: "reported_news" }]));
    const items = regionalLinkItems(
      Array.from({ length: 15 }, (_, i) => row(i + 1, "article", String(100 + i))),
      targets({ articles: many }),
    );
    expect(items).toHaveLength(PUBLIC_LINK_LIMIT);
    expect(regionalLinkItems([], targets())).toEqual([]);
  });
});
