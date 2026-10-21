#!/usr/bin/env node
// 행정구역 적재 도구 (docs/dev/W4_설계.md 1단계 · 2.6 · 2.7) — 읽기 → 분류 → 검증 → slug·별칭 → 차이 보고 → (승인 뒤) 데이터 마이그레이션 만들기
// 자동 내려받기 없음 — 사람이 공식 사이트에서 받은 파일과, 받을 때 기록한 SHA-256·배포일을 준다. 마이그레이션은 만들기만 하고 적용하지 않는다.
//
// 사용:
//   node scripts/regions/cli.mjs --source <원본 파일> --encoding cp949 --sha256 <받을 때 기록한 값> --file-date <배포일 YYYY-MM-DD> --out <결과 폴더>
//        [--downloaded-on YYYY-MM-DD] [--source-url <받은 곳>]
//        [--current seed|db|<상태 파일.json>]   지금 지역 상태 (기본 seed = W2-b 씨앗만, db = SUPABASE_DB_URL 또는 로컬 DB)
//        [--sido-seed <파일>]...                 기준 시·도 (기본 W2-b 마이그레이션 20261018000009 — .sql 또는 .json, 여러 번 줄 수 있음)
//        [--slug-review <region_slugs.review.csv>] [--successors <후속 입력.csv — code,successor_code,valid_to,basis>]
//        [--record-dry-run]                      region_import_runs에 dry_run 1행 (DB)
//        [--emit --approved-by <PO 승인자> [--migration-dir <폴더>] [--migration-name <파일 이름>]]
//        [--slug-style suffix|plain] [--same-name-child sido_alias|sigungu] [--delimiter tab|comma] [--today YYYY-MM-DD]
// 결과 폴더: report.md(차이 보고서) · report.json · region_slugs.review.csv · derived.json(파생 파일) · regions.after.json(적용 뒤 상태)
// 끝 코드: 0 통과 · 1 멈춤(문제 목록) · 2 사용법 오류
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { MIGRATIONS_DIR, ROW_CLASSES, SIDO_SEED_MIGRATION, kstToday, resolveOptions } from "./config.mjs";
import { checkReceipt, decode, parseSource } from "./parse.mjs";
import { classify, classCountsJson } from "./classify.mjs";
import { loadSidoSeed, validate } from "./validate.mjs";
import { readReview, reviewCsv, slugs } from "./slug.mjs";
import { applyPlan, currentFromDb, currentFromSeed, dryRunInsert, plan as makePlan, readSuccessors } from "./diff.mjs";
import { emitMigration, nextMigrationNameIn } from "./emit-migration.mjs";
import { RegionImportError, STOPS, formatProblem } from "./stop.mjs";

/**
 * 원본 바이트 → 전 과정 결과 (파일·DB를 건드리지 않는 순수 흐름)
 * input = { bytes, fileName, encoding, sha256, fileDate, current, expectedSido, review?, successors?, today?, options? }
 */
