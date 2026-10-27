// W12-c 수용 E2E - 계산·감면·판정 연결과 범위 확장 (docs/dev/W12-c_설계.md - PRD-04 ASK-05·18·19·22 · FAM-09)
// 코드·DB 경계를 로컬 Supabase와 소스에서 확인한다. 모델 호출 0, 글은 시험용.
//  a) 도구 목록 - 모델 도구 정의에 양도세·상속세·증여세 계산이 없고, 감면 점검은 서버 전용이다
//  b) 경계 - 지방세봇 코드가 상속·증여 엔진을 불러오지 않고, 도구 입력을 기록 함수로 보내지 않는다
//  c) 기록 - 결과 요약 표에 입력값 칸이 없고, anon은 기록 함수를 부를 수 없다
//  d) 색인 - 상속·증여 허브 지도와 국세 법령이 색인 원천에 없다
// SSE 전체 시나리오(가짜 모델이 도구를 부르는 턴)는 W12-z 수용 묶음에서 가짜 모델 서버와 함께 돈다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { open } from "../packages/db/tests/_w10c_helpers.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
let client;
before(async () => {
  client = await open();
});
after(async () => client?.end());

const AGENT_FILES = ["calc-run.ts", "calc-tools.ts", "calc-copy.ts", "dictionary-link.ts", "flow.ts", "tools.ts"].map((f) => `apps/web/lib/agent/${f}`);
const SERVER_FILES = ["calc-port.ts", "service.ts", "store.ts", "toolbox.ts"].map((f) => `apps/web/lib/server/agent/${f}`);

test("a) 모델 도구 정의에 국세 계산 도구가 없다 - 도구 이름 상수에 양도·상속·증여가 없다", () => {
  const tools = read("apps/web/lib/agent/calc-tools.ts") + read("apps/web/lib/agent/tools.ts");
  const names = [...tools.matchAll(/(?:def\(|name: )"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(names.includes("run_calculator") && names.includes("run_determination"));
  assert.deepEqual(names.filter((n) => /transfer|inherit|gift|igt|cgt/i.test(n)), []);
});

test("b) 지방세봇 코드가 상속·증여 엔진·룰셋을 불러오지 않는다", () => {
  for (const f of [...AGENT_FILES, ...SERVER_FILES]) {
    const src = read(f);
    assert.doesNotMatch(src, new RegExp(`from\\s+["']@ltr/(?:igt${"-"}engine|rules${"-"}igt)`), f);
    assert.doesNotMatch(src, /lib\/igt\//, f);
  }
});

test("b) 결과 기록은 요약만 보낸다 - 도구 입력(form·answers·facts)을 기록 함수로 넘기지 않는다", () => {
  const store = read("apps/web/lib/server/agent/store.ts");
  const block = store.slice(store.indexOf("export async function recordResults"), store.indexOf("export async function recordTurn"));
  assert.match(block, /agent_record_results/);
  assert.doesNotMatch(block, /form|answers|facts/);
  const flow = read("apps/web/lib/agent/flow.ts");
  assert.doesNotMatch(flow, /inputSummary:\s*JSON\.stringify|inputSummary:\s*cp\./);
});

test("c) agent_results에 입력값 칸이 없고 anon은 기록 함수를 부를 수 없다", async () => {
  const cols = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'agent_results'")).rows.map((r) => r.column_name);
  assert.ok(cols.includes("result_hash") && cols.includes("ruleset_version"));
  assert.deepEqual(cols.filter((c) => /input|facts|answer|form|question|price|owner|house/i.test(c)), []);
  const grants = (await client.query("select grantee from information_schema.routine_privileges where specific_schema = 'public' and routine_name = 'agent_record_results'")).rows.map((r) => r.grantee);
  assert.ok(grants.includes("service_role"));
  assert.ok(!grants.includes("anon") && !grants.includes("authenticated"));
});

test("d) 상속·증여 허브 지도와 국세 법령은 색인 원천에 없다 (플래그를 켜도 증여·상속 청크가 새로 생기지 않는다)", async () => {
  const maps = await client.query("select count(*)::int as n from public.chunk_sources where source_type = 'issue_graph_version' and scope in ('inheritance', 'gift')");
  assert.equal(maps.rows[0].n, 0);
  const laws = await client.query("select count(*)::int as n from public.chunk_sources where source_type = 'law_article' and (tax_items && array['national_igt', 'related'])");
  assert.equal(laws.rows[0].n, 0);
});
