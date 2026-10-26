import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { clearHandoff, readHandoff, setHandoff } from "./handoff";

afterEach(() => clearHandoff());

describe("메모리 전달 (RE-04)", () => {
  it("담은 값을 사본으로 돌려주고, 사본을 바꿔도 원본은 그대로다", () => {
    expect(setHandoff({ houseCount: 2, cause: "GIFT" })).toBe(true);
    const a = readHandoff()!;
    expect(a).toEqual({ houseCount: 2, cause: "GIFT" });
    a.houseCount = 99;
    expect(readHandoff()!.houseCount).toBe(2);
  });

  it("주택 수 0도 답이다 (없음과 다르다)", () => {
    expect(setHandoff({ houseCount: 0, cause: "PAID" })).toBe(true);
    expect(readHandoff()).toEqual({ houseCount: 0, cause: "PAID" });
    clearHandoff();
    expect(readHandoff()).toBeNull();
  });

  it("모양이 틀린 값은 담지 않고 이전 값도 건드리지 않는다", () => {
    setHandoff({ houseCount: 1, cause: "PAID" });
    for (const bad of [null, "2", { houseCount: -1, cause: "PAID" }, { houseCount: 1.5, cause: "PAID" }, { houseCount: 1, cause: "SALE" }, { houseCount: "1", cause: "PAID" }, { cause: "PAID" }]) expect(setHandoff(bad)).toBe(false);
    expect(readHandoff()).toEqual({ houseCount: 1, cause: "PAID" });
  });

  it("소스에 저장소·주소·쿠키·네트워크 접근이 없다", () => {
    const src = readFileSync(fileURLToPath(new URL("./handoff.ts", import.meta.url)), "utf8").replace(/\/\/.*$/gm, "");
    for (const bad of ["localStorage", "sessionStorage", "document.cookie", "window.location", "history.", "fetch(", "navigator.", "indexedDB"]) expect(src.includes(bad), bad).toBe(false);
  });
});
