#!/usr/bin/env node
// 화면 규칙 측정 실행 (UX-02) — e2e/screen-rules.config.json의 화면을 뷰포트별로 재고 화면·규칙별 표를 남긴다 (CI 기록).
// R1은 360×740에서만 잰다(PRD-00 8.2). enforce=true인 화면이 하나라도 실패하면 종료 코드 1.
// E2E_BASE_URL이 있으면 그 주소를, 없으면 standalone 빌드(미리 빌드돼 있어야 한다)를 로컬 Supabase에 붙여 띄워 잰다
// (공개 화면은 요청 때 DB를 읽는다 — 로컬 Supabase가 꺼져 있으면 DB 없이 띄우고, 공개 화면은 오류 안내 화면을 잰다).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { ROOT, localSupabase, startServer } from "./lib/local.mjs";
import { measurePage, toTable } from "./lib/screen-rules.mjs";

const config = JSON.parse(fs.readFileSync(path.join(ROOT, "e2e", "screen-rules.config.json"), "utf8"));
function localEnv() {
  try {
    const sb = localSupabase();
    return { NEXT_PUBLIC_SUPABASE_URL: sb.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.anonKey };
  } catch {
    console.warn("로컬 Supabase에 닿지 않아 DB 없이 띄운다");
    return {};
  }
}
const server = process.env.E2E_BASE_URL ? null : await startServer(localEnv());
const base = (process.env.E2E_BASE_URL ?? server.base).replace(/\/$/, "");
const browser = await chromium.launch();
const results = [];
let failed = 0;
try {
  for (const screen of config.screens) {
    for (const vp of config.viewports) {
      const r = await measurePage(browser, `${base}${screen.path}`, { width: vp.width, height: vp.height });
      if (!vp.r1) r.r1 = { ...r.r1, pass: true, chars: "-" };
      r.url = screen.path + (screen.enforce ? "" : " (측정만)");
      results.push(r);
      if (screen.enforce && !(r.r1.pass && r.r2.pass && r.r3.pass)) failed++;
    }
  }
} finally {
  await browser.close();
  server?.stop();
}
// R1을 재지 않는 뷰포트(1280)는 칸에 '-'만 둔다
const table = toTable(results).replaceAll("| -자 통과 |", "| - |");
console.log(table);
const out = path.join(ROOT, "e2e", "reports");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "screen-rules.md"), `# 화면 규칙 측정 (UX-02)\n\n측정 시각 ${new Date().toISOString()} · 기준 PRD-00 8.2\n\n${table}\n`);
console.log(failed ? `화면 규칙 실패 ${failed}건` : "화면 규칙 통과 — 측정 대상(enforce) 모두 R1·R2·R3 통과");
process.exit(failed ? 1 : 0);
