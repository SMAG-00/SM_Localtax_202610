import { describe, expect, it } from "vitest";
import { HOUSE_COUNT_KIND, judgeHouseCount, openCauses, parseFactText, pickHouseCountTable, questionsOf } from "./house-count";

// 판정표는 모두 '시험용' 지어낸 자료다 (실제 요건·기간·날짜 아님). 날짜는 경계(전날·당일)를 보려고 지어낸 값이다.
const CUTOFF = "2099-06-01";

const HOUSES = {
  kind: "house_count",
  version: "2099.01",
  label: "시험용 주택 수 판정표",
  entry_required: [
    { id: "item_kind", label: "시험용 종류" },
    { id: "acquired_on", label: "시험용 취득일" },
  ],
  count_when: { op: "all", conds: [{ op: "in", field: "item_kind", values: ["house", "right"] }, { op: "lte", field: "acquired_on", value: CUTOFF }] },
  result_rules: [
    { id: "none", op: "eq", value: 0, conclusion: "시험용 무주택" },
    { id: "one", op: "eq", value: 1, conclusion: "시험용 1주택" },
    { id: "many", op: "gte", value: 2, conclusion: "시험용 다주택" },
  ],
};
const INHERIT = {
  kind: "house_count_inheritance",
  version: "2099.01",
  label: "시험용 상속 후 주택 수 판정표",
  required: [{ id: "cause_date", label: "시험용 취득일" }],
  rules: [{ id: "r1", when: { op: "lt", field: "cause_date", value: CUTOFF }, conclusion: "시험용 상속-이전" }, { id: "r2", when: { op: "gte", field: "cause_date", value: CUTOFF }, conclusion: "시험용 상속-이후" }],
};
const GIFT = {
  kind: "house_count_gift",
  version: "2099.02",
  label: "시험용 증여 후 주택 수 판정표",
  required: [{ id: "cause_date", label: "시험용 취득일" }],
  rules: [{ id: "g1", when: { op: "gte", field: "cause_date", value: CUTOFF }, conclusion: "시험용 증여-이후" }],
  fallback: "시험용 증여-기본",
};
const ROWS = [{ kind: "house_count", body: HOUSES }, { kind: "house_count_inheritance", body: INHERIT }, { kind: "house_count_gift", body: GIFT }];

describe("판정표 고르기", () => {
  it("원인마다 서로 다른 종류의 표를 고른다 (상속 != 증여)", () => {
    expect(pickHouseCountTable(ROWS, "PAID")?.kind).toBe("house_count");
    expect(pickHouseCountTable(ROWS, "INHERITANCE")?.kind).toBe("house_count_inheritance");
    expect(pickHouseCountTable(ROWS, "GIFT")?.kind).toBe("house_count_gift");
    expect(new Set(Object.values(HOUSE_COUNT_KIND)).size).toBe(3);
  });

  it("서명된 표가 없거나 본문이 종류와 맞지 않으면 그 원인은 열리지 않는다", () => {
    expect(openCauses([])).toEqual([]);
    expect(openCauses(ROWS.slice(0, 1))).toEqual(["PAID"]);
    expect(pickHouseCountTable([{ kind: "house_count_gift", body: HOUSES }], "GIFT")).toBeNull();
    expect(pickHouseCountTable([{ kind: "house_count", body: { nope: true } }], "PAID")).toBeNull();
  });

  it("입력 칸은 판정표의 필수 칸에서만 만든다", () => {
    expect(questionsOf(pickHouseCountTable(ROWS, "PAID")!)).toEqual([
      { scope: "entry", id: "item_kind", label: "시험용 종류" },
      { scope: "entry", id: "acquired_on", label: "시험용 취득일" },
    ]);
    expect(questionsOf(pickHouseCountTable(ROWS, "GIFT")!)).toEqual([{ scope: "fact", id: "cause_date", label: "시험용 취득일" }]);
  });
});

describe("입력 글자 해석", () => {
  it("모르겠어요·빈 글자는 값 없음, 예/아니요는 불리언, 숫자는 숫자", () => {
    expect(parseFactText("모르겠어요")).toBeUndefined();
    expect(parseFactText("   ")).toBeUndefined();
    expect(parseFactText("예")).toBe(true);
    expect(parseFactText("아니요")).toBe(false);
    expect(parseFactText("0")).toBe(0);
    expect(parseFactText("-3")).toBe(-3);
    expect(parseFactText("2099-06-01")).toBe("2099-06-01");
  });
});

