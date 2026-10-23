#!/usr/bin/env node
// 화면 고정 문구 숫자 검사 (W4 설계 2.12 · 1장 19단계 — PRD-01B PR-10 '숫자 요건은 dev_method_facts에서').
// 대상: apps/web/app/(site)/realestate/** 와 apps/web/components/site/ 중 개발방법·상속·증여·프로젝트 화면 소스(시험 파일 제외)의 글자.
// 잡는 것: 숫자 + 요건 단위(% · 퍼센트 · ㎡ · 평 · 개월 · 세대 · 분의 · 일 이내 · 년 이내/이상… · 만원/억), 기한·공제·세율·감면 낱말 옆 숫자.
// 잡지 않는 것: 차례 번호·`360px` 같은 화면 값·연도만 있는 날짜 서식·주석·Tailwind 값(`w-[50%]`). 숫자 요건은 dev_method_facts(서명 + 기준일), 세율·공제·기한은 감수된 기사에서만 나온다.
// 사용: node scripts/check-fixed-numbers.mjs [저장소 루트]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 검사 대상 경로 (슬래시 경로) */
export function isTarget(rel) {
  if (!/\.(tsx?|jsx?)$/.test(rel) || /\.(test|itest|spec)\./.test(rel)) return false;
  if (/^apps\/web\/app\/\(site\)\/realestate\//.test(rel)) return true;
  const m = /^apps\/web\/components\/site\/([^/]+)$/.exec(rel);
  return m !== null && /^(DevMethod|Inheritance|Gift|Project)/.test(m[1]);
}

const UNIT = /\d[\d,.]*\s*(?:%|％|퍼센트|㎡|제곱미터|평(?![가균일등])|개월|세대|분의|일\s*이내|년\s*(?:이내|이상|이하|미만|초과)|만\s*원|억\s*원|천\s*원)/;
const KEYWORD = /(?:세율|공제|기한|감면|한도|납부기한|신고기한)[^\n]{0,12}\d/;
// 연도만 있는 날짜 서식(예 2026년)은 단위 '년'을 단독으로 쓰지 않으므로 UNIT에 걸리지 않는다.

/** 주석·Tailwind 값 제거 (줄 수는 그대로) */
export function stripNoise(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`])\/\/.*$/, "$1").replace(/[A-Za-z0-9_:!-]+-\[[^\]]*\]/g, " "))
    .join("\n");
}

export function scanSource(src) {
  const hits = [];
  stripNoise(src)
    .split("\n")
    .forEach((line, i) => {
      const m = UNIT.exec(line) ?? KEYWORD.exec(line);
      if (m) hits.push({ line: i + 1, text: m[0].trim() });
    });
  return hits;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const files = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .filter(isTarget);
  const found = [];
  for (const f of files) {
    const full = path.join(root, f);
    if (!fs.existsSync(full)) continue;
    for (const h of scanSource(fs.readFileSync(full, "utf8"))) found.push(`${f}:${h.line} 고정 문구에 숫자 요건 '${h.text}'`);
  }
  if (found.length) {
    console.error(`화면 고정 문구 숫자 검사 실패 ${found.length}건 — 숫자 요건은 서명된 DB 값(dev_method_facts)에서 와야 합니다`);
    for (const h of found) console.error(` - ${h}`);
    process.exit(1);
  }
  console.log(`화면 고정 문구 숫자 검사 통과 — 대상 파일 ${files.length}개`);
}
