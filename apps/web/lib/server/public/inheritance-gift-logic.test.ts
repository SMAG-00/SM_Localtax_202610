import { describe, expect, it } from "vitest";
import type { OfficialLinkCard } from "./calc";
import {
  IG_NOTICE_SEED,
  fam08Card,
  inheritanceNoticeErrors,
  inheritanceSituationsCrossErrors,
  inheritanceSituationsErrors,
  parseNotice,
  parseSituationSlugs,
  selfCalculatorHref,
  situationMissing,
  smAcquisitionCard,
} from "./inheritance-gift-logic";
import { validateSettingValue } from "@/lib/admin/settings-rules";

const card = (over: Partial<OfficialLinkCard>): OfficialLinkCard => ({ id: 1, kind: "external_calculator", key: "inheritance_gift", label: "시험 카드", url: "https://x.example.test/", termsNote: null, status: "ok", checkedOn: "2026-10-20", ...over });
const nts = card({ id: 2, kind: "fallback", key: "nts", label: "국세청 안내" });
const wetax = card({ id: 3, kind: "fallback", key: "wetax", label: "위택스 안내" });

describe("고지 문구 검사", () => {
  it("PRD 문장 씨앗은 통과한다", () => expect(inheritanceNoticeErrors(IG_NOTICE_SEED)).toEqual([]));
  it("글자가 아니거나 비었거나 100자를 넘으면 거부, 100자는 통과", () => {
    expect(inheritanceNoticeErrors(5)).toHaveLength(1);
    expect(inheritanceNoticeErrors("  ")).toHaveLength(1);
    expect(inheritanceNoticeErrors("가".repeat(101))).toHaveLength(1);
    expect(inheritanceNoticeErrors("가".repeat(100))).toEqual([]);
  });
  it("숫자가 든 문구는 거부", () => expect(inheritanceNoticeErrors("공제 3억")[0]).toMatch(/숫자/));
  it("설정이 틀리면 씨앗 문장으로 대신한다", () => {
    expect(parseNotice(7)).toBe(IG_NOTICE_SEED);
    expect(parseNotice(" 시험용 고지 ")).toBe("시험용 고지");
  });
});

describe("상황 목록 검사", () => {
  it("빈 목록·4개는 통과, 5개·중복·나쁜 slug·배열 아님은 거부", () => {
    expect(inheritanceSituationsErrors([])).toEqual([]);
    expect(inheritanceSituationsErrors(["a", "b", "c", "d"])).toEqual([]);
    expect(inheritanceSituationsErrors(["a", "b", "c", "d", "e"])).toHaveLength(1);
    expect(inheritanceSituationsErrors(["a", "a"])[0]).toMatch(/두 번/);
    expect(inheritanceSituationsErrors(["Bad_Slug", 1])).toHaveLength(2);
    expect(inheritanceSituationsErrors("a")).toHaveLength(1);
  });
  it("틀린 목록은 읽을 때 빈 목록", () => {
    expect(parseSituationSlugs(["a", "a"])).toEqual([]);
    expect(parseSituationSlugs(["a", "b"])).toEqual(["a", "b"]);
  });
  it("설정 화면 규칙(SETTING_SPECS)에 두 키가 있고 같은 검사를 한다", () => {
    expect(validateSettingValue("inheritance_gift_notice", "시험용", null)).toEqual({ ok: true, value: "시험용" });
    expect(validateSettingValue("inheritance_gift_notice", "3억", null).ok).toBe(false);
    expect(validateSettingValue("inheritance_gift_situations", ["a"], []).ok).toBe(true);
    expect(validateSettingValue("inheritance_gift_situations", ["A"], []).ok).toBe(false);
  });
});

describe("상황이 갖춰야 할 것", () => {
  const ok = { slug: "s1", section: "realestate", checklist: { items: ["x"], notice: "고지" }, link: { kind: "external_calculator", key: "inheritance_gift" } };
  it("모두 갖추면 null", () => expect(situationMissing(ok)).toBeNull());
  it("연결·고지·분야가 빠진 것을 말해 준다", () => {
    expect(situationMissing({ ...ok, link: null })).toMatch(/외부 계산기 연결/);
    expect(situationMissing({ ...ok, link: { kind: "sm_calculator", key: "acquisition" } })).toMatch(/외부 계산기 연결/);
    expect(situationMissing({ ...ok, checklist: null })).toMatch(/체크리스트 고지/);
    expect(situationMissing({ ...ok, checklist: { items: ["x"], notice: " " } })).toMatch(/체크리스트 고지/);
    expect(situationMissing({ ...ok, section: "tax" })).toMatch(/부동산 분야/);
    expect(situationMissing(undefined)).toBe("상황이 없습니다");
  });
  it("목록 전체 검사는 상황마다 한 줄", () => {
    expect(inheritanceSituationsCrossErrors(["s1", "s2"], [ok])).toEqual(["상속·증여 상황 s2: 상황이 없습니다"]);
  });
});

describe("FAM-08 카드", () => {
  it("정상이면 대체 안내 없이 카드 하나", () => expect(fam08Card([card({}), nts])).toEqual({ card: card({}), fallbacks: [] }));
  it("주소가 있는 외부 계산기 행이 없으면 null", () => expect(fam08Card([nts])).toBeNull());
  it("끊김이면 국세청만 대체(위택스 제외), 국세청도 끊겼거나 없으면 카드째 숨김", () => {
    const broken = card({ status: "broken" });
    expect(fam08Card([broken, wetax, nts])?.fallbacks.map((f) => f.key)).toEqual(["nts"]);
    expect(fam08Card([broken, wetax, { ...nts, status: "broken" }])).toBeNull();
    expect(fam08Card([broken, wetax])).toBeNull();
  });
});

describe("SM 취득세 카드·자체 계산기 버튼", () => {
  const sm = card({ id: 9, kind: "sm_calculator", key: "acquisition" });
  it("sm_calculator 키가 꺼지면 카드 0, 켜지면 취득세 카드 1(다른 계산기 아님)", () => {
    expect(smAcquisitionCard([sm], false)).toBeNull();
    expect(smAcquisitionCard([card({ kind: "sm_calculator", key: "transfer" })], true)).toBeNull();
    expect(smAcquisitionCard([sm, wetax], true)?.card.key).toBe("acquisition");
  });
  it("self_calculator 키가 꺼지면 요소 0, 켜지면 /calc/acquisition", () => {
    expect(selfCalculatorHref(false)).toBeNull();
    expect(selfCalculatorHref(true)).toBe("/calc/acquisition");
  });
});
