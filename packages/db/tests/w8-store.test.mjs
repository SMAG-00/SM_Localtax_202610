// W8 DB — 스토어 상품 · 자사 상품 연결 · 클릭 집계 (docs/dev/W8_설계.md 1장 1·2단계 · 2장, 마이그레이션 20261025000075 · 76 · PRD-01C BIZ-01·02·03·09)
//  · 씨앗 — 상품·연결 0행, 주문 허용 도메인 빈 목록, 구독 확인 기록 미승인, 기능 키 store 꺼짐
//  · 상품 — 허용 도메인 밖·http·사용자 정보 주소 거부, 신청서 방식에 주소 거부, 바깥 링크 방식에 주소 없음 거부, 할인·가격 표기 거부,
//    판매 중은 확인일·근거 필요, 도서는 판차·목차 필요, 가격·결제·재고 칸 없음
//  · 설정 — 허용 도메인 모양·겹침 거부, 구독 확인 기록 승인에 근거·확인자·확인일 필요
//  · 연결 — 기사당 승인 1개(두 번째 승인 거부), 홈 승인 1개, 위치 모양, 승인 기록 칸
//  · 공개 뷰 — 키 꺼짐·초안·중지·구독 미승인·허용 도메인에서 빠진 상품은 0행, 승인된 연결만 카드, 중지하면 연결도 0행, anon 표 접근 0
//  · 집계 — store_click_summary가 상품 x 위치 x 출처 기사로 센다(봇·편집국 제외, 기간 밖 제외, 모르는 위치 제외), anon 호출 불가
// 모든 시험은 거래 안에서 돌고 되돌린다 (남는 행 0). 내용은 시험용 가짜다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { connect, dbUrl, isLocal } from "../scripts/db.mjs";

let client;
before(async () => {
  assert.ok(isLocal(dbUrl()), "이 시험은 로컬 DB에서만 돌린다");
  client = await connect();
});
after(async () => client?.end());

