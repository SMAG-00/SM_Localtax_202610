// W4 1단계 2.6 7 데이터 마이그레이션 만들기 + 명령(cli.mjs) 전 과정
//  만든 마이그레이션 머리에 원본 이름·배포일·해시·행 수 · 승인자 없으면 만들지 않음 · 다음 빈 번호 · 적용하지 않는다
//  (만든 마이그레이션이 실제 DB에 깨끗이 적용되는지는 packages/db/tests/w4-regions-import.test.mjs — 이 폴더 시험은 DB 없이 돈다)
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fix, problemsOf, pipelineFor, SIDO_SEED_MIGRATION_PATH } from "./regions-fixtures.mjs";
import { runScript } from "./helpers.mjs";
import { emitMigration, nextMigrationName, nextMigrationNameIn } from "../regions/emit-migration.mjs";
import { readSuccessors } from "../regions/diff.mjs";
import { sha256 } from "../regions/parse.mjs";
import { MIGRATIONS_DIR } from "../regions/config.mjs";
import { lintMigrations } from "../../packages/db/scripts/lint-migrations.mjs";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "regions", "cli.mjs");
const temps = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ltr-regions-"));
  temps.push(d);
  return d;
};
after(() => {
  for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
});
const shaOf = (name) => sha256(fs.readFileSync(fix(name)));
const SEEDS = ["--sido-seed", SIDO_SEED_MIGRATION_PATH, "--sido-seed", fix("sido-fictional.json")];

