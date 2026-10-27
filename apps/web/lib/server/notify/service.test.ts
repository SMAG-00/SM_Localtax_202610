// 브리핑 항목 해석 - 항목 JSON의 id가 문자열이든 숫자든 DB 행(숫자)과 맞춰진다
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveItems } from "./service";

function fakeDb(rows: Record<string, unknown[]>) {
  return {
    from: (table: string) => ({
      select: () => ({ in: (_col: string, ids: number[]) => Promise.resolve({ data: (rows[table] ?? []).filter((r) => ids.includes(Number((r as { id: number }).id))) }) }),
    }),
  } as never;
}

describe("resolveItems id 형태", () => {
  const db = fakeDb({ public_articles: [{ id: 41, slug: "a-41", title: "공개 기사 41" }] });

  test("문자열 id와 숫자 id가 같은 기사로 풀린다", async () => {
    const out = await resolveItems(db, [
      { type: "article", id: "41" as unknown as number, reason: "region", basis_on: "2026-10-26" },
      { type: "article", id: 41, reason: "interest", basis_on: "2026-10-26" },
    ]);
    expect(out.map((o) => o.title)).toEqual(["공개 기사 41", "공개 기사 41"]);
    expect(out[0].link).toBe("/news/a-41");
  });

  test("공개 뷰에 없는 기사는 빠진다", async () => {
    const out = await resolveItems(db, [{ type: "article", id: "42" as unknown as number, reason: "region", basis_on: "2026-10-26" }]);
    expect(out).toEqual([]);
  });
});
