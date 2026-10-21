// 2.6 6 차이 보고 · 7 적용 계획 — 넣을 지역(entries) ↔ 지금 지역 상태(current: DB 또는 상태 파일)
//  · added(새 코드) · renamed(같은 코드, 이름 바뀜 — slug 그대로) · retired(지금 유효한데 원본에 '존재'로 없음) · unchanged
//  · 폐지 = valid_to + 후속 코드(사람 입력 --successors, 근거 고시) + 옛 주소 → 후속 지역 301(region_slug_redirects)
//    후속 코드 없는 폐지 → 중단 · 후속이 또 폐지 → 최종 지역으로 바꿔 쓴다(연쇄 0) · 순환 → 중단
//  · 옛 이름(개칭 전 이름·폐지 지역 이름)은 후속 지역 별칭에 더한다 (2.7 옛 이름)
import { CHANGES, kstToday } from "./config.mjs";
import { parseCsv } from "./slug.mjs";
import { problem, stopIf } from "./stop.mjs";

export const validOn = (r, day) => (r.valid_to == null || r.valid_to >= day) && (r.valid_from == null || r.valid_from <= day);

/** 지금 상태 = 씨앗 마이그레이션만 적용된 DB (첫 적재 — 시·도만) */
export const currentFromSeed = (sido) =>
  sido.map((s) => ({ code: s.code, parent_code: null, level: "sido", name: s.name, slug: s.slug, aliases: [...s.aliases], valid_from: null, valid_to: null, successor_code: null }));

export const CURRENT_SQL =
  "select code, parent_code, level, name, slug, aliases, valid_from::text as valid_from, valid_to::text as valid_to, successor_code from public.regions order by code";

/** 지금 상태 = DB regions (pg client) */
export async function currentFromDb(client) {
  return (await client.query(CURRENT_SQL)).rows;
}

/** 후속 입력 CSV(code,successor_code,valid_to,basis) → Map(code → { successor, validTo, basis }) */
export function readSuccessors(text) {
  const map = new Map();
  const problems = [];
  for (const r of parseCsv(text)) {
    if (!r.code) continue;
    if (!/^[0-9]{10}$/.test(r.code) || !/^[0-9]{10}$/.test(r.successor_code ?? "")) problems.push(problem("SUCCESSOR_INPUT", `코드 '${r.code}' · 후속 '${r.successor_code ?? ""}'`));
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(r.valid_to ?? "") || !r.basis) problems.push(problem("SUCCESSOR_INPUT", `${r.code} — 폐지일 '${r.valid_to ?? ""}' · 근거 '${r.basis ?? ""}'`));
    else if (map.has(r.code)) problems.push(problem("SUCCESSOR_INPUT", `${r.code}가 두 번 나옵니다`));
    else map.set(r.code, { successor: r.successor_code, validTo: r.valid_to, basis: r.basis });
  }
  stopIf(problems);
  return map;
}

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * entries(buildSlugs 결과) · current(지금 상태) · fileRows(분류된 원본 행) · successors(Map) → 적용 계획
 * { added, renamed, retired, unchanged, aliasUpdates, redirects, counts, notes, problems }
 */
