#!/usr/bin/env node
// 유출 대응 리허설 (ENV-04) — 시험(Preview) 환경의 CRON_SECRET으로 절차서(docs/ops/유출대응_절차서.md) 1~6을 실제로 한다.
//   준비: 새 값 S1을 Preview에 넣고 시험 배포 1 → S1로 작업 호출 200 ('유출된 키'가 실제로 쓰이던 상태)
//   1·2·3 폐기·재발급·교체: 새 값 S2로 덮어쓴다 (S1은 그 순간 무효)
//   4 재배포: 시험 배포 2
//   5 이전 키 거부 확인: 배포 2에서 S1 → 401, S2 → 200
//   6 기록: docs/ops/유출대응_리허설_기록.md에 한 줄 + 시험 DB 감사 로그(action secret.rotate)
// 운영(Production) 값은 건드리지 않는다. S1·S2는 이 프로세스 안에서만 쓰고 출력·저장하지 않는다.
// 리허설이 만든 실행 기록(agent_runs)은 시험 DB에서 지운다.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REFS = JSON.parse(fs.readFileSync(path.join(ROOT, "apps", "web", "config", "environments.json"), "utf8")).supabaseRef;
const RECORD = path.join(ROOT, "docs", "ops", "유출대응_리허설_기록.md");
const VC = process.platform === "win32" ? [process.execPath, path.join(process.env.APPDATA ?? "", "npm", "node_modules", "vercel", "dist", "vc.js")] : ["vercel"];

function vercel(args, input) {
  const [cmd, ...pre] = VC;
  const r = spawnSync(cmd, [...pre, ...args], { cwd: ROOT, encoding: "utf8", input });
  return { status: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function setPreviewSecret(value) {
  const r = vercel(["env", "add", "CRON_SECRET", "preview", "--force", "--yes", "--sensitive"], value);
  if (r.status !== 0) throw new Error(`Preview CRON_SECRET 교체 실패 (종료 코드 ${r.status})`);
}

function deployPreview() {
  const r = vercel(["deploy", "--yes"]);
  const url = (r.out.match(/https:\/\/[a-z0-9-]+\.vercel\.app/g) ?? []).pop();
  if (r.status !== 0 || !url) throw new Error(`시험 배포 실패 (종료 코드 ${r.status})`);
  return url;
}

/** 배포 보호를 넘어 작업을 부른다 → { code, runId } */
function callJob(url, secret) {
  const out = path.join(os.tmpdir(), `ltr-rehearsal-${crypto.randomBytes(4).toString("hex")}.json`);
  const r = vercel(["curl", "/api/jobs/scheduler-heartbeat", "--deployment", url, "--", "-s", "-o", out, "-w", "%{http_code}", "-X", "POST", "-H", `Authorization: Bearer ${secret}`]);
  const code = Number((r.out.match(/(\d{3})\s*$/) ?? [])[1]);
  let runId = null;
  try {
    runId = JSON.parse(fs.readFileSync(out, "utf8")).runId ?? null;
  } catch {}
  fs.rmSync(out, { force: true });
  return { code, runId };
}

function stagingSql(sql) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ltr-sql-"));
  const file = path.join(dir, "q.sql");
  fs.writeFileSync(file, sql);
  const r = spawnSync("supabase", ["db", "query", "--linked", "--project-ref", REFS.staging, "-o", "json", "-f", file], {
    cwd: path.join(ROOT, "packages", "db"),
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`시험 DB 기록 실패: ${(r.stderr || "").split("\n").slice(-2).join(" ")}`);
}

const step = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
const started = new Date();
const runIds = [];

step("준비 — 새 값 S1을 Preview에 넣는다");
const s1 = crypto.randomBytes(32).toString("hex");
setPreviewSecret(s1);
step("준비 — 시험 배포 1");
const url1 = deployPreview();
const before = callJob(url1, s1);
if (before.runId) runIds.push(before.runId);
step(`준비 확인 — 배포 1에서 S1로 호출: ${before.code}`);
if (before.code !== 200) throw new Error("준비 단계에서 S1 호출이 200이 아니다 — 리허설을 멈춘다");

step("1·2·3 폐기·재발급·교체 — 새 값 S2로 덮어쓴다");
const s2 = crypto.randomBytes(32).toString("hex");
setPreviewSecret(s2);
step("4 재배포 — 시험 배포 2");
const url2 = deployPreview();
const oldKey = callJob(url2, s1);
const newKey = callJob(url2, s2);
if (newKey.runId) runIds.push(newKey.runId);
step(`5 이전 키 거부 확인 — 배포 2에서 S1: ${oldKey.code}, S2: ${newKey.code}`);
const passed = (oldKey.code === 401 || oldKey.code === 403) && newKey.code === 200;

const finished = new Date();
const result = passed ? "성공" : "실패";
const scope = "Preview(시험) 환경 CRON_SECRET — 운영·사용자 영향 없음";
step("6 기록 — 시험 DB 감사 로그와 리허설 기록");
const detail = JSON.stringify({ deployment1: url1, deployment2: url2, oldKey: oldKey.code, newKey: newKey.code, result });
stagingSql(
  `insert into public.audit_logs (actor, action, target, after, reason) values ('ops:claude (PO admin@sunmyung.kr 지시)', 'secret.rotate', 'vercel:preview:CRON_SECRET', '${detail.replaceAll("'", "''")}'::jsonb, '유출 대응 리허설 (ENV-04) — ${result}');` +
    (runIds.length ? `\ndelete from public.agent_runs where id in (${runIds.map(Number).join(",")});` : ""),
);
const header = "| 시각(UTC) | 담당자 | 대상(영향 범위) | 조치 | 이전 키 요청 | 새 키 요청 | 결과 |\n|---|---|---|---|---|---|---|\n";
if (!fs.existsSync(RECORD)) {
  fs.writeFileSync(RECORD, `# 유출 대응 리허설 기록 (ENV-04)\n\n절차는 docs/ops/유출대응_절차서.md, 실행은 scripts/ops/rehearse-secret-rotation.mjs. 값은 적지 않는다.\n\n${header}`);
}
fs.appendFileSync(
  RECORD,
  `| ${started.toISOString()} ~ ${finished.toISOString()} | Claude (PO 지시) | ${scope} | 폐기·재발급(덮어쓰기) → Preview 재배포(${url2}) → 이전 키 거부 확인 → 감사 로그 secret.rotate | ${oldKey.code} | ${newKey.code} | ${result} |\n`,
);
step(`리허설 ${result}`);
process.exit(passed ? 0 : 1);
