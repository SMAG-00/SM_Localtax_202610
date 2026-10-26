// W4 24단계 DB — 지역 측정 이벤트 (docs/dev/W4_설계.md 1장 24단계 · 2.5, W2-c 설계 2.1, 마이그레이션 20261024000057 · REG1-15)
//  · 이름 제약 — 새 이벤트 7개는 저장되고, 모르는 이름·대문자·빈 글자는 거부, 제약 값 집합 = W2-c 2.1 표
//  · 속성 칸 — 상세 주소·좌표·검색어 원문·계산값·외부 주소 이름의 칸은 DB도 거부
// 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

const W2C = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "dev", "W2-c_설계.md"), "utf8");
const NEW = ["region_viewed", "regional_news_opened", "regional_source_opened", "region_to_tax_clicked", "region_to_realestate_clicked", "project_viewed", "dev_method_viewed"];
const designNames = () => {
  const line = W2C.split("\n").find((l) => l.startsWith("| analytics_events.name "));
  return [...line.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
};

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
const insert = (name, props, section = "local") =>
  client.query(
    "insert into public.analytics_events (name, session_id, first_visit, stage, entry, section, props, is_bot, is_staff) values ($1, gen_random_uuid(), true, 1, 'direct', $2, $3, false, false) returning id",
    [name, section, JSON.stringify(props)],
  );
async function rejected(name, props) {
  await client.query("savepoint e");
  await assert.rejects(insert(name, props), (err) => err.code === "23514", `${name} ${JSON.stringify(props)}`);
  await client.query("rollback to savepoint e");
}

test("이름 제약 — 새 이벤트 7개가 W2-c 2.1 표에 있고 제약이 받는다, 제약 값 집합 = 표(85종)", () =>
  tx(async () => {
    const names = designNames();
    assert.equal(names.length, 105);
    for (const n of NEW) assert.ok(names.includes(n), `2.1 표에 ${n}`);
    const def = (await client.query("select pg_get_constraintdef(oid) d from pg_constraint where conname = 'analytics_events_name_check'")).rows[0].d;
    const inDb = [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
    assert.deepEqual([...inDb].sort(), [...names].sort());
    for (const n of NEW) await insert(n, { region_code: "9900000000" });
  }));

test("이름 제약 — 모르는 이름·대문자·빈 글자·비슷한 이름은 거부", () =>
  tx(async () => {
    for (const bad of ["region_view", "Region_Viewed", "", "region_viewed ", "project_opened"]) await rejected(bad, {});
  }));

test("속성 — 지역 코드·종류만 저장되고, 주소·좌표·검색어·계산값·외부 주소 이름의 칸은 DB도 거부", () =>
  tx(async () => {
    await insert("region_to_tax_clicked", { region_code: "9900000000", target: "situation" });
    await insert("project_viewed", { region_code: "9900000000", project_type: "redevelopment", stage: "notice" }, "realestate");
    for (const bad of ["address", "address_detail", "lat", "lng", "coords", "query", "q", "keyword", "amount", "price", "input", "url"]) await rejected("region_viewed", { region_code: "9900000000", [bad]: "MARKER" });
    await rejected("dev_method_viewed", { method: "trust", nested: { a: 1 } });
  }));
