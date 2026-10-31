// W4 5단계 DB — 공식 자료 규칙 (docs/dev/W4_설계.md 1장 5단계 · 2.1 · 2.2 · 3장 · 12장 #13·#22, 마이그레이션 20261022000041 · PRD-01B REG1-07 · REG1-09 · REG1-13 · PR-07)
//  · 값 목록 — 공공누리 6값(article_sources·media check) · 자료 종류 허용 6종(설정 씨앗) · 차단 4종 = 설계 2.1 글자
//  · 공공누리 유형 — 공식 자료·보도자료·사진 출처는 필수(초안 기사에도), 권리 확인 이미지는 필수. 목록 밖 값 거부
//  · 자료 종류 — 허용 목록 값만, 차단 4종은 출처에도 설정에도 못 넣는다, 공식 자료 행에만
//  · 발행 검사 — 공식 자료의 발표일·기준일·지역 단위·수집일·확인일·공공누리 유형 중 하나라도 비면 published·scheduled 거부(빈 칸 이름),
//    이미 발행된 기사에 넣는 출처도 같은 검사(한쪽만 우회한 삽입도 실패) · 고시·조례 자료를 쓴 해설은 세무 감수 승인 없이 거부(보도는 감수 불필요)
//  · 원자료 새 버전 — 값이 있던 칸 덮어쓰기 거부, 빈 칸 채우기·확인일 갱신은 됨, 새 버전은 사유 필수·한 번만·같은 기사만, 스냅샷 그대로, 대체된 옛 행은 발행 검사 밖
//  · 이미지 — 공개 렌더 가능 = 유형이 kogl_usage.photoTypes(씨앗 제1유형·자체 촬영)에 있음, 제4유형·미표시는 설정으로도 못 엶, 설정을 바꾸면 다시 계산 ·
//    crop_allowed 기본 true · anon은 렌더 가능 이미지와 새 칸만 읽고 검사 함수는 실행 못 함
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN = fs.readFileSync(path.join(HERE, "..", "..", "..", "docs", "dev", "W4_설계.md"), "utf8");
const line = (prefix) => {
  const l = DESIGN.split("\n").find((x) => x.startsWith(prefix));
  assert.ok(l, `설계 문서에 '${prefix}' 줄이 없다`);
  return l;
};
const codes = (prefix, col = 2) => [...line(prefix).split("|")[col].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const LICENSE_TYPES = codes("| article_source.license_type · media.license_type (공공누리) |");
const ALLOWED_TYPES = codes("| official_source_type (허용 — 설정");
const BLOCKED_TYPES = codes("| official_source_type (차단 — 설정에도 못 넣는다) |");
const KOGL_SEED = JSON.parse(line("| `kogl_usage` |").split("|")[2].match(/`(\{[^`]+\})`/)[1]);

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

async function attempt(sql, params = [], role = null) {
  await client.query("savepoint t");
  try {
    if (role) await client.query(`set local role ${role}`);
    const res = await client.query(sql, params);
    if (role) await client.query("reset role");
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows, rowCount: res.rowCount };
  } catch (err) {
    await client.query("rollback to savepoint t");
    return { ok: false, message: err.message, code: err.code };
  }
}

async function tx(fn) {
  await client.query("begin");
  try {
    return await fn();
  } finally {
    await client.query("rollback");
  }
}

let seq = 0;
const uniq = (p) => `${p}-${process.pid}-${++seq}`;

async function article(over = {}) {
  const row = { slug: uniq("w4os"), title: "시험용 공식 자료 기사", section: "local", content_type: "reported_news", status: "draft", region_codes: ["1100000000"], editorial_field: "local_tax", public_question: "시험용 공익적 질문", ...over };
  const keys = Object.keys(row);
  return (await client.query(`insert into public.articles (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => row[k]))).rows[0];
}

/** 공식 자료 한 행의 칸이 모두 찬 모양 (가짜 발표기관·가짜 주소) */
const FULL = {
  title: "시험용 가상구 지방세 세수 결산",
  source_url: "https://gasang.example/open/tax-2026",
  source_name: "시험용 가상구청",
  last_verified_at: "2026-10-20T10:00:00+09:00",
  license_status: "공공누리 제1유형",
  license_type: "kogl_1",
  source_type: "local_tax_revenue",
  published_on: "2026-10-01",
  reference_date: "2026-06-30",
  region_unit: "시·군·구",
  collected_at: "2026-10-15T09:00:00+09:00",
};

