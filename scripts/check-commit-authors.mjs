#!/usr/bin/env node
// 커밋 작성자 검사 (FND-01) — 저장소의 모든 커밋 작성자 이메일이 새 플랫폼 계정이다 (SM 계정 0).
// 허용 목록: scripts/commit-authors.json — authors(작성자), committers(커미터 — GitHub 웹 병합의 noreply@github.com 포함)
// 사용: node scripts/check-commit-authors.mjs [저장소 루트]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(fs.readFileSync(path.join(root, "scripts", "commit-authors.json"), "utf8"));
const lower = (list) => new Set(list.map((e) => e.toLowerCase()));
const authors = lower(config.authors);
const committers = lower(config.committers);

let log = "";
try {
  log = execFileSync("git", ["-C", root, "log", "--format=%h%x09%ae%x09%ce%x09%s"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (err) {
  // 커밋이 하나도 없는 저장소
  if (!/does not have any commits|bad default revision/.test(String(err.stderr))) throw err;
}
const commits = log.split("\n").filter(Boolean).map((l) => l.split("\t"));
const bad = [];
for (const [hash, author, committer, subject] of commits) {
  if (!authors.has(author.toLowerCase())) bad.push(`${hash} 작성자 ${author} — ${subject}`);
  if (!committers.has(committer.toLowerCase())) bad.push(`${hash} 커미터 ${committer} — ${subject}`);
}
if (bad.length) {
  console.error(`커밋 작성자 검사 실패 ${bad.length}건 — 허용: ${config.authors.join(", ")} (scripts/commit-authors.json)`);
  for (const b of bad) console.error(` - ${b}`);
  process.exit(1);
}
console.log(`커밋 작성자 검사 통과 — 커밋 ${commits.length}개, 모두 허용된 계정`);
