// 공개 데이터를 읽지 못할 때 공개 화면 (W2-b 4단계 — 시험 주소에서 표가 없는 DB에 붙었을 때 /news·하위 분야·상황 페이지가 500이던 결함)
// standalone 빌드를 세 가지 '읽지 못함'으로 띄운다 — ① Supabase 접속값 없음 ② 닿지 않는 주소(닫힌 포트) ③ 표가 없는 DB(PostgREST가 모든 표에 404 PGRST205)
//  a) 목록 화면(홈·허브 4·지자체뉴스 분야·하위 분야·칼럼 목록·뉴스 전체)은 200 + 안내 한 줄("잠시 뒤 다시 확인해 주세요"), 기사 카드 0 (낡은 자료 0)
//  b) 상세 화면(기사·상황·인물)은 503 + "잠시 뒤 다시 확인해 주세요" + no-store — 있는지 모르므로 404·410 0, 오류 원문 0
//  c) 어느 화면도 500이 아니고, 서버 로그에 처리되지 않은 오류(⨯ · Unhandled)가 없다 — 실패는 [public] 줄로만 남는다
// 실제 DB를 쓰지 않는다 — 가짜 PostgREST는 이 시험 안의 작은 HTTP 서버다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { buildWeb, freePort, startServer } from "./lib/local.mjs";

const NOTICE = "잠시 뒤 다시 확인해 주세요";
const LISTS = ["/", "/tax", "/realestate", "/finance", "/local", "/local?topic=local_tax", "/tax/amendments", "/tax/interpretations?page=2", "/tax/columns", "/finance/columns", "/news", "/news?section=tax"];
const DETAILS = ["/news/acquisition-tax-2026", "/news/none", "/situations/car-sold", "/situations/none", "/people/kim-gaon", "/people/none"];
/** 응답·화면에 나오면 안 되는 오류 글자 */
const LEAKS = /PGRST|schema cache|fetch failed|ECONNREFUSED|stack|NEXT_PUBLIC_SUPABASE/i;

let fakeRest;
let fakeUrl;
const anonKey = "e2e-not-a-real-key";

before(async () => {
  buildWeb();
  // 표가 없는 DB — 모든 REST 요청에 PostgREST의 '표 없음' 응답
  fakeRest = http.createServer((req, res) => {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ code: "PGRST205", details: null, hint: null, message: `Could not find the table 'public.x' in the schema cache (${req.url?.split("?")[0]})` }));
  });
  await new Promise((r) => fakeRest.listen(0, "127.0.0.1", r));
  fakeUrl = `http://127.0.0.1:${fakeRest.address().port}`;
});

after(() => fakeRest?.close());

async function scenario(name, env) {
  const server = await startServer(env);
  try {
    const seen = [];
    for (const path of LISTS) {
      const res = await fetch(`${server.base}${path}`);
      const html = await res.text();
      seen.push([path, res.status]);
      assert.equal(res.status, 200, `${name} ${path}: 목록은 200`);
      assert.ok(html.includes(NOTICE), `${name} ${path}: 안내 한 줄`);
      assert.ok(!html.includes("data-article-id"), `${name} ${path}: 기사 카드 0`);
      assert.doesNotMatch(html.replace(/<script[\s\S]*?<\/script>/g, ""), LEAKS, `${name} ${path}: 오류 원문 0`);
    }
    for (const path of DETAILS) {
      const res = await fetch(`${server.base}${path}`);
      const html = await res.text();
      seen.push([path, res.status]);
      assert.equal(res.status, 503, `${name} ${path}: 상세는 503 (있는지 모른다 — 404·410 0)`);
      assert.equal(res.headers.get("cache-control"), "no-store", `${name} ${path}: 캐시 0`);
      assert.equal(res.headers.get("retry-after"), "30");
      assert.ok(html.includes(NOTICE), `${name} ${path}: 안내`);
      assert.ok(!html.includes("찾는 화면이 없습니다") && !html.includes("삭제된 기사"), `${name} ${path}: 없음·삭제 안내 0`);
      assert.doesNotMatch(html, LEAKS, `${name} ${path}: 오류 원문 0`);
    }
    // 화면 전환 요청(RSC)도 500이 아니다 — 목록은 200, 상세는 503
    for (const [path, expected] of [["/news", 200], ["/news/acquisition-tax-2026", 503]]) {
      const res = await fetch(`${server.base}${path}`, { headers: { rsc: "1" } });
      assert.equal(res.status, expected, `${name} RSC ${path}`);
    }
    const log = server.log();
    assert.doesNotMatch(log, /⨯|Unhandled|uncaughtException/, `${name}: 처리되지 않은 오류가 없어야 한다\n${log.slice(-3000)}`);
    assert.match(log, /\[public\]/, `${name}: 실패는 [public] 줄로 남는다`);
    return seen;
  } finally {
    server.stop();
  }
}

test("① Supabase 접속값이 없다 — 목록 200 + 안내, 상세 503, 500 0", async () => {
  const seen = await scenario("접속값 없음", {});
  assert.ok(seen.every(([, s]) => s === 200 || s === 503), JSON.stringify(seen));
});

test("② 닿지 않는 주소(닫힌 포트) — 목록 200 + 안내, 상세 503, 500 0", async () => {
  const port = await freePort(); // 잠깐 열었다 닫은 포트 — 아무도 듣지 않는다
  const seen = await scenario("닿지 않음", { NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${port}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey });
  assert.ok(seen.every(([, s]) => s === 200 || s === 503), JSON.stringify(seen));
});

test("③ 표가 없는 DB(PostgREST 404 PGRST205 — 마이그레이션 전 시험 주소) — 목록 200 + 안내, 상세 503, 500 0", async () => {
  const seen = await scenario("표 없음", { NEXT_PUBLIC_SUPABASE_URL: fakeUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey });
  assert.ok(seen.every(([, s]) => s === 200 || s === 503), JSON.stringify(seen));
});
