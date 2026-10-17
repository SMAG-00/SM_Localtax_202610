// 디자인 린트 — DS-01(hex 직접 사용 0 · 흰 글자/hermes-500 금지) · UX-04/R11(이모지 0) · R5(그라데이션 허용 파일) · R6(그림자 허용 목록)
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempRepo, runScript } from "./helpers.mjs";
import { checkDesign } from "../check-design.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "check-design.mjs");
const RULES = {
  scan: ["apps/web/app", "apps/web/components", "packages/ui/src"],
  hexAllowed: ["packages/ui/src/tokens.ts", "packages/ui/src/theme.css"],
  gradientAllowed: ["packages/ui/src/components/Hero.tsx"],
  shadowAllowed: ["shadow-[0_8px_24px_rgba(6,24,42,0.08)]"],
};
const ok = (over = {}) =>
  checkDesign({
    root: tempRepo({
      "scripts/design-rules.json": RULES,
      "packages/ui/src/tokens.ts": 'export const c = { navy: "#06182A" };\n',
      "packages/ui/src/theme.css": "@theme { --color-navy-900: #06182A; }\n",
      "apps/web/app/page.tsx": 'export default () => <main className="bg-ivory text-navy-900"><p>안녕</p></main>;\n',
      ...over,
    }).dir,
  });

test("규칙을 지킨 저장소는 오류 0 (토큰 파일의 hex는 허용)", () => {
  assert.deepEqual(ok().errors, []);
});

for (const [label, code] of [
  ["클래스 안 hex", 'export const A = () => <div className="bg-[#F26A1B]" />;'],
  ["style 속성 hex", 'export const A = () => <div style={{ color: "#06182a" }} />;'],
  ["CSS 파일 hex", ".x { color: #fff; }"],
]) {
  test(`DS-01 — ${label}는 오류`, () => {
    const file = label.startsWith("CSS") ? "apps/web/app/x.css" : "apps/web/app/x.tsx";
    const r = ok({ [file]: code + "\n" });
    assert.ok(r.errors.some((e) => e.includes(file) && /hex/.test(e)), r.errors.join("\n"));
  });
}

test("DS-01 — HTML 엔티티(&#160;)·URL 조각(#section)은 hex가 아니다", () => {
  const r = ok({ "apps/web/app/y.tsx": 'export const A = () => <a href="/news#related">관련&#160;기사</a>;\n' });
  assert.deepEqual(r.errors, []);
});

test("DS-01 — 흰 글자 + hermes-500 바탕 조합은 오류 (대비 3.1:1)", () => {
  const r = ok({ "apps/web/app/b.tsx": 'export const B = () => <button className="bg-hermes-500 text-white">시작</button>;\n' });
  assert.ok(r.errors.some((e) => e.includes("apps/web/app/b.tsx") && /hermes-500/.test(e)), r.errors.join("\n"));
});

test("DS-01 — 주 버튼 조합(navy-900 글자 + hermes-500 바탕)은 통과", () => {
  const r = ok({ "apps/web/app/b.tsx": 'export const B = () => <button className="bg-hermes-500 text-navy-900">시작</button>;\n' });
  assert.deepEqual(r.errors, []);
});

test("UX-04·R11 — 화면 코드에 이모지가 있으면 오류", () => {
  const r = ok({ "apps/web/app/e.tsx": 'export const E = () => <span>🧮 계산기</span>;\n' });
  assert.ok(r.errors.some((e) => e.includes("apps/web/app/e.tsx") && /이모지/.test(e)), r.errors.join("\n"));
});

test("UX-04 — 한글·가운뎃점·화살표 같은 일반 문자는 이모지가 아니다", () => {
  const r = ok({ "apps/web/app/k.tsx": 'export const K = () => <span>SM(선명) · 지방세 → 자세히 ※ 확인 ①</span>;\n' });
  assert.deepEqual(r.errors, []);
});

test("R5 — 허용 파일 밖의 bg-gradient-*·bg-linear-*는 오류, 허용 파일은 통과", () => {
  const r = ok({
    "apps/web/app/g.tsx": 'export const G = () => <section className="bg-linear-to-b from-navy-800 to-navy-900" />;\n',
    "packages/ui/src/components/Hero.tsx": 'export const H = () => <section className="bg-gradient-to-b from-navy-700 to-navy-900" />;\n',
  });
  assert.equal(r.errors.length, 1, r.errors.join("\n"));
  assert.ok(r.errors[0].includes("apps/web/app/g.tsx"));
});

test("R6 — 허용 목록 밖의 임의 그림자 shadow-[...]는 오류, 허용 값은 통과", () => {
  const r = ok({
    "apps/web/app/s.tsx": 'export const S = () => <div className="shadow-[0_0_40px_rgba(242,106,27,0.6)]" />;\n',
    "apps/web/app/t.tsx": 'export const T = () => <div className="hover:shadow-[0_8px_24px_rgba(6,24,42,0.08)]" />;\n',
  });
  assert.equal(r.errors.length, 1, r.errors.join("\n"));
  assert.ok(r.errors[0].includes("apps/web/app/s.tsx"));
});

test("시험 파일(*.test.tsx)은 보지 않는다 — '별점 ★이 없어야 한다' 같은 금지 견본을 담는다", () => {
  const r = ok({ "packages/ui/src/components/x/people.test.tsx": 'expect(screen.queryByText("★")).toBeNull(); const c = "#06182A";\n' });
  assert.deepEqual(r.errors, []);
});

test("시험 파일이 아닌 같은 폴더의 화면 코드는 그대로 본다", () => {
  const r = ok({ "packages/ui/src/components/x/People.tsx": 'export const P = () => <span>★ 4.9</span>;\n' });
  assert.ok(r.errors.some((e) => e.includes("People.tsx") && /이모지/.test(e)), r.errors.join("\n"));
});

test("검사 범위(scan) 밖 파일은 보지 않는다", () => {
  const r = ok({ "e2e/fixture.tsx": 'export const F = () => <div className="bg-[#000]">🧮</div>;\n' });
  assert.deepEqual(r.errors, []);
});

test("저장소 전체 — 스크립트가 종료 코드 0", () => {
  const r = runScript(SCRIPT, [], { cwd: ROOT });
  assert.equal(r.code, 0, r.out);
});
