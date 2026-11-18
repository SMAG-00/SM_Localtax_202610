#!/usr/bin/env node
// 편집위원 데스크 작업기 (PO 2026-11-18) — 웹 '편집위원' 메뉴의 제작 요청을 가져와 프로젝트 지침 v4대로 끝까지 만들고 결과물을 올린다.
// 지금은 PO PC에서 돌린다(Claude 구독 로그인 + OpenAI 키가 그 PC에 있음). 사내 서버로 옮기면 같은 파일을 서버에서 돌린다 —
// 실행 위치에 묶이는 값은 모두 환경변수다(아래). 서버에서는 claude 명령이 ANTHROPIC_API_KEY로 로그인하게 하면 된다.
//
// 사용:
//   node scripts/editorial-desk/worker.mjs            대기열을 계속 확인 (기본 20초마다, Ctrl+C로 멈춤)
//   node scripts/editorial-desk/worker.mjs once       대기 요청 하나만 처리하고 끝
//   node scripts/editorial-desk/worker.mjs sync       New_Article의 지난 결과물(코워크로 만든 날짜 폴더)을 보관함에 올림 — 이미 올린 파일은 건너뜀
//   node scripts/editorial-desk/worker.mjs check      설정·연결만 확인
//
// 환경변수 (저장소 루트 .env.local 또는 EDITORIAL_ENV_FILE이 가리키는 파일에서 읽는다 — 값은 화면·로그에 쓰지 않는다)
//   NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY   필수 — 운영 사이트와 같은 Supabase (service_role은 이 PC 밖으로 내보내지 않는다)
//   EDITORIAL_NEW_ARTICLE_DIR   결과물 폴더 (기본: 저장소/New_Article)
//   EDITORIAL_CLAUDE_PATH       claude 명령 (기본: claude). .mjs·.js 파일이면 node로 실행(시험용 가짜 claude)
//   EDITORIAL_CLAUDE_MODEL      모델 이름 (기본: 비움 = claude 기본 모델)
//   EDITORIAL_TIMEOUT_MIN       한 요청 최대 시간(분, 기본 150)
//   EDITORIAL_POLL_SEC          대기열 확인 간격(초, 기본 20)
//   EDITORIAL_WORKER_NAME       화면에 보일 작업기 이름 (기본: 컴퓨터 이름)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FOLDER_RE,
  buildPrompt,
  claudeArgs,
  kstWorkDate,
  listFiles,
  mimeOf,
  nextFolderName,
  shortError,
  storageKey,
  titleOf,
  uploadDecision,
  workDateOf,
} from "./lib.mjs";

const VERSION = "1.0.0";
const BUCKET = "editorial-desk";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUIDELINE = path.join(repoRoot, "docs", "editorial-desk", "프로젝트지침_v4.md");

function loadEnv() {
  const file = process.env.EDITORIAL_ENV_FILE || path.join(repoRoot, ".env.local");
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

function config() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY가 없습니다 — .env.local(또는 EDITORIAL_ENV_FILE)에 넣어 주세요");
  const num = (v, d, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : d;
  };
  return {
    url,
    key,
    articleDir: path.resolve(process.env.EDITORIAL_NEW_ARTICLE_DIR || path.join(repoRoot, "New_Article")),
    claude: process.env.EDITORIAL_CLAUDE_PATH || "claude",
    model: process.env.EDITORIAL_CLAUDE_MODEL || "",
    timeoutMs: num(process.env.EDITORIAL_TIMEOUT_MIN, 150, 5, 600) * 60_000,
    pollMs: num(process.env.EDITORIAL_POLL_SEC, 20, 5, 3600) * 1000,
    name: (process.env.EDITORIAL_WORKER_NAME || os.hostname()).slice(0, 100),
  };
}

