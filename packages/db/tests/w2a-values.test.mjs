// W2-a 값 목록 — docs/dev/W2-a_설계.md 2장 표의 값과 DB check 제약이 같다 (TypeScript 타입도 같은 표를 쓴다).
// 표를 읽어 칸마다 ① 표의 값은 모두 저장된다 ② 목록 밖 값(없는 값·대문자·빈 문자열)은 거부된다
// ③ 그 칸의 check 제약에 적힌 값 집합이 표와 같다 (값을 더하거나 빼면 이 시험이 잡는다).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const DESIGN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "dev", "W2-a_설계.md");

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

/** 설계 문서 2장 표 → Map(이름 첫 낱말 → 값 배열) */
function valueLists() {
  const md = fs.readFileSync(DESIGN, "utf8");
  const sec = md.split(/^## /m).find((s) => s.startsWith("2. 값 목록"));
  assert.ok(sec, "설계 문서 2장을 찾지 못했다");
  const lists = new Map();
  for (const line of sec.split("\n")) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/);
    if (!m || m[1] === "이름" || /^-+$/.test(m[1])) continue;
    lists.set(m[1].split(/\s/)[0], [...m[2].matchAll(/`([^`]+)`/g)].map((x) => x[1]));
  }
  return lists;
}
const LISTS = valueLists();

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

function insertSql(table, cols) {
  const keys = Object.keys(cols);
  return {
    sql: `insert into public.${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
    params: keys.map((k) => cols[k]),
  };
}
async function insert(table, cols) {
  const { sql, params } = insertSql(table, cols);
  return (await client.query(sql, params)).rows[0];
}
async function tryInsert(table, cols) {
  const { sql, params } = insertSql(table, cols);
  return attempt(sql, params);
}

// 시험 행 재료 — 모두 postgres(소유자)로 만든다
const person = () => insert("people", { slug: uniq("p"), name: "시험 인물", roles: ["reporter"] });
const authUser = async () => (await client.query("insert into auth.users (id) values (gen_random_uuid()) returning id")).rows[0].id;
const snapshot = () => insert("raw_snapshots", { source: "시험", url: "https://example.go.kr/a", content_hash: "h1", payload: "원문" });
async function article(over = {}) {
  return insert("articles", { slug: uniq("a"), title: "시험 기사", section: "tax", content_type: "explainer", ...over });
}
const OFFICIAL = { source_url: "https://example.go.kr/doc", source_name: "행정안전부", last_verified_at: new Date(), license_status: "공공누리 제1유형", license_type: "kogl_1" };

/** 칸마다: 값 → 그 값으로 행 하나를 넣는 시도 */
const TARGETS = [
  { list: "section", table: "articles", column: "section", make: (v) => tryInsert("articles", { slug: uniq("a"), title: "t", section: v, content_type: "explainer" }) },
  { list: "section", table: "categories", column: "section", make: (v) => tryInsert("categories", { section: v, slug: uniq("c"), name: uniq("분야") }) },
  { list: "section", table: "story_assignments", column: "section", make: (v) => tryInsert("story_assignments", { section: v }) },
  { list: "section", table: "legacy_category_map", column: "section", make: (v) => tryInsert("legacy_category_map", { legacy_name: uniq("옛"), section: v }) },
  {
    list: "content_type",
    table: "articles",
    column: "content_type",
    make: (v) =>
      tryInsert("articles", { slug: uniq("a"), title: "t", section: "tax", content_type: v, label: v === "sponsored" ? "ad" : "none", digest_id: v === "digest" ? 1 : null }),
  },
  {
    list: "reporting_method",
    table: "articles",
    column: "reporting_method",
    make: (v) => tryInsert("articles", { slug: uniq("a"), title: "t", section: "tax", content_type: "reported_news", reporting_method: v }),
  },
  { list: "reporting_method", table: "story_assignments", column: "method", make: (v) => tryInsert("story_assignments", { section: "tax", method: v }) },
  { list: "format", table: "articles", column: "format", make: (v) => tryInsert("articles", { slug: uniq("a"), title: "t", section: "tax", content_type: "explainer", format: v }) },
  {
    list: "label",
    table: "articles",
    column: "label",
    make: async (v) => {
      const partner = await insert("partners", { name: "시험 제휴사", kind: "media" });
      return tryInsert("articles", {
        slug: uniq("a"),
        title: "t",
        section: "tax",
        content_type: v === "none" ? "explainer" : "sponsored",
        label: v,
        partner_id: partner.id,
      });
    },
  },
  { list: "subtype", table: "articles", column: "subtype", make: (v) => tryInsert("articles", { slug: uniq("a"), title: "t", section: "tax", content_type: "explainer", subtype: v }) },
  {
    list: "status",
    table: "articles",
    column: "status",
    make: (v) => tryInsert("articles", { slug: uniq("a"), title: "t", section: "tax", content_type: "explainer", status: v, publish_at: new Date() }),
  },
  {
    list: "update_kind",
    table: "articles",
    column: "update_kind",
    make: (v) => tryInsert("articles", { slug: uniq("a"), title: "t", section: "tax", content_type: "explainer", update_kind: v, updated_reason: "보강" }),
  },
  {
    list: "update_kind",
    table: "article_revisions",
    column: "update_kind",
    make: async (v) => {
      const a = await article();
      return tryInsert("article_revisions", { article_id: a.id, version: 2, title: "t", body: "[]", edited_by: "user:시험", reason: "보강", update_kind: v });
    },
  },
  {
    list: "article_sources.kind",
    table: "article_sources",
    column: "kind",
    make: async (v) => tryInsert("article_sources", { article_id: (await article()).id, kind: v, title: "출처", ...OFFICIAL }),
  },
  {
    list: "article_evidence.evidence_type",
    table: "article_evidence",
    column: "evidence_type",
    make: async (v) => tryInsert("article_evidence", { article_id: (await article()).id, evidence_type: v, location: "보관함 A-1" }),
  },
  {
    list: "editorial_reviews.kind",
    table: "editorial_reviews",
    column: "kind",
    make: async (v) => {
      const a = await article({ author_id: (await person()).id });
      return tryInsert("editorial_reviews", { article_id: a.id, kind: v, reviewer_id: (await person()).id, decision: "approve" });
    },
  },
  {
    list: "editorial_reviews.decision",
    table: "editorial_reviews",
    column: "decision",
    make: async (v) => {
      const a = await article({ author_id: (await person()).id });
      return tryInsert("editorial_reviews", { article_id: a.id, kind: "desk_edit", reviewer_id: (await person()).id, decision: v, reason: "사유" });
    },
  },
  {
    list: "article_corrections.kind",
    table: "article_corrections",
    column: "kind",
    make: async (v) => {
      const a = await article();
      const r1 = await insert("article_revisions", { article_id: a.id, version: 1, title: "전", body: "[]", edited_by: "user:시험" });
      const r2 = await insert("article_revisions", { article_id: a.id, version: 2, title: "후", body: "[]", edited_by: "user:시험", reason: "정정", update_kind: "correction" });
      return tryInsert("article_corrections", { article_id: a.id, kind: v, before_revision_id: r1.id, after_revision_id: r2.id, reason: "사실 오류", decided_by: "user:편집자" });
    },
  },
  {
    list: "story_assignments.status",
    table: "story_assignments",
    column: "status",
    // published는 fact_check·review를 거쳐야만 된다 — 거쳐 간 뒤 저장되는지 본다
    make: async (v) => {
      const ready = { section: "tax", reporter_id: (await person()).id, editor_id: (await person()).id, conflicts: "없음", relevance: "취득세 세수 영향" };
      if (v !== "published") return tryInsert("story_assignments", { ...ready, status: v });
      const s = await insert("story_assignments", { ...ready, status: "assigned" });
      for (const step of ["reporting", "fact_check", "review"]) await client.query("update public.story_assignments set status = $2 where id = $1", [s.id, step]);
      return attempt("update public.story_assignments set status = $2 where id = $1 returning *", [s.id, v]);
    },
  },
  {
    list: "staff_roles.role",
    table: "staff_roles",
    column: "role",
    make: async (v) => tryInsert("staff_roles", { user_id: await authUser(), role: v, granted_by: "admin:시험" }),
  },
  {
    list: "개정",
    table: "amendment_events",
    column: "stage",
    make: async (v) => {
      const am = await insert("amendments", { slug: uniq("am"), title: "시험 개정안" });
      return tryInsert("amendment_events", {
        amendment_id: am.id,
        stage: v,
        occurred_on: "2026-08-01",
        source_url: "https://www.mois.go.kr/a",
        snapshot_id: (await snapshot()).id,
        recorded_by: "user:편집자",
      });
    },
  },
  {
    list: "article_evidence.rights_status",
    table: "article_evidence",
    column: "rights_status",
    make: async (v) => tryInsert("article_evidence", { article_id: (await article()).id, evidence_type: "document", location: "보관함 A-1", rights_status: v }),
  },
  {
    list: "media.rights_status",
    table: "media",
    column: "rights_status",
    // 권리 확인(confirmed)은 출처·이용 조건·확인일·촬영자가 있어야 한다 — 모두 채워 값 자체만 시험한다
    make: (v) =>
      tryInsert("media", { path: uniq("m"), credit: "가온시", license: "공공누리 제1유형", license_type: "kogl_1", checked_at: new Date(), photographer: "시험 촬영자", rights_status: v }),
  },
  {
    list: "article_evidence.verification_status",
    table: "article_evidence",
    column: "verification_status",
    make: async (v) => tryInsert("article_evidence", { article_id: (await article()).id, evidence_type: "document", location: "보관함 A-1", verification_status: v }),
  },
  {
    list: "articles.editorial_status",
    table: "articles",
    column: "editorial_status",
    // approved는 편집 승인 기록(desk_edit approve)으로만 된다 (3장) — 기록을 넣어 저장되는지 본다
    make: (v) => (v === "approved" ? approvedByReview("desk_edit", "editorial_status") : tryInsert("articles", { slug: uniq("a"), title: "t", section: "tax", content_type: "explainer", editorial_status: v })),
  },
  {
    list: "articles.tax_review_status",
    table: "articles",
    column: "tax_review_status",
    make: (v) => (v === "approved" ? approvedByReview("tax_review", "tax_review_status") : tryInsert("articles", { slug: uniq("a"), title: "t", section: "tax", content_type: "explainer", tax_review_status: v })),
  },
];

/** 다른 사람의 승인 기록을 넣은 뒤 기사의 상태 칸이 approved로 저장됐는지 */
async function approvedByReview(kind, column) {
  const a = await article({ author_id: (await person()).id });
  const r = await tryInsert("editorial_reviews", { article_id: a.id, kind, reviewer_id: (await person()).id, decision: "approve" });
  if (!r.ok) return r;
  const { rows } = await client.query(`select ${column} as status from public.articles where id = $1`, [a.id]);
  return rows[0].status === "approved" ? { ok: true, rows } : { ok: false, message: `승인 기록 뒤 ${column} = ${rows[0].status}` };
}

test("설계 문서 2장의 값 목록을 모두 읽었다 (시험 대상이 빠지지 않는다)", () => {
  const listed = new Set(TARGETS.map((t) => t.list));
  for (const name of LISTS.keys()) assert.ok(listed.has(name), `값 목록 '${name}'을 시험하지 않는다`);
  assert.equal(LISTS.get("section").length, 4);
  assert.equal(LISTS.get("staff_roles.role").length, 7);
  assert.equal(LISTS.get("개정").length, 6);
  assert.deepEqual(LISTS.get("media.rights_status"), ["unconfirmed", "confirmed", "rejected"]);
  assert.deepEqual(LISTS.get("articles.tax_review_status"), ["not_required", "pending", "approved", "rejected", "held"]);
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
      const values = LISTS.get(t.list);
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
