// W4 1단계 2.6 6 차이 보고 · 7 적용 계획 — 같은 파일 두 번 = 차이 0 · 이름 바뀜·폐지 표시 → 차이 보고에 각 1건
//  후속 코드 없는 폐지 → 중단 · 후속이 또 폐지 → 최종 지역으로 바꿔 씀(연쇄 0) · 순환 → 중단 · 옛 주소 301 · 옛 이름 → 후속 지역 별칭
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SEED_PLUS, fix, textOf, sourceOf, problemsOf, pipelineFor } from "./regions-fixtures.mjs";
import { applyPlan, currentFromSeed, dryRunInsert, readSuccessors, validOn } from "../regions/diff.mjs";

const v1After = () => pipelineFor("v1.utf8.txt").after;
const successorsV2 = () => readSuccessors(fs.readFileSync(fix("v2.successors.csv"), "utf8"));
const withText = (text, over) => {
  const s = sourceOf(text);
  return pipelineFor("edited.txt", { bytes: s.bytes, sha256: s.sha, encoding: "utf-8", ...over });
};

test("첫 적재(지금 = 씨앗만) — added 6 · unchanged 18 · 폐지·옛 주소 0, 적용 뒤 상태 24행", () => {
  const r = pipelineFor("v1.cp949.txt");
  assert.deepEqual(r.plan.counts, { added: 6, renamed: 0, retired: 0, unchanged: 18 });
  assert.deepEqual(r.plan.redirects, []);
  assert.equal(r.after.length, 24);
  assert.ok(r.after.every((x) => x.level === "sido" || x.parent_code === "9900000000"));
  assert.deepEqual(r.after.find((x) => x.code === "9913000000"), {
    code: "9913000000", parent_code: "9900000000", level: "sigungu", name: "시험시", slug: "siheom-si", aliases: ["시험"], valid_from: null, valid_to: null, successor_code: null,
  });
  assert.equal(r.prefix99, 15, "가짜 접두 99 행 수를 보고서에 낸다");
});

test("같은 파일 두 번 = 차이 0 (added·renamed·retired 0, 별칭 갱신 0, 옛 주소 0, 상태 그대로)", () => {
  const after = v1After();
  for (const name of ["v1.utf8.txt", "v1.cp949.txt"]) {
    const again = pipelineFor(name, { current: after });
    assert.deepEqual(again.plan.counts, { added: 0, renamed: 0, retired: 0, unchanged: 24 }, name);
    assert.deepEqual(again.plan.aliasUpdates, []);
    assert.deepEqual(again.plan.redirects, []);
    assert.deepEqual(again.after, after);
  }
});

test("v2 — 이름 바뀜 1 · 폐지 1 · 새 지역 1, 각각 목록에 · slug 그대로 · 옛 주소 301 · 옛 이름은 후속·개칭 지역 별칭", () => {
  const r = pipelineFor("v2.utf8.txt", { current: v1After(), successors: successorsV2() });
  assert.deepEqual(r.plan.counts, { added: 1, renamed: 1, retired: 1, unchanged: 22 });
  assert.deepEqual(r.plan.added.map((e) => [e.code, e.name, e.slug, e.aliases]), [["9924000000", "신규군", "singyu-gun", ["신규"]]]);
  assert.deepEqual(r.plan.renamed.map((x) => [x.entry.code, x.from, x.entry.name, x.entry.slug, x.entry.aliases]), [["9917000000", "예시군", "새예시군", "yesi-gun", ["예시", "새예시", "예시군"]]]);
  assert.deepEqual(r.plan.retired, [{ code: "9915000000", name: "나구", level: "sigungu", parentCode: "9900000000", slug: "na-gu", successor: "9913000000", validTo: "2026-06-30", basis: "시험용 고시 제0000-0호", reason: "file" }]);
  assert.deepEqual(r.plan.redirects, [{ old_path: "/local/gasang-do/na-gu", region_code: "9913000000", reason: "retired" }]);
  assert.deepEqual(r.plan.aliasUpdates, [{ code: "9913000000", aliases: ["시험", "나구"] }]);
  const after = Object.fromEntries(r.after.map((x) => [x.code, x]));
  assert.equal(after["9915000000"].valid_to, "2026-06-30");
  assert.equal(after["9915000000"].successor_code, "9913000000");
  assert.equal(after["9917000000"].slug, "yesi-gun");
  assert.equal(validOn(after["9915000000"], "2026-06-30"), true, "폐지일 당일까지 유효");
  assert.equal(validOn(after["9915000000"], "2026-07-01"), false);
  // v2를 다시(후속 입력 없이) — 차이 0
  const again = pipelineFor("v2.utf8.txt", { current: r.after });
  assert.deepEqual(again.plan.counts, { added: 0, renamed: 0, retired: 0, unchanged: 24 });
  assert.deepEqual(again.plan.aliasUpdates, []);
});

