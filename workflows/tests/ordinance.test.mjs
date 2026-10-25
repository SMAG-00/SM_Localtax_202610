// W11-e 조례 규칙 단위 시험 (RDV-06 · TX-13 · AIOPS-14) - 실제 외부 호출 0, 지어낸 시험용 문장·숫자만 쓴다
//  · 요약 숫자 검사 - 원문에 없는 숫자는 거부, 토큰 일치(5가 15에 걸리지 않음), 천 단위 쉼표
//  · 관문 - 이용 조건 미확인이면 lookup 0회
//  · 수동 등록 - 빠진 칸 목록, 시·도/시·군·구 종류 불일치
//  · 개정 판정 - 해시만 바뀌면 검수 0, 시행일 변경이면 검수 1
//  · 확인일 경고 - 90일째 경고 없음, 91일째 경고, 한도 없으면 경고 0, 한국 날짜 기준
import { test } from "node:test";
import assert from "node:assert/strict";
import { collectOrdinances, isStale, missingSummaryNumbers, staleDays, summaryNumbersOk, validateManualOrdinance } from "../src/ordinance/index.ts";

const SOURCE = "시험용 조례 제3조 감면 비율은 7 로 하고 한도는 1,200 으로 한다. 제4조 기간은 2.5 로 한다.";

test("요약 숫자가 모두 원문에 있으면 통과, 쉼표 천 단위는 같은 숫자", () => {
  assert.equal(summaryNumbersOk("시험용 요약 7 과 1200 과 2.5", SOURCE), true);
  assert.equal(summaryNumbersOk("숫자 없는 요약", SOURCE), true);
});

test("요약에 원문에 없는 숫자가 있으면 거부하고 그 숫자를 알려준다", () => {
  assert.equal(summaryNumbersOk("시험용 요약 8", SOURCE), false);
  assert.deepEqual(missingSummaryNumbers("시험용 8 과 7 과 99", SOURCE), ["8", "99"]);
});

test("토큰 일치 - 요약 5는 원문 15나 2.5 안의 5로 통과하지 않는다", () => {
  assert.equal(summaryNumbersOk("시험용 5", "시험용 15 와 2.5"), false);
  assert.equal(summaryNumbersOk("시험용 15", "시험용 15 와 2.5"), true);
});

test("관문이 닫혀 있으면(이용 조건 미확인) 조회 요청 0", async () => {
  let calls = 0;
  const r = await collectOrdinances({
    gate: { flagOn: true, oc: "x", sourceRunnable: false },
    targets: [{ lawId: 1, name: "시험용 조례", prev: null }],
    lookup: async () => { calls += 1; return { promulgationNo: "시험용-1", effectiveOn: "2026-01-01", bodyHash: "h" }; },
  });
  assert.equal(calls, 0);
  assert.equal(r.requests, 0);
  assert.equal(r.skipped, "source_not_runnable");
});

test("개정 판정 - 해시만 바뀌면 검수 항목 0, 시행일이 바뀌면 1, 한 건 오류가 나머지를 막지 않는다", async () => {
  const prev = { promulgationNo: "시험용-1", effectiveOn: "2026-01-01", bodyHash: "a" };
  const r = await collectOrdinances({
    gate: { flagOn: true, oc: "x", sourceRunnable: true },
    targets: [
      { lawId: 1, name: "시험용 가", prev },
      { lawId: 2, name: "시험용 나", prev },
      { lawId: 3, name: "시험용 다", prev },
      { lawId: 4, name: "시험용 라", prev: null },
    ],
    lookup: async (t) => {
      if (t.lawId === 1) return { ...prev, bodyHash: "b" };
      if (t.lawId === 2) return { promulgationNo: "시험용-2", effectiveOn: "2026-02-01", bodyHash: "c" };
      if (t.lawId === 3) throw new Error("시험용 오류");
      return { ...prev };
    },
  });
  assert.equal(r.requests, 4);
  assert.deepEqual(r.outcomes.map((o) => [o.lawId, o.change ?? o.error, o.review ?? null]), [[1, "body_only", false], [2, "revision", true], [3, "시험용 오류", null], [4, "first_seen", false]]);
});

test("수동 등록 - 빠진 칸을 모두 알려주고, 완전하면 통과", () => {
  const empty = validateManualOrdinance({});
  assert.equal(empty.ok, false);
  assert.deepEqual(empty.problems, ["name", "regionCode", "kind", "sourceUrl", "effectiveFrom", "verifiedAt", "promulgationNo", "bodyText"]);
  const full = { name: "시험용 시 조례", regionCode: "1100000000", regionLevel: "sigungu", kind: "tax_reduction", sourceUrl: "https://example.test/ord", effectiveFrom: "2026-01-01", verifiedAt: "2026-01-02", promulgationNo: "시험용-1", bodyText: SOURCE, summary: "시험용 7" };
  assert.deepEqual(validateManualOrdinance(full), { ok: true, problems: [] });
});

test("수동 등록 - 시·도 도시정비 종류를 시·군·구에 달면 거부, 요약 숫자 불일치도 거부", () => {
  const base = { name: "시험용", regionCode: "1100000000", kind: "urban_redevelopment", sourceUrl: "https://example.test/o", effectiveFrom: "2026-01-01", verifiedAt: "2026-01-02", promulgationNo: "n", bodyText: SOURCE };
  assert.deepEqual(validateManualOrdinance({ ...base, regionLevel: "sigungu" }).problems, ["kind_level"]);
  assert.deepEqual(validateManualOrdinance({ ...base, regionLevel: "sido", summary: "시험용 42" }).problems, ["summary_numbers"]);
});

test("확인일 경고 - 90일째 경고 없음, 91일째 경고 (한도 90)", () => {
  const verified = new Date("2026-03-01T03:00:00+09:00");
  const day90 = new Date("2026-05-30T20:00:00+09:00");
  const day91 = new Date("2026-05-31T00:00:00+09:00");
  assert.equal(staleDays(verified, day90), 90);
  assert.equal(isStale(verified, day90, 90), false);
  assert.equal(staleDays(verified, day91), 91);
  assert.equal(isStale(verified, day91, 90), true);
});

test("확인일 경고 - 한도가 없으면 경고 계산 0, 한국 날짜 기준(UTC 자정 전후)", () => {
  const verified = new Date("2026-03-01T00:00:00+09:00");
  assert.equal(isStale(verified, new Date("2027-03-01T00:00:00+09:00"), null), false);
  assert.equal(isStale(verified, new Date("2027-03-01T00:00:00+09:00"), undefined), false);
  // 한국 시각 00:30 = UTC 전날 15:30 - 한국 날짜로 하루가 지난 것으로 센다
  assert.equal(staleDays(new Date("2026-03-01T23:30:00+09:00"), new Date("2026-03-02T00:30:00+09:00")), 1);
});
