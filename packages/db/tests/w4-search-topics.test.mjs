// W4 10단계 — 지역 + 주제 검색 분류 (docs/dev/W4_설계.md 1장 10단계 · 2.1 search.topic · 2.2 search_topics · 2.9.1 · 12장 #29·#73~, PRD-01B REG-08 · REG1-11)
//  · search_topics 씨앗 = 설계 2.2 · 저장 검사(트리거 — TypeScript searchTopicsErrors와 같은 거부 견본) · anon은 이 키 한 줄만 읽고 쓰기 0
//  · search_classify = 설계 2.9.1 표 전부(TypeScript classifyTerms 시험과 같은 표) · anon 실행·invoker · 폐지 지역 0 · 설정을 바꾸면 다음 분류부터
//  · search_public — 지역 후보가 첫 결과(등급 0) · 그 지역 태그 기사의 주제 검색(주제 별칭 포함) · 지금까지의 결과는 그대로(늘기만) · 동명은 후보 모두 ·
//    비공개·보류·유료·권리 미확인 대표 이미지 기사 0 · 지역·기사 유형 거르개 그대로 · 사전 밖 낱말('축제')은 관광 종류 0
// 시험용 지역은 법정동코드에 없는 접두 99 가짜 코드와 '시험' 이름이다(설계 8장). 모두 한 트랜잭션 안에서 넣고 되돌린다. 로컬 DB에서만 돈다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";
import { ANON_EXECUTE_ALLOWED } from "../scripts/verify-rls-remote.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN = fs.readFileSync(path.resolve(HERE, "../../../docs/dev/W4_설계.md"), "utf8");
const lines = DESIGN.split("\n");
const cells = (line) => line.split("|").slice(1, -1).map((c) => c.trim());
const ticks = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const SEED = JSON.parse(cells(lines.find((l) => l.startsWith("| `search_topics` |")))[1].match(/`(\{"acquisition_tax"[^`]+\})`/)[1]);
const TOPIC_KEYS = ticks(cells(lines.find((l) => l.startsWith("| search.topic (")))[1]);
const T291 = DESIGN.slice(DESIGN.indexOf("#### 2.9.1"), DESIGN.indexOf("### 2.10")).split("\n");
const DICT = T291.filter((l) => /^\| `\d{10}` \| `(sido|sigungu)`/.test(l)).map((l) => {
  const [code, level, parent, name, aliases, end] = cells(l);
  const e = ticks(end);
  return { code: ticks(code)[0], level: ticks(level)[0], parent: ticks(parent)[0] ?? null, name: ticks(name)[0], aliases: ticks(aliases), validTo: e[0] ?? null, successor: e[1] ?? null };
});
const CASES = T291.filter((l) => /^\| `[^`]+` \| (`\d{10}`|—)/.test(l)).map((l) => {
  const [q, regions, topics, rest] = cells(l);
  return { q: ticks(q)[0], regions: ticks(regions), topics: ticks(topics), rest: ticks(rest) };
});
/** 견본 검색어 → 낱말 (견본에 한 글자 낱말이 없다 — 설계 2.9.1. 정규화는 W2-d 4장 규칙: NFKC·소문자·남기는 글자 밖에서 나눔) */
const termsOf = (q) => q.normalize("NFKC").toLowerCase().split(/[^0-9a-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿]+/u).filter(Boolean);

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
    return { ok: false, code: err.code, message: err.message };
  }
}
async function classify(terms, role = "anon") {
  const r = await attempt("select * from public.search_classify($1::text[])", [terms], role);
  assert.ok(r.ok, r.message);
  assert.equal(r.rows.length, 1);
  return r.rows[0];
}
async function search(query, args = {}, role = "anon") {
  const names = Object.keys(args);
  const sql = `select * from public.search_public(p_query => $1${names.map((n, i) => `, ${n} => $${i + 2}`).join("")})`;
  const r = await attempt(sql, [query, ...names.map((n) => args[n])], role);
  assert.ok(r.ok, `search_public(${query}) 실패: ${r.message}`);
  return r.rows;
}
const keys = (rows) => rows.map((r) => `${r.kind}:${r.ref}`);

