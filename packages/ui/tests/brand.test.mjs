// DS-03 — 명칭 문자열은 설정 파일 한 곳(packages/ui/src/brand.ts)에만 있다. 'SM 플랫폼'처럼 두 이름을 섞은 표현 0.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { brand } from "../src/brand.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const files = execFileSync("git", ["-C", ROOT, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "apps", "packages", "workflows"], { encoding: "utf8" })
  .split("\0")
  .filter((f) => /\.(ts|tsx|js|jsx|mjs|css)$/.test(f) && !/(^|\/)(tests|__tests__)\//.test(f))
  // 지웠지만 아직 커밋하지 않은 파일은 건너뛴다 (scripts/check-design.mjs와 같은 규칙)
  .filter((f) => fs.existsSync(path.join(ROOT, f)));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("제품명·워드마크 값이 비어 있지 않다", () => {
  assert.ok(brand.productName.length > 0);
  assert.ok(brand.wordmark.lead.length > 0 && brand.wordmark.tail.length > 0);
});

test("사이트 이름은 「김의효 지방세연구」, 워드마크는 앞뒤 낱말을 띄어쓰기로 이은 같은 글자, 운영 주체는 따로 SM(선명) (PO 결정 2026-10-24)", () => {
  assert.equal(brand.productName, "김의효 지방세연구");
  assert.equal(`${brand.wordmark.lead} ${brand.wordmark.tail}`, brand.productName);
  assert.ok(!/[·]/.test(brand.productName));
  assert.equal(brand.operatorName, "SM(선명)");
  assert.notEqual(brand.operatorName, brand.productName);
});

test("제품명 문자열이 brand.ts 한 곳에만 있다", () => {
  const hits = files.filter((f) => read(f).includes(brand.productName));
  assert.deepEqual(hits, ["packages/ui/src/brand.ts"]);
});

test("화면 코드에 'SM 플랫폼'처럼 두 이름을 섞은 표현이 없다", () => {
  const hits = files.filter((f) => /SM 플랫폼/.test(read(f)));
  assert.deepEqual(hits, []);
});

test("기존 계산기 사이트 이름은 'SM 부동산 세금 플랫폼'으로 따로 둔다", () => {
  assert.equal(brand.smCalculatorSiteName, "SM 부동산 세금 플랫폼");
  assert.notEqual(brand.wordmark.tail, "부동산 세금");
});