test("후속 코드 없는 폐지 → 중단 · 원본에서 빠진 지역도 폐지로 보고 후속을 요구한다", () => {
  const p = problemsOf(() => pipelineFor("v2.utf8.txt", { current: v1After() }));
  assert.deepEqual(p.map((x) => [x.code, x.detail]), [["SUCCESSOR_MISSING", "9915000000 나구"]]);
  const dropped = textOf("v1.utf8.txt").replace("9919000000\t가상도 모의시\t존재\n", "");
  const p2 = problemsOf(() => withText(dropped, { current: v1After() }));
  assert.deepEqual(p2.map((x) => x.code), ["SUCCESSOR_MISSING"]);
  const ok = withText(dropped, { current: v1After(), successors: new Map([["9919000000", { successor: "9920000000", validTo: "2026-06-30", basis: "시험용 고시" }]]) });
  assert.equal(ok.plan.retired[0].reason, "missing");
  assert.ok(ok.notes.some((n) => /9919000000 모의시 — 원본에 행이 없어 폐지로 봅니다 \[확인 필요\]/.test(n)));
});

test("후속이 또 폐지 → 최종 지역으로 바꿔 쓴다(연쇄 0, 멈추지 않음) · 순환 → 중단 · 적용 뒤 유효하지 않은 후속 → 중단", () => {
  const text = textOf("v2.utf8.txt").replace("9919000000\t가상도 모의시\t존재", "9919000000\t가상도 모의시\t폐지");
  const chain = new Map([
    ["9915000000", { successor: "9919000000", validTo: "2026-06-30", basis: "시험용 고시 1" }],
    ["9919000000", { successor: "9913000000", validTo: "2026-06-30", basis: "시험용 고시 2" }],
  ]);
  const r = withText(text, { current: v1After(), successors: chain });
  assert.deepEqual(r.plan.retired.map((x) => [x.code, x.successor]), [["9915000000", "9913000000"], ["9919000000", "9913000000"]]);
  assert.deepEqual(r.rewrites.map((x) => x.code), ["SUCCESSOR_CHAIN"]);
  assert.match(r.rewrites[0].detail, /9915000000 → 9919000000 → 9913000000/);
  assert.deepEqual(r.plan.redirects.map((x) => [x.old_path, x.region_code]), [["/local/gasang-do/na-gu", "9913000000"], ["/local/gasang-do/moui-si", "9913000000"]]);
  const cycle = new Map([
    ["9915000000", { successor: "9919000000", validTo: "2026-06-30", basis: "시험용" }],
    ["9919000000", { successor: "9915000000", validTo: "2026-06-30", basis: "시험용" }],
  ]);
  const pc = problemsOf(() => withText(text, { current: v1After(), successors: cycle }));
  assert.ok(pc.length >= 1 && pc.every((x) => x.code === "SUCCESSOR_CYCLE"), JSON.stringify(pc));
  const unknown = new Map([["9915000000", { successor: "9922000000", validTo: "2026-06-30", basis: "시험용" }]]);
  assert.deepEqual(problemsOf(() => pipelineFor("v2.utf8.txt", { current: v1After(), successors: unknown })).map((x) => x.code), ["SUCCESSOR_UNKNOWN"]);
});