export function runPipeline(input) {
  const options = resolveOptions(input.options);
  const today = input.today ?? kstToday();
  const actualSha = checkReceipt(input.bytes, { sha256: input.sha256, fileDate: input.fileDate });
  const text = decode(input.bytes, input.encoding);
  const parsed = parseSource(text, options);
  const classified = classify(parsed.rows);
  const validated = validate(classified.rows, { expectedSido: input.expectedSido, ...options });
  const slugged = slugs(validated.desired, { current: input.current, review: input.review ?? new Map(), ...options });
  const p = makePlan(slugged.entries, input.current, { fileRows: classified.rows, successors: input.successors ?? new Map(), today });
  const source = {
    fileName: input.fileName,
    fileDate: input.fileDate,
    sha256: actualSha,
    rowsTotal: parsed.rows.length,
    encoding: input.encoding,
    downloadedOn: input.downloadedOn,
    sourceUrl: input.sourceUrl,
  };
  const derived = {
    source: { file_name: source.fileName, file_date: source.fileDate, sha256: source.sha256, rows_total: source.rowsTotal, encoding: source.encoding },
    class_counts: classCountsJson(classified.counts),
    rows: classified.rows
      .filter((r) => r.rowClass !== "sub_district")
      .map((r) => ({ code: r.code, row_class: r.rowClass, name: r.name, full_name: r.fullName, status: r.status === "active" ? "존재" : "폐지" })),
  };
  const prefix99 = parsed.rows.filter((r) => r.code.startsWith("99")).length;
  return {
    today,
    options,
    source,
    counts: classified.counts,
    classified: classified.rows,
    notes: [...validated.notes, ...slugged.notes, ...p.notes],
    rewrites: p.problems.filter((x) => STOPS[x.code].action === "rewrite"),
    entries: slugged.entries,
    plan: p,
    reviewCsv: reviewCsv(p.entries),
    derived,
    after: applyPlan(input.current, p),
    prefix99,
  };
}

const cell = (s) => String(s ?? "").replaceAll("|", "\\|");

/** 차이 보고서 (PO가 읽는다 — 개발 용어 대신 쉬운 말) */
export function reportMarkdown(r, { currentLabel, seedLabel } = {}) {
  const p = r.plan;
  const L = [];
  L.push(`# 행정구역 적재 차이 보고서 — ${r.source.fileName}`);
  L.push("");
  L.push("| 항목 | 값 |");
  L.push("|---|---|");
  L.push(`| 원본 파일 | ${cell(r.source.fileName)} |`);
  L.push(`| 배포일 | ${r.source.fileDate} |`);
  L.push(`| SHA-256 | \`${r.source.sha256}\` |`);
  L.push(`| 받은 날 · 받은 곳 | ${cell(r.source.downloadedOn ?? "[기록 없음]")} · ${cell(r.source.sourceUrl ?? "[기록 없음]")} |`);
  L.push(`| 인코딩 | ${r.source.encoding} |`);
  L.push(`| 비교한 지금 상태 | ${cell(currentLabel ?? "")} |`);
  L.push(`| 기준 시·도 | ${cell(seedLabel ?? "")} |`);
  L.push(`| 유효 판단 기준일 | ${r.today} |`);
  L.push("");
  L.push("## 분류 수 (가설 규칙 — 2.6 3)");
  L.push("");
  L.push("| 분류 | 존재 | 폐지 | 전체 |");
  L.push("|---|---|---|---|");
  for (const c of ROW_CLASSES) L.push(`| \`${c}\` | ${r.counts[c].active} | ${r.counts[c].retired} | ${r.counts[c].total} |`);
  L.push(`| 합 | | | ${r.source.rowsTotal} |`);
  L.push("");
  L.push("## 차이 (지금 상태와 비교)");
  L.push("");
  L.push("| 차이 | 수 |");
  L.push("|---|---|");
  for (const k of ["added", "renamed", "retired", "unchanged"]) L.push(`| \`${k}\` | ${p.counts[k]} |`);
  L.push(`| 별칭만 갱신 | ${p.aliasUpdates.length} |`);
  L.push(`| 옛 주소 301 | ${p.redirects.length} |`);
  const list = (title, rows) => {
    if (!rows.length) return;
    L.push("");
    L.push(`### ${title}`);
    L.push("");
    for (const x of rows) L.push(`- ${x}`);
  };
  list("새 지역 (added)", p.added.map((e) => `${e.code} ${e.name} → \`${e.slug}\`${e.aliases.length ? ` · 별칭 ${e.aliases.join(", ")}` : ""}`));
  list("이름 바뀜 (renamed — slug 그대로)", p.renamed.map((x) => `${x.entry.code} ${x.from} → ${x.entry.name} (\`${x.entry.slug}\`)`));
  list("폐지 (retired)", p.retired.map((x) => `${x.code} ${x.name} → 후속 ${x.successor} · 폐지일 ${x.validTo} · 근거 ${x.basis}`));
  list("옛 주소 301", p.redirects.map((x) => `${x.old_path} → ${x.region_code}`));
  list("고쳐 쓴 것", r.rewrites.map(formatProblem));
  list("참고", r.notes);
  L.push("");
  L.push("## 확인할 것 [확인 필요]");
  L.push("");
  L.push("- 분류 규칙은 가설이다 — 위 분류 수가 공식 자료의 시·도·시·군·구 수와 맞는지 본다 (2.6 3)");
  L.push("- 열 머리·인코딩·폐지여부 2값은 추정값이다 — 이 파일에서 통과했으면 맞다 (12장 #1)");
  L.push(`- 접두 \`99\`(시험용 가짜 코드 자리) 행: ${r.prefix99}개 — 공식 원본이면 0이어야 한다`);
  L.push("- 시·군·구 slug는 자동 변환 초안이다 — `region_slugs.review.csv`를 편집국·PO가 확인·수정해 `--slug-review`로 다시 넣는다 (12장 #3)");
  L.push("- 일반구는 행을 넣지 않고 상위 시의 별칭으로 둔다 (12장 #4 권고) · 시·도와 이름이 같은 하위 행은 넣지 않는다 (12장 #5 권고)");
  L.push("");
  L.push("PO가 이 보고서를 승인하면 `--emit --approved-by <승인자>`로 데이터 마이그레이션을 만든다(적용은 별도 승인).");
  return `${L.join("\n")}\n`;
}