async function attempt(sql, params = []) {
  await client.query("savepoint t");
  try {
    const res = await client.query(sql, params);
    await client.query("release savepoint t");
    return { ok: true, rows: res.rows.map((r) => (r.id !== undefined ? { ...r, id: Number(r.id) } : r)) };
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
async function asAnon(sql, params = []) {
  await client.query("set local role anon");
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.query("reset role");
  }
}
const setSetting = (key, value) => attempt("update public.settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);
async function flags(patch) {
  const cur = (await client.query("select value from public.settings where key = 'feature_flags'")).rows[0].value;
  return attempt("update public.settings set value = $1::jsonb where key = 'feature_flags'", [JSON.stringify({ ...cur, ...patch })]);
}
const DOMAIN = "shop.example.test";
const URL_OK = `https://${DOMAIN}/item/1`;
let n = 0;
async function product(over = {}) {
  n += 1;
  const p = {
    slug: `zz-product-${n}`,
    title: `가상 시험 상품 ${n}`,
    kind: "education",
    summary: "시험용 한 줄 설명입니다.",
    audience: "시험 대상",
    order_mode: "request_form",
    order_url: null,
    verified_on: "2026-10-20",
    verified_ref: "시험 확인 기록 A-1",
    status: "on_sale",
    ...over,
  };
  const cols = Object.keys(p);
  return attempt(
    `insert into public.products (${cols.join(", ")}, edited_by) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}, 'tester') returning id`,
    cols.map((c) => p[c]),
  );
}
const book = (over = {}) => product({ kind: "book", edition: "제1판 (시험)", toc: ["제1장 시험", "제2장 시험"], ...over });
async function article() {
  n += 1;
  const row = (
    await client.query(
      "insert into public.articles (slug, title, section, content_type, status, first_published_at) values ($1, '시험용 기사', 'tax', 'explainer', 'published', now()) returning id",
      [`w8-article-${n}`],
    )
  ).rows[0];
  return Number(row.id);
}
const link = (productId, placement, articleId = null) =>
  attempt("insert into public.product_links (product_id, placement, article_id, proposed_by) values ($1, $2, $3, 'tester') returning id", [productId, placement, articleId]);
const approve = (linkId) => attempt("update public.product_links set status = 'approved', approved_by = 'tester2', approved_at = now() where id = $1", [linkId]);
const openStore = async () => {
  assert.ok((await setSetting("store_order_domains", [DOMAIN])).ok);
  assert.ok((await flags({ store: true })).ok);
};
const publicIds = async () => (await asAnon("select id from public.public_store_products order by id")).map((r) => Number(r.id));

test("씨앗 — 상품·연결 0행, 주문 허용 도메인 빈 목록, 구독 확인 기록 미승인, 기능 키 store 꺼짐", async () => {
  for (const t of ["products", "product_links"]) assert.equal(Number((await client.query(`select count(*) from public.${t}`)).rows[0].count), 0, t);
  assert.deepEqual((await client.query("select value from public.settings where key = 'store_order_domains'")).rows[0].value, []);
  const review = (await client.query("select value from public.settings where key = 'store_subscription_review'")).rows[0].value;
  assert.equal(review.approved, false);
  assert.equal((await client.query("select value from public.settings where key = 'feature_flags'")).rows[0].value.store, false);
  assert.deepEqual(await asAnon("select id from public.public_store_products"), []);
});

test("설정 — 허용 도메인은 소문자 호스트만, 겹침·대문자·경로·30개 초과 거부", () =>
  tx(async () => {
    assert.ok((await setSetting("store_order_domains", [DOMAIN, "books.example.test"])).ok);
    for (const bad of [["Shop.example.test"], ["shop.example.test/path"], ["https://shop.example.test"], ["localhost"], [DOMAIN, DOMAIN], "shop.example.test", [1], Array.from({ length: 31 }, (_, i) => `h${i}.example.test`)]) {
      const r = await setSetting("store_order_domains", bad);
      assert.equal(r.ok, false, JSON.stringify(bad).slice(0, 60));
      assert.equal(r.code, "23514");
    }
  }));

test("설정 — 구독 확인 기록 승인에는 근거·확인자·확인일이 모두 필요하다", () =>
  tx(async () => {
    const ok = { approved: true, ref: "시험 기록 B-2", reviewed_by: "시험 확인자", reviewed_on: "2026-10-20" };
    for (const drop of ["ref", "reviewed_by", "reviewed_on"]) {
      const r = await setSetting("store_subscription_review", { ...ok, [drop]: drop === "reviewed_on" ? "어제" : "" });
      assert.equal(r.ok, false, drop);
      assert.match(r.message, /구독 확인 기록/);
    }
    assert.equal((await setSetting("store_subscription_review", { ...ok, extra: 1 })).ok, false, "모르는 칸");
    assert.ok((await setSetting("store_subscription_review", ok)).ok);
  }));

test("상품 — 주문 주소: 허용 도메인의 https만, 신청서 방식은 주소 없음, 바깥 링크 방식은 주소 필수", () =>
  tx(async () => {
    const closed = await product({ order_mode: "existing_channel", order_url: URL_OK });
    assert.equal(closed.ok, false, "허용 목록이 비어 있으면 거부");
    assert.match(closed.message, /허용 목록/);
    assert.ok((await setSetting("store_order_domains", [DOMAIN])).ok);
    assert.ok((await product({ order_mode: "existing_channel", order_url: URL_OK })).ok);
    for (const url of ["https://other.example.test/x", "http://shop.example.test/x", "https://shop.example.test.evil.test/x", "https://user@shop.example.test/x", "ftp://shop.example.test/x", "https://shop.example.test/a b"]) {
      assert.equal((await product({ order_mode: "existing_channel", order_url: url })).ok, false, url);
    }
    assert.equal((await product({ order_mode: "existing_channel", order_url: null })).ok, false, "바깥 링크 방식인데 주소 없음");
    assert.equal((await product({ order_mode: "request_form", order_url: URL_OK })).ok, false, "신청서 방식인데 주소 있음");
  }));

test("상품 — 할인·가격 표기는 제목·요약·대상·판차·목차 어디에 있어도 거부 (도서정가제 감수 전)", () =>
  tx(async () => {
    for (const over of [
      { title: "시험 상품 20% 안내" },
      { summary: "지금 할인 중입니다" },
      { audience: "최저가 대상" },
      { summary: "정가 15,000원" },
      { summary: "정가 15000 원" },
      { kind: "book", edition: "제1판", toc: ["제1장 특가"] },
    ]) {
      const r = await product(over);
      assert.equal(r.ok, false, JSON.stringify(over));
      assert.match(r.message, /할인·가격/);
    }
    assert.ok((await product({ summary: "2026년 개정 세법을 다루는 시험용 강좌입니다." })).ok, "평범한 문장은 통과");
  }));

test("상품 — 판매 중은 확인일·근거가 있어야 하고, 도서는 판차·목차가 있어야 한다", () =>
  tx(async () => {
    assert.equal((await product({ verified_on: null })).ok, false);
    assert.equal((await product({ verified_ref: "  " })).ok, false);
    assert.ok((await product({ status: "draft", verified_on: null, verified_ref: null })).ok, "초안은 확인일 없이 저장");
    assert.equal((await product({ kind: "book" })).ok, false, "판차·목차 없는 도서");
    assert.equal((await book({ toc: [] })).ok, false, "목차 없는 도서");
    assert.equal((await book({ edition: " " })).ok, false, "판차 없는 도서");
    assert.ok((await book()).ok);
    assert.ok((await product({ kind: "book", status: "draft" })).ok, "도서도 초안은 판차·목차 없이 저장");
    assert.equal((await product({ kind: "magazine" })).ok, false, "종류는 3가지뿐");
  }));

test("상품 — 가격·결제·재고 칸이 없다", async () => {
  const { rows } = await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name in ('products', 'product_links', 'public_store_products', 'public_product_links')");
  const bad = rows.map((r) => r.column_name).filter((c) => /price|amount|pay|stock|inventory|card|cost|discount/i.test(c));
  assert.deepEqual(bad, []);
});

test("연결 — 기사당 승인 1개: 두 번째 승인은 거부, 철회하면 다시 승인 가능, 제안은 여러 개 가능", () =>
  tx(async () => {
    const a = await article();
    const p1 = (await product()).rows[0].id;
    const p2 = (await product()).rows[0].id;
    const l1 = (await link(p1, "article", a)).rows[0].id;
    const l2 = (await link(p2, "article", a)).rows[0].id;
    { const r = await approve(l1); assert.ok(r.ok, r.message); }
    const second = await approve(l2);
    assert.equal(second.ok, false);
    assert.equal(second.code, "23505");
    assert.ok((await attempt("update public.product_links set status = 'revoked' where id = $1", [l1])).ok);
    assert.ok((await approve(l2)).ok, "철회 뒤 다른 상품 승인");
  }));

test("연결 — 홈 승인 1개, 위치 모양(기사 연결은 기사 필수·홈은 기사 없음), 승인 기록 칸", () =>
  tx(async () => {
    const a = await article();
    const p1 = (await product()).rows[0].id;
    const p2 = (await product()).rows[0].id;
    assert.equal((await link(p1, "article", null)).ok, false, "기사 연결에 기사 없음");
    assert.equal((await link(p1, "home", a)).ok, false, "홈 연결에 기사 있음");
    assert.equal((await link(p1, "sidebar")).ok, false, "모르는 위치");
    const h1 = (await link(p1, "home")).rows[0].id;
    const h2 = (await link(p2, "home")).rows[0].id;
    assert.ok((await approve(h1)).ok);
    assert.equal((await approve(h2)).code, "23505", "홈 승인 두 번째");
    assert.equal((await attempt("update public.product_links set status = 'approved' where id = $1", [h2])).ok, false, "승인자·시각 없이 승인");
    assert.equal((await attempt("update public.product_links set approved_by = 'x', approved_at = now() where id = $1", [h2])).ok, false, "상태가 제안인데 승인 기록");
  }));

test("공개 뷰 — 키 꺼짐·초안·중지·구독 확인 미승인·허용 도메인에서 빠진 상품은 0행", () =>
  tx(async () => {
    assert.ok((await setSetting("store_order_domains", [DOMAIN])).ok);
    const free = (await product()).rows[0].id;
    const channel = (await product({ order_mode: "existing_channel", order_url: URL_OK })).rows[0].id;
    const draft = (await product({ status: "draft" })).rows[0].id;
    const stopped = (await product({ status: "stopped" })).rows[0].id;
    const sub = (await product({ kind: "subscription" })).rows[0].id;
    assert.deepEqual(await publicIds(), [], "키 꺼짐");
    assert.ok((await flags({ store: true })).ok);
    assert.deepEqual(await publicIds(), [free, channel]);
    assert.ok(draft && stopped, "초안·중지·구독 미승인은 위 목록에 없음");
    assert.ok((await setSetting("store_subscription_review", { approved: true, ref: "시험 기록", reviewed_by: "시험 확인자", reviewed_on: "2026-10-20" })).ok);
    assert.deepEqual(await publicIds(), [free, channel, sub], "구독 확인 기록 승인 뒤 구독 상품");
    assert.ok((await setSetting("store_order_domains", ["other.example.test"])).ok);
    assert.deepEqual(await publicIds(), [free, sub], "허용 목록에서 빠진 바깥 링크 상품은 공개에서도 빠짐");
    assert.ok((await attempt("update public.products set status = 'stopped' where id = $1", [free])).ok);
    assert.deepEqual(await publicIds(), [sub], "판매 중지 -> 다음 조회부터 0");
    const cols = (await asAnon("select * from public.public_store_products limit 1"))[0] ?? {};
    assert.deepEqual(Object.keys(cols).sort(), ["audience", "edition", "id", "kind", "order_mode", "order_url", "slug", "summary", "title", "toc", "verified_on"]);
  }));

test("공개 연결 뷰 — 승인된 연결만 카드가 되고, 상품을 중지하거나 키를 끄면 0행", () =>
  tx(async () => {
    await openStore();
    const a = await article();
    const p = (await product()).rows[0].id;
    const l = (await link(p, "article", a)).rows[0].id;
    const h = (await link(p, "home")).rows[0].id;
    assert.deepEqual(await asAnon("select link_id from public.public_product_links"), [], "제안만 있으면 0행");
    assert.ok((await approve(l)).ok);
    const rows = await asAnon("select link_id, placement, article_id, title from public.public_product_links");
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].article_id), Number(a));
    assert.equal(rows[0].placement, "article");
    assert.ok((await approve(h)).ok);
    assert.deepEqual((await asAnon("select placement from public.public_product_links order by placement")).map((r) => r.placement), ["article", "home"]);
    assert.ok((await attempt("update public.product_links set status = 'revoked' where id = $1", [h])).ok);
    assert.deepEqual((await asAnon("select placement from public.public_product_links")).map((r) => r.placement), ["article"], "철회한 연결 0");
    assert.ok((await attempt("update public.products set status = 'stopped' where id = $1", [p])).ok);
    assert.deepEqual(await asAnon("select 1 from public.public_product_links"), [], "상품 중지 -> 연결도 0");
    assert.ok((await attempt("update public.products set status = 'on_sale' where id = $1", [p])).ok);
    assert.ok((await flags({ store: false })).ok);
    assert.deepEqual(await asAnon("select 1 from public.public_product_links"), [], "키 꺼짐 -> 0");
  }));

