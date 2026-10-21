// 2.6 7 적용 — PO가 차이 보고서를 승인하면 데이터 마이그레이션 파일을 만든다(적용하지 않는다)
//  · 머리 주석에 원본 이름·배포일·SHA-256·행 수·차이 수·승인자
//  · 같은 원본(SHA-256)의 applied 기록이 있으면 아무것도 하지 않는다 — 두 번 적용해도 행 수 같음
//  · 있는 지역은 이름·별칭만 갱신(slug는 바꾸지 않는다), 폐지는 valid_to + 후속 코드 + 옛 주소 301
import fs from "node:fs";
import { ROW_CLASSES } from "./config.mjs";
import { problem, stopIf } from "./stop.mjs";

const q = (s) => (s === null || s === undefined ? "null" : `'${String(s).replaceAll("'", "''")}'`);
const arr = (list) => (list.length ? `array[${list.map(q).join(", ")}]::text[]` : "'{}'::text[]");
const oneLine = (s) => String(s ?? "").replace(/[\r\n]+/g, " ");

/** 다음 빈 번호의 파일 이름 — <오늘 YYYYMMDD><차례 6자리>_w4_regions_data_<배포일 YYYYMMDD>.sql */
export function nextMigrationName(existingNames, { today, fileDate }) {
  let max = 0;
  for (const n of existingNames) {
    const m = n.match(/^\d{8}(\d{6})_/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${today.replaceAll("-", "")}${String(max + 1).padStart(6, "0")}_w4_regions_data_${fileDate.replaceAll("-", "")}.sql`;
}

export const nextMigrationNameIn = (dir, opts) => nextMigrationName(fs.existsSync(dir) ? fs.readdirSync(dir) : [], opts);

/**
 * source = { fileName, fileDate, sha256, rowsTotal, encoding, downloadedOn?, sourceUrl? }
 * counts = classify 결과 counts · p = planImport 결과 · approvedBy = PO 승인자(= applied_by)
 */
export function emitMigration({ source, counts, plan: p, approvedBy, generatedAt = new Date().toISOString() }) {
  if (!approvedBy || !String(approvedBy).trim()) stopIf([problem("APPROVAL_MISSING", "--approved-by")]);
  if (!/^[0-9a-f]{64}$/.test(source.sha256 ?? "")) throw new Error("원본 SHA-256이 없습니다");
  const classCounts = Object.fromEntries(ROW_CLASSES.map((c) => [c, counts[c].total]));
  const sum = Object.values(classCounts).reduce((a, b) => a + b, 0);
  if (sum !== source.rowsTotal) throw new Error(`분류 수 합(${sum})과 행 수(${source.rowsTotal})가 다릅니다`);
  const L = [];
  L.push("-- W4 행정구역 데이터 (docs/dev/W4_설계.md 2.6 7) — scripts/regions/cli.mjs가 만든 파일. 손으로 고치지 않는다(원본·검토 파일·후속 입력을 고쳐 다시 만든다)");
  L.push(`-- 원본 파일: ${oneLine(source.fileName)}`);
  L.push(`-- 배포일: ${source.fileDate}`);
  L.push(`-- SHA-256: ${source.sha256}`);
  L.push(`-- 받은 날: ${oneLine(source.downloadedOn ?? "[기록 없음]")} · 받은 곳: ${oneLine(source.sourceUrl ?? "[기록 없음]")} · 인코딩: ${oneLine(source.encoding)}`);
  L.push(`-- 행 수: 전체 ${source.rowsTotal} · ${ROW_CLASSES.map((c) => `${c} ${counts[c].total}(존재 ${counts[c].active}·폐지 ${counts[c].retired})`).join(" · ")}`);
  L.push(`-- 차이: added ${p.counts.added} · renamed ${p.counts.renamed} · retired ${p.counts.retired} · unchanged ${p.counts.unchanged} · 별칭 갱신 ${p.aliasUpdates.length} · 옛 주소 ${p.redirects.length}`);
  L.push(`-- 승인·적용자: ${oneLine(approvedBy)} · 만든 때: ${generatedAt}`);
  for (const r of p.retired) L.push(`-- 폐지 ${r.code} ${oneLine(r.name)} → ${r.successor} (폐지일 ${r.validTo} · 근거 ${oneLine(r.basis)})`);
  L.push("-- 같은 원본(SHA-256)의 applied 기록이 있으면 아무것도 하지 않는다 — 두 번 적용해도 행 수 같음");
  L.push("");
  L.push("do $regions$");
  L.push("declare");
  L.push("  v_run bigint;");
  L.push("begin");
  L.push(`  if exists (select 1 from public.region_import_runs where sha256 = ${q(source.sha256)} and status = 'applied') then`);
  L.push(`    raise notice '행정구역 원본 %는 이미 적용됐습니다 — 건너뜀', ${q(source.sha256)};`);
  L.push("    return;");
  L.push("  end if;");
  L.push("");
  L.push("  insert into public.region_import_runs (file_name, file_date, sha256, rows_total, class_counts, change_counts, status, applied_by, applied_at, note)");
  L.push(
    `  values (${q(source.fileName)}, ${q(source.fileDate)}, ${q(source.sha256)}, ${source.rowsTotal}, ${q(JSON.stringify(classCounts))}::jsonb, ${q(JSON.stringify(p.counts))}::jsonb, 'applied', ${q(approvedBy)}, now(), ${q(`scripts/regions 적용 — 별칭 갱신 ${p.aliasUpdates.length} · 옛 주소 ${p.redirects.length}`)})`,
  );
  L.push("  returning id into v_run;");
  // 부모 먼저 — 시·도 문장 → 시·군·구 문장 (한 문장 안 행 순서에 기대지 않는다)
  for (const level of ["sido", "sigungu"]) {
    const rows = p.added.filter((e) => e.level === level).sort((a, b) => a.code.localeCompare(b.code));
    if (!rows.length) continue;
    L.push("");
    L.push(`  -- added ${level} ${rows.length}`);
    L.push("  insert into public.regions (code, parent_code, level, name, slug, aliases, import_run_id) values");
    L.push(rows.map((e) => `    (${q(e.code)}, ${q(e.parentCode)}, ${q(e.level)}, ${q(e.name)}, ${q(e.slug)}, ${arr(e.aliases)}, v_run)`).join(",\n"));
    L.push("  on conflict (code) do nothing;");
  }
  const updates = [
    ...p.renamed.map(({ entry }) => ({ code: entry.code, name: entry.name, aliases: entry.aliases, label: "renamed" })),
    ...p.aliasUpdates.map((u) => ({ code: u.code, name: null, aliases: u.aliases, label: "aliases" })),
  ];
  if (updates.length) {
    L.push("");
    L.push(`  -- renamed ${p.renamed.length} · 별칭 갱신 ${p.aliasUpdates.length} (slug는 바꾸지 않는다)`);
    L.push("  update public.regions r set name = coalesce(v.name, r.name), aliases = v.aliases, import_run_id = v_run");
    L.push(`  from (values\n${updates.map((u) => `    (${q(u.code)}, ${u.name === null ? "null::text" : q(u.name)}, ${arr(u.aliases)})`).join(",\n")}\n  ) as v(code, name, aliases)`);
    L.push("  where r.code = v.code;");
  }
  if (p.retired.length) {
    L.push("");
    L.push(`  -- retired ${p.retired.length} (후속 = 최종 지역)`);
    L.push("  update public.regions r set valid_to = v.valid_to::date, successor_code = v.successor_code, import_run_id = v_run");
    L.push(`  from (values\n${p.retired.map((r) => `    (${q(r.code)}, ${q(r.validTo)}, ${q(r.successor)})`).join(",\n")}\n  ) as v(code, valid_to, successor_code)`);
    L.push("  where r.code = v.code;");
  }
  if (p.redirects.length) {
    L.push("");
    L.push(`  -- 옛 주소 301 ${p.redirects.length}`);
    L.push("  insert into public.region_slug_redirects (old_path, region_code, reason) values");
    L.push(p.redirects.map((r) => `    (${q(r.old_path)}, ${q(r.region_code)}, ${q(r.reason)})`).join(",\n"));
    L.push("  on conflict (old_path) do update set region_code = excluded.region_code, reason = excluded.reason;");
  }
  L.push("end");
  L.push("$regions$;");
  return `${L.join("\n")}\n`;
}
