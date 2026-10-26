// W12-h DB - 채널 배포 키트·게시 기록 (마이그레이션 180, PRD-04 CH-01)
//  · 키트 조회 - 기능 키 channel_kit 꺼짐이면 빈 목록, 승인된 channel_draft만(승인 전 0), 내려받기 기록 추가
//  · 게시 기록 - 승인된 원고만, 체크리스트 4칸 모두 true, https 링크, UTM 모양, 원고당 1건, 거부도 감사 1행
//  · 불변 - channel_posts·내려받기·감사는 추가만
//  · 공개 뷰 - 기능 키가 켜졌을 때만 (channel, utm_campaign) 두 칸
// 모든 시험은 거래 안에서 돌고 되돌린다. 원고·링크는 모두 시험용 가짜다.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { open, helpers } from "./_w10d_helpers.mjs";

let client;
let h;
before(async () => {
  client = await open();
  h = helpers(client);
});
after(async () => client?.end());

const ACTOR = "admin:test@example.test";
const CHECKS = ["original_compared", "numbers_dates_links", "no_personal_info", "channel_limits_checked"];
const FULL = { source_noted: true, ai_notice: true, alt_text: true, not_ad: true };
const flag = (on) => client.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify({ channel_kit: on })]);

async function article() {
  const person = (await client.query("insert into public.people (slug, name, roles, visibility) values ($1, '시험 기자', array['reporter'], 'public') returning id", [h.uniq("p")])).rows[0];
  const slug = h.uniq("art");
  const a = (
    await client.query(
      "insert into public.articles (slug, title, section, content_type, status, author_id, body, first_published_at) values ($1, '시험용 기사', 'tax', 'explainer', 'published', $2, $3, now()) returning id, slug",
      [slug, person.id, JSON.stringify({ blocks: [{ type: "paragraph", text: "시험용 본문" }], claims: [] })],
    )
  ).rows[0];
  return a;
}
async function draft(a, channel, over = {}) {
  const url = over.url ?? `https://example.test/news/${a.slug}?utm_source=${channel}&utm_medium=owned&utm_campaign=${a.slug}`;
  const item = (
    await client.query(
      "insert into public.review_items (kind, source_key, title, payload, created_by) values ('channel_draft', $1, '시험용 채널 원고', $2, 'job:test') returning id",
      [h.uniq("channel"), JSON.stringify({ articleId: a.id, articleVersion: 1, channel, text: "시험용 원고 문장", articleUrl: url })],
    )
  ).rows[0];
  if (over.approve !== false) {
    await client.query("select public.review_item_transition($1, 'in_review', $2)", [item.id, ACTOR]);
    await client.query("select public.review_item_transition($1, 'approved', $2, null, $3)", [item.id, ACTOR, CHECKS]);
  }
  return item.id;
}
const kit = async (a) => (await h.one("select public.channel_kit_get($1, $2) r", [a.id, ACTOR])).r;
const post = async (id, over = {}) =>
  (await h.one("select public.channel_post_record($1, $2, $3::jsonb, $4, $5) r", [id, over.url ?? "https://example.test/post/1", JSON.stringify(over.checklist ?? FULL), over.at ?? new Date().toISOString(), over.actor ?? ACTOR])).r;

test("키트 - 기능 키 꺼짐이면 빈 목록 + 거부 감사, 켜짐이면 승인된 원고만", () =>
  h.tx(async () => {
    const a = await article();
    await draft(a, "brief");
    await draft(a, "shorts", { approve: false });
    await flag(false);
    const off = await kit(a);
    assert.equal(off.ok, false);
    assert.equal(off.code, "feature_off");
    assert.deepEqual(off.items, []);
    assert.equal((await h.one("select count(*)::int n from public.channel_audit where outcome = 'refused' and code = 'feature_off'")).n, 1);
    await flag(true);
    const on = await kit(a);
    assert.equal(on.ok, true);
    assert.equal(on.slug, a.slug);
    assert.deepEqual(on.items.map((i) => i.channel), ["brief"], "승인 전 shorts 0");
    assert.equal(on.items[0].posted, false);
    assert.equal((await h.one("select count(*)::int n from public.channel_kit_downloads")).n, 1, "내려받기 기록");
    assert.equal((await h.one("select public.channel_kit_get($1, 'bad') r", [a.id])).r.code, "actor_invalid");
    assert.equal((await h.one("select public.channel_kit_get(99999999, $1) r", [ACTOR])).r.code, "not_found");
  }));

