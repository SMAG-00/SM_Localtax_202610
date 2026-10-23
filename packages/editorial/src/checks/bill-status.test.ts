// PR-13 법안 상태를 다룬 기사 — 출처 주소·확인일이 있는 공식 자료 출처 (01B W4 20단계 뒷부분, 12장 #169). 기사·출처는 시험용 가짜.
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { uniqueIds } from "../../fixtures/helpers";
import { QUANTITATIVE_NEWS } from "../../fixtures/quantitative";
import { evaluatePublish } from "../evaluate";
import type { ArticleForPublish, ArticleSource } from "../model";
import { billStatusProblem, checkBillStatus } from "./bill-status";

const q = QUANTITATIVE_NEWS;
const dataset = q.sources.find((s) => s.kind === "dataset")!;
const press = q.sources.find((s) => s.kind === "press_release")!;
const withSources = (sources: readonly ArticleSource[], covers: boolean | "unset" = true): ArticleForPublish => (covers === "unset" ? { ...q, sources } : { ...q, coversBillStatus: covers, sources });
const ids = (a: ArticleForPublish) => uniqueIds(evaluatePublish(a, BASE_CONTEXT).blockers);

describe("법안 상태를 다룬 기사 (PR-13)", () => {
  it("표시가 없거나 꺼진 기사는 출처가 0건이어도 이 검사에 걸리지 않는다", () => {
    expect(checkBillStatus(withSources([], "unset"))).toEqual([]);
    expect(checkBillStatus(withSources([], false))).toEqual([]);
    expect(ids(withSources([], false))).not.toContain("pr13.bill-status-source");
  });

  it("표시를 켠 기사에 출처가 0건이면 '공식 자료 출처'가 빠졌다고 차단한다", () => {
    const f = checkBillStatus(withSources([]));
    expect(f).toHaveLength(1);
    expect(f[0]!.id).toBe("pr13.bill-status-source");
    expect(f[0]!.level).toBe("block");
    expect(f[0]!.message).toContain("빠진 것: 공식 자료 출처");
    expect(billStatusProblem(withSources([]))).toEqual({ missing: ["공식 자료 출처"] });
    expect(ids(withSources([]))).toContain("pr13.bill-status-source");
  });

  it("보도자료 출처만 있으면 공식 자료가 아니므로 차단한다", () => {
    expect(billStatusProblem(withSources([press]))).toEqual({ missing: ["공식 자료 출처"] });
  });

  it("공식 자료에 출처 주소와 확인일이 모두 있으면 통과하고 발행 판정에도 이 항목이 없다", () => {
    const ok = { ...dataset, url: "https://gasang.example/bill/1", accessedAt: "2026-10-20T09:00:00+09:00" };
    expect(billStatusProblem(withSources([ok]))).toBeNull();
    expect(ids(withSources([ok, press]))).not.toContain("pr13.bill-status-source");
  });

  it("공식 자료에 확인일이 비면 '확인일'이, 출처 주소가 비면 '출처 주소'가 빠졌다고 알린다", () => {
    expect(billStatusProblem(withSources([{ ...dataset, url: "https://gasang.example/bill/1", accessedAt: null }]))).toEqual({ missing: ["확인일"] });
    expect(billStatusProblem(withSources([{ ...dataset, url: " ", accessedAt: "2026-10-20T09:00:00+09:00" }]))).toEqual({ missing: ["출처 주소"] });
  });

  it("불완전한 출처 옆에 완전한 공식 자료가 1건 있으면 통과한다", () => {
    const bad = { ...dataset, id: "src:bad", accessedAt: null };
    const good = { ...dataset, id: "src:good", url: "https://gasang.example/bill/2", accessedAt: "2026-10-20T09:00:00+09:00" };
    expect(billStatusProblem(withSources([bad, good]))).toBeNull();
  });
});
