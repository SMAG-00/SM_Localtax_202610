// W10-c 2~3단계 DB — 법령 표(마이그레이션 87) · legal_docs 확장(마이그레이션 88)  (PRD-02 PIPE-01 · PIPE-02~04 · PIPE-06 · PIPE-07)
//  · 감시 목록 씨앗 15행(지방세 12 + 연관 국세 3), 상속세·증여세 법령 이름은 어떤 형태로도 거부
//  · 개정판 — 스냅샷 없이 거부, (법령, 공포번호, 시행일자) 중복 거부, 고치기·지우기 거부
//  · 조문 — 개정판마다 새 행, 같은 개정판 같은 조 중복 거부, 고치기·지우기 거부
//  · 감지 기록 — 같은 사건 키는 1행(크론 재실행 중복 0), 개정은 개정판 필수, 해시만 바뀜은 개정판 없음, 고치기 거부
//  · 감시 상태 — 실패 기록은 감시 상태 표만 바꾸고 개정판·조문 수는 그대로
//  · anon·authenticated는 법령 표 접근 0
//  · legal_docs — 수집기 후보는 스냅샷·원천·원천 문서 번호 필수, 공개 읽기에 안 보임(권리 미확인), 같은 원천 번호 1행, 별칭 1행, 새 칸은 anon에 닫힘, 수기 입력 행은 그대로
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { open, helpers } from "./_w10c_helpers.mjs";

let client;
let h;
before(async () => {
  client = await open();
  h = helpers(client);
});
after(async () => client?.end());