test("마이그레이션 머리 — 원본 이름·배포일·SHA-256·행 수·분류 수·차이 수·승인자, 같은 원본 applied 있으면 건너뜀", () => {
  const r = pipelineFor("v1.cp949.txt");
  const sql = emitMigration({ source: r.source, counts: r.counts, plan: r.plan, approvedBy: "PO(시험)", generatedAt: "2026-10-22T00:00:00.000Z" });
  const head = sql.split("\n").filter((l) => l.startsWith("--"));
  assert.ok(head.includes("-- 원본 파일: v1.cp949.txt"));
  assert.ok(head.includes("-- 배포일: 2026-10-01"));
  assert.ok(head.includes(`-- SHA-256: ${shaOf("v1.cp949.txt")}`));
  assert.ok(head.includes("-- 행 수: 전체 32 · sido 18(존재 18·폐지 0) · sigungu 7(존재 6·폐지 1) · general_gu 2(존재 2·폐지 0) · sub_district 5(존재 4·폐지 1)"));
  assert.ok(head.includes("-- 차이: added 6 · renamed 0 · retired 0 · unchanged 18 · 별칭 갱신 0 · 옛 주소 0"));
  assert.ok(head.some((l) => l.startsWith("-- 승인·적용자: PO(시험)")));
  assert.match(sql, new RegExp(`where sha256 = '${shaOf("v1.cp949.txt")}' and status = 'applied'\\) then`));
  assert.match(sql, /'\{"sido":18,"sigungu":7,"general_gu":2,"sub_district":5\}'::jsonb/);
  // 시·군·구 6행만 넣는다 — 시·도(이미 있음)·일반구(별칭)·하위·폐지 행 0
  const inserted = [...sql.matchAll(/^\s+\('(\d{10})', '(\d{10})', 'sigungu'/gm)].map((m) => m[1]);
  assert.deepEqual(inserted, ["9911000000", "9913000000", "9915000000", "9917000000", "9919000000", "9920000000"]);
  assert.ok(!/9911100000|9911101000|9922000000/.test(sql.split("\n").filter((l) => !l.startsWith("--")).join("\n")));
  assert.match(sql, /\('9911000000', '9900000000', 'sigungu', '가상시', 'gasang-si', array\['가상시 시험구', '시험구', '가상시 모의구', '모의구'\]::text\[\], v_run\)/);
  assert.deepEqual(lintMigrations([{ name: "x.sql", sql }]).errors, []);
});

test("v2 마이그레이션 — 이름·별칭 갱신(slug 칸 없음)·폐지(폐지일·후속)·옛 주소 301, 근거 고시는 머리 주석에", () => {
  const r1 = pipelineFor("v1.utf8.txt");
  const r = pipelineFor("v2.utf8.txt", { current: r1.after, successors: readSuccessors(fs.readFileSync(fix("v2.successors.csv"), "utf8")) });
  const sql = emitMigration({ source: r.source, counts: r.counts, plan: r.plan, approvedBy: "PO(시험)" });
  assert.ok(sql.includes("-- 폐지 9915000000 나구 → 9913000000 (폐지일 2026-06-30 · 근거 시험용 고시 제0000-0호)"));
  assert.match(sql, /\('9917000000', '새예시군', array\['예시', '새예시', '예시군'\]::text\[\]\)/);
  assert.match(sql, /\('9913000000', null::text, array\['시험', '나구'\]::text\[\]\)/);
  assert.match(sql, /\('9915000000', '2026-06-30', '9913000000'\)/);
  assert.match(sql, /\('\/local\/gasang-do\/na-gu', '9913000000', 'retired'\)/);
  assert.ok(!/set[^;]*slug\s*=/.test(sql), "slug는 바꾸지 않는다");
  assert.match(sql, /\('9924000000', '9900000000', 'sigungu', '신규군', 'singyu-gun'/);
});

test("승인자 없으면 만들지 않는다 · 분류 수 합 ≠ 행 수면 오류 · 따옴표가 든 이름도 SQL 글자로 안전", () => {
  const r = pipelineFor("v1.utf8.txt");
  assert.deepEqual(problemsOf(() => emitMigration({ source: r.source, counts: r.counts, plan: r.plan })).map((p) => p.code), ["APPROVAL_MISSING"]);
  assert.deepEqual(problemsOf(() => emitMigration({ source: r.source, counts: r.counts, plan: r.plan, approvedBy: "  " })).map((p) => p.code), ["APPROVAL_MISSING"]);
  assert.throws(() => emitMigration({ source: { ...r.source, rowsTotal: 31 }, counts: r.counts, plan: r.plan, approvedBy: "PO" }), /합\(32\)/);
  const sql = emitMigration({ source: { ...r.source, fileName: "it's.txt" }, counts: r.counts, plan: r.plan, approvedBy: "O'PO" });
  assert.ok(sql.includes("values ('it''s.txt'"));
  assert.ok(sql.includes("'applied', 'O''PO', now()"));
});

test("다음 빈 번호 — 지금 마이그레이션 폴더의 가장 큰 차례 + 1, 이름에 배포일", () => {
  assert.equal(nextMigrationName(["20261018000009_regions.sql", "20261022000039_w4_regions_import.sql", "README.md"], { today: "2026-11-02", fileDate: "2026-10-01" }), "20261102000040_w4_regions_data_20261001.sql");
  assert.equal(nextMigrationName([], { today: "2026-11-02", fileDate: "2026-10-01" }), "20261102000001_w4_regions_data_20261001.sql");
  const real = nextMigrationNameIn(MIGRATIONS_DIR, { today: "2026-11-02", fileDate: "2026-10-01" });
  assert.ok(Number(real.slice(8, 14)) > 39, real);
});

test("명령 — CP949 원본으로 결과 파일 5종 + 승인 뒤 마이그레이션(적용 안 함), 같은 파일 두 번 = 차이 0, v2 차이", () => {
  const out = tmp();
  const base = ["--encoding", "cp949", "--sha256", shaOf("v1.cp949.txt"), "--file-date", "2026-10-01", ...SEEDS];
  const r = runScript(CLI, ["--source", fix("v1.cp949.txt"), "--out", out, ...base, "--emit", "--approved-by", "PO(시험)", "--migration-name", "test_data.sql", "--downloaded-on", "2026-10-02", "--source-url", "시험용 주소"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /added 6 · renamed 0 · retired 0 · unchanged 18/);
  assert.match(r.out, /sido 18 · sigungu 7 · general_gu 2 · sub_district 5 \(전체 32\)/);
  assert.deepEqual(fs.readdirSync(out).sort(), ["derived.json", "region_slugs.review.csv", "regions.after.json", "report.json", "report.md", "test_data.sql"]);
  const derived = JSON.parse(fs.readFileSync(path.join(out, "derived.json"), "utf8"));
  assert.equal(derived.source.sha256, shaOf("v1.cp949.txt"));
  assert.equal(derived.rows.length, 27, "시·도 18 + 시·군·구 7 + 일반구 2 (하위 제외)");
  assert.ok(derived.rows.every((x) => x.row_class !== "sub_district"));
  const report = fs.readFileSync(path.join(out, "report.md"), "utf8");
  assert.match(report, /\| `general_gu` \| 2 \| 0 \| 2 \|/);
  assert.match(report, /접두 `99`\(시험용 가짜 코드 자리\) 행: 15개/);
  assert.match(report, /받은 날 · 받은 곳 \| 2026-10-02 · 시험용 주소/);
  const sql = fs.readFileSync(path.join(out, "test_data.sql"), "utf8");
  assert.ok(sql.includes("-- 받은 날: 2026-10-02 · 받은 곳: 시험용 주소 · 인코딩: cp949"));
  assert.equal(fs.readFileSync(path.join(out, "region_slugs.review.csv"), "utf8").split("\n").filter(Boolean).length, 7);
  // 이미 있는 파일은 덮어쓰지 않는다
  const dup = runScript(CLI, ["--source", fix("v1.cp949.txt"), "--out", out, ...base, "--emit", "--approved-by", "PO(시험)", "--migration-name", "test_data.sql"]);
  assert.equal(dup.code, 2);
  assert.match(dup.out, /덮어쓰지 않습니다/);
  // 같은 파일 두 번 — 적용 뒤 상태를 지금 상태로
  const out2 = tmp();
  const again = runScript(CLI, ["--source", fix("v1.cp949.txt"), "--out", out2, ...base, "--current", path.join(out, "regions.after.json")]);
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /added 0 · renamed 0 · retired 0 · unchanged 24/);
  // v2 — 후속 입력 + 검토 파일 그대로
  const out3 = tmp();
  const v2 = runScript(CLI, ["--source", fix("v2.utf8.txt"), "--out", out3, "--encoding", "utf-8", "--sha256", shaOf("v2.utf8.txt"), "--file-date", "2026-11-01", ...SEEDS,
    "--current", path.join(out, "regions.after.json"), "--successors", fix("v2.successors.csv"), "--slug-review", path.join(out, "region_slugs.review.csv")]);
  assert.equal(v2.code, 1, "v1 검토 파일에는 v2에서 폐지된 9915가 있다 — 이번 원본의 시·군·구가 아닌 코드로 중단(검토 파일은 그 판의 결과로 다시 만든다)");
  assert.match(v2.out, /\[중단\] 5 slug·별칭 · 검토 파일에 이번 원본의 시·군·구가 아닌 코드가 있습니다: 9915000000/);
  const v2ok = runScript(CLI, ["--source", fix("v2.utf8.txt"), "--out", out3, "--encoding", "utf-8", "--sha256", shaOf("v2.utf8.txt"), "--file-date", "2026-11-01", ...SEEDS,
    "--current", path.join(out, "regions.after.json"), "--successors", fix("v2.successors.csv")]);
  assert.equal(v2ok.code, 0, v2ok.out);
  assert.match(v2ok.out, /added 1 · renamed 1 · retired 1 · unchanged 22/);
});

test("명령 — 멈춤은 끝 코드 1 + 차례·조건·줄 번호, 사용법 오류는 2, 멈추면 결과 파일 0", () => {
  const run = (name, extra = []) => {
    const out = tmp();
    const res = runScript(CLI, ["--source", fix(name), "--out", out, "--encoding", "utf-8", "--sha256", shaOf(name), "--file-date", "2026-10-01", ...SEEDS, ...extra]);
    return { ...res, files: fs.readdirSync(out) };
  };
  const code = run("bad-code.txt");
  assert.equal(code.code, 1);
  assert.match(code.out, /\[중단\] 2 읽기 · 코드가 10자리 숫자 아님 — 3번째 줄/);
  assert.match(code.out, /— 4번째 줄/);
  assert.match(code.out, /— 5번째 줄/);
  assert.deepEqual(code.files, []);
  assert.match(run("dup-code.txt").out, /같은 코드 두 번 — 3·5번째 줄/);
  assert.match(run("bad-header.txt").out, /모르는 열 머리 — 1번째 줄/);
  const noHash = runScript(CLI, ["--source", fix("v1.utf8.txt"), "--out", tmp(), "--encoding", "utf-8", "--file-date", "2026-10-01", ...SEEDS]);
  assert.equal(noHash.code, 1);
  assert.match(noHash.out, /1 받기 · 해시 기록 없음/);
  const wrongEnc = runScript(CLI, ["--source", fix("v1.cp949.txt"), "--out", tmp(), "--encoding", "utf-8", "--sha256", shaOf("v1.cp949.txt"), "--file-date", "2026-10-01", ...SEEDS]);
  assert.equal(wrongEnc.code, 1);
  assert.match(wrongEnc.out, /인코딩/);
  const noEnc = runScript(CLI, ["--source", fix("v1.utf8.txt"), "--out", tmp()]);
  assert.equal(noEnc.code, 2);
  const unknownFlag = runScript(CLI, ["--source", fix("v1.utf8.txt"), "--out", tmp(), "--encoding", "utf-8", "--force"]);
  assert.equal(unknownFlag.code, 2);
  const noApproval = run("v1.utf8.txt", ["--emit"]);
  assert.equal(noApproval.code, 1);
  assert.match(noApproval.out, /--approved-by/);
  // 기준 시·도를 씨앗 17만으로(기본값) — 가짜 시·도 가상도는 씨앗에 없다 → 중단
  const seedOnly = runScript(CLI, ["--source", fix("v1.utf8.txt"), "--out", tmp(), "--encoding", "utf-8", "--sha256", shaOf("v1.utf8.txt"), "--file-date", "2026-10-01"]);
  assert.equal(seedOnly.code, 1);
  assert.match(seedOnly.out, /4 검증 · 하나라도 어긋남 — 19번째 줄: 원본의 '존재' 시·도 9900000000 가상도이 씨앗에 없습니다/);
});
