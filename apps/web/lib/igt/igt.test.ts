import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { calcGift, calcInheritance } from "@ltr/igt-engine";
import { igtGateOpen, type IgtGateRow } from "./gate";
import { buildGiftInput, buildInheritanceInput, GIFT_FORM_EMPTY, INHERITANCE_FORM_EMPTY, parseWon } from "./form";
import { asIgtRuleset } from "./ruleset";
import { toolLinkFor, type ToolContext } from "@/lib/calc/tool-link";

const ROOT = path.resolve(__dirname, "../../../..");
const draft = JSON.parse(fs.readFileSync(path.join(ROOT, "rules-igt/2026.07.json"), "utf8")) as unknown;
const HASH = "a".repeat(64);
const row = (kind: string, open: boolean, hash: string | null = HASH): IgtGateRow => ({ tax_kind: kind, cause_group: "ALL", engine_hash: hash, is_open: open });

describe("게이트 판정 (FAM-12·14)", () => {
  test("증여만 열리면 증여는 열리고 상속은 닫힌다", () => {
    const rows = [row("gift", true), row("inheritance", false)];
    expect(igtGateOpen(rows, "gift", HASH)).toBe(true);
    expect(igtGateOpen(rows, "inheritance", HASH)).toBe(false);
  });
  test("엔진 해시가 다르면 뷰가 열려 있어도 닫힌다", () => {
    expect(igtGateOpen([row("gift", true, "b".repeat(64))], "gift", HASH)).toBe(false);
  });
  test("줄이 없거나 배포 해시가 비면 닫힌다", () => {
    expect(igtGateOpen([], "gift", HASH)).toBe(false);
    expect(igtGateOpen([row("gift", true)], "gift", "")).toBe(false);
  });
});

describe("입력 폼 -> 엔진 입력", () => {
  test("숫자 글자: 쉼표·공백을 지우고, 빈 칸은 0, 음수·소수·글자는 거부", () => {
    expect(parseWon("1,500,000 원")).toBe(1_500_000);
    expect(parseWon("")).toBe(0);
    for (const bad of ["-1", "1.5", "abc", "1e9", "1".repeat(16)]) expect(parseWon(bad)).toBeNull();
  });
  test("증여 폼: 5억 성인 자녀 -> 엔진 -> 77,600,000원 (손계산과 같음)", () => {
    const built = buildGiftInput({ ...GIFT_FORM_EMPTY, giftDate: "2026-08-10", giftValue: "500,000,000" });
    expect(built.ok).toBe(true);
    if (built.ok) expect(calcGift(built.input, asIgtRuleset(draft)!).final_tax).toBe(77_600_000);
  });
  test("증여 폼: 날짜 없음 · 0원 · 글자 금액은 계산 전에 막는다", () => {
    const r = buildGiftInput({ ...GIFT_FORM_EMPTY, giftValue: "abc" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join("|")).toMatch(/증여일.*증여재산가액/);
    expect(buildGiftInput({ ...GIFT_FORM_EMPTY, giftDate: "2026-08-10", giftValue: "0" }).ok).toBe(false);
  });
  test("상속 폼: 자녀 1명 · 부동산 20억 -> 426,800,000원, 미성년 나이 범위 밖은 거부", () => {
    const base = { ...INHERITANCE_FORM_EMPTY, deathDate: "2026-03-15", realEstate: "2,000,000,000", childrenCount: "1" };
    const ok = buildInheritanceInput(base);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(calcInheritance(ok.input, asIgtRuleset(draft)!).final_tax).toBe(426_800_000);
    expect(buildInheritanceInput({ ...base, minorAges: "7, 19" }).ok).toBe(false);
    expect(buildInheritanceInput({ ...base, skipShare: "1.5" }).ok).toBe(false);
  });
});

describe("룰셋 모양 확인", () => {
  test("rules-igt 초안은 엔진이 읽는 모양, 묶음이 빠지면 없는 것으로 친다", () => {
    expect(asIgtRuleset(draft)).not.toBeNull();
    const broken = { ...(draft as object), payment: undefined };
    expect(asIgtRuleset(broken)).toBeNull();
    expect(asIgtRuleset(null)).toBeNull();
    expect(asIgtRuleset("x")).toBeNull();
  });
});

describe("개인정보 - 화면·입력 코드는 서버·저장소·분석으로 내보내지 않는다 (FAM-10·11)", () => {
  const files = ["components/site/igt/IgtCalculator.tsx", "lib/igt/form.ts", "lib/igt/gate.ts", "lib/igt/ruleset.ts"].map((f) => path.join(__dirname, "../..", f));
  const banned = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|indexedDB|document\.cookie|location\.(hash|search)|history\.(push|replace)State|useRouter|analytics|track\(|console\./;
  test.each(files)("%s", (f) => {
    const code = fs.readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code.match(banned)).toBeNull();
  });
  test("화면은 지방세 엔진을 가져오지 않는다 (한 줄 합계 0)", () => {
    const code = fs.readFileSync(files[0]!, "utf8");
    expect(code).not.toMatch(/@ltr\/tax-engine/);
  });
});

describe("도구 링크 전환 (FAM-14) - 외부 카드 -> 자체 카드는 키 + 게이트 + 해시가 모두 맞을 때만", () => {
  const ctx = (patch: Partial<ToolContext["features"]>, rows: IgtGateRow[], hash: string | null = HASH): ToolContext =>
    ({
      features: { calc: true, sm_calculator: true, self_calculator: true, calc_acquisition: false, calc_holding: false, calc_refund: false, calc_igt_gift: true, calc_igt_inheritance: true, ...patch },
      gateRows: rows as unknown as ToolContext["gateRows"],
      engineHash: "x",
      igtEngineHash: hash ?? undefined,
      refundTableActive: false,
    }) as ToolContext;
  test("둘 다 열림 -> 증여·상속 모두 자체", () => {
    const c = ctx({}, [row("gift", true), row("inheritance", true)]);
    expect(toolLinkFor("gift_tax", null, c)).toEqual({ kind: "self", href: "/calc/gift-tax" });
    expect(toolLinkFor("inheritance_tax", null, c)).toEqual({ kind: "self", href: "/calc/inheritance-tax" });
  });
  test("증여만 열림 -> 증여는 자체, 상속은 외부 카드", () => {
    const c = ctx({}, [row("gift", true), row("inheritance", false)]);
    expect(toolLinkFor("gift_tax", null, c).kind).toBe("self");
    expect(toolLinkFor("inheritance_tax", null, c)).toEqual({ kind: "external", linkKey: "inheritance_gift" });
  });
  test("둘 다 닫힘 · 키 꺼짐 · 해시 불일치 · 해시 없음 -> 자체 0, 외부 카드", () => {
    const open = [row("gift", true), row("inheritance", true)];
    for (const c of [ctx({}, []), ctx({ calc_igt_gift: false, calc_igt_inheritance: false }, open), ctx({}, [row("gift", true, "z"), row("inheritance", true, "z")]), ctx({}, open, null)]) {
      expect(toolLinkFor("gift_tax", null, c).kind).toBe("external");
      expect(toolLinkFor("inheritance_tax", null, c).kind).toBe("external");
    }
  });
  test("기존 합친 카드(inheritance_gift)는 늘 외부 카드 그대로", () => {
    expect(toolLinkFor("inheritance_gift", null, ctx({}, [row("gift", true), row("inheritance", true)]))).toEqual({ kind: "external", linkKey: "inheritance_gift" });
  });
});
