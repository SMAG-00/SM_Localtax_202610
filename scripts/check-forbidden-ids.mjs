#!/usr/bin/env node
// SM 플랫폼 식별자 차단 (FND-05) — SM의 Supabase 프로젝트 ref·Vercel 프로젝트 ID·저장소 주소가
// 커밋 대상 파일(코드·설정)에 없는지 검사한다. 금지 목록은 CI 비밀값 FORBIDDEN_IDENTIFIERS(쉼표·공백·줄바꿈 구분)로만 받는다.
// 실패 메시지에는 파일·줄과 목록 번호만 적고 금지 값 자체는 찍지 않는다. SM 계산기 공개 링크 주소는 목록 대상이 아니다.
// 사용: FORBIDDEN_IDENTIFIERS=... node scripts/check-forbidden-ids.mjs [저장소 루트]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MAX_BYTES = 2 * 1024 * 1024;
const root = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const list = (process.env.FORBIDDEN_IDENTIFIERS ?? "")
  .split(/[,\s]+/)
  .map((s) => s.trim())
  .filter(Boolean);

if (!list.length) {
  if (process.env.CI) {
    console.error("금지 목록이 없습니다 — CI 비밀값 FORBIDDEN_IDENTIFIERS를 설정해야 합니다 (FND-05). 검사를 건너뛰지 않고 실패합니다.");
    process.exit(3);
  }
  console.log("경고 — 금지 목록(FORBIDDEN_IDENTIFIERS)이 없습니다. 로컬에서는 이 검사를 건너뜀 (CI에서는 실패)");
  process.exit(0);
}

const files = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const hits = [];
for (const f of files) {
  const full = path.join(root, f);
  if (!fs.existsSync(full) || fs.statSync(full).size > MAX_BYTES) continue;
  const buf = fs.readFileSync(full);
  if (buf.includes(0)) continue; // 바이너리
  buf
    .toString("utf8")
    .split(/\r?\n/)
    .forEach((line, i) => {
      list.forEach((id, n) => {
        if (line.includes(id)) hits.push(`${f}:${i + 1} 금지 식별자 #${n + 1}`);
      });
    });
}

if (hits.length) {
  console.error(`SM 플랫폼 식별자 검사 실패 ${hits.length}건 (값은 표시하지 않음)`);
  for (const h of hits) console.error(` - ${h}`);
  process.exit(1);
}
console.log(`SM 플랫폼 식별자 검사 통과 — 파일 ${files.length}개, 금지 목록 ${list.length}개`);
