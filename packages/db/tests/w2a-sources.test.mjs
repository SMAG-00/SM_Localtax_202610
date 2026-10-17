// 공개 출처(article_sources) — FND-04 · REG1-09 · NAV-02.
// kind가 official_doc·dataset인 행은 출처 URL(source_url)·발표기관(source_name)·확인일(last_verified_at)·권리 상태(license_status)가
// 비면 DB 제약이 거부한다 (직접 SQL로도). 보도자료 등 다른 종류는 이 칸 없이 저장된다.
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
async function publishedArticle() {
  return (await client.query("insert into public.articles (slug, title, section, content_type, status) values ($1, 't', 'local', 'reported_news', 'published') returning id", [uniq("a")])).rows[0].id;
}
const FULL = {
  title: "2026 지방세 세수 결산",
  source_url: "https://www.mois.go.kr/frt/a01.do",
  source_name: "행정안전부",
  last_verified_at: "2026-10-16T10:00:00+09:00",
  license_status: "공공누리 제1유형",
};
function insertSource(articleId, kind, cols, role = "service_role") {
  const all = { article_id: articleId, kind, ...cols };
  const keys = Object.keys(all);
  return attempt(
    `insert into public.article_sources (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    keys.map((k) => all[k]),
    role,
  );
}

for (const kind of ["official_doc", "dataset"]) {
  test(`${kind} — 네 칸이 모두 있으면 저장된다`, () =>
    tx(async () => {
      const r = await insertSource(await publishedArticle(), kind, FULL);
      assert.ok(r.ok, r.message);
    }));

  for (const field of ["source_url", "source_name", "last_verified_at", "license_status"]) {
    test(`${kind} — ${field}가 비면 거부 (공개 기사에 직접 SQL로 넣어도, 소유자도)`, () =>
      tx(async () => {
        const id = await publishedArticle();
        const blanks = field === "last_verified_at" ? [null] : [null, "", "   "];
        for (const blank of blanks) {
          for (const role of ["service_role", null]) {
            const r = await insertSource(id, kind, { ...FULL, [field]: blank }, role);
            assert.equal(r.ok, false, `${field}=${JSON.stringify(blank)} (${role ?? "소유자"})가 저장됐다`);
            assert.equal(r.code, "23514");
          }
        }
      }));
  }

  test(`${kind} — 저장한 뒤 네 칸 중 하나를 지우는 수정도 거부`, () =>
    tx(async () => {
      const r = await insertSource(await publishedArticle(), kind, FULL);
      for (const field of ["source_url", "source_name", "last_verified_at", "license_status"]) {
        const u = await attempt(`update public.article_sources set ${field} = null where id = $1`, [r.rows[0].id], "service_role");
        assert.equal(u.ok, false, field);
      }
    }));
}

for (const kind of ["press_release", "interview", "field", "photo", "other"]) {
  test(`${kind} — 출처 URL·발표기관·확인일·권리 상태 없이도 저장된다`, () =>
    tx(async () => {
      const r = await insertSource(await publishedArticle(), kind, { title: "자료" });
      assert.ok(r.ok, r.message);
    }));
}

test("원자료 행의 새 버전(supersedes_id)은 수정 사유가 있어야 한다 (REG1-09)", () =>
  tx(async () => {
    const id = await publishedArticle();
    const first = await insertSource(id, "dataset", FULL);
    for (const reason of [null, "", " "]) {
      const r = await insertSource(id, "dataset", { ...FULL, supersedes_id: first.rows[0].id, revision_reason: reason });
      assert.equal(r.ok, false, JSON.stringify(reason));
    }
    const ok = await insertSource(id, "dataset", { ...FULL, supersedes_id: first.rows[0].id, revision_reason: "확정치 반영" });
    assert.ok(ok.ok, ok.message);
  }));

test("원본 스냅샷은 raw_snapshots의 행만 가리킨다", () =>
  tx(async () => {
    const id = await publishedArticle();
    assert.equal((await insertSource(id, "official_doc", { ...FULL, snapshot_id: -1 })).ok, false);
    const snap = (await client.query("insert into public.raw_snapshots (source, url, content_hash, payload) values ('mois', $1, 'abc', '원문') returning id", [FULL.source_url])).rows[0].id;
    assert.ok((await insertSource(id, "official_doc", { ...FULL, snapshot_id: snap })).ok);
  }));