test("후속 입력 파일 — 칸 규칙 밖·같은 코드 두 번·이번에 폐지되지 않는 코드 → 중단", () => {
  const bad = (csv) => problemsOf(() => readSuccessors(csv)).map((x) => x.code);
  assert.deepEqual(bad("code,successor_code,valid_to,basis\n9915000000,991300000,2026-06-30,고시\n"), ["SUCCESSOR_INPUT"]);
  assert.deepEqual(bad("code,successor_code,valid_to,basis\n9915000000,9913000000,2026/06/30,고시\n"), ["SUCCESSOR_INPUT"]);
  assert.deepEqual(bad("code,successor_code,valid_to,basis\n9915000000,9913000000,2026-06-30,\n"), ["SUCCESSOR_INPUT"]);
  assert.deepEqual(bad("code,successor_code,valid_to,basis\n9915000000,9913000000,2026-06-30,고시\n9915000000,9913000000,2026-06-30,고시\n"), ["SUCCESSOR_INPUT"]);
  const extra = new Map([...successorsV2(), ["9919000000", { successor: "9913000000", validTo: "2026-06-30", basis: "시험용" }]]);
  const p = problemsOf(() => pipelineFor("v2.utf8.txt", { current: v1After(), successors: extra }));
  assert.deepEqual(p.map((x) => [x.code, x.detail]), [["SUCCESSOR_INPUT", "9919000000는 이번에 폐지되는 지역이 아닙니다"]]);
});

test("지금 폐지된 코드가 원본에서 '존재'로 돌아오면 중단 (사람이 확인)", () => {
  const after2 = pipelineFor("v2.utf8.txt", { current: v1After(), successors: successorsV2() }).after;
  const p = problemsOf(() => pipelineFor("v1.utf8.txt", { current: after2, today: "2026-10-22" }));
  assert.ok(p.some((x) => x.code === "REVIVED" && /9915000000 나구/.test(x.detail)), JSON.stringify(p));
});

test("적용 뒤 상태 — 폐지 지역을 후속으로 둔 옛 행도 최종 지역으로 (DB 트리거와 같게)", () => {
  const old = { code: "9926000000", parent_code: "9900000000", level: "sigungu", name: "옛모의구", slug: "yet-moui-gu", aliases: [], valid_from: null, valid_to: "2020-12-31", successor_code: "9915000000" };
  const current = [...v1After(), old];
  const r = pipelineFor("v2.utf8.txt", { current, successors: successorsV2() });
  assert.equal(r.after.find((x) => x.code === "9926000000").successor_code, "9913000000");
  assert.equal(r.plan.counts.retired, 1, "이미 폐지된 옛 행은 차이에 없다");
  assert.deepEqual(applyPlan(currentFromSeed(SEED_PLUS), { added: [], renamed: [], aliasUpdates: [], retired: [] }), currentFromSeed(SEED_PLUS).sort((a, b) => a.code.localeCompare(b.code)));
});

test("dry_run 기록 행 — 분류 수·차이 수 JSON과 원본 해시", () => {
  const r = pipelineFor("v1.utf8.txt");
  const { sql, params } = dryRunInsert({ fileName: r.source.fileName, fileDate: r.source.fileDate, sha256: r.source.sha256, rowsTotal: r.source.rowsTotal, classCounts: r.derived.class_counts, changeCounts: r.plan.counts });
  assert.match(sql, /'dry_run'/);
  assert.deepEqual(params.slice(0, 4), ["v1.utf8.txt", "2026-10-01", r.source.sha256, 32]);
  assert.deepEqual(JSON.parse(params[4]), { sido: 18, sigungu: 7, general_gu: 2, sub_district: 5 });
  assert.deepEqual(JSON.parse(params[5]), { added: 6, renamed: 0, retired: 0, unchanged: 18 });
});
