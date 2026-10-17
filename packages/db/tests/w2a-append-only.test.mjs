// 추가만 되는 표 — 수정 이력(article_revisions)·정정 이력(article_corrections)·점검 결과(seo_checks) (W2-a 설계 3장),
// 개정 단계 기록(amendment_events, 01B TX-07), 기획 상태 기록(story_assignment_events).
// UPDATE·DELETE·TRUNCATE는 서버(service_role)와 테이블 소유자(postgres) 모두 거부한다. 추가는 서버가 한다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

async function tx(fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

async function attempt(sql, params = [], role = null) {
  await client.query("savepoint t");
  try {
    if (role) await client.query(`set local role ${role}`);
    const res = await client.query(sql, params);
    if (role) await client.query("reset role");
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, message: err.message, code: err.code };
  }
}

let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];

/** 표마다 시험 행 하나를 서버(service_role)로 추가하고 { id, column(고칠 칸) } 을 돌려준다 */
const TABLES = {
  article_revisions: {
    column: "reason",
    make: async () => {
      const a = await one("insert into public.articles (slug, title, section, content_type) values ($1, 't', 'tax', 'explainer') returning id", [uniq("a")]);
      return attempt("insert into public.article_revisions (article_id, version, title, body, edited_by) values ($1, 1, 't', '[]', 'user:기자') returning id", [a.id], "service_role");
    },
  },
  article_corrections: {
    column: "reason",
    make: async () => {
      const a = await one("insert into public.articles (slug, title, section, content_type) values ($1, 't', 'tax', 'explainer') returning id", [uniq("a")]);
      return attempt("insert into public.article_corrections (article_id, kind, reason, decided_by) values ($1, 'rebuttal', '반론 게재', 'user:편집자') returning id", [a.id], "service_role");
    },
  },
  seo_checks: {
    column: "rules_version",
    make: () =>
      attempt(
        "insert into public.seo_checks (target_type, target_id, rules_version, engine_version, scores, checked_by) values ('article', '1', 'r1', 'e1', '{\"seo\":80,\"aeo\":70,\"geo\":60,\"common\":90}', 'system') returning id",
        [],
        "service_role",
      ),
  },
  amendment_events: {
    column: "reason",
    make: async () => {
      const am = await one("insert into public.amendments (slug, title) values ($1, 't') returning id", [uniq("am")]);
      const snap = await one("insert into public.raw_snapshots (source, url, content_hash, payload) values ('mois', 'https://www.mois.go.kr/a', 'h', 'x') returning id");
      return attempt(
        "insert into public.amendment_events (amendment_id, stage, occurred_on, source_url, snapshot_id, recorded_by) values ($1, 'announced', '2026-07-25', 'https://www.mois.go.kr/a', $2, 'user:편집자') returning id",
        [am.id, snap.id],
        "service_role",
      );
    },
  },
  story_assignment_events: {
    column: "reason",
    // 이 기록은 트리거만 만든다 — 기획을 하나 만들면 한 줄이 생긴다
    make: async () => {
      const s = await attempt("insert into public.story_assignments (section) values ('tax') returning id", [], "service_role");
      return { ok: s.ok, rows: [await one("select id from public.story_assignment_events where assignment_id = $1", [s.rows[0].id])] };
    },
  },
};

for (const [table, t] of Object.entries(TABLES)) {
  test(`${table} — 서버가 추가할 수 있다`, () =>
    tx(async () => {
      const r = await t.make();
      assert.ok(r.ok, r.message);
      assert.ok(r.rows[0].id);
    }));

  for (const role of ["service_role", null]) {
    const who = role ?? "테이블 소유자(postgres)";
    test(`${table} — ${who}의 UPDATE·DELETE 거부`, () =>
      tx(async () => {
        const id = (await t.make()).rows[0].id;
        const u = await attempt(`update public.${table} set ${t.column} = '고침' where id = $1`, [id], role);
        assert.equal(u.ok, false, "UPDATE가 통과됨");
        const d = await attempt(`delete from public.${table} where id = $1`, [id], role);
        assert.equal(d.ok, false, "DELETE가 통과됨");
        assert.equal((await one(`select count(*)::int n from public.${table} where id = $1`, [id])).n, 1);
      }));
  }

  test(`${table} — TRUNCATE 거부 (소유자)`, () =>
    tx(async () => {
      const r = await attempt(`truncate public.${table} cascade`);
      assert.equal(r.ok, false);
      assert.match(r.message, /추가만/);
    }));
}
