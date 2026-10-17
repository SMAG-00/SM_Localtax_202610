// DS-01 색 토큰 — PRD-00 8.3 표(문서)와 코드·CSS 값이 모두 같고, 대비 규칙이 실제 계산과 맞는다.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { colors, contrastRatio } from "../src/tokens.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..", "..");
const PRD00 = fs.readdirSync(path.join(ROOT, "docs", "PRD")).find((f) => f.startsWith("PRD-00"));
const doc = fs.readFileSync(path.join(ROOT, "docs", "PRD", PRD00), "utf8");
const section = doc.slice(doc.indexOf("### 8.3 색 토큰"), doc.indexOf("### 8.4"));
const css = fs.readFileSync(path.join(HERE, "..", "src", "theme.css"), "utf8");

/** 문서 표의 | navy-50 | `#EEF3F8` | ... | 행 */
const docTokens = Object.fromEntries(
  [...section.matchAll(/^\| ((?:navy|hermes)-\d{2,3}|ivory(?:-dark)?) \| `(#[0-9A-Fa-f]{6})` \|/gm)].map((m) => [m[1], m[2].toUpperCase()]),
);

test("문서 표에 토큰 22개(navy 10 · hermes 10 · ivory · ivory-dark)가 있다", () => {
  assert.equal(Object.keys(docTokens).length, 22);
});

test("코드 토큰(src/tokens.ts) 22개가 문서 값과 모두 같다", () => {
  assert.deepEqual(colors, docTokens);
});

test("Tailwind 테마(src/theme.css)의 색 변수 22개가 문서 값과 모두 같다", () => {
  const cssTokens = Object.fromEntries(
    [...css.matchAll(/--color-((?:navy|hermes)-\d{2,3}|ivory(?:-dark)?):\s*(#[0-9A-Fa-f]{6});/g)].map((m) => [m[1], m[2].toUpperCase()]),
  );
  assert.deepEqual(cssTokens, docTokens);
});

test("WCAG 대비 계산 — 검은 글자/흰 바탕 21:1, 같은 색 1:1", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#FFFFFF") * 10) / 10, 21);
  assert.equal(contrastRatio("#F26A1B", "#F26A1B"), 1);
});

// 문서의 대비 표에서 우리 토큰(+흰 글자)만으로 된 줄을 읽어, 적힌 값과 판정을 실제 계산과 맞춘다
const colorOf = (name) => (name === "흰 글자" || name === "흰 바탕" ? "#FFFFFF" : docTokens[name]);
const contrastRows = [...section.matchAll(/^\| (?:\[.\] 칩: )?([a-z]+-?[a-z0-9]*|흰 글자) (?:글자 )?\/ ([a-z]+-?[a-z0-9]*|흰 바탕)(?: 바탕)? \| ([\d.]+):1 \| (사용|금지)/gm)]
  .map((m) => ({ fg: m[1], bg: m[2], ratio: Number(m[3]), verdict: m[4] }))
  .filter((r) => colorOf(r.fg) && colorOf(r.bg));

test("대비 표에서 토큰 조합 9줄 이상을 읽었다", () => {
  assert.ok(contrastRows.length >= 9, JSON.stringify(contrastRows));
});

for (const r of contrastRows) {
  test(`대비 ${r.fg} / ${r.bg} — 문서 ${r.ratio}:1 (${r.verdict})이 계산과 맞다`, () => {
    const actual = contrastRatio(colorOf(r.fg), colorOf(r.bg));
    assert.ok(Math.abs(actual - r.ratio) <= 0.15, `계산 ${actual.toFixed(2)}:1, 문서 ${r.ratio}:1`);
    if (r.verdict === "사용") assert.ok(actual >= 4.5, `사용인데 4.5 미만 (${actual.toFixed(2)})`);
    if (r.verdict === "금지") assert.ok(actual < 4.5, `금지인데 4.5 이상 (${actual.toFixed(2)})`);
  });
}
