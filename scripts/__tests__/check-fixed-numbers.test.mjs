// W4 2.12 — 화면 고정 문구에 숫자 요건이 없다. 위반 견본을 넣으면 실제로 잡고, 연도 날짜·화면 값·주석·시험 파일은 잡지 않는다.
// 견본 숫자는 검사가 잡는지 보려는 가짜 값이다(실제 요건 아님).
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempRepo, runScript } from "./helpers.mjs";
import { scanSource, isTarget } from "../check-fixed-numbers.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "check-fixed-numbers.mjs");
const VIEW = "apps/web/components/site/DevMethodsView.tsx";
const clean = { [VIEW]: 'export const A = () => <p className="w-[50%] mt-6 text-[17px]">숫자 요건은 근거 조문과 기준일과 함께 보입니다. 2026년 기준, 360px 화면.</p>;\n' };

test("깨끗한 소스는 통과 (연도 날짜·화면 값·Tailwind 값은 잡지 않는다)", () => {
  const repo = tempRepo(clean);
  const r = runScript(SCRIPT, [repo.dir]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /대상 파일 1개/);
});

test("숫자 요건을 넣은 견본 파일은 실제로 잡고 파일·줄을 알린다", () => {
  const repo = tempRepo({ ...clean, "apps/web/app/(site)/realestate/development-methods/x.tsx": 'export const B = () => <p>\n  동의율 75% 이상이어야 합니다.\n</p>;\n' });
  const r = runScript(SCRIPT, [repo.dir]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /development-methods\/x\.tsx:2 .*75%/);
});

test("단위별로 잡는다 — 퍼센트·㎡·평·개월·세대·일 이내·년 이내·분의", () => {
  for (const s of ["80퍼센트", "100㎡", "30평", "6개월", "300세대", "30일 이내", "3년 이내", "3분의 2"]) {
    assert.equal(scanSource(`const t = "${s}";`).length, 1, s);
  }
});

test("세율·공제·기한 낱말 옆 숫자를 잡는다", () => {
  assert.equal(scanSource('const t = "취득세율 3 적용";').length, 1);
  assert.equal(scanSource('const t = "신고기한은 60";').length, 1);
});

test("잡지 않는다 — 연도만 있는 날짜·차례 번호·px 값·주석", () => {
  assert.equal(scanSource('const t = "2026년 10월 기준";').length, 0);
  assert.equal(scanSource("const n = i + 1; const w = 360; // 동의 75% 주석\n").length, 0);
  assert.equal(scanSource('/* 동의 75% 이상 */\nconst a = "x";').length, 0);
  assert.equal(scanSource('<div className="w-[50%] lg:grid-cols-[1fr_2fr]" />').length, 0);
});

test("대상 파일 범위 — 개발방법·프로젝트 화면과 realestate 라우트만, 시험 파일·다른 화면은 제외", () => {
  assert.equal(isTarget("apps/web/components/site/DevMethodsView.tsx"), true);
  assert.equal(isTarget("apps/web/components/site/ProjectView.tsx"), true);
  assert.equal(isTarget("apps/web/app/(site)/realestate/development-methods/page.tsx"), true);
  assert.equal(isTarget("apps/web/components/site/DevMethodsView.test.tsx"), false);
  assert.equal(isTarget("apps/web/components/site/SupplyView.tsx"), false);
  assert.equal(isTarget("apps/web/lib/server/public/dev-methods-logic.ts"), false);
});

test("대상이 아닌 파일의 숫자는 보지 않는다", () => {
  const repo = tempRepo({ ...clean, "apps/web/lib/other.ts": 'export const x = "동의 75% 이상";\n' });
  const r = runScript(SCRIPT, [repo.dir]);
  assert.equal(r.code, 0, r.out);
});