describe("판정 - 목록 집계형", () => {
  const table = pickHouseCountTable(ROWS, "PAID")!;
  const entry = (kind: string, on: string) => ({ item_kind: kind, acquired_on: on });

  it("기준일 전날·당일은 세고 다음 날은 세지 않는다 (0·1·2개 경계)", () => {
    expect(judgeHouseCount(table, { facts: {}, entries: [] })).toMatchObject({ status: "결론", count: 0, conclusion: { text: "시험용 무주택" } });
    expect(judgeHouseCount(table, { facts: {}, entries: [entry("house", "2099-05-31")] }).count).toBe(1);
    expect(judgeHouseCount(table, { facts: {}, entries: [entry("house", CUTOFF)] }).count).toBe(1);
    expect(judgeHouseCount(table, { facts: {}, entries: [entry("house", "2099-06-02")] }).count).toBe(0);
    const two = judgeHouseCount(table, { facts: {}, entries: [entry("house", "2099-05-31"), entry("right", CUTOFF)] });
    expect(two).toMatchObject({ count: 2, conclusion: { text: "시험용 다주택" }, tableVersion: "2099.01" });
  });

  it("목록을 모르면 0채가 아니라 결론 없음 + 빠진 항목이다", () => {
    const j = judgeHouseCount(table, { facts: {} });
    expect(j.status).toBe("요건 확인 필요");
    expect(j.conclusion).toBeNull();
    expect(j.count).toBeNull();
    expect(j.missing.length).toBeGreaterThan(0);
  });

  it("항목 하나라도 칸이 비면 일부만 센 값을 내지 않는다", () => {
    const j = judgeHouseCount(table, { facts: {}, entries: [entry("house", "2099-05-31"), { item_kind: "house" }] });
    expect(j.count).toBeNull();
    expect(j.status).toBe("요건 확인 필요");
    expect(j.missing[0]!.id).toBe("entries.1.acquired_on");
  });
});

describe("판정 - 결론형 (상속·증여)", () => {
  it("같은 사실이라도 원인에 따라 다른 표·다른 버전으로 처리된다", () => {
    const inh = judgeHouseCount(pickHouseCountTable(ROWS, "INHERITANCE")!, { facts: { cause_date: CUTOFF } });
    const gift = judgeHouseCount(pickHouseCountTable(ROWS, "GIFT")!, { facts: { cause_date: CUTOFF } });
    expect(inh).toMatchObject({ tableKind: "house_count_inheritance", tableVersion: "2099.01", conclusion: { text: "시험용 상속-이후" } });
    expect(gift).toMatchObject({ tableKind: "house_count_gift", tableVersion: "2099.02", conclusion: { text: "시험용 증여-이후" } });
  });

  it("기준일 전날과 당일의 결론이 갈린다", () => {
    const t = pickHouseCountTable(ROWS, "INHERITANCE")!;
    expect(judgeHouseCount(t, { facts: { cause_date: "2099-05-31" } }).conclusion?.text).toBe("시험용 상속-이전");
    expect(judgeHouseCount(t, { facts: { cause_date: CUTOFF } }).conclusion?.text).toBe("시험용 상속-이후");
  });

  it("필수 사실을 모르겠어요로 두면 결론 0 + 빠진 항목, 기본 가정으로 채우지 않는다", () => {
    const j = judgeHouseCount(pickHouseCountTable(ROWS, "GIFT")!, { facts: { cause_date: parseFactText("모르겠어요") } });
    expect(j).toMatchObject({ status: "요건 확인 필요", conclusion: null, count: null, missing: [{ id: "cause_date", label: "시험용 취득일" }] });
  });

  it("결론형 표는 개수를 내지 않는다 (RE-04로 넘길 주택 수 없음)", () => {
    expect(judgeHouseCount(pickHouseCountTable(ROWS, "INHERITANCE")!, { facts: { cause_date: CUTOFF } }).count).toBeNull();
  });
});
