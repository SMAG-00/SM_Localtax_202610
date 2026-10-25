import { describe, expect, it } from "vitest";
import { applyToolHref, parseToolTarget, targetHref } from "./tool-target";
import { buildRegionLinks, conversionRows, hiddenGuides, parseGuideInput, type RegionLinkRow } from "./admin-helpers";
import type { ToolContext } from "./tool-link";
import type { TaxLensView } from "@/lib/server/public/article-logic";
import { ALL_OPEN, ENGINE_HASH } from "./fixture.test-util";
import { selfCalculatorDocs } from "./tool-cards";

const features = { calc: true, sm_calculator: true, self_calculator: true, calc_acquisition: true, calc_holding: true, calc_refund: true };
const ctx = (o: Partial<ToolContext> = {}): ToolContext => ({ features, gateRows: ALL_OPEN, engineHash: ENGINE_HASH, refundTableActive: true, ...o });

describe("기사 도구 지정 입력 (GROW-02)", () => {
  it("줄마다 칸=값을 질문 정의로 검사해 타입 있는 값으로 바꾼다", () => {
    const r = parseToolTarget({ articleId: "12", tool: "acquisition", prefillText: "propertyKind=HOUSE\nhouseCount=2\nisAdjustedArea=0\nprice=700000000" });
    expect(r).toEqual({ ok: true, value: { articleId: 12, tool: "acquisition", prefill: { propertyKind: "HOUSE", houseCount: 2, isAdjustedArea: false, price: 700000000 } } });
  });
  it("모르는 칸·틀린 값·값 없는 줄은 오류로 알려 주고 저장하지 않는다", () => {
    const r = parseToolTarget({ articleId: 1, tool: "acquisition", prefillText: "cause=EXCHANGE\nevil=1\nprice=" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toMatch(/cause, evil/);
  });
  it("도구·기사 번호·줄 수 경계", () => {
    expect(parseToolTarget({ articleId: 0, tool: "acquisition", prefillText: "" }).ok).toBe(false);
    expect(parseToolTarget({ articleId: 3, tool: "transfer", prefillText: "" }).ok).toBe(false);
    const twelve = Array.from({ length: 12 }, () => "price=1").join("\n");
    expect(parseToolTarget({ articleId: 3, tool: "acquisition", prefillText: twelve }).ok).toBe(true);
    expect(parseToolTarget({ articleId: 3, tool: "acquisition", prefillText: `${twelve}\nprice=1` }).ok).toBe(false);
  });
  it("환급 진단은 미리 채울 값이 없다", () => {
    expect(parseToolTarget({ articleId: 3, tool: "refund", prefillText: "" }).ok).toBe(true);
    expect(parseToolTarget({ articleId: 3, tool: "refund", prefillText: "price=1" }).ok).toBe(false);
  });
});

describe("지정한 도구의 독자용 주소", () => {
  it("열려 있으면 자체 주소 + 해시, 닫혀 있거나 스위치가 꺼졌으면 허브", () => {
    expect(targetHref("acquisition", { propertyKind: "HOUSE", price: 5 }, ctx())).toBe("/calc/acquisition#t=acquisition&propertyKind=HOUSE&price=5");
    expect(targetHref("acquisition", { price: 5 }, ctx({ gateRows: [] }))).toBe("/calc");
    expect(targetHref("acquisition", { price: 5 }, ctx({ features: { ...features, self_calculator: false } }))).toBe("/calc");
    expect(targetHref("refund", {}, ctx())).toBe("/calc/refund");
    expect(targetHref("refund", {}, ctx({ refundTableActive: false }))).toBe("/calc");
  });
  it("유효하지 않은 미리 채움 값은 해시에서 빠진다", () => {
    expect(targetHref("acquisition", { price: -5, houseCount: 1 }, ctx())).toBe("/calc/acquisition#t=acquisition&houseCount=1");
  });
  it("지방세로 읽기 상자는 계산기 링크만 바꾸고 허브 주소면 그대로 둔다", () => {
    const lens: TaxLensView = { topics: ["t"], points: ["p"], basisDate: "2099-01-01", reviewer: "시험", links: [{ kind: "calculator", label: "계산", href: "https://sm.example.test/x", external: true }, { kind: "explainer", label: "해설", href: "/tax/x", external: false }] };
    const out = applyToolHref(lens, "/calc/acquisition#t=acquisition");
    expect(out?.links).toEqual([{ kind: "calculator", label: "계산", href: "/calc/acquisition#t=acquisition", external: false }, lens.links[1]]);
    expect(applyToolHref(lens, "/calc")).toBe(lens);
    expect(applyToolHref(null, "/calc/acquisition")).toBeNull();
  });
});

describe("지역 허브 돌아가기 주소표 (REG1-10)", () => {
  const row = (o: Partial<RegionLinkRow> & Pick<RegionLinkRow, "code">): RegionLinkRow => ({ parent_code: null, name: o.code, slug: o.code, valid_from: null, valid_to: null, ...o });
  const rows = [row({ code: "A0", name: "시험시", slug: "siheom" }), row({ code: "A1", parent_code: "A0", name: "시험구", slug: "gu" }), row({ code: "B0", name: "옛시", slug: "old", valid_to: "2098-12-31" }), row({ code: "B1", parent_code: "B0", name: "옛구", slug: "ogu" }), row({ code: "C1", parent_code: "ZZ", name: "고아", slug: "orphan" })];
  it("시·도와 시·군·구 주소를 만들고 만료·고아 행은 뺀다", () => {
    expect(buildRegionLinks(rows, "2099-01-01")).toEqual({ A0: { name: "시험시", href: "/local/siheom" }, A1: { name: "시험구", href: "/local/siheom/gu" } });
  });
  it("만료 마지막 날까지는 유효", () => {
    expect(buildRegionLinks(rows, "2098-12-31").B0).toEqual({ name: "옛시", href: "/local/old" });
    expect(buildRegionLinks(rows, "2098-12-31").B1).toEqual({ name: "옛구", href: "/local/old/ogu" });
  });
});

describe("전환 보고서 (GROW-02)", () => {
  it("콘텐츠 유형 x 도구로 세고 열람 수가 있으면 전환율(%)을 낸다", () => {
    const ev = [
      { props: { content_kind: "article", tool: "acquisition" } },
      { props: { content_kind: "article", tool: "acquisition" } },
      { props: { content_kind: "article", tool: "holding" } },
      { props: { content_kind: "search", tool: "acquisition" } },
      { props: { content_kind: 3, tool: "acquisition" } },
      { props: null },
    ];
    expect(conversionRows(ev, { article: 40 })).toEqual([
      { contentKind: "article", tool: "acquisition", clicks: 2, views: 40, rate: 5 },
      { contentKind: "article", tool: "holding", clicks: 1, views: 40, rate: 2.5 },
      { contentKind: "search", tool: "acquisition", clicks: 1, views: null, rate: null },
    ]);
  });
  it("이벤트가 없으면 빈 표", () => {
    expect(conversionRows([], {})).toEqual([]);
  });
});

describe("위택스 안내 입력 (WETAX-02)", () => {
  it("올바른 입력은 값 정리, 틀린 날짜·긴 글·키는 오류", () => {
    expect(parseGuideInput({ key: "hours", label: " 시험용 ", body: "시험용 내용", source: "", confirmedOn: "" })).toEqual({ ok: true, value: { key: "hours", label: "시험용", body: "시험용 내용", source: null, confirmedOn: null, active: true, sort: 0 } });
    expect(parseGuideInput({ key: "Hours", label: "x", body: "x" }).ok).toBe(false);
    expect(parseGuideInput({ key: "hours", label: "x", body: "가".repeat(301) }).ok).toBe(false);
    expect(parseGuideInput({ key: "hours", label: "x", body: "x", confirmedOn: "2099-02-30" }).ok).toBe(false);
    expect(parseGuideInput({ key: "hours", label: "x", body: "x", confirmedOn: "2099-02-28", source: "시험용 출처" }).ok).toBe(true);
  });
  it("출처·확인일이 없는 안내는 공개 화면에 안 나온다는 알림 대상", () => {
    const g = (key: string, source: string | null, confirmed_on: string | null) => ({ key, label: "l", body: "b", source, confirmed_on });
    expect(hiddenGuides([g("a", "출처", "2099-01-01"), g("b", null, "2099-01-01"), g("c", "출처", null)])).toEqual(["b", "c"]);
  });
});

describe("AI 도우미 링크 (TX-04)", () => {
  it("자체 계산기가 열린 세목만 사이트 안 주소, 닫힌 세목은 빠져 SM 카드가 그대로 나간다", () => {
    expect(Object.keys(selfCalculatorDocs(ctx()))).toEqual(["acquisition", "property_tax"]);
    expect(selfCalculatorDocs(ctx()).acquisition?.url).toBe("/calc/acquisition");
    expect(selfCalculatorDocs(ctx({ gateRows: [] }))).toEqual({});
    expect(Object.keys(selfCalculatorDocs(ctx({ gateRows: [ALL_OPEN[0]!] })))).toEqual(["acquisition"]);
  });
  it("답변 링크에 금액·입력값이 없다", () => {
    for (const d of Object.values(selfCalculatorDocs(ctx()))) expect(d.url + d.text).not.toMatch(/\d{4,}|[?#]/);
  });
});
