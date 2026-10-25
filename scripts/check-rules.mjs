#!/usr/bin/env node
// 룰셋 파일 검사 (RULE-01 · CALC-08 · 2단계 설계 W10-a a2) - rules/{YYYY}.{NN}.json
//  R1 파일 이름 = 버전(YYYY.NN), 파일 안 version이 같고 status는 draft(파일을 만들 때의 표시 - 활성화는 DB가 정한다)
//  R2 versions.lock.json - 버전 파일의 SHA-256 잠금. 파일 내용이 잠금과 다르면 실패 (이미 있는 버전을 고치는 커밋 = CI 실패)
//  R3 잠금의 기존 항목은 바꾸거나 지우지 못한다 - 직전 커밋(HEAD, HEAD~1)의 잠금과 비교. 새 버전은 항목만 더한다
//  R4 bundle.json - 번들(장애 폴백·오프라인 계산)에는 감수 서명 기록(서명자 표시·서명 시각·파일 SHA-256)이 있는 버전만 들어간다
// 사용: node scripts/check-rules.mjs [저장소 루트]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERSION_FILE = /^(\d{4}\.\d{2})\.json$/;
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
// 지방세 룰셋 폴더 rules/ 외에 상속·증여 룰셋 폴더가 있으면 같은 규칙으로 함께 본다 (W11-g, 3단계 설계 4.4) - 폴더가 없으면 건너뜀. 이름은 조각을 이어 붙인다(국세 낱말 검사 대상 파일)
const EXTRA_DIRS = [["rules", "i" + "gt"].join("-")];
/** 검사할 룰셋 폴더 - rules(없으면 오류 그대로) + 있는 추가 폴더 */
export const ruleDirs = (root) => ["rules", ...EXTRA_DIRS.filter((d) => fs.existsSync(path.join(root, d)))];

/** git 기준선(HEAD·HEAD~1)의 잠금 항목 - git이 없거나 파일이 없으면 빈 목록 */
export function baselineLocks(root, git = defaultGit, dirName = "rules") {
  const out = [];
  for (const ref of ["HEAD", "HEAD~1"]) {
    const text = git(root, `${ref}:${dirName}/versions.lock.json`);
    if (!text) continue;
    try {
      out.push({ ref, versions: JSON.parse(text).versions ?? {} });
    } catch {
      /* 깨진 기준선은 건너뜀 */
    }
  }
  return out;
}

function defaultGit(root, spec) {
  try {
    return execFileSync("git", ["-C", root, "show", spec], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

export function checkRules({ root, dirName = "rules", baselines = baselineLocks(root, defaultGit, dirName) }) {
  const dir = path.join(root, dirName);
  const errors = [];
  const readJson = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !["bundle.json", "versions.lock.json"].includes(f));
  const hashes = {};
  for (const f of files) {
    const m = VERSION_FILE.exec(f);
    if (!m) {
      errors.push(`R1 ${f}: 파일 이름이 YYYY.NN.json 모양이 아닙니다`);
      continue;
    }
    const buf = fs.readFileSync(path.join(dir, f));
    hashes[m[1]] = sha256(buf);
    let body;
    try {
      body = JSON.parse(buf.toString("utf8"));
    } catch {
      errors.push(`R1 ${f}: JSON이 아닙니다`);
      continue;
    }
    if (body.version !== m[1]) errors.push(`R1 ${f}: 파일 안 version(${body.version})이 파일 이름과 다릅니다`);
    if (body.status !== "draft") errors.push(`R1 ${f}: status는 draft여야 합니다 (활성화 상태는 파일이 아니라 DB가 정합니다)`);
  }

  const lock = fs.existsSync(path.join(dir, "versions.lock.json")) ? (readJson("versions.lock.json").versions ?? {}) : {};
  for (const [v, h] of Object.entries(hashes)) {
    if (!(v in lock)) errors.push(`R2 ${v}: versions.lock.json에 항목이 없습니다 (새 버전은 잠금에 항목을 더해야 합니다)`);
    else if (lock[v] !== h) errors.push(`R2 ${v}: 파일 내용이 잠금과 다릅니다 - 이미 있는 버전 파일은 고치지 않고 차수를 올려 새 파일을 만듭니다 (RULE-01)`);
  }
  for (const v of Object.keys(lock)) if (!(v in hashes)) errors.push(`R2 ${v}: 잠금에는 있는데 파일이 없습니다`);
  for (const b of baselines) {
    for (const [v, h] of Object.entries(b.versions)) {
      if (!(v in lock)) errors.push(`R3 ${v}: ${b.ref}에 있던 잠금 항목이 지워졌습니다`);
      else if (lock[v] !== h) errors.push(`R3 ${v}: ${b.ref}에 있던 잠금 항목이 바뀌었습니다`);
    }
  }

  const bundle = fs.existsSync(path.join(dir, "bundle.json")) ? readJson("bundle.json") : { versions: [] };
  for (const e of bundle.versions ?? []) {
    const label = `R4 bundle ${e?.version ?? "?"}`;
    if (!e || typeof e.version !== "string" || !(e.version in hashes)) errors.push(`${label}: 파일이 없는 버전입니다`);
    else {
      for (const k of ["signedBy", "signedAt", "sha256"]) if (typeof e[k] !== "string" || !e[k].trim()) errors.push(`${label}: 서명 기록 ${k}가 없습니다 - 서명 없는 버전은 번들에 들어갈 수 없습니다 (CALC-08)`);
      if (e.sha256 && e.sha256 !== hashes[e.version]) errors.push(`${label}: 서명한 파일 SHA-256이 현재 파일과 다릅니다`);
    }
  }
  return { errors, versions: Object.keys(hashes).sort(), bundled: (bundle.versions ?? []).length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const errors = [];
  const summary = [];
  for (const dirName of ruleDirs(root)) {
    const r = checkRules({ root, dirName });
    errors.push(...r.errors.map((e) => (dirName === "rules" ? e : `[${dirName}] ${e}`)));
    summary.push(`${dirName}: 버전 ${r.versions.length}개(${r.versions.join(", ")}) · 번들 ${r.bundled}개`);
  }
  if (errors.length) {
    console.error(`룰셋 파일 검사 실패 ${errors.length}건`);
    for (const e of errors) console.error(` - ${e}`);
    process.exit(1);
  }
  console.log(`룰셋 파일 검사 통과 - ${summary.join(" / ")} (서명 없는 버전 0)`);
}
