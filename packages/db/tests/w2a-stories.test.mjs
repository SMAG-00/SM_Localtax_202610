// 기사 기획 캘린더(story_assignments) 상태 전이 — NAV-09 · REG1-17.
// ① 담당 기자·편집자·이해관계·전문 분야 관련성이 비면 assigned로 못 바꾼다 (assigned를 건너뛴 그 뒤 상태도 같다)
// ② fact_check·review를 거치지 않은 published는 거부 — 거쳐 온 상태는 story_assignment_events(추가만, 트리거가 남김)로 판정
// ③ held는 어느 상태에서나 갈 수 있다
// ④ 지역 태그(region_code)가 있는 기획은 편집 분야(4종)·공익적 질문 없이 assigned 이상으로 못 간다
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
const person = async () => (await client.query("insert into public.people (slug, name, roles) values ($1, '시험', '{reporter}') returning id", [uniq("p")])).rows[0].id;
async function ready(over = {}) {
  return { reporter_id: await person(), editor_id: await person(), conflicts: "이해관계 없음", relevance: "취득세 세수와 직접 관련", ...over };
}
async function story(cols = {}) {
  const all = { section: "tax", ...cols };
  const keys = Object.keys(all);
  return (
    await client.query(`insert into public.story_assignments (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, keys.map((k) => all[k]))
  ).rows[0];
}
const move = (id, status, role = "service_role") => attempt("update public.story_assignments set status = $2 where id = $1 returning status", [id, status], role);
async function walk(id, steps) {
  for (const s of steps) {
    const r = await move(id, s);
    assert.ok(r.ok, `${s}: ${r.message}`);
  }
}

test("idea는 빈 칸으로 만들 수 있다", () =>
  tx(async () => {
    const s = await story();
    assert.equal(s.status, "idea");
  }));

for (const field of ["reporter_id", "editor_id", "conflicts", "relevance"]) {
  test(`idea → assigned: ${field}가 비면 거부`, () =>
    tx(async () => {
      const blanks = field.endsWith("_id") ? [null] : [null, "", "   "];
      for (const blank of blanks) {
        const s = await story(await ready({ [field]: blank }));
        const r = await move(s.id, "assigned");
        assert.equal(r.ok, false, `${field}=${JSON.stringify(blank)}`);
      }
    }));
}

test("idea → assigned: 네 칸이 모두 있으면 바뀐다", () =>
  tx(async () => {
    const s = await story(await ready());
    assert.ok((await move(s.id, "assigned")).ok);
  }));

test("assigned를 건너뛰어 idea → reporting으로 가도 네 칸 규칙을 피할 수 없다", () =>
  tx(async () => {
    const s = await story();
    for (const to of ["reporting", "fact_check", "review"]) assert.equal((await move(s.id, to)).ok, false, to);
  }));

test("assigned 이후 담당 칸을 비우는 수정도 거부", () =>
  tx(async () => {
    const s = await story(await ready());
    await walk(s.id, ["assigned", "reporting"]);
    assert.equal((await attempt("update public.story_assignments set editor_id = null where id = $1", [s.id])).ok, false);
  }));

for (const [label, path] of [
  ["idea에서 바로", []],
  ["assigned에서", ["assigned"]],
  ["reporting에서", ["assigned", "reporting"]],
  ["fact_check만 거치고 review 없이", ["assigned", "reporting", "fact_check"]],
  ["review만 거치고 fact_check 없이", ["assigned", "reporting", "review"]],
]) {
  test(`published 거부 — ${label}`, () =>
    tx(async () => {
      const s = await story(await ready());
      await walk(s.id, path);
      const r = await move(s.id, "published");
      assert.equal(r.ok, false);
      assert.match(r.message, /fact_check|review/);
    }));
}

test("fact_check·review를 거치면 published로 바뀐다", () =>
  tx(async () => {
    const s = await story(await ready());
    await walk(s.id, ["assigned", "reporting", "fact_check", "review"]);
    assert.ok((await move(s.id, "published")).ok);
  }));

test("처음부터 published로 넣을 수 없다 · 기록 표를 직접 채워 우회할 수 없다", () =>
  tx(async () => {
    const r = await attempt("insert into public.story_assignments (section, status, reporter_id, editor_id, conflicts, relevance) values ('tax', 'published', $1, $2, '없음', '관련')", [
      await person(),
      await person(),
    ]);
    assert.equal(r.ok, false);
    const s = await story(await ready({ status: "assigned" }));
    const forge = await attempt("insert into public.story_assignment_events (assignment_id, to_status) values ($1, 'fact_check'), ($1, 'review')", [s.id], "service_role");
    assert.equal(forge.ok, false, "service_role은 상태 기록을 직접 넣을 수 없다");
    assert.equal((await move(s.id, "published")).ok, false);
  }));

for (const from of ["idea", "assigned", "reporting", "fact_check", "review", "published"]) {
  test(`${from} → held는 언제나 된다`, () =>
    tx(async () => {
      const s = await story(from === "idea" ? {} : await ready());
      const path = { idea: [], assigned: ["assigned"], reporting: ["assigned", "reporting"], fact_check: ["assigned", "reporting", "fact_check"] };
      path.review = [...path.fact_check, "review"];
      path.published = [...path.review, "published"];
      await walk(s.id, path[from]);
      const r = await move(s.id, "held");
      assert.ok(r.ok, r.message);
    }));
}

test("held에서 다시 published로 갈 때도 거쳐 온 기록으로 판정한다", () =>
  tx(async () => {
    const a = await story(await ready());
    await walk(a.id, ["assigned", "held"]);
    assert.equal((await move(a.id, "published")).ok, false, "fact_check·review를 거치지 않았다");
    const b = await story(await ready());
    await walk(b.id, ["assigned", "reporting", "fact_check", "review", "held"]);
    assert.ok((await move(b.id, "published")).ok);
  }));

test("상태가 바뀔 때마다 이전·다음 상태가 기록된다 (추가만)", () =>
  tx(async () => {
    const s = await story(await ready());
    await walk(s.id, ["assigned", "reporting"]);
    await attempt("update public.story_assignments set plan = '현장 취재 2회' where id = $1", [s.id]);
    const { rows } = await client.query("select from_status, to_status from public.story_assignment_events where assignment_id = $1 order by id", [s.id]);
    assert.deepEqual(rows, [
      { from_status: null, to_status: "idea" },
      { from_status: "idea", to_status: "assigned" },
      { from_status: "assigned", to_status: "reporting" },
    ]);
  }));

test("지역 태그가 있는 기획은 편집 분야·공익적 질문 없이 assigned로 못 간다 (REG1-17)", () =>
  tx(async () => {
    const noField = await story(await ready({ section: "local", region_code: "11", public_question: "구 예산이 세수에 맞나" }));
    assert.equal((await move(noField.id, "assigned")).ok, false, "편집 분야 없음");
    const noQuestion = await story(await ready({ section: "local", region_code: "11", editorial_field: "local_finance" }));
    assert.equal((await move(noQuestion.id, "assigned")).ok, false, "공익적 질문 없음");
    const ok = await story(await ready({ section: "local", region_code: "11", editorial_field: "local_finance", public_question: "구 예산이 세수에 맞나" }));
    assert.ok((await move(ok.id, "assigned")).ok);
    const noRegion = await story(await ready());
    assert.ok((await move(noRegion.id, "assigned")).ok, "지역 태그가 없으면 편집 분야 없이도");
  }));

test("편집 분야는 REG1-17의 4종(local_tax·realestate·local_finance·urban_policy)만 — v1.0의 축제·지역 경제 값 거부", () =>
  tx(async () => {
    for (const f of ["local_tax", "realestate", "local_finance", "urban_policy"]) assert.ok((await attempt("insert into public.story_assignments (section, editorial_field) values ('local', $1)", [f])).ok, f);
    for (const f of ["festival", "local_economy", ""]) assert.equal((await attempt("insert into public.story_assignments (section, editorial_field) values ('local', $1)", [f])).ok, false, f);
  }));

test("기획 종류·검수 큐·분기 형식 밖의 값은 거부", () =>
  tx(async () => {
    const ins = (col, v) => attempt(`insert into public.story_assignments (section, ${col}) values ('tax', $1)`, [v]);
    assert.ok((await ins("kind", "investigative")).ok);
    assert.equal((await ins("kind", "tourism")).ok, false);
    assert.ok((await ins("review_queue", "separate_product")).ok);
    assert.equal((await ins("review_queue", "trash")).ok, false);
    assert.ok((await ins("quarter", "2026Q4")).ok);
    assert.equal((await ins("quarter", "2026Q5")).ok, false);
  }));
