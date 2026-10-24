#!/usr/bin/env node
// W9 이관 도구 명령줄 (docs/dev/W9_설계.md 1장) — 기존 사이트에도 DB에도 연결하지 않는다. 파일을 읽고 파일을 쓴다.
//   node scripts/migration/cli.mjs adapt   --platform ndsoft --input <HTML 저장본 폴더(<번호>.html)> --out <중간형식.json>
//   node scripts/migration/cli.mjs adapt   --platform wxr     --input <export.xml> [--category-map <map.json>] --out <중간형식.json>
//   node scripts/migration/cli.mjs dry-run --input <중간형식.json> --out <폴더> [--status draft|published] [--now 2026-10-25T00:00:00+09:00]
//   node scripts/migration/cli.mjs rehearse --input <중간형식.json> --out <폴더> [--runs 2]   (같은 입력 2회 → 산출물 해시 대조, MIG-03)
// 종료 코드: 0 통과 · 1 검증 오류/리허설 불일치 · 2 사용법 오류
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { adaptNdsoft } from "./adapters/ndsoft.mjs";
import { adaptWxr } from "./adapters/wxr.mjs";
import { renderReportMarkdown, runDryRun } from "./run.mjs";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith("--")) throw new Error(`알 수 없는 인자: ${a}`);
    const key = a.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      i++;
    }
  }
  return { command, flags };
}

const need = (flags, name) => {
  if (typeof flags[name] !== "string") throw new UsageError(`--${name} 값이 필요합니다`);
  return flags[name];
};
class UsageError extends Error {}

const json = (v) => `${JSON.stringify(v, null, 2)}\n`;
const sha = (s) => createHash("sha256").update(s).digest("hex");

/** dry-run 산출물을 폴더에 쓰고 파일별 해시를 돌려준다 */
export function writeOutputs(result, outDir) {
  mkdirSync(outDir, { recursive: true });
  const files = {
    "report.json": json(result.report),
    "report.md": renderReportMarkdown(result.report),
    "articles.json": json(result.items),
    "redirects.json": json(result.urlMap),
    "redirects.sql": result.redirectsSql,
    "images.txt": `${result.report.image_urls.join("\n")}\n`,
  };
  const hashes = {};
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(outDir, name), content, "utf8");
    hashes[name] = sha(content);
  }
  return hashes;
}

function loadDoc(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

export function main(argv) {
  const { command, flags } = parseArgs(argv);
  if (command === "adapt") {
    const platform = need(flags, "platform");
    const input = resolve(need(flags, "input"));
    let doc;
    if (platform === "ndsoft") {
      const pages = readdirSync(input).filter((f) => /^[0-9]+\.html?$/.test(f)).map((f) => ({ id: f.replace(/\.html?$/, ""), html: readFileSync(join(input, f), "utf8") }));
      doc = adaptNdsoft(pages);
    } else if (platform === "wxr") {
      const categoryMap = typeof flags["category-map"] === "string" ? loadDoc(flags["category-map"]) : {};
      doc = adaptWxr(readFileSync(input, "utf8"), { categoryMap });
    } else throw new UsageError(`지원하는 플랫폼: ndsoft · wxr (받은 값: ${platform})`);
    writeFileSync(resolve(need(flags, "out")), json(doc), "utf8");
    console.log(`중간 형식 ${doc.articles.length}건 → ${flags.out}`);
    return 0;
  }
  if (command === "dry-run" || command === "rehearse") {
    const doc = loadDoc(need(flags, "input"));
    const out = resolve(need(flags, "out"));
    const status = typeof flags.status === "string" ? flags.status : "draft";
    const now = typeof flags.now === "string" ? new Date(flags.now) : new Date();
    if (command === "dry-run") {
      const t0 = Date.now();
      const result = runDryRun(doc, { status, now });
      writeOutputs(result, out);
      writeFileSync(join(out, "timing.json"), json({ elapsed_ms: Date.now() - t0 }), "utf8");
      const c = result.report.counts;
      console.log(`${result.report.result} — 원본 ${c.source} = 이관 ${c.migrated} + 제외 ${c.excluded} · 오류 ${c.errors} · 경고 ${c.warnings} · 주소 ${c.url_map_rows}행 → ${out}`);
      return result.ok && result.urlProblems.every((p) => p.problem === "새 주소 미결정") ? 0 : 1;
    }
    const runs = Number(typeof flags.runs === "string" ? flags.runs : 2);
    const all = [];
    for (let i = 1; i <= runs; i++) {
      const t0 = Date.now();
      const result = runDryRun(doc, { status, now });
      const hashes = writeOutputs(result, join(out, `run${i}`));
      all.push({ ok: result.ok, hashes, elapsed_ms: Date.now() - t0 });
    }
    const same = all.every((r) => r.ok && JSON.stringify(r.hashes) === JSON.stringify(all[0].hashes));
    writeFileSync(join(out, "rehearsal.json"), json({ runs, identical: same, elapsed_ms: all.map((r) => r.elapsed_ms), hashes: all[0].hashes }), "utf8");
    console.log(`리허설 ${runs}회 — ${same ? "산출물 해시 일치" : "산출물 불일치 또는 검증 오류"} (${all.map((r) => `${r.elapsed_ms}ms`).join(", ")})`);
    return same ? 0 : 1;
  }
  throw new UsageError("명령: adapt · dry-run · rehearse");
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exitCode = err instanceof UsageError ? 2 : 1;
  }
}