let seq = 0;
const uniq = (p) => `w4st-${p}-${process.pid}-${++seq}`;
async function insert(table, cols) {
  const k = Object.keys(cols);
  const sql = `insert into public.${table} (${k.join(", ")}) values (${k.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
  return (await client.query(sql, k.map((x) => cols[x]))).rows[0];
}
const para = (text) => JSON.stringify({ blocks: [{ type: "paragraph", text }], claims: [] });

/** 2.9.1 사전의 가짜 지역(접두 99)을 넣는다 — 후속이 있는 폐지 지역은 후속 뒤에 */
async function dictionary() {
  for (const r of [...DICT.filter((d) => d.code.startsWith("99") && !d.successor), ...DICT.filter((d) => d.code.startsWith("99") && d.successor)]) {
    await insert("regions", { code: r.code, parent_code: r.parent, level: r.level, name: r.name, slug: uniq("r"), aliases: r.aliases, valid_to: r.validTo, successor_code: r.successor });
  }
  const reporter = await insert("people", { slug: uniq("p"), name: "분류 시험 기자", roles: ["reporter"], visibility: "public" });
  /** 공개 지역 기사 (지역 태그 + 편집 분야 + 공익적 질문 — 7단계 발행 검사) */
  const article = (over) =>
    insert("articles", {
      slug: uniq("a"),
      title: "분류 시험 기사",
      section: "local",
      content_type: "explainer",
      status: "published",
      author_id: reporter.id,
      body: para("본문"),
      first_published_at: new Date().toISOString(),
      editorial_field: "realestate",
      public_question: "시험용 공익적 질문",
      ...over,
    });
  return { article };
}

// ── 설정 search_topics ────────────────────────────────────────

test("씨앗 search_topics = 설계 2.2 (주제 키 = 2.1 search.topic 6개) · 마이그레이션 기록", async () => {
  const { rows } = await client.query("select value, updated_by from public.settings where key = 'search_topics'");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].value, SEED);
  assert.deepEqual(Object.keys(rows[0].value).sort(), [...TOPIC_KEYS].sort());
  assert.equal(TOPIC_KEYS.length, 6);
  assert.equal(rows[0].updated_by, "migration:20261023000045");
});

test("저장 검사 — 모양이 틀리면 거부(check_violation), 씨앗 그대로 · 맞는 값은 저장 (TypeScript searchTopicsErrors와 같은 견본)", () =>
  tx(async () => {
    const withTopic = (t, v) => ({ ...SEED, [t]: v });
    const bad = [
      ["객체가 아님", ["취득세"]],
      ["주제 하나 빠짐", Object.fromEntries(Object.entries(SEED).filter(([k]) => k !== "local_finance"))],
      ["모르는 주제", { ...SEED, tourism: { label: "축제", aliases: [] } }],
      ["모르는 칸", withTopic("property_tax", { label: "재산세", aliases: [], note: "x" })],
      ["빈 글자", withTopic("property_tax", { label: "  ", aliases: [] })],
      ["글자 21자", withTopic("property_tax", { label: "가".repeat(21), aliases: [] })],
      ["한 글자 글자", withTopic("property_tax", { label: "세", aliases: [] })],
      ["별칭이 목록 아님", withTopic("property_tax", { label: "재산세", aliases: "보유세" })],
      ["별칭 21개", withTopic("property_tax", { label: "재산세", aliases: Array.from({ length: 21 }, (_, i) => `별칭${i}번`) })],
      ["한 글자 별칭", withTopic("property_tax", { label: "재산세", aliases: ["세"] })],
      ["글자가 아닌 별칭", withTopic("property_tax", { label: "재산세", aliases: [3] })],
      ["다른 주제와 같은 낱말", withTopic("property_tax", { label: "재산세", aliases: ["취득 세"] })],
      ["같은 주제 안 두 번", withTopic("property_tax", { label: "재산세", aliases: ["재산 세"] })],
    ];
    for (const [name, value] of bad) {
      const r = await attempt("update public.settings set value = $1::jsonb where key = 'search_topics'", [JSON.stringify(value)]);
      assert.equal(r.ok, false, name);
      assert.equal(r.code, "23514", `${name}: ${r.message}`);
    }
    assert.deepEqual((await client.query("select value from public.settings where key = 'search_topics'")).rows[0].value, SEED);
    const good = withTopic("property_tax", { label: "가".repeat(20), aliases: ["보유세", "주택 재산세"] });
    assert.ok((await attempt("update public.settings set value = $1::jsonb where key = 'search_topics'", [JSON.stringify(good)])).ok);
  }));

test("anon — search_topics 한 줄은 읽고 쓰기 0, 검사 함수 실행 0 · 기존 공개 키 정책은 그대로", () =>
  tx(async () => {
    for (const role of ["anon", "authenticated"]) {
      const read = await attempt("select key, value from public.settings where key = 'search_topics'", [], role);
      assert.ok(read.ok, read.message);
      assert.deepEqual(read.rows.map((r) => r.value), [SEED], role);
      const w = await attempt("update public.settings set value = '{}'::jsonb where key = 'search_topics' returning key", [], role);
      assert.ok(!w.ok || w.rows.length === 0, `${role} 쓰기 0`);
      const f = await client.query("select has_function_privilege($1, 'public.search_topics_guard()', 'execute') as can", [role]);
      assert.equal(f.rows[0].can, false, `${role} 검사 함수 실행 0`);
    }
    const policies = (await client.query("select polname from pg_policy where polrelid = 'public.settings'::regclass order by polname")).rows.map((r) => r.polname);
    assert.ok(policies.includes("settings_public_read") && policies.includes("settings_public_search_topics"), policies.join(","));
    const qual = (await client.query("select pg_get_expr(polqual, polrelid) q from pg_policy where polrelid = 'public.settings'::regclass and polname = 'settings_public_read'")).rows[0].q;
    assert.ok(!qual.includes("search_topics"), "기존 공개 키 목록(W2-b 2.3)은 바꾸지 않는다");
  }));

// ── search_classify ──────────────────────────────────────────

test("권한 — search_classify는 anon 실행(허용 목록에 있다)·security invoker·search_path 비움, 안정(stable)", async () => {
  assert.ok(ANON_EXECUTE_ALLOWED.has("search_classify"));
  const def = await client.query("select p.prosecdef, p.proconfig, p.provolatile from pg_proc p where p.oid = 'public.search_classify(text[])'::regprocedure");
  assert.deepEqual(def.rows[0], { prosecdef: false, proconfig: ['search_path=""'], provolatile: "s" });
  for (const role of ["anon", "authenticated", "service_role"]) {
    const r = await client.query("select has_function_privilege($1, 'public.search_classify(text[])', 'execute') as can", [role]);
    assert.equal(r.rows[0].can, true, role);
  }
});

test("설계 2.9.1 표 전부 — TypeScript classifyTerms와 같은 견본 (anon)", () =>
  tx(async () => {
    assert.equal(CASES.length, 15);
    await dictionary();
    for (const c of CASES) {
      const r = await classify(termsOf(c.q));
      assert.deepEqual({ regions: r.region_codes, topics: r.topics, rest: r.rest }, { regions: c.regions, topics: c.topics, rest: c.rest }, c.q);
    }
  }));

test("낱말은 칸마다 다시 정규화·빈 것 빼고 앞 8개 · 지역으로 읽은 낱말 정규형 · 빈 입력은 빈 분류", () =>
  tx(async () => {
    await dictionary();
    const r = await classify(["시험가람구", " ", null, "재 개발"]);
    assert.deepEqual(r, { region_codes: ["9901100000"], region_keys: ["시험가람구"], topics: ["redevelopment"], rest: [] });
    const many = await classify(["가나", "다라", "마바", "사아", "자차", "카타", "파하", "거너", "시험가람구"]);
    assert.deepEqual(many.region_codes, [], "아홉째 낱말은 읽지 않는다");
    assert.equal(many.rest.length, 8);
    assert.deepEqual(await classify([]), { region_codes: [], region_keys: [], topics: [], rest: [] });
    assert.deepEqual(await classify(null), { region_codes: [], region_keys: [], topics: [], rest: [] });
  }));

test("설정을 바꾸면 다음 분류부터 — 별칭 '축제'를 지방재정에 더하면 '시험누리 축제' → local_finance, 설정 행이 없으면 주제 0(지역은 그대로)", () =>
  tx(async () => {
    await dictionary();
    assert.deepEqual((await classify(["시험누리", "축제"])).topics, []);
    await client.query("update public.settings set value = jsonb_set(value, '{local_finance,aliases}', '[\"축제\"]') where key = 'search_topics'");
    assert.deepEqual(await classify(["시험누리", "축제"]), { region_codes: ["9901200000"], region_keys: ["시험누리"], topics: ["local_finance"], rest: [] });
    await client.query("delete from public.settings where key = 'search_topics'");
    assert.deepEqual(await classify(["시험가람구", "재개발"]), { region_codes: ["9901100000"], region_keys: ["시험가람구"], topics: [], rest: ["재개발"] });
  }));

// ── search_public 분류 ─────────────────────────────────────────

test("지역 + 주제 — 지역 허브가 첫 결과(등급 0), 그 지역 태그 기사의 주제 검색(주제 별칭 '재건축'도), 지금까지의 결과(두 낱말이 든 글)는 그대로", () =>
  tx(async () => {
    const f = await dictionary();
    const tagged = await f.article({ title: "재건축 조합 세금 정리", region_codes: ["9901100000"] });
    const taggedOther = await f.article({ title: "재건축 이웃 지역 소식", region_codes: ["9901200000"] });
    const textOnly = await f.article({ title: "시험가람구 재개발 구역 설명회", section: "realestate", region_codes: [], editorial_field: null, public_question: null });
    const untaggedTopic = await f.article({ title: "재건축 일반 안내 시험분류표식", section: "realestate", region_codes: [], editorial_field: null, public_question: null });
    const rows = await search("시험가람구 재개발");
    assert.deepEqual(`${rows[0].kind}:${rows[0].ref}:${rows[0].tier}`, "region:9901100000:0", "지역 허브가 첫 결과");
    const got = keys(rows);
    assert.ok(got.includes(`article:${tagged.id}`), "그 지역 태그 + 주제 별칭(재건축) 기사");
    assert.ok(got.includes(`article:${textOnly.id}`), "글에 두 낱말이 든 기사 (W2-d 결과 그대로)");
    assert.ok(!got.includes(`article:${taggedOther.id}`), "다른 지역 태그 0");
    assert.ok(!got.includes(`article:${untaggedTopic.id}`), "태그 없는 주제 기사 0 (지역 낱말이 글에 없다)");
    assert.equal(new Set(got).size, got.length, "겹침 0");
    assert.equal(Number(rows[0].total_count), rows.length);
    assert.deepEqual(rows[0].kind_counts, { region: 1, article: 2 });
    assert.deepEqual(rows[0].query_terms, ["시험가람구", "재개발"]);
    // 종류별 묶음(전체 탭) — 지역 묶음이 맨 앞
    const grouped = await search("시험가람구 재건축", { p_per_kind: 3 });
    assert.equal(grouped[0].kind, "region");
    assert.ok(keys(grouped).includes(`article:${tagged.id}`));
    // 지역명만 — 그 지역 허브가 첫 결과 (REG-08)
    assert.equal(keys(await search("시험가람구"))[0], "region:9901100000");
  }));

test("동명 — 하나로 단정 0, 후보 지역 모두 등급 0 · 두 지역 태그 기사 · 시·도 + 이름이면 그 시·도 아래만", () =>
  tx(async () => {
    const f = await dictionary();
    const a = await f.article({ title: "재산세 고지 안내 A", region_codes: ["9901300000"], editorial_field: "local_tax" });
    const b = await f.article({ title: "재산세 고지 안내 B", region_codes: ["9901400000"], editorial_field: "local_tax" });
    const rows = await search("시험고개군 재산세");
    assert.deepEqual(rows.filter((r) => r.kind === "region").map((r) => `${r.ref}:${r.tier}`), ["9901300000:0", "9901400000:0"]);
    assert.deepEqual(keys(rows).slice(0, 2), ["region:9901300000", "region:9901400000"]);
    for (const x of [a, b]) assert.ok(keys(rows).includes(`article:${x.id}`));
  }));

test("옛 이름 별칭 → 현재 지역 · 시·도 후보는 그 아래 시·군·구 태그 기사까지 · 폐지 지역 이름은 지역 0", () =>
  tx(async () => {
    const f = await dictionary();
    const now = await f.article({ title: "재산세 시험새벌 안내", region_codes: ["9901500000"], editorial_field: "local_tax" });
    const child = await f.article({ title: "취득세 감면 안내", region_codes: ["9901100000"], editorial_field: "local_tax" });
    const old = await search("시험옛벌 재산세");
    assert.equal(keys(old)[0], "region:9901500000");
    assert.ok(keys(old).includes(`article:${now.id}`));
    const sido = await search("분류도 취득세");
    assert.equal(keys(sido)[0], "region:9900000000");
    assert.ok(keys(sido).includes(`article:${child.id}`), "시·도 후보 → 하위 시·군·구 태그");
    const retired = await search("시험폐지구 재산세");
    assert.ok(!retired.some((r) => r.kind === "region" && r.ref === "9901600000"), "폐지 지역 0");
  }));

test("공개 경계 그대로 — 초안·보류·유료·권리 미확인 대표 이미지·금주 핫뉴스는 분류 검색에도 0 (anon·service_role)", () =>
  tx(async () => {
    const f = await dictionary();
    const pub = await f.article({ title: "재건축 공개 기사", region_codes: ["9901100000"] });
    const hidden = [
      await f.article({ title: "재건축 초안", region_codes: ["9901100000"], status: "draft", first_published_at: null }),
      await f.article({ title: "재건축 유료", region_codes: ["9901100000"], is_paid: true }),
    ];
    const held = await f.article({ title: "재건축 곧 보류", region_codes: ["9901100000"] });
    await client.query("update public.articles set status = 'held' where id = $1", [held.id]);
    hidden.push(held);
    const unconfirmed = await insert("media", { path: "w4st-u.jpg", kind: "photo" });
    const uncleared = await f.article({ title: "재건축 대표 이미지 미확인", region_codes: ["9901100000"], lead_media_id: unconfirmed.id });
    assert.equal((await client.query("select lead_media_cleared from public.articles where id = $1", [uncleared.id])).rows[0].lead_media_cleared, false);
    hidden.push(uncleared);
    hidden.push(await f.article({ title: "재건축 금주 핫뉴스", content_type: "digest", digest_id: 1, region_codes: ["9901100000"] }));
    for (const role of ["anon", "service_role"]) {
      const got = keys(await search("시험가람구 재건축", {}, role));
      assert.ok(got.includes(`article:${pub.id}`), role);
      for (const h of hidden) assert.ok(!got.includes(`article:${h.id}`), `${role}: ${h.title} 0`);
    }
  }));

test("거르개 그대로 — 지역 거르개가 후보를 빼면 그 지역 결과·태그 기사 0, 기사 유형을 고르면 지역 결과 0 · 사전 밖 낱말('축제')은 지역 + 그 낱말 기사만(관광 종류 0)", () =>
  tx(async () => {
    const f = await dictionary();
    const tagged = await f.article({ title: "재건축 조합 세금", region_codes: ["9901100000"], content_type: "reported_news", reporting_method: "qualitative" });
    assert.deepEqual(keys(await search("시험가람구 재개발", { p_region: "1100000000" })), []);
    const inFilter = keys(await search("시험가람구 재개발", { p_region: "9900000000" }));
    assert.deepEqual(inFilter, ["region:9901100000", `article:${tagged.id}`]);
    const typed = await search("시험가람구 재개발", { p_content_type: "reported_news" });
    assert.deepEqual(keys(typed), [`article:${tagged.id}`], "기사 유형을 고르면 기사만");
    const festival = await f.article({ title: "축제 예산 지방재정 영향", region_codes: ["9901200000"], editorial_field: "local_finance" });
    const fest = await search("시험누리 축제");
    assert.deepEqual(keys(fest), ["region:9901200000", `article:${festival.id}`]);
    const kinds = new Set(fest.map((r) => r.kind));
    for (const k of kinds) assert.ok(["region", "situation", "tracker", "glossary", "category", "article", "person", "interpretation"].includes(k), k);
  }));

test("분류가 없는 검색어는 W2-d 결과 그대로 — 지역 낱말이 없으면 태그만으로 더하지 않는다", () =>
  tx(async () => {
    const f = await dictionary();
    const tagged = await f.article({ title: "재건축 분류없음표식", region_codes: ["9901100000"] });
    const plain = await f.article({ title: "분류없음표식 재건축 안내", section: "realestate", region_codes: [], editorial_field: null, public_question: null });
    assert.deepEqual(keys(await search("분류없음표식 재건축")).sort(), [`article:${plain.id}`, `article:${tagged.id}`].sort(), "두 낱말이 든 글만 (태그와 상관없이)");
    assert.deepEqual(keys(await search("분류없음표식 재개발")), [], "지역이 없으면 주제 별칭으로 넓히지 않는다");
  }));