// ── Supabase REST (service_role) ─────────────────────────────────────────────
function client(cfg) {
  const headers = { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` };
  async function rest(method, pathAndQuery, body, prefer) {
    const res = await fetch(`${cfg.url}/rest/v1/${pathAndQuery}`, {
      method,
      headers: { ...headers, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(prefer ? { Prefer: prefer } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`DB ${method} ${pathAndQuery.split("?")[0]} ${res.status}: ${shortError(text, 300)}`);
    return text ? JSON.parse(text) : null;
  }
  const objectUrl = (key) => `${cfg.url}/storage/v1/object/${BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`;
  return {
    rest,
    async download(key) {
      const res = await fetch(objectUrl(key), { headers });
      if (!res.ok) throw new Error(`첨부 내려받기 실패 ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async upload(key, bytes, contentType) {
      const res = await fetch(objectUrl(key), { method: "POST", headers: { ...headers, "content-type": contentType, "x-upsert": "true" }, body: bytes });
      if (!res.ok) throw new Error(`올리기 실패 ${res.status}: ${shortError(await res.text(), 200)}`);
    },
  };
}

const nowIso = () => new Date().toISOString();

async function beat(db, cfg) {
  await db.rest("POST", "editorial_worker_status?on_conflict=worker", { worker: cfg.name, seen_at: nowIso(), version: VERSION }, "resolution=merge-duplicates,return=minimal");
}

/** 작업기가 꺼진 사이 멈춘 요청(제작 중인데 15분 넘게 소식 없음)은 실패로 */
async function failStale(db) {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const rows = await db.rest(
    "PATCH",
    `editorial_requests?status=eq.running&heartbeat_at=lt.${encodeURIComponent(cutoff)}`,
    { status: "failed", error: "작업기가 중간에 멈췄습니다 — 다시 요청해 주세요", finished_at: nowIso() },
    "return=representation",
  );
  for (const r of rows ?? []) console.log(`[작업기] 멈춘 요청을 실패로 표시: ${r.id}`);
}

/** 대기 요청 하나를 가져온다 — 다른 작업기와 겹치지 않게 status=queued 조건으로 바꾼다 */
async function claim(db, cfg) {
  const rows = await db.rest("GET", "editorial_requests?select=*&status=eq.queued&order=queued_at.asc&limit=1");
  const row = rows?.[0];
  if (!row) return null;
  const got = await db.rest(
    "PATCH",
    `editorial_requests?id=eq.${row.id}&status=eq.queued`,
    { status: "running", started_at: nowIso(), heartbeat_at: nowIso(), worker: cfg.name, progress: "준비 중" },
    "return=representation",
  );
  return got?.[0] ?? null;
}

async function takenFolders(db, cfg, dateFolder) {
  const local = fs.existsSync(cfg.articleDir) ? fs.readdirSync(cfg.articleDir).filter((n) => n.startsWith(dateFolder)) : [];
  const remote = (await db.rest("GET", `editorial_packages?select=folder&folder=like.${encodeURIComponent(dateFolder)}*`)) ?? [];
  return [...local, ...remote.map((r) => r.folder)];
}

/** 폴더 파일을 올리고 묶음을 저장한다 — 이미 같은 크기로 올린 파일은 건너뛴다 */
async function publishFolder(db, cfg, folder, { source, report = null, title = null, log = console.log }) {
  const dir = path.join(cfg.articleDir, folder);
  const workDate = workDateOf(folder);
  if (!workDate) throw new Error(`${folder}: 날짜 폴더 이름이 아닙니다`);
  const existing = ((await db.rest("GET", `editorial_packages?select=id,files&folder=eq.${encodeURIComponent(folder)}`)) ?? [])[0];
  const before = new Map((existing?.files ?? []).map((f) => [f.path, f]));
  const files = [];
  let uploaded = 0;
  let skipped = 0;
  for (const f of listFiles(dir)) {
    const d = uploadDecision(f.path, f.size);
    if (!d.ok) {
      skipped++;
      continue;
    }
    const key = storageKey(folder, f.path);
    const prev = before.get(f.path);
    if (!prev || prev.size !== f.size || prev.key !== key) {
      await db.upload(key, fs.readFileSync(path.join(dir, f.path)), mimeOf(f.path));
      uploaded++;
    }
    files.push({ path: f.path, size: f.size, mime: mimeOf(f.path), key });
  }
  const row = { folder, work_date: workDate, title: title ?? titleOf(dir, folder), source, files, updated_at: nowIso(), ...(report !== null ? { report } : {}) };
  const saved = await db.rest("POST", "editorial_packages?on_conflict=folder", row, "resolution=merge-duplicates,return=representation");
  log(`[작업기] ${folder}: 파일 ${files.length}개 (새로 올림 ${uploaded}, 건너뜀 ${skipped})`);
  return saved[0];
}

function readIf(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** claude 실행 — 진행 줄(_desk/progress.txt)을 주기적으로 DB에 남기고, 시간 초과면 끝낸다 */
function runClaude(cfg, folderAbs, prompt, onTick) {
  return new Promise((resolve) => {
    const addDirs = [path.join(repoRoot, "scripts"), path.join(repoRoot, "docs", "editorial-desk"), path.join(repoRoot, "image", "Instagram")].filter((d) => fs.existsSync(d));
    // .mjs·.js를 주면 node로 실행한다 — 시험용 가짜 claude(scripts/__tests__/fixtures/fake-claude.mjs)
    const viaNode = /\.(mjs|js)$/i.test(cfg.claude);
    const args = claudeArgs({ addDirs, model: cfg.model });
    const child = spawn(viaNode ? process.execPath : cfg.claude, viaNode ? [cfg.claude, ...args] : args, { cwd: folderAbs, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let out = "";
    let err = "";
    let timedOut = false;
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (err += b));
    const tick = setInterval(() => onTick().catch((e) => console.error("[작업기] 진행 기록 실패:", e.message)), 30_000);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, cfg.timeoutMs);
    child.on("error", (e) => {
      clearInterval(tick);
      clearTimeout(timer);
      resolve({ code: -1, out, err: `claude 명령을 실행하지 못했습니다: ${e.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearInterval(tick);
      clearTimeout(timer);
      resolve({ code, out, err, timedOut });
    });
    child.stdin.end(prompt);
  });
}

async function processRequest(db, cfg, req) {
  const work = kstWorkDate();
  fs.mkdirSync(cfg.articleDir, { recursive: true });
  const folder = nextFolderName(work.folder, await takenFolders(db, cfg, work.folder));
  const folderAbs = path.join(cfg.articleDir, folder);
  fs.mkdirSync(path.join(folderAbs, "_desk"), { recursive: true });
  fs.mkdirSync(path.join(folderAbs, "_request"), { recursive: true });
  console.log(`[작업기] 요청 ${req.id} → ${folder} 「${req.input.topic}」`);

  const update = (patch) => db.rest("PATCH", `editorial_requests?id=eq.${req.id}`, { heartbeat_at: nowIso(), ...patch }, "return=minimal");
  await update({ progress: `첨부 받는 중 (${folder})` });
  const attachments = [];
  for (const a of req.attachments ?? []) {
    const local = path.join(folderAbs, "_request", path.basename(a.name));
    fs.writeFileSync(local, await db.download(a.path));
    attachments.push(local);
  }
  fs.writeFileSync(path.join(folderAbs, "_request", "request.json"), JSON.stringify({ id: req.id, requester: req.requester_label, input: req.input }, null, 2));

  const prompt = buildPrompt({ guidelinePath: GUIDELINE, repoRoot, folderAbs, folder, work, request: req, attachments });
  await update({ progress: "Claude가 지침대로 제작 중" });
  const progressFile = path.join(folderAbs, "_desk", "progress.txt");
  const result = await runClaude(cfg, folderAbs, prompt, async () => {
    const line = readIf(progressFile)?.trim().split(/\r?\n/).at(-1)?.slice(0, 200);
    await update(line ? { progress: line } : {});
    await beat(db, cfg);
  });
  fs.writeFileSync(path.join(folderAbs, "_desk", "claude_output.json"), result.out || "");
  if (result.err) fs.writeFileSync(path.join(folderAbs, "_desk", "claude_stderr.txt"), result.err);

  let parsed = null;
  try {
    parsed = JSON.parse(result.out);
  } catch {
    parsed = null;
  }
  const resultJson = (() => {
    try {
      return JSON.parse(readIf(path.join(folderAbs, "_desk", "result.json")) ?? "null");
    } catch {
      return null;
    }
  })();
  const report = readIf(path.join(folderAbs, "_desk", "report.md"));
  const ok = !result.timedOut && result.code === 0 && parsed && parsed.is_error !== true && resultJson !== null;

  await update({ progress: "결과물 올리는 중" });
  let pkg = null;
  try {
    const hasFiles = listFiles(folderAbs).some((f) => uploadDecision(f.path, f.size).ok);
    if (hasFiles) pkg = await publishFolder(db, cfg, folder, { source: "web", report: report ?? null, title: typeof resultJson?.title === "string" && resultJson.title.trim() ? resultJson.title.trim() : null });
  } catch (e) {
    console.error("[작업기] 올리기 실패:", e.message);
    await update({ status: "failed", error: shortError(`결과물을 올리지 못했습니다 — ${e.message}. 파일은 PC의 New_Article\\${folder}에 있습니다`), finished_at: nowIso() });
    return;
  }
  if (ok) {
    await update({ status: "done", progress: resultJson.status === "partial" ? "완료(일부 남은 일 있음 — 완료 보고 확인)" : "완료", package_id: pkg?.id ?? null, finished_at: nowIso(), error: null });
    console.log(`[작업기] 완료 ${req.id} → ${folder}`);
  } else {
    const why = result.timedOut
      ? `시간 초과(${Math.round(cfg.timeoutMs / 60000)}분)로 멈췄습니다`
      : result.code === -1
        ? result.err
        : parsed?.is_error
          ? `Claude 오류: ${parsed.result ?? parsed.subtype ?? "알 수 없음"}`
          : resultJson === null
            ? "Claude가 완료 기록(_desk/result.json)을 남기지 않았습니다"
            : `claude 종료 코드 ${result.code}`;
    await update({ status: "failed", error: shortError(`${why}${pkg ? " — 만들어진 파일까지는 결과물에 올렸습니다" : ""}`), package_id: pkg?.id ?? null, finished_at: nowIso() });
    console.log(`[작업기] 실패 ${req.id}: ${why}`);
  }
}

async function once(db, cfg) {
  await beat(db, cfg);
  await failStale(db);
  const req = await claim(db, cfg);
  if (!req) return false;
  try {
    await processRequest(db, cfg, req);
  } catch (e) {
    console.error("[작업기] 처리 중 오류:", e.message);
    await db
      .rest("PATCH", `editorial_requests?id=eq.${req.id}&status=eq.running`, { status: "failed", error: shortError(`작업기 오류: ${e.message}`), finished_at: nowIso() }, "return=minimal")
      .catch(() => {});
  }
  return true;
}

async function sync(db, cfg, only) {
  if (!fs.existsSync(cfg.articleDir)) throw new Error(`결과물 폴더가 없습니다: ${cfg.articleDir}`);
  const folders = fs
    .readdirSync(cfg.articleDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && FOLDER_RE.test(d.name) && workDateOf(d.name) && (!only || d.name === only))
    .map((d) => d.name)
    .sort();
  const web = new Set(((await db.rest("GET", "editorial_packages?select=folder&source=eq.web")) ?? []).map((r) => r.folder));
  for (const folder of folders) {
    await publishFolder(db, cfg, folder, { source: web.has(folder) ? "web" : "cowork" });
  }
  console.log(`[작업기] 보관함 올리기 끝 — 폴더 ${folders.length}개`);
}

async function main() {
  loadEnv();
  const mode = process.argv[2] ?? "loop";
  if (!["loop", "once", "sync", "check"].includes(mode)) {
    console.error("사용: node scripts/editorial-desk/worker.mjs [loop|once|sync [폴더]|check]");
    process.exit(2);
  }
  const cfg = config();
  const db = client(cfg);
  if (mode === "check") {
    await beat(db, cfg);
    const queued = await db.rest("GET", "editorial_requests?select=id&status=eq.queued");
    console.log(`[작업기] 연결 확인 — 이름 ${cfg.name} · 결과물 폴더 ${cfg.articleDir} · 대기 요청 ${queued.length}건 · 지침 ${fs.existsSync(GUIDELINE) ? "있음" : "없음!"}`);
    return;
  }
  if (mode === "sync") return sync(db, cfg, process.argv[3]);
  if (mode === "once") {
    const did = await once(db, cfg);
    if (!did) console.log("[작업기] 대기 요청 없음");
    return;
  }
  console.log(`[작업기] 시작 — ${cfg.name}, ${cfg.pollMs / 1000}초마다 확인 (멈추려면 Ctrl+C)`);
  for (;;) {
    try {
      while (await once(db, cfg)) {
        /* 대기 요청이 남아 있으면 바로 다음 것 */
      }
    } catch (e) {
      console.error("[작업기] 확인 실패(잠시 뒤 다시):", e.message);
    }
    await new Promise((r) => setTimeout(r, cfg.pollMs));
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(`[작업기] ${e.message}`);
    process.exit(1);
  });
}

export { processRequest, publishFolder, runClaude, sync, once, client, config };