const USAGE = "사용: node scripts/regions/cli.mjs --source <파일> --encoding cp949|utf-8 --sha256 <값> --file-date YYYY-MM-DD --out <폴더> [선택 — 파일 머리 주석 참고]";

async function main(argv) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: {
        source: { type: "string" },
        encoding: { type: "string" },
        sha256: { type: "string" },
        "file-date": { type: "string" },
        "downloaded-on": { type: "string" },
        "source-url": { type: "string" },
        current: { type: "string", default: "seed" },
        "sido-seed": { type: "string", multiple: true },
        "slug-review": { type: "string" },
        successors: { type: "string" },
        out: { type: "string" },
        "record-dry-run": { type: "boolean", default: false },
        emit: { type: "boolean", default: false },
        "approved-by": { type: "string" },
        "migration-dir": { type: "string" },
        "migration-name": { type: "string" },
        "slug-style": { type: "string" },
        "same-name-child": { type: "string" },
        delimiter: { type: "string" },
        today: { type: "string" },
      },
      strict: true,
    }).values;
  } catch (err) {
    console.error(`${err.message}\n${USAGE}`);
    return 2;
  }
  if (!args.source || !args.encoding || !args.out) {
    console.error(`--source·--encoding·--out은 꼭 줍니다\n${USAGE}`);
    return 2;
  }
  let client;
  try {
    const options = resolveOptions({ slugStyle: args["slug-style"], sameNameChild: args["same-name-child"], delimiter: args.delimiter });
    const seedPaths = args["sido-seed"]?.length ? args["sido-seed"] : [SIDO_SEED_MIGRATION];
    const expectedSido = loadSidoSeed(seedPaths);
    let dbHost;
    if (args.current === "db" || args["record-dry-run"]) {
      const { connect, dbUrl } = await import("../../packages/db/scripts/db.mjs");
      client = await connect();
      dbHost = new URL(dbUrl()).host;
    }
    let current;
    let currentLabel;
    if (args.current === "seed") {
      current = currentFromSeed(expectedSido);
      currentLabel = "씨앗만 적용된 상태 (시·도만)";
    } else if (args.current === "db") {
      current = await currentFromDb(client);
      currentLabel = `DB ${dbHost}`;
    } else {
      current = JSON.parse(fs.readFileSync(args.current, "utf8"));
      currentLabel = `상태 파일 ${path.basename(args.current)}`;
    }
    const bytes = fs.readFileSync(args.source);
    const r = runPipeline({
      bytes,
      fileName: path.basename(args.source),
      encoding: args.encoding,
      sha256: args.sha256,
      fileDate: args["file-date"],
      downloadedOn: args["downloaded-on"],
      sourceUrl: args["source-url"],
      current,
      expectedSido,
      review: args["slug-review"] ? readReview(fs.readFileSync(args["slug-review"], "utf8")) : undefined,
      successors: args.successors ? readSuccessors(fs.readFileSync(args.successors, "utf8")) : undefined,
      today: args.today,
      options,
    });
    fs.mkdirSync(args.out, { recursive: true });
    const seedLabel = seedPaths.map((s) => path.basename(s)).join(" + ");
    fs.writeFileSync(path.join(args.out, "report.md"), reportMarkdown(r, { currentLabel, seedLabel }));
    const summary = {
      source: r.source,
      class_counts: classCountsJson(r.counts),
      counts: r.counts,
      change_counts: r.plan.counts,
      alias_updates: r.plan.aliasUpdates.length,
      redirects: r.plan.redirects,
      added: r.plan.added.map((e) => ({ code: e.code, name: e.name, slug: e.slug, aliases: e.aliases })),
      renamed: r.plan.renamed.map((x) => ({ code: x.entry.code, from: x.from, to: x.entry.name })),
      retired: r.plan.retired,
      notes: r.notes,
      prefix99: r.prefix99,
    };
    fs.writeFileSync(path.join(args.out, "report.json"), `${JSON.stringify(summary, null, 2)}\n`);
    fs.writeFileSync(path.join(args.out, "region_slugs.review.csv"), r.reviewCsv);
    fs.writeFileSync(path.join(args.out, "derived.json"), `${JSON.stringify(r.derived, null, 2)}\n`);
    fs.writeFileSync(path.join(args.out, "regions.after.json"), `${JSON.stringify(r.after, null, 2)}\n`);
    console.log(`차이 보고 — added ${r.plan.counts.added} · renamed ${r.plan.counts.renamed} · retired ${r.plan.counts.retired} · unchanged ${r.plan.counts.unchanged} (결과 ${args.out})`);
    console.log(`분류 — ${ROW_CLASSES.map((c) => `${c} ${r.counts[c].total}`).join(" · ")} (전체 ${r.source.rowsTotal})`);
    if (args["record-dry-run"]) {
      const { sql, params } = dryRunInsert({ fileName: r.source.fileName, fileDate: r.source.fileDate, sha256: r.source.sha256, rowsTotal: r.source.rowsTotal, classCounts: classCountsJson(r.counts), changeCounts: r.plan.counts, note: "scripts/regions 차이 보고" });
      const id = (await client.query(sql, params)).rows[0].id;
      console.log(`region_import_runs dry_run 기록 ${id}`);
    }
    if (args.emit) {
      const sql = emitMigration({ source: r.source, counts: r.counts, plan: r.plan, approvedBy: args["approved-by"] });
      const dir = args["migration-dir"] ?? args.out;
      const name = args["migration-name"] ?? nextMigrationNameIn(MIGRATIONS_DIR, { today: r.today, fileDate: r.source.fileDate });
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, name);
      if (fs.existsSync(file)) throw new Error(`이미 있는 파일입니다 — 덮어쓰지 않습니다: ${file}`);
      fs.writeFileSync(file, sql);
      console.log(`데이터 마이그레이션을 만들었습니다(적용하지 않음): ${file}`);
    }
    return 0;
  } catch (err) {
    if (err instanceof RegionImportError) {
      console.error(`멈춤 — 문제 ${err.problems.length}건`);
      for (const p of err.problems) console.error(` ${formatProblem(p)}`);
      return 1;
    }
    console.error(err.message);
    return 2;
  } finally {
    await client?.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
