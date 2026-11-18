import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 편집기 「지역 코드」 칸의 입력 예시는 저장소가 받는 모양(법정동코드 10자리)과 같아야 한다.
// 5자리 예시를 따라 적으면 지자체뉴스 발행 점검(REG1-17)과 지역 색인이 코드를 못 찾는다 (기사 6번 질문, 2026-11-18).
const src = readFileSync(resolve(__dirname, "../../components/admin/editor/MetaFields.tsx"), "utf8");
const block = src.slice(src.indexOf('id="meta-region-codes"'));
const hint = /hint="([^"]*)"/.exec(block)?.[1] ?? "";

describe("편집기 지역 코드 입력 예시", () => {
  it("예시가 있고, 예시의 모든 코드가 10자리 숫자다", () => {
    const codes = hint.match(/\d{4,}/g) ?? [];
    expect(codes.length).toBeGreaterThan(0);
    for (const c of codes) expect(c, `예시 ${c}`).toMatch(/^\d{10}$/);
  });

  it("5자리 예시(11680)는 남아 있지 않다", () => {
    expect(hint).not.toContain("11680");
  });
});
