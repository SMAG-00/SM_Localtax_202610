import { describe, expect, test } from "vitest";
import { maskBody } from "./query-terms";
import { maskEmailForDisplay } from "@/lib/policy/email";
import { parseHelpInput } from "@/lib/help/forms";

// 가림 정규식이 글 길이의 제곱만큼 느려지지 않는지 (2026-10-21 — '@' 없는 한글 5천 자가 0.4초, 문의 폼 본문 2만 자면 수 초).
// 시간 기준은 넉넉히 잡는다(직선 시간이면 수십 ms, 제곱이면 수 초) — 바쁜 PC에서도 흔들리지 않게.
const ms = (f: () => void) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};

describe("가림 속도 — 긴 글도 직선 시간", () => {
  test("'@' 없는 한글 2만 자 maskBody가 1초 안", () => {
    expect(ms(() => maskBody("가".repeat(20_000)))).toBeLessThan(1000);
  });
  test("'@' 없는 영문·숫자·띄어쓰기 섞인 2만 자 maskBody가 1초 안", () => {
    expect(ms(() => maskBody("ab1 ".repeat(5_000)))).toBeLessThan(1000);
  });
  test("끝에 '@' 하나만 있는 한글 2만 자도 1초 안", () => {
    expect(ms(() => maskBody(`${"가".repeat(20_000)}@`))).toBeLessThan(1000);
  });
  test("'@' 없는 영문 5만 자 maskEmailForDisplay가 1초 안", () => {
    expect(ms(() => maskEmailForDisplay("a".repeat(50_000)))).toBeLessThan(1000);
  });
});

describe("길이를 묶어도 실제 이메일은 그대로 가린다", () => {
  test("앞부분 64자 이메일·띄어쓰기 낀 이메일·한글 도메인", () => {
    const local64 = "a".repeat(64);
    expect(maskBody(`문의 ${local64}@example.com 부탁`).text).not.toContain("@example.com");
    expect(maskBody("연락 abc @ example.com 주세요").text).not.toMatch(/abc\s*@/);
    expect(maskBody("메일 홍길동@회사.한국 으로").text).not.toContain("@회사.한국");
  });
  test("정책 표기 — 앞부분 64자 이메일도 가린다", () => {
    const out = maskEmailForDisplay(`${"b".repeat(64)}@example.com`);
    expect(out).not.toContain("@");
    expect(out).toContain("[at]");
  });
});

describe("문의 폼 — 한도를 크게 넘는 원문은 가리기 전에 거부", () => {
  const SETTINGS = { bodyMin: 10, bodyMax: 5000, titleMax: 100, attachMaxCount: 3, attachMaxTotalBytes: 4_000_000 } as unknown as Parameters<typeof parseHelpInput>[2];
  test("한도의 2배를 넘는 본문은 code body로 거부하고 오래 걸리지 않는다", () => {
    let r: ReturnType<typeof parseHelpInput> | undefined;
    const took = ms(() => {
      r = parseHelpInput("report", { body: "가".repeat(10_001) }, SETTINGS);
    });
    expect(r).toMatchObject({ ok: false, code: "body" });
    expect(took).toBeLessThan(200);
  });
});
