// 측정 거부·GPC·DNT 시험 (GROW-01 · PRD-00 13장 "측정 거부 또는 GPC 신호가 있으면 측정 이벤트를 보내지 않는다")
import { describe, expect, test } from "vitest";
import { choiceCookies, dntSignal, measurementState, parseChoice, refusalSignal } from "./consent";
import { parseCookies } from "./visit";

const headers = (h: Record<string, string>) => new Headers(h);

describe("거부 신호", () => {
  test("거부 쿠키 ltr_optout=1 → optout (GPC보다 먼저), 다른 값은 거부 아님", () => {
    expect(refusalSignal(parseCookies("ltr_optout=1"), headers({ "sec-gpc": "1" }))).toBe("optout");
    expect(refusalSignal(parseCookies("ltr_optout=0"), headers({}))).toBeNull();
    expect(refusalSignal(parseCookies("ltr_optout=true"), headers({}))).toBeNull();
  });
  test("Sec-GPC: 1 → gpc, 0이나 다른 값은 아님", () => {
    expect(refusalSignal(new Map(), headers({ "sec-gpc": "1" }))).toBe("gpc");
    expect(refusalSignal(new Map(), headers({ "Sec-GPC": " 1 " }))).toBe("gpc");
    expect(refusalSignal(new Map(), headers({ "sec-gpc": "0" }))).toBeNull();
    expect(refusalSignal(new Map(), headers({}))).toBeNull();
  });
  test("DNT: 1만 DNT 신호 (거부로 볼지는 설정이 정한다)", () => {
    expect(dntSignal(headers({ dnt: "1" }))).toBe(true);
    expect(dntSignal(headers({ dnt: "0" }))).toBe(false);
    expect(dntSignal(headers({}))).toBe(false);
  });
});

describe("측정 거부 화면·API", () => {
  test("지금 상태 — 거부 쿠키가 먼저, 그다음 GPC", () => {
    expect(measurementState(true, true)).toBe("refused");
    expect(measurementState(false, true)).toBe("gpc");
    expect(measurementState(false, false)).toBe("measuring");
  });

  test("본문 읽기 — 폼과 JSON, 모르는 값·형식은 null", () => {
    expect(parseChoice("application/x-www-form-urlencoded", "choice=refuse")).toBe("refuse");
    expect(parseChoice("application/x-www-form-urlencoded", "x=1&choice=allow")).toBe("allow");
    expect(parseChoice("application/json", '{"choice":"refuse"}')).toBe("refuse");
    for (const [type, text] of [
      ["application/x-www-form-urlencoded", "choice=REFUSE"],
      ["application/x-www-form-urlencoded", ""],
      ["application/json", '{"choice":1}'],
      ["application/json", '["refuse"]'],
      ["application/json", "{choice"],
    ] as const) {
      expect(parseChoice(type, text), `${type} ${text}`).toBeNull();
    }
  });

  test("거부 → 거부 쿠키(스크립트가 읽는다 — HttpOnly 아님, 400일) + 방문자·세션 쿠키 지움 / 허용 → 거부 쿠키만 지움", () => {
    expect(choiceCookies("refuse", true)).toEqual([
      "ltr_optout=1; Path=/; Max-Age=34560000; SameSite=Lax; Secure",
      "ltr_vid=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly; Secure",
      "ltr_sid=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly; Secure",
    ]);
    expect(choiceCookies("allow", false)).toEqual(["ltr_optout=; Path=/; Max-Age=0; SameSite=Lax"]);
  });
});