test("권한 — anon은 상품·연결 표와 집계 함수에 접근할 수 없고, service_role은 지우기 권한이 없다", () =>
  tx(async () => {
    for (const t of ["products", "product_links"]) {
      await client.query("set local role anon");
      const r = await attempt(`select 1 from public.${t}`);
      await client.query("reset role");
      assert.equal(r.ok, false, t);
      const priv = (await client.query("select has_table_privilege('service_role', $1, 'DELETE') d, has_table_privilege('service_role', $1, 'INSERT') i", [`public.${t}`])).rows[0];
      assert.deepEqual([priv.i, priv.d], [true, false], t);
    }
    await client.query("set local role anon");
    const f = await attempt("select * from public.store_click_summary(now() - interval '1 day', now() + interval '1 day')");
    await client.query("reset role");
    assert.equal(f.ok, false);
  }));

const event = (name, props, over = {}) =>
  client.query(
    "insert into public.analytics_events (name, session_id, first_visit, stage, entry, section, props, is_bot, is_staff, occurred_at) values ($1, gen_random_uuid(), true, 1, 'direct', null, $2, $3, $4, $5)",
    [name, JSON.stringify(props), over.bot ?? false, over.staff ?? false, over.at ?? new Date()],
  );

test("집계 — store_click_summary가 상품 x 위치 x 출처 기사로 센다 (봇·편집국·기간 밖·모르는 위치 제외)", () =>
  tx(async () => {
    await event("product_clicked", { product_id: 7, placement: "article", article_id: 11 });
    await event("product_clicked", { product_id: 7, placement: "article", article_id: 11 });
    await event("order_link_clicked", { product_id: 7, placement: "article", mode: "existing_channel", article_id: 11 });
    await event("product_clicked", { product_id: 7, placement: "home" });
    await event("order_link_clicked", { product_id: 8, placement: "store", mode: "request_form" });
    // 제외 대상
    await event("product_clicked", { product_id: 7, placement: "article", article_id: 11 }, { bot: true });
    await event("product_clicked", { product_id: 7, placement: "article", article_id: 11 }, { staff: true });
    await event("product_clicked", { product_id: 7, placement: "article", article_id: 11 }, { at: new Date(Date.now() - 40 * 86400000) });
    await event("product_clicked", { product_id: 7, placement: "sidebar" });
    await event("article_viewed", { article_id: 11, format: "general", content_type: "explainer" });
    const rows = (await client.query("select * from public.store_click_summary(now() - interval '7 days', now() + interval '1 hour')")).rows.map((r) => [Number(r.product_id), r.placement, r.article_id === null ? null : Number(r.article_id), Number(r.card_clicks), Number(r.order_clicks)]);
    assert.deepEqual(rows, [
      [7, "article", 11, 2, 1],
      [7, "home", null, 1, 0],
      [8, "store", null, 0, 1],
    ]);
  }));

test("이름 제약 — 새 이벤트 2개를 받고 가격·이름·주소 칸은 DB도 거부", () =>
  tx(async () => {
    await event("product_clicked", { product_id: 1, placement: "store" });
    await event("order_link_clicked", { product_id: 1, placement: "store", mode: "request_form" });
    for (const bad of [{ product_id: 1, placement: "store", price: 1 }, { product_id: 1, placement: "store", url: "https://x.example.test" }, { product_id: 1, placement: "store", name: "x" }]) {
      await client.query("savepoint e");
      await assert.rejects(event("product_clicked", bad), (err) => err.code === "23514", JSON.stringify(bad));
      await client.query("rollback to savepoint e");
    }
  }));
