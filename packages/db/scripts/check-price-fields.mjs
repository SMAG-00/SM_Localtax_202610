#!/usr/bin/env node
// 가격 칸 검사 (PRD-01B PR-05 · docs/dev/W4_설계.md 1장 12단계 · 2.10) — 실제 DB에 접속해 프로젝트·분양 표와 그 표를 읽는 뷰에
// 가격·분양가·분담금·수익률·시세를 뜻하는 칸이 없는지 본다. 위반이 있으면 종료 코드 1(CI 실패 — DB 시험 tests/w4-price-fields.test.mjs가 같은 함수를 부른다).
//  · 사전 낱말(2.10 — 소문자, 밑줄 무시)이 칸 이름의 일부이거나 칸 설명(comment on column)에 들면 위반. 표 설명은 보지 않는다('가격 칸 없음' 같은 안내 글).
//  · 대상: 2.10의 표 4개(projects · project_events · supply_notices · project_stage_lenses — 아직 없는 표는 건너뛰고 생기는 단계에서 저절로 검사)
//    + 그 표를 (다른 뷰를 거쳐서라도) 읽는 public 뷰 전부. 설계 2.10의 information_schema 대신 pg_catalog를 읽는다(칸 설명·뷰 의존을 함께 보려고).
// 사용: node scripts/check-price-fields.mjs   (SUPABASE_DB_URL이 없으면 로컬 Supabase)
import { pathToFileURL } from "node:url";
import { connect } from "./db.mjs";

/** 2.10 사전 — 시험이 설계 문서 2.10 줄과 같은지 본다 */
export const PRICE_WORDS = Object.freeze([
  "price",
  "cost",
  "contribution",
  "yield",
  "return",
  "profit",
  "premium",
  "market",
  "appraisal",
  "sale_amount",
  "bunyang",
  "분양가",
  "분담금",
  "수익",
  "시세",
  "프리미엄",
]);

/** 2.10 검사 대상 표 */
export const PRICE_TABLES = Object.freeze(["projects", "project_events", "supply_notices", "project_stage_lenses"]);

const fold = (s) => String(s).toLowerCase().replaceAll("_", "");

/** 글자에 든 사전 낱말 (소문자로 바꾸고 밑줄을 뺀 뒤 일부 일치) */
export function priceWordsIn(text, words = PRICE_WORDS) {
  const t = fold(text ?? "");
  return words.filter((w) => t.includes(fold(w)));
}

/**
 * 칸 목록에서 위반 찾기 — columns: [{ relation, column, comment }]
 * @returns {{ relation: string, column: string, where: "name" | "comment", words: string[] }[]}
 */
export function priceFieldHits(columns, words = PRICE_WORDS) {
  const hits = [];
  for (const c of columns) {
    const byName = priceWordsIn(c.column, words);
    if (byName.length) hits.push({ relation: c.relation, column: c.column, where: "name", words: byName });
    const byComment = c.comment ? priceWordsIn(c.comment, words) : [];
    if (byComment.length) hits.push({ relation: c.relation, column: c.column, where: "comment", words: byComment });
  }
  return hits;
}

/** 대상 표 + 그 표를 읽는 public 뷰(여러 겹 포함)의 칸 — [{ relation, kind, column, comment }] */
export async function priceFieldColumns(client, tables = PRICE_TABLES) {
  const { rows } = await client.query(
    `with recursive rel(oid) as (
       select c.oid from pg_class c
        where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relname = any($1::text[])
       union
       select rw.ev_class
         from pg_depend d
         join pg_rewrite rw on rw.oid = d.objid
         join rel on d.refobjid = rel.oid
        where d.classid = 'pg_rewrite'::regclass and rw.ev_class <> rel.oid
     )
     select c.relname as relation, case when c.relkind in ('r', 'p') then 'table' else 'view' end as kind,
            a.attname as column, col_description(c.oid, a.attnum) as comment
       from rel
       join pg_class c on c.oid = rel.oid
       join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where c.relnamespace = 'public'::regnamespace
      order by c.relname, a.attnum`,
    [tables],
  );
  return rows;
}

/** 검사 — { relations: 본 표·뷰 이름, missingTables: 아직 없는 대상 표, hits } */
export async function scanPriceFields(client, { tables = PRICE_TABLES, words = PRICE_WORDS } = {}) {
  const columns = await priceFieldColumns(client, tables);
  const relations = [...new Set(columns.map((c) => c.relation))].sort();
  const missingTables = tables.filter((t) => !columns.some((c) => c.relation === t && c.kind === "table"));
  return { relations, missingTables, hits: priceFieldHits(columns, words) };
}

export function formatHits(hits) {
  return hits.map((h) => `${h.relation}.${h.column} — 칸 ${h.where === "name" ? "이름" : "설명"}에 ${h.words.join("·")}`);
}

async function main() {
  const client = await connect();
  try {
    const { relations, missingTables, hits } = await scanPriceFields(client);
    console.log(`가격 칸 검사 (PR-05 · 설계 2.10) — 본 표·뷰 ${relations.length}개: ${relations.join(", ") || "없음"}`);
    if (missingTables.length) console.log(`아직 없는 대상 표 (건너뜀): ${missingTables.join(", ")}`);
    if (hits.length) {
      console.error(`가격·분양가·분담금·수익률·시세를 뜻하는 칸 ${hits.length}건:`);
      for (const line of formatHits(hits)) console.error(`  ${line}`);
      process.exitCode = 1;
      return;
    }
    console.log("위반 0건");
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