function source(articleId, kind, cols, role = null) {
  const all = { article_id: articleId, kind, ...cols };
  const keys = Object.keys(all);
  return attempt(
    `insert into public.article_sources (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
    keys.map((k) => all[k]),
    role,
  );
}
const DESK_FULL = { evidence: true, relation: true, ad_independence: true };
/**
 * 발행 — W4 8단계부터 지역 기사는 단계를 밟아야 공개된다(초안 → 편집 승인(지역 기사 3항목) → 승인 → 발행, REG1-14 · …44 articles_stage_order).
 * 편집 승인·승인 단계를 밟은 뒤 발행 상태로 바꾼다. 실패하면 그 문장(발행 검사 문장은 7단계·5단계 트리거가 먼저 낸다). 한 번에 되돌린다
 */
async function publish(id) {
  await client.query("savepoint p");
  try {
    const desk = (await client.query("insert into public.people (slug, name, roles) values ($1, '시험용 편집 책임자', '{editor}') returning id", [uniq("desk")])).rows[0].id;
    await client.query("insert into public.editorial_reviews (article_id, kind, reviewer_id, decision, checklist) values ($1, 'desk_edit', $2, 'approve', $3)", [id, desk, JSON.stringify(DESK_FULL)]);
    await client.query("update public.articles set status = 'approved' where id = $1 and status not in ('approved', 'published', 'scheduled')", [id]);
    const res = await client.query("update public.articles set status = 'published' where id = $1 returning status, first_published_at", [id]);
    await client.query("release savepoint p");
    return { ok: true, rows: res.rows, rowCount: res.rowCount };
  } catch (err) {
    await client.query("rollback to savepoint p");
    return { ok: false, message: err.message, code: err.code };
  }
}
const setSetting = (key, value) => attempt("update public.settings set value = $1::jsonb where key = $2", [JSON.stringify(value), key]);
const checkValues = async (constraint) => {
  const def = (await client.query("select pg_get_constraintdef(oid) d from pg_constraint where conname = $1", [constraint])).rows[0]?.d ?? "";
  return [...def.matchAll(/'([a-z0-9_]+)'::text/g)].map((m) => m[1]);
};

test("값 목록 — 공공누리 6값·자료 종류 허용 6종·차단 4종·kogl_usage 씨앗 = 설계 2.1·2.2 글자, DB check·설정 씨앗과 같다", async () => {
  assert.deepEqual(LICENSE_TYPES, ["kogl_1", "kogl_2", "kogl_3", "kogl_4", "unmarked", "not_applicable"]);
  assert.deepEqual(ALLOWED_TYPES, ["ordinance", "notice", "budget_settlement", "local_tax_revenue", "realestate_transaction", "redevelopment"]);
  assert.deepEqual(BLOCKED_TYPES, ["transport", "tourism", "restaurant", "living_guide"]);
  assert.deepEqual(await checkValues("article_sources_license_type_check"), LICENSE_TYPES, "article_sources.license_type check = 2.1");
  assert.deepEqual(await checkValues("media_license_type_check"), LICENSE_TYPES, "media.license_type check = 2.1");
  const settings = Object.fromEntries((await client.query("select key, value from public.settings where key in ('official_source_types', 'kogl_usage')")).rows.map((r) => [r.key, r.value]));
  assert.deepEqual(settings.official_source_types, ALLOWED_TYPES, "official_source_types 씨앗 = 2.1 허용 6종");
  assert.deepEqual(KOGL_SEED, { photoTypes: ["kogl_1", "not_applicable"], fullTextTypes: [] }, "12장 #13 권고 기본값");
  assert.deepEqual(settings.kogl_usage, KOGL_SEED, "kogl_usage 씨앗 = 2.2");
  for (const t of BLOCKED_TYPES) assert.ok(!ALLOWED_TYPES.includes(t), `${t}는 허용 목록 밖`);
});

test("공공누리 유형 — 공식 자료·보도자료·사진 출처는 비면 저장 거부(초안 기사에도), 다른 종류는 없어도 된다, 목록 밖 값 거부", () =>
  tx(async () => {
    const a = await article();
    for (const kind of ["official_doc", "dataset", "press_release", "photo"]) {
      const cols = kind === "official_doc" || kind === "dataset" ? { ...FULL, license_type: null } : { title: "시험용 자료" };
      const r = await source(a.id, kind, cols, "service_role");
      assert.equal(r.ok, false, `${kind} 유형 없이 저장됐다`);
      assert.equal(r.code, "23514");
      assert.match(r.message, /article_sources_license_required/);
      assert.ok((await source(a.id, kind, kind === "official_doc" || kind === "dataset" ? FULL : { title: "시험용 자료", license_type: "unmarked" })).ok, `${kind} 유형 있으면 저장`);
    }
    for (const kind of ["interview", "field", "other"]) assert.ok((await source(a.id, kind, { title: "시험용 자료" })).ok, kind);
    for (const v of LICENSE_TYPES) assert.ok((await source(a.id, "press_release", { title: v, license_type: v })).ok, v);
    assert.equal((await source(a.id, "press_release", { title: "x", license_type: "kogl_5" })).code, "23514", "목록 밖 값");
  }));

test("자료 종류 — 허용 목록 값만, 차단 4종은 출처에도 설정에도 못 넣는다, 설정에 더한 새 종류는 저장된다, 공식 자료 행에만", () =>
  tx(async () => {
    const a = await article();
    for (const t of ALLOWED_TYPES) assert.ok((await source(a.id, "official_doc", { ...FULL, source_type: t })).ok, t);
    for (const t of BLOCKED_TYPES) {
      const r = await source(a.id, "official_doc", { ...FULL, source_type: t });
      assert.equal(r.ok, false, t);
      assert.match(r.message, /교통·관광·음식점·생활 안내/);
      const s = await setSetting("official_source_types", [...ALLOWED_TYPES, t]);
      assert.equal(s.ok, false, `설정에 ${t}`);
      assert.equal(s.code, "23514");
      assert.match(s.message, /코드 고정/);
    }
    const unknown = await source(a.id, "dataset", { ...FULL, source_type: "school_meal" });
    assert.equal(unknown.ok, false);
    assert.match(unknown.message, /허용 목록\(official_source_types\)에 없습니다/);
    assert.ok((await setSetting("official_source_types", [...ALLOWED_TYPES, "school_meal"])).ok, "편집국이 더한 종류");
    assert.ok((await source(a.id, "dataset", { ...FULL, source_type: "school_meal" })).ok, "더한 뒤에는 저장");
    for (const bad of [[], "notice", ["notice", "notice"], ["Notice"], [1]]) assert.equal((await setSetting("official_source_types", bad)).ok, false, JSON.stringify(bad));
    const onPress = await source(a.id, "press_release", { title: "시험용 보도자료", license_type: "kogl_1", source_type: "notice" });
    assert.equal(onPress.ok, false);
    assert.match(onPress.message, /공식 자료\(official_doc·dataset\) 출처에만/);
    assert.ok((await source(a.id, "official_doc", { ...FULL, source_type: null })).ok, "자료 종류는 비워도 된다 (법령 출처)");
  }));

test("발행 검사 — 공식 자료의 발표일·기준일·지역 단위·수집일·확인일·공공누리 유형 중 하나라도 비면 published·scheduled 거부 + 빈 칸 이름", () =>
  tx(async () => {
    const cases = [
      ["published_on", null, "발표일(publishedOn)"],
      ["reference_date", null, "기준일(referenceDate)"],
      ["region_unit", "  ", "지역 단위(regionUnit)"],
      ["collected_at", null, "수집일(collectedAt)"],
    ];
    for (const [col, blank, label] of cases) {
      for (const kind of ["official_doc", "dataset"]) {
        const a = await article();
        assert.ok((await source(a.id, kind, { ...FULL, [col]: blank })).ok, `초안에는 ${col} 없이 저장`);
        const r = await publish(a.id);
        assert.equal(r.ok, false, `${kind} ${col} 빈 채 발행됐다`);
        assert.equal(r.code, "23514");
        assert.ok(r.message.includes(label), `${r.message} — ${label}`);
        const s = await attempt("update public.articles set status = 'scheduled', publish_at = now() + interval '1 day' where id = $1", [a.id]);
        assert.equal(s.ok, false, `${kind} ${col} 빈 채 예약됐다`);
        // 빈 칸을 채우면(값이 없던 칸 — 새 버전 불필요) 발행된다
        assert.ok((await attempt(`update public.article_sources set ${col} = $1 where article_id = $2`, [FULL[col], a.id])).ok, `${col} 채우기`);
        assert.ok((await publish(a.id)).ok, `${kind} ${col} 채운 뒤 발행`);
      }
    }
    const ok = await article();
    assert.ok((await source(ok.id, "official_doc", FULL)).ok);
    assert.ok((await source(ok.id, "press_release", { title: "시험용 보도자료", license_type: "kogl_4" })).ok);
    assert.ok((await publish(ok.id)).ok, "칸이 모두 찬 공식 자료 + 유형 있는 보도자료 → 발행");
    // 직접 published로 넣은 기사에 빈 칸 공식 자료를 넣는 우회도 실패
    const pub = await article({ status: "published" });
    const bypass = await source(pub.id, "dataset", { ...FULL, reference_date: null }, "service_role");
    assert.equal(bypass.ok, false, "발행된 기사에 빈 칸 공식 자료");
    assert.match(bypass.message, /기준일\(referenceDate\)/);
    assert.ok((await source(pub.id, "dataset", FULL)).ok, "칸이 모두 찬 자료는 더할 수 있다");
    // 이미 발행된 기사의 다른 칸 고치기는 막지 않는다
    assert.ok((await attempt("update public.articles set summary = '시험용 요약' where id = $1", [ok.id])).ok);
  }));

test("고시·조례 해설 — 간편 발행(2026-10-31 PO 결정): 세무 감수 승인 없이도 발행되고(작성자 책임), 세무 감수 상태는 approved가 되지 않는다 · 공식 자료 칸 검사는 그대로", () =>
  tx(async () => {
    for (const sourceType of ["notice", "ordinance"]) {
      for (const contentType of ["explainer", "guide", "reported_news"]) {
        const a = await article({ content_type: contentType });
        assert.ok((await source(a.id, "official_doc", { ...FULL, source_type: sourceType })).ok);
        const r = await publish(a.id);
        assert.ok(r.ok, `${contentType} + ${sourceType} 감수 없이 발행: ${r.message ?? ""}`);
        const row = (await client.query("select status, tax_review_status from public.articles where id = $1", [a.id])).rows[0];
        assert.equal(row.status, "published");
        assert.notEqual(row.tax_review_status, "approved", "감수 기록 없이 감수 완료 상태가 되지 않는다");
      }
    }
    // 발행된 해설에 고시 자료를 더해도 된다 — 공식 자료 칸이 빠진 출처는 여전히 거부(REG1-09)
    const plain = await article({ content_type: "explainer" });
    assert.ok((await source(plain.id, "dataset", { ...FULL, source_type: "budget_settlement" })).ok);
    assert.ok((await publish(plain.id)).ok);
    assert.ok((await source(plain.id, "official_doc", { ...FULL, source_type: "notice" }, "service_role")).ok, "감수 없는 발행 해설에 고시 자료 추가");
    const missing = await source(plain.id, "official_doc", { ...FULL, source_type: "notice", reference_date: null }, "service_role");
    assert.equal(missing.ok, false, "공식 자료 칸이 빈 출처는 발행 기사에 넣을 수 없다");
  }));

test("원자료 새 버전 — 값이 있던 칸은 덮어쓰기 거부, 확인일 갱신·빈 칸 채우기는 됨, 새 버전은 사유 필수·한 번만·같은 기사만, 스냅샷 그대로", () =>
  tx(async () => {
    const a = await article();
    const other = await article();
    const snap = (await client.query("insert into public.raw_snapshots (source, url, content_hash, payload) values ('시험용', $1, 'sha256:aa', '시험용 원문 글') returning id", [FULL.source_url])).rows[0].id;
    const first = (await source(a.id, "dataset", { ...FULL, provider: null, snapshot_id: snap })).rows[0];
    for (const [col, v] of [["title", "고친 제목"], ["reference_date", "2026-07-31"], ["source_url", "https://gasang.example/x"], ["license_type", "kogl_2"], ["snapshot_id", null]]) {
      const r = await attempt(`update public.article_sources set ${col} = $1 where id = $2`, [v, first.id], "service_role");
      assert.equal(r.ok, false, `${col} 덮어쓰기`);
      assert.match(r.message, new RegExp(`${col}.*새 버전 행`));
    }
    assert.ok((await attempt("update public.article_sources set last_verified_at = now() where id = $1", [first.id])).ok, "확인일 갱신");
    assert.ok((await attempt("update public.article_sources set provider = '시험용 공공데이터포털' where id = $1", [first.id])).ok, "빈 칸 채우기");
    for (const reason of [null, "", "  "]) assert.equal((await source(a.id, "dataset", { ...FULL, title: "고친 제목", snapshot_id: snap, supersedes_id: first.id, revision_reason: reason })).ok, false, `사유 ${JSON.stringify(reason)}`);
    const v2 = await source(a.id, "dataset", { ...FULL, title: "고친 제목", snapshot_id: snap, supersedes_id: first.id, revision_reason: "확정치 반영" });
    assert.ok(v2.ok, v2.message);
    assert.equal((await source(a.id, "dataset", { ...FULL, supersedes_id: first.id, revision_reason: "또" })).ok, false, "한 행은 한 번만 대체");
    const cross = await source(other.id, "dataset", { ...FULL, supersedes_id: v2.rows[0].id, revision_reason: "다른 기사" });
    assert.equal(cross.ok, false, "다른 기사 출처 대체");
    assert.match(cross.message, /다른 기사의 출처/);
    const kept = (await client.query("select title, snapshot_id from public.article_sources where id = $1", [first.id])).rows[0];
    assert.deepEqual(kept, { title: FULL.title, snapshot_id: snap }, "옛 행 그대로");
    assert.equal((await client.query("select content_hash from public.raw_snapshots where id = $1", [snap])).rows[0].content_hash, "sha256:aa", "스냅샷 해시 그대로");
    // 분석 문단(기사 본문)을 고쳐도 원자료 행은 그대로
    await client.query(`update public.articles set body = '[{"type":"paragraph","text":"시험용 분석 문단을 고쳤다"}]'::jsonb where id = $1`, [a.id]);
    assert.equal((await client.query("select count(*)::int n from public.article_sources where article_id = $1", [a.id])).rows[0].n, 2);
    assert.equal((await client.query("select title from public.article_sources where id = $1", [first.id])).rows[0].title, FULL.title);
    // 대체된 옛 행이 비어 있어도 발행 검사는 새 버전만 본다
    const b = await article();
    const incomplete = (await source(b.id, "official_doc", { ...FULL, reference_date: null })).rows[0];
    assert.equal((await publish(b.id)).ok, false);
    assert.ok((await source(b.id, "official_doc", { ...FULL, supersedes_id: incomplete.id, revision_reason: "기준일 확인" })).ok);
    assert.ok((await publish(b.id)).ok, "대체된 옛 행은 검사 밖");
  }));

test("이미지 — 권리 확인 이미지는 공공누리 유형 필수, 공개 렌더 가능은 kogl_usage.photoTypes만(씨앗 제1유형·자체 촬영), 설정을 바꾸면 다시 계산, 제4유형·미표시는 못 엶", () =>
  tx(async () => {
    const base = { kind: "photo", rights_status: "confirmed", credit: "시험용 구청", photographer: "시험용 촬영자", license: "시험용 이용 조건", checked_at: new Date() };
    const ins = (cols) => attempt(`insert into public.media (path, ${Object.keys(cols).join(", ")}) values ($1, ${Object.keys(cols).map((_, i) => `$${i + 2}`).join(", ")}) returning id, license_cleared, crop_allowed`, [uniq("m") + ".jpg", ...Object.values(cols)]);
    const none = await ins(base);
    assert.equal(none.ok, false, "권리 확인 + 유형 없음");
    assert.match(none.message, /media_license_required/);
    assert.ok((await ins({ kind: "photo" })).ok, "미확인 초안 이미지는 칸 없이 저장 (W2-a 그대로)");
    const made = {};
    for (const t of LICENSE_TYPES) {
      const r = await ins({ ...base, license_type: t });
      assert.ok(r.ok, r.message);
      made[t] = r.rows[0];
      assert.equal(made[t].crop_allowed, true, "자르기 허용 기본 true (12장 #22)");
    }
    const cleared = () => client.query("select license_type, license_cleared from public.media where id = any($1)", [Object.values(made).map((m) => m.id)]).then((r) => Object.fromEntries(r.rows.map((x) => [x.license_type, x.license_cleared])));
    assert.deepEqual(await cleared(), { kogl_1: true, kogl_2: false, kogl_3: false, kogl_4: false, unmarked: false, not_applicable: true }, "씨앗 — 제1유형·자체 촬영만");
    const forged = await attempt("update public.media set license_cleared = true where id = $1 returning license_cleared", [made.kogl_2.id], "service_role");
    assert.equal(forged.rows[0].license_cleared, false, "계산 칸은 직접 못 켠다");
    assert.ok((await setSetting("kogl_usage", { photoTypes: ["kogl_1", "kogl_2", "not_applicable"], fullTextTypes: [] })).ok, "법률 검토 뒤 제2유형을 연다 (설정)");
    assert.equal((await cleared()).kogl_2, true, "설정을 바꾸면 다시 계산");
    for (const bad of [
      { photoTypes: ["kogl_1", "kogl_4"], fullTextTypes: [] },
      { photoTypes: ["unmarked"], fullTextTypes: [] },
      { photoTypes: ["kogl_1"], fullTextTypes: ["kogl_4"] },
    ]) {
      const r = await setSetting("kogl_usage", bad);
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.match(r.message, /설정으로도 열 수 없습니다/);
    }
    for (const bad of [[], { photoTypes: ["kogl_1"] }, { photoTypes: ["kogl_1"], fullTextTypes: [], order: [] }, { photoTypes: ["kogl_9"], fullTextTypes: [] }, { photoTypes: ["kogl_1", "kogl_1"], fullTextTypes: [] }, { photoTypes: ["kogl_1"], fullTextTypes: ["not_applicable"] }]) {
      assert.equal((await setSetting("kogl_usage", bad)).ok, false, JSON.stringify(bad));
    }
    const t4 = await attempt("update public.media set license_type = 'kogl_4' where id = $1 returning license_cleared", [made.kogl_1.id]);
    assert.equal(t4.rows[0].license_cleared, false, "제4유형으로 바꾸면 바로 꺼짐");
  }));

test("anon — 렌더 가능 이미지·새 칸(공공누리 유형·자르기)만 읽고, 쓰기·검사 함수 실행은 0", () =>
  tx(async () => {
    const base = { kind: "photo", rights_status: "confirmed", credit: "시험용 구청", photographer: "시험용 촬영자", license: "시험용", checked_at: new Date() };
    const m = {};
    for (const t of ["kogl_1", "kogl_2", "kogl_4", "unmarked", "not_applicable"]) {
      m[t] = (await client.query("insert into public.media (path, kind, rights_status, credit, photographer, license, checked_at, license_type, crop_allowed) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id", [uniq("m"), base.kind, base.rights_status, base.credit, base.photographer, base.license, base.checked_at, t, t !== "kogl_1"])).rows[0].id;
    }
    const pub = await article({ status: "published", body: JSON.stringify({ blocks: Object.values(m).map((id) => ({ type: "image", mediaId: String(id), alt: "시험용", caption: "" })) }) });
    await source(pub.id, "official_doc", FULL);
    const seen = await attempt("select id, license_type, crop_allowed from public.media where id = any($1) order by id", [Object.values(m)], "anon");
    assert.ok(seen.ok, seen.message);
    assert.deepEqual(seen.rows.map((r) => r.license_type).sort(), ["kogl_1", "not_applicable"], "제2유형(씨앗 닫힘)·제4유형·미표시 0행");
    assert.equal(seen.rows.find((r) => r.license_type === "kogl_1").crop_allowed, false);
    assert.equal((await attempt("select license_cleared from public.media limit 1", [], "anon")).ok, false, "계산 칸은 비공개");
    const src = await attempt("select license_type, source_type, region_unit, collected_at from public.article_sources where article_id = $1", [pub.id], "anon");
    assert.ok(src.ok, src.message);
    assert.equal(src.rows[0].license_type, "kogl_1");
    assert.equal((await attempt("update public.article_sources set license_type = 'kogl_2' where article_id = $1", [pub.id], "anon")).ok, false, "anon 쓰기 0");
    for (const fn of [
      "public.official_source_missing(null::public.article_sources)",
      "public.official_source_publish_problem(null::public.articles)",
    ]) {
      assert.equal((await attempt(`select ${fn}`, [], "anon")).ok, false, `${fn} anon 실행 0`);
    }
    const settings = await attempt("select key from public.settings where key in ('official_source_types', 'kogl_usage')", [], "anon");
    assert.equal(settings.rows.length, 0, "새 설정 두 키는 anon 0행");
  }));