export function planImport(entries, current, { fileRows = [], successors = new Map(), today = kstToday() } = {}) {
  const problems = [];
  const notes = [];
  const curBy = new Map(current.map((r) => [r.code, r]));
  const entryBy = new Map(entries.map((e) => [e.code, { ...e, aliases: [...e.aliases] }]));
  const fileBy = new Map(fileRows.map((r) => [r.code, r]));
  const plan = { added: [], renamed: [], retired: [], unchanged: [], aliasUpdates: [], redirects: [] };

  for (const e of entryBy.values()) {
    const cur = curBy.get(e.code);
    if (!cur) plan.added.push(e);
    else if (!validOn(cur, today)) problems.push(problem("REVIVED", `${e.code} ${e.name} — 지금 valid_to ${cur.valid_to}`, e.line));
    else if (cur.name !== e.name) plan.renamed.push({ entry: e, from: cur.name });
    else plan.unchanged.push(e);
  }
  const retiring = new Map();
  for (const cur of current) {
    if (entryBy.has(cur.code) || !validOn(cur, today)) continue;
    const f = fileBy.get(cur.code);
    const reason = !f ? "missing" : f.status === "retired" ? "file" : "excluded";
    if (reason !== "file") notes.push(`${cur.code} ${cur.name} — 원본에 ${reason === "missing" ? "행이 없어" : "'존재'지만 넣지 않는 분류라"} 폐지로 봅니다 [확인 필요]`);
    retiring.set(cur.code, { row: cur, reason });
  }
  for (const code of successors.keys()) {
    if (!retiring.has(code)) problems.push(problem("SUCCESSOR_INPUT", `${code}는 이번에 폐지되는 지역이 아닙니다`));
  }

  // 후속 — 최종 지역까지 따라간다
  for (const [code, { row, reason }] of retiring) {
    const s = successors.get(code);
    if (!s) {
      problems.push(problem("SUCCESSOR_MISSING", `${code} ${row.name}`));
      continue;
    }
    const chain = [code];
    let target = s.successor;
    let bad = false;
    while (retiring.has(target)) {
      if (chain.includes(target)) {
        problems.push(problem("SUCCESSOR_CYCLE", [...chain, target].join(" → ")));
        bad = true;
        break;
      }
      chain.push(target);
      const next = successors.get(target);
      if (!next) break; // 그 지역의 후속 없음 — 그 지역 차례에서 SUCCESSOR_MISSING
      target = next.successor;
    }
    if (bad || retiring.has(target)) continue;
    if (!entryBy.has(target)) {
      problems.push(problem("SUCCESSOR_UNKNOWN", `${code} ${row.name} → ${target}`));
      continue;
    }
    if (chain.length > 1) problems.push(problem("SUCCESSOR_CHAIN", `${[...chain, target].join(" → ")} — ${code}의 후속을 ${target}로 씁니다`));
    plan.retired.push({ code, name: row.name, level: row.level, parentCode: row.parent_code, slug: row.slug, successor: target, validTo: s.validTo, basis: s.basis, reason });
  }

  // 옛 이름 → 후속 지역 별칭 (2글자 이상 · 다른 지역의 지금 이름이 아닐 때)
  const nameOwner = new Map([...entryBy.values()].map((e) => [e.name, e.code]));
  const addOld = (e, oldName) => {
    if ([...oldName].length < 2 || oldName === e.name || (nameOwner.has(oldName) && nameOwner.get(oldName) !== e.code)) {
      notes.push(`옛 이름 '${oldName}'은 ${e.name}의 별칭에 넣지 않음 (1글자이거나 다른 지역 이름)`);
      return;
    }
    if (!e.aliases.includes(oldName)) e.aliases.push(oldName);
  };
  for (const r of plan.renamed) addOld(r.entry, r.from);
  for (const r of plan.retired) addOld(entryBy.get(r.successor), r.name);

  // 옛 주소 301 — 폐지 지역의 지금 주소 → 최종 후속 지역
  const slugOf = (code) => entryBy.get(code)?.slug ?? curBy.get(code)?.slug;
  for (const r of plan.retired) {
    const path = r.level === "sido" ? `/local/${r.slug}` : `/local/${slugOf(r.parentCode)}/${r.slug}`;
    plan.redirects.push({ old_path: path, region_code: r.successor, reason: "retired" });
  }
  for (const e of plan.unchanged) {
    const cur = curBy.get(e.code);
    if (!sameList(cur.aliases ?? [], e.aliases)) plan.aliasUpdates.push({ code: e.code, aliases: e.aliases });
  }
  plan.counts = Object.fromEntries(CHANGES.map((c) => [c, plan[c].length]));
  plan.entries = [...entryBy.values()];
  plan.notes = notes;
  plan.problems = problems;
  return plan;
}

export function plan(entries, current, opts) {
  const p = planImport(entries, current, opts);
  stopIf(p.problems);
  return p;
}

/** 계획을 적용한 뒤의 지역 상태 (DB 트리거의 연쇄 고쳐 쓰기와 같게) — 상태 파일(regions.after.json)·DB 대조용 */
export function applyPlan(current, p) {
  const by = new Map(current.map((r) => [r.code, { ...r, aliases: [...(r.aliases ?? [])] }]));
  for (const e of p.added) {
    by.set(e.code, { code: e.code, parent_code: e.parentCode, level: e.level, name: e.name, slug: e.slug, aliases: [...e.aliases], valid_from: null, valid_to: null, successor_code: null });
  }
  for (const { entry } of p.renamed) Object.assign(by.get(entry.code), { name: entry.name, aliases: [...entry.aliases] });
  for (const u of p.aliasUpdates) by.get(u.code).aliases = [...u.aliases];
  const finalOf = new Map(p.retired.map((r) => [r.code, r.successor]));
  for (const r of p.retired) Object.assign(by.get(r.code), { valid_to: r.validTo, successor_code: r.successor });
  for (const row of by.values()) {
    if (row.successor_code && finalOf.has(row.successor_code) && !finalOf.has(row.code)) row.successor_code = finalOf.get(row.successor_code);
  }
  return [...by.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** region_import_runs에 dry_run 1행 (2.6 6) — { sql, params } */
export function dryRunInsert({ fileName, fileDate, sha256, rowsTotal, classCounts, changeCounts, note }) {
  return {
    sql: "insert into public.region_import_runs (file_name, file_date, sha256, rows_total, class_counts, change_counts, status, note) values ($1, $2, $3, $4, $5, $6, 'dry_run', $7) returning id",
    params: [fileName, fileDate, sha256, rowsTotal, JSON.stringify(classCounts), JSON.stringify(changeCounts), note ?? null],
  };
}
