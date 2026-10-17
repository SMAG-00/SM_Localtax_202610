#!/usr/bin/env node
// 디자인 린트 (PRD-00 8.2·8.3)
//  DS-01  화면 코드에 색 hex 직접 사용 0 (토큰 파일만 허용) · 흰 글자 + hermes-500 바탕 금지 (대비 3.1:1)
//  UX-04  이모지 아이콘 0 (픽토그램 세트만 — R11)
//  R5     그라데이션은 허용 파일(SM 네이비 그라데이션 컴포넌트)에서만
//  R6     임의 그림자 shadow-[...]는 허용 목록 3종만
// 규칙: scripts/design-rules.json · 사용: node scripts/check-design.mjs [저장소 루트]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const CODE_EXT = /\.(tsx|ts|jsx|js|mjs|css)$/;
const SKIP = /(^|\/)(node_modules|\.next|tests|__tests__)(\/|$)/;
// 따옴표·공백·괄호·콜론 등 뒤에 오는 #hex (HTML 엔티티 &#160;·URL 조각 /news#x는 제외)
const HEX = /(?<=["'`\s[(:,=])#[0-9a-fA-F]{3,8}(?![0-9A-Za-z_-])/g;
const STRINGS = /"[^"\n]*"|'[^'\n]*'|`[^`]*`/g;
const EMOJI = /\p{Extended_Pictographic}/u;
const NOT_EMOJI = new Set(["©", "®", "™"]);
const GRADIENT = /(?:^|[\s"'`:])((?:[a-z-]+:)*bg-(?:gradient|linear|radial|conic)-[^\s"'`]*)/g;
const SHADOW = /(?:^|[\s"'`])(?:[a-z-]+:)*(shadow-\[[^\]\s]+\])/g;

function files(root, dirs) {
  return execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...dirs], { encoding: "utf8" })
    .split("\0")
    .filter((f) => f && CODE_EXT.test(f) && !SKIP.test(f));
}

export function checkDesign({ root }) {
  const rules = JSON.parse(fs.readFileSync(path.join(root, "scripts", "design-rules.json"), "utf8"));
  const errors = [];
  for (const f of files(root, rules.scan)) {
    const full = path.join(root, f);
    if (!fs.existsSync(full)) continue;
    const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      const at = `${f}:${i + 1}`;
      if (!rules.hexAllowed.includes(f) && line.match(HEX)) errors.push(`${at} 색 hex를 직접 썼다 (${line.match(HEX)[0]}) — packages/ui 토큰 클래스를 쓴다 (DS-01)`);
      for (const s of line.match(STRINGS) ?? []) {
        if (/(^|[\s"'`])bg-hermes-500(?![\w/-])/.test(s) && /(^|[\s"'`])text-white(?![\w/-])/.test(s))
          errors.push(`${at} 흰 글자 + hermes-500 바탕 — 대비 3.1:1로 금지, 주 버튼 글자는 navy-900 (DS-01·8.3)`);
      }
      for (const ch of line) {
        if (EMOJI.test(ch) && !NOT_EMOJI.has(ch)) {
          errors.push(`${at} 이모지 '${ch}' — 아이콘은 픽토그램 세트만 쓴다 (UX-04·R11)`);
          break;
        }
      }
      if (!rules.gradientAllowed.includes(f)) {
        for (const m of line.matchAll(GRADIENT)) errors.push(`${at} 그라데이션 ${m[1]} — 허용 파일(헤더·히어로·바닥글·전문가 안내 카드) 밖 (R5)`);
      }
      for (const m of line.matchAll(SHADOW)) {
        if (!rules.shadowAllowed.includes(m[1])) errors.push(`${at} 임의 그림자 ${m[1]} — 허용 목록 3종 밖 (R6)`);
      }
    });
  }
  return { errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const r = checkDesign({ root });
  if (r.errors.length) {
    console.error(`디자인 린트 실패 ${r.errors.length}건`);
    for (const e of r.errors) console.error(` - ${e}`);
    process.exit(1);
  }
  console.log("디자인 린트 통과 — hex 직접 사용 0 · 흰 글자/hermes-500 0 · 이모지 0 · 그라데이션·그림자 허용 범위 안");
}