const lawId = async (name = "지방세법") => (await h.one("select id from public.laws where name = $1", [name])).id;
async function version(law, over = {}) {
  const row = { law_id: law, promulgation_no: h.uniq("시험용"), promulgated_on: "2026-01-01", effective_on: "2026-02-01", body_hash: h.uniq("bh"), snapshot_id: await h.snapshot(), ...over };
  const keys = Object.keys(row);
  return h.attempt(`insert into public.law_versions (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, keys.map((k) => row[k]));
}

test("감시 목록 씨앗 — 지방세 12 + 연관 국세 3 + 쟁점 지도 관련 19(W11-d 122) + 상속·증여 감시 3(W11-g 138, scope national_igt), 그 밖 scope 에 상속세·증여세 법령은 없다", () =>
  h.tx(async () => {
    const rows = (await client.query("select name, scope from public.laws")).rows;
    assert.equal(rows.length, 37);
    assert.equal(rows.filter((r) => r.scope === "local").length, 12);
    assert.equal(rows.filter((r) => r.scope === "linked_national").length, 3);
    assert.equal(rows.filter((r) => r.scope === "related").length, 19);
    assert.equal(rows.filter((r) => r.scope === "national_igt").length, 3);
    assert.ok(rows.filter((r) => r.scope !== "national_igt").every((r) => !/상속세|증여세/.test(r.name)));
  }));

test("상속세·증여세 법령 이름은 법·시행령·시행규칙 어떤 형태로도 넣을 수 없다", () =>
  h.tx(async () => {
    for (const name of ["상속세 및 증여세법", "상속세 및 증여세법 시행령", "상속세 및 증여세법 시행규칙", "증여세법", "상속세법"]) {
      const res = await h.attempt("insert into public.laws (name, tier) values ($1, 'statute')", [name]);
      assert.equal(res.ok, false, name);
      assert.match(res.message, /laws_name_not_excluded/);
    }
    assert.ok((await h.attempt("insert into public.laws (name, tier) values ('시험용 법', 'statute')")).ok);
  }));

test("개정판 — 스냅샷 없이 거부, 같은 (법령, 공포번호, 시행일자) 중복 거부, 고치기·지우기 거부", () =>
  h.tx(async () => {
    const law = await lawId();
    const noSnap = await version(law, { snapshot_id: null });
    assert.equal(noSnap.ok, false);
    const v = await version(law, { promulgation_no: "시험용-1", effective_on: "2026-03-01" });
    assert.ok(v.ok, v.message);
    const dup = await version(law, { promulgation_no: "시험용-1", effective_on: "2026-03-01" });
    assert.equal(dup.ok, false);
    assert.ok((await version(law, { promulgation_no: "시험용-1", effective_on: "2026-04-01" })).ok, "시행일자가 다르면 새 개정판");
    assert.equal((await h.attempt("update public.law_versions set revision_kind = '바꿈' where id = $1", [v.rows[0].id])).ok, false);
    assert.equal((await h.attempt("delete from public.law_versions where id = $1", [v.rows[0].id])).ok, false);
  }));

test("조문 — 개정판마다 새 행, 같은 개정판의 같은 조·가지 번호 중복 거부, 고치기·지우기 거부, 빈 본문 거부", () =>
  h.tx(async () => {
    const law = await lawId();
    const v1 = (await version(law)).rows[0].id;
    const v2 = (await version(law)).rows[0].id;
    const ins = (v, no, br = 0, body = "시험용 조문") => h.attempt("insert into public.law_articles (version_id, article_no, branch_no, body) values ($1, $2, $3, $4) returning id", [v, no, br, body]);
    const a = await ins(v1, 1);
    assert.ok(a.ok, a.message);
    assert.ok((await ins(v1, 1, 2)).ok, "가지 번호가 다르면 다른 조");
    assert.equal((await ins(v1, 1)).ok, false);
    assert.ok((await ins(v2, 1)).ok, "새 개정판은 같은 조 번호를 새 행으로");
    assert.equal((await ins(v1, 0)).ok, false);
    assert.equal((await ins(v1, 3, 0, "   ")).ok, false);
    assert.equal((await h.attempt("update public.law_articles set body = '덮어씀' where id = $1", [a.rows[0].id])).ok, false);
    assert.equal((await h.attempt("delete from public.law_articles where id = $1", [a.rows[0].id])).ok, false);
  }));

test("감지 기록 — 같은 사건은 1행, 개정은 개정판 필수, 해시만 바뀜(body_only)은 개정판 없음", () =>
  h.tx(async () => {
    const law = await lawId();
    const v = (await version(law)).rows[0].id;
    const ev = async (kind, key, version_id = null) =>
      h.attempt("insert into public.law_events (law_id, kind, event_key, version_id, snapshot_id) values ($1, $2, $3, $4, $5) returning id", [law, kind, key, version_id, await h.snapshot()]);
    assert.ok((await ev("revision", "시험용-1|2026-02-01", v)).ok);
    assert.equal((await ev("revision", "시험용-1|2026-02-01", v)).ok, false, "크론 재실행 중복 0");
    assert.equal((await ev("revision", "시험용-2|2026-02-01", null)).ok, false, "개정은 개정판 필수");
    assert.ok((await ev("body_only", "hash-a")).ok);
    assert.equal((await ev("body_only", "hash-a")).ok, false);
    assert.equal((await ev("body_only", "hash-b", v)).ok, false, "body_only는 개정판을 달지 않는다");
    assert.ok((await ev("body_only", "hash-b")).ok);
    const row = (await ev("first_seen", "baseline", v)).rows[0];
    assert.equal((await h.attempt("update public.law_events set summary = '{}' where id = $1", [row.id])).ok, false);
    assert.equal((await h.attempt("delete from public.law_events where id = $1", [row.id])).ok, false);
    assert.equal((await ev("other", "x")).ok, false);
  }));

test("실패 기록은 감시 상태 표만 바꾸고 개정판·조문 수는 그대로 (PIPE-06)", () =>
  h.tx(async () => {
    const law = await lawId();
    const v = (await version(law)).rows[0].id;
    await client.query("insert into public.law_articles (version_id, article_no, body) values ($1, 1, '시험용 조문')", [v]);
    await client.query("insert into public.law_watch_state (law_id) values ($1)", [law]);
    const before = (await h.one("select (select count(*)::int from public.law_versions) v, (select count(*)::int from public.law_articles) a, (select count(*)::int from public.law_events) e")).v;
    const counts = async () => h.one("select (select count(*)::int from public.law_versions) v, (select count(*)::int from public.law_articles) a, (select count(*)::int from public.law_events) e");
    const b = await counts();
    const up = await h.attempt("update public.law_watch_state set status = 'api_error', fail_count = fail_count + 1, last_error = '법령 API 오류 (HTTP 502)', last_checked_at = now() where law_id = $1", [law], "service_role");
    assert.ok(up.ok, up.message);
    assert.deepEqual(await counts(), b);
    assert.ok(before >= 1);
    assert.equal((await h.attempt("update public.law_watch_state set status = 'broken' where law_id = $1", [law])).ok, false);
    assert.equal((await h.attempt("update public.law_watch_state set last_error = $2 where law_id = $1", [law, "x".repeat(501)])).ok, false);
  }));

test("anon·authenticated는 법령 표·감시 상태·별칭에 접근할 수 없다", () =>
  h.tx(async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const t of ["laws", "law_versions", "law_articles", "law_events", "law_watch_state", "legal_doc_aliases"]) {
        assert.equal((await h.attempt(`select * from public.${t}`, [], role)).ok, false, `${role}: ${t}`);
      }
    }
  }));

const doc = (over = {}) => {
  const row = { doc_type: "interpretation", origin: "pipeline", source_key: "mois_interpretation", source_doc_id: h.uniq("D"), ...over };
  const keys = Object.keys(row);
  return h.attempt(`insert into public.legal_docs (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id, rights_status`, keys.map((k) => row[k]));
};

test("수집기 후보 문서 — 스냅샷·원천·원천 문서 번호가 모두 있어야 하고, 공개 읽기에는 보이지 않는다", async () =>
  h.tx(async () => {
    assert.equal((await doc({ snapshot_id: null })).ok, false, "스냅샷 없음");
    assert.equal((await doc({ snapshot_id: await h.snapshot(), source_key: null })).ok, false, "원천 없음");
    assert.equal((await doc({ snapshot_id: await h.snapshot(), source_doc_id: null })).ok, false, "원천 문서 번호 없음");
    const ok = await doc({ snapshot_id: await h.snapshot(), decision_kind: "dismissed" });
    assert.ok(ok.ok, ok.message);
    assert.equal(ok.rows[0].rights_status, "unchecked");
    await client.query("set local role anon");
    const seen = (await client.query("select count(*)::int n from public.legal_docs where id = $1", [ok.rows[0].id])).rows[0].n;
    await client.query("reset role");
    assert.equal(seen, 0, "권리 미확인 후보는 공개 읽기에 없음");
    assert.equal((await doc({ snapshot_id: await h.snapshot(), decision_kind: "free_text" })).ok, false);
  }));

test("같은 원천·같은 문서 번호는 1행, 다른 원천의 번호는 별칭으로 같은 문서에 대응(중복 표시 0)", () =>
  h.tx(async () => {
    const snap = await h.snapshot();
    const a = await doc({ snapshot_id: snap, source_doc_id: "D-100" });
    assert.ok(a.ok, a.message);
    assert.equal((await doc({ snapshot_id: await h.snapshot(), source_doc_id: "D-100" })).ok, false);
    const alias = (src, id) => h.attempt("insert into public.legal_doc_aliases (legal_doc_id, source_key, source_doc_id, snapshot_id) values ($1, $2, $3, $4) returning id", [a.rows[0].id, src, id, snap]);
    const first = await alias("admrul", "X-9");
    assert.ok(first.ok, first.message);
    assert.equal((await alias("admrul", "X-9")).ok, false, "같은 원천 번호의 별칭은 1행");
    assert.equal((await h.attempt("update public.legal_doc_aliases set source_doc_id = 'Y' where id = $1", [first.rows[0].id])).ok, false);
    assert.equal((await h.attempt("delete from public.legal_doc_aliases where id = $1", [first.rows[0].id])).ok, false);
  }));

test("수기 입력 문서(origin manual)는 그대로 넣을 수 있고, 새 칸은 anon·authenticated에 열려 있지 않다", () =>
  h.tx(async () => {
    const manual = await h.attempt("insert into public.legal_docs (doc_type) values ('ruling') returning id, origin, source_key");
    assert.ok(manual.ok, manual.message);
    assert.equal(manual.rows[0].origin, "manual");
    assert.equal(manual.rows[0].source_key, null);
    for (const role of ["anon", "authenticated"]) {
      for (const col of ["origin", "source_key", "source_doc_id", "decision_kind"]) {
        assert.equal((await h.attempt(`select ${col} from public.legal_docs`, [], role)).ok, false, `${role}.${col}`);
      }
      assert.ok((await h.attempt("select id, doc_type from public.legal_docs", [], role)).ok, `${role}: 기존 공개 열은 그대로`);
    }
  }));