test("게시 기록 - 승인된 원고 + 체크리스트 4칸 + https 링크일 때만, 원고당 1건", () =>
  h.tx(async () => {
    const a = await article();
    const approved = await draft(a, "naver_blog");
    const pending = await draft(a, "cardnews", { approve: false });
    assert.equal((await post(pending)).code, "not_approved");
    assert.equal((await post(99999999)).code, "not_found");
    assert.equal((await post(approved, { actor: "bad" })).code, "actor_invalid");
    assert.equal((await post(approved, { url: "http://example.test/p" })).code, "url_invalid");
    assert.equal((await post(approved, { checklist: { ...FULL, alt_text: false } })).code, "checklist_incomplete");
    assert.equal((await post(approved, { checklist: { source_noted: true } })).code, "checklist_incomplete");
    assert.equal((await post(approved, { at: "2999-01-01T00:00:00Z" })).code, "posted_at_invalid");
    const ok = await post(approved);
    assert.equal(ok.ok, true);
    const row = await h.one("select channel, utm_campaign, article_id from public.channel_posts where id = $1", [ok.id]);
    assert.deepEqual({ ...row }, { channel: "naver_blog", utm_campaign: a.slug, article_id: a.id });
    assert.equal((await post(approved)).code, "already_recorded");
    assert.equal((await h.one("select count(*)::int n from public.channel_audit where action = 'post' and outcome = 'refused'")).n, 8);
  }));

test("UTM 형식 - 원고 링크의 utm_source가 채널과 다르거나 utm_campaign이 없으면 거부", () =>
  h.tx(async () => {
    const a = await article();
    const wrongSource = await draft(a, "brief", { url: `https://example.test/news/${a.slug}?utm_source=shorts&utm_medium=owned&utm_campaign=${a.slug}` });
    assert.equal((await post(wrongSource)).code, "utm_invalid");
    const noCampaign = await draft(a, "shorts", { url: `https://example.test/news/${a.slug}?utm_source=shorts&utm_medium=owned` });
    assert.equal((await post(noCampaign)).code, "utm_invalid");
  }));

test("직접 삽입 제약 - 체크리스트·링크·채널 값 거부, 수정·삭제 거부", () =>
  h.tx(async () => {
    const a = await article();
    const id = await draft(a, "brief");
    const ins = (cl, url = "https://example.test/p", ch = "brief") =>
      h.attempt("insert into public.channel_posts (article_id, review_item_id, channel, utm_campaign, posted_url, checklist, posted_by, posted_at) values ($1, $2, $3, 'x', $4, $5::jsonb, 't', now())", [a.id, id, ch, url, JSON.stringify(cl)]);
    assert.equal((await ins({ ...FULL, not_ad: false })).ok, false);
    assert.equal((await ins(FULL, "http://example.test/p")).ok, false);
    assert.equal((await ins(FULL, "https://example.test/p?apikey=1")).ok, false);
    assert.equal((await ins(FULL, "https://example.test/p", "unknown")).ok, false);
    const ok = await post(id);
    assert.equal((await h.attempt("update public.channel_posts set posted_url = 'https://example.test/other' where id = $1", [ok.id])).ok, false);
    assert.equal((await h.attempt("delete from public.channel_posts where id = $1", [ok.id])).ok, false);
    assert.equal((await h.attempt("delete from public.channel_audit")).ok, false);
    await client.query("insert into public.channel_kit_downloads (review_item_id, downloaded_by) values ($1, 't')", [id]);
    assert.equal((await h.attempt("update public.channel_kit_downloads set downloaded_by = 'x'")).ok, false);
  }));

test("공개 뷰 - 기능 키가 꺼지면 0행, 켜지면 (channel, utm_campaign) 두 칸만", () =>
  h.tx(async () => {
    const a = await article();
    const id = await draft(a, "naver_post");
    await post(id);
    await flag(false);
    assert.equal((await h.anon("select * from public.public_channel_posts")).rows.length, 0);
    await flag(true);
    const res = await h.anon("select * from public.public_channel_posts");
    const cols = (await client.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'public_channel_posts' order by ordinal_position")).rows.map((r) => r.column_name);
    assert.deepEqual(cols, ["channel", "utm_campaign"]);
    assert.deepEqual(res.rows.map((r) => ({ ...r })), [{ channel: "naver_post", utm_campaign: a.slug }]);
    assert.equal((await h.attempt("select * from public.channel_posts", [], "anon")).ok, false, "표 직접 읽기 거부");
  }));

test("새 함수는 anon·authenticated 실행 불가", () =>
  h.tx(async () => {
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await h.attempt("select public.channel_kit_get(1, 'admin:x')", [], role)).ok, false, role);
      assert.equal((await h.attempt("select public.channel_post_record(1, 'https://example.test', '{}'::jsonb, now(), 'admin:x')", [], role)).ok, false, role);
    }
  }));
