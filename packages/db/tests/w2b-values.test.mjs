// W2-b 값 목록 — docs/dev/W2-b_설계.md 2장 표와 DB가 같다 (w2a-values.test.mjs와 같은 방식).
//  2.1 칸마다 ① 표의 값은 모두 저장된다 ② 목록 밖 값(없는 값·대문자·빈 글자)은 check 제약 위반 ③ 제약에 적힌 값 집합이 표와 같다
//  2.2 예약 이름은 모두 거부되고(check 제약), 예약 이름이 아닌 값은 저장된다
//  2.3 공개 설정 키는 DB 공개 읽기 정책의 키 목록과 같다 (TypeScript 상수 쪽은 apps/web 시험이 같은 표를 읽는다)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const DESIGN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "dev", "W2-b_설계.md");

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

/** 설계 문서 2장의 소절(### 2.n) → Map(이름 첫 낱말 → 값 배열) */
function valueTables() {
  const md = fs.readFileSync(DESIGN, "utf8");
  const sec = md.split(/^## /m).find((s) => s.startsWith("2. 값 목록"));
  assert.ok(sec, "설계 문서 2장을 찾지 못했다");
  const out = new Map();
  for (const sub of sec.split(/^### /m).slice(1)) {
    const key = sub.match(/^(2\.\d)/)?.[1];
    const lists = new Map();
    for (const line of sub.split("\n")) {
      const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/);
      if (!m || m[1] === "이름" || /^-+$/.test(m[1])) continue;
      lists.set(m[1].split(/\s/)[0], [...m[2].matchAll(/`([^`]+)`/g)].map((x) => x[1]));
    }
    if (key) out.set(key, lists);
  }
  return out;
}
const TABLES = valueTables();
const VALUES = TABLES.get("2.1");
const RESERVED = TABLES.get("2.2");
const PUBLIC = TABLES.get("2.3");

async function tx(fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

async function attempt(sql, params = []) {
  await client.query("savepoint t");
  try {
    const res = await client.query(sql, params);
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, message: err.message, code: err.code };
  }
}

let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;

async function insert(table, cols) {
  const keys = Object.keys(cols);
  const sql = `insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
  return (await client.query(sql, keys.map((k) => cols[k]))).rows[0];
}
function tryInsert(table, cols) {
  const keys = Object.keys(cols);
  const sql = `insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
  return attempt(sql, keys.map((k) => cols[k]));
}

// 시·군·구 시험 행 — 씨앗 시·도(서울 1100000000) 아래, 시험마다 다른 코드
let codeSeq = 0;
const sigunguCode = () => `11${String(900 + (++codeSeq % 99)).padStart(3, "0")}00000`;

const TARGETS = [
  {
    list: "situations.section",
    table: "situations",
    column: "section",
    make: (v) => tryInsert("situations", { slug: uniq("s"), section: v, title: "시험 상황", pictogram: "car-sold" }),
  },
  {
    list: "home_curations.kind",
    table: "home_curations",
    column: "kind",
    make: async (v) => {
      const target =
        v === "tracker"
          ? { amendment_id: (await insert("amendments", { slug: uniq("am"), title: "시험 개정안" })).id }
          : v === "story"
            ? { article_id: (await insert("articles", { slug: uniq("a"), title: "시험 기사", section: "tax", content_type: "explainer" })).id }
            : { article_id: (await insert("articles", { slug: uniq("a"), title: "시험 기사", section: "tax", content_type: "explainer" })).id };
      return tryInsert("home_curations", { kind: v, ...target, starts_on: "2026-11-01", created_by: "user:시험" });
    },
  },
  {
    list: "regions.level",
    table: "regions",
    column: "level",
    // sido는 부모 없음·코드 뒤 8자리 0, sigungu는 부모 시·도 아래 — 단계마다 맞는 모양으로 넣어 값 자체만 시험한다
    make: (v) =>
      v === "sido"
        ? tryInsert("regions", { code: "9900000000", level: v, name: "시험 시·도", slug: uniq("sido") })
        : tryInsert("regions", { code: sigunguCode(), parent_code: "1100000000", level: v, name: "시험 구", slug: uniq("gu") }),
  },
];

test("설계 문서 2장의 표를 모두 읽었다 (시험 대상이 빠지지 않는다)", () => {
  assert.ok(VALUES && RESERVED && PUBLIC, "2.1·2.2·2.3 소절이 있어야 한다");
  const listed = new Set(TARGETS.map((t) => t.list));
  for (const name of VALUES.keys()) assert.ok(listed.has(name), `값 목록 '${name}'을 시험하지 않는다`);
  assert.deepEqual(VALUES.get("situations.section"), ["tax", "realestate", "finance", "local"]);
  assert.deepEqual(VALUES.get("home_curations.kind"), ["tracker", "story"]);
  assert.deepEqual(RESERVED.get("regions.slug"), ["events", "weekly", "places", "festivals", "food", "life"]);
  assert.equal(PUBLIC.get("home_sections").length, 9, "홈 섹션 9개 (HOME-01 + W10-i 바로가기)");
  assert.equal(PUBLIC.get("policy_links").length, 7, "기사 하단 정책 링크 7종 (ART-02)");
});

async function checkValues(table, column) {
  const { rows } = await client.query(
    `select pg_get_constraintdef(c.oid) as def
     from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.conrelid = $1::regclass and c.contype = 'c' and cardinality(c.conkey) = 1 and a.attname = $2`,
    [`public.${table}`, column],
  );
  const withList = rows.filter((r) => /ARRAY\[/.test(r.def));
  assert.equal(withList.length, 1, `${table}.${column}의 값 목록 제약이 1개가 아니다: ${JSON.stringify(rows)}`);
  return [...withList[0].def.matchAll(/'((?:[^']|'')*)'::text/g)].map((m) => m[1]).sort();
}

for (const t of TARGETS) {
  test(`${t.table}.${t.column} — '${t.list}' 값은 모두 저장되고 목록 밖 값은 거부`, () =>
    tx(async () => {
      const values = VALUES.get(t.list);
      assert.ok(values?.length, `설계 문서에 '${t.list}' 목록이 없다`);
      for (const v of values) {
        const r = await t.make(v);
        assert.ok(r.ok, `${v}: ${r.message}`);
      }
      for (const bad of ["__not_in_list__", values[0].toUpperCase(), ""]) {
        const r = await t.make(bad);
        assert.equal(r.ok, false, `목록 밖 값 '${bad}'가 저장됐다`);
        assert.equal(r.code, "23514", `'${bad}': check 제약 위반이어야 한다 (${r.message})`);
      }
      assert.deepEqual(await checkValues(t.table, t.column), [...values].sort());
    }));
}

test("regions.slug — 2.2 예약 이름은 시·도·시·군·구 어디에도 저장되지 않고, 예약 이름이 아니면 저장된다 (REG1-01)", () =>
  tx(async () => {
    const reserved = RESERVED.get("regions.slug");
    for (const slug of reserved) {
      const sido = await tryInsert("regions", { code: "9800000000", level: "sido", name: "예약 시험", slug });
      assert.equal(sido.ok, false, `시·도 slug '${slug}'가 저장됐다`);
      assert.equal(sido.code, "23514", sido.message);
      const gu = await tryInsert("regions", { code: sigunguCode(), parent_code: "1100000000", level: "sigungu", name: "예약 시험 구", slug });
      assert.equal(gu.ok, false, `시·군·구 slug '${slug}'가 저장됐다`);
      assert.equal(gu.code, "23514", gu.message);
    }
    // 예약 이름을 품은 다른 이름(앞뒤 글자 더함)은 예약 이름이 아니다
    for (const slug of ["events-hall", "weekly2", "life-zone"]) {
      const r = await tryInsert("regions", { code: sigunguCode(), parent_code: "1100000000", level: "sigungu", name: "보통 구", slug });
      assert.ok(r.ok, `${slug}: ${r.message}`);
    }
  }));

test("settings.public_keys — 공개 읽기 정책의 키 목록이 2.3 표와 같다", async () => {
  const { rows } = await client.query(
    "select pg_get_expr(polqual, polrelid) as qual from pg_policy where polrelid = 'public.settings'::regclass and polname = 'settings_public_read'",
  );
  assert.equal(rows.length, 1, "settings 공개 읽기 정책이 없다");
  const keys = [...rows[0].qual.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(keys, [...PUBLIC.get("settings.public_keys")].sort());
});
