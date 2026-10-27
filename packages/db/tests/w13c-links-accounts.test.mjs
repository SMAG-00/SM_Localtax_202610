// W13-c DB - 관련 자료 패널 v2 연결(202)과 계정과목 연결(203) (PRD-05 LAW-10 · LINK-02)
//  · 유사도 연결: 기준(설정) 비면 0 / min 경계 포함 / min 바로 아래 제외 / v1 뷰에는 항상 제외 / 이유·점수 필수 / 공개 아닌 자료 거부
//  · 계정과목: 서명 전 공개 0 / 서명 뒤 공개 / 서명된 가장 높은 버전만 / 두 번 서명·삭제·내용 수정 거부 / 본문 칸 없음 / 기능 키 꺼짐이면 0
// 글은 모두 시험용 가짜다. 모든 시험은 거래 안에서 돌고 되돌린다.
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

const setThreshold = (value) => client.query("update public.settings set value = $1::jsonb where key = 'link_similarity_threshold'", [JSON.stringify(value)]);
const setFeature = (key, on) => client.query("update public.settings set value = value || $1::jsonb where key = 'feature_flags'", [JSON.stringify({ [key]: on })]);

async function fixture() {
  await h.flags({ law_viewer: true, case_db: true });
  const lawId = await h.law(h.uniq("시험용법"));
  const v = await h.version(lawId);
  await h.article(v, 11, 0);
  const docId = await h.doc();
  return { lawId, docId };
}
const addSim = (docId, lawId, score, reason = "시험용 이유") =>
  h.attempt("select public.link_add_similarity('legal_doc', $1, $2, 11, 0, 'cites', $3, $4) as id", [docId, lawId, score, reason]);
const v2count = async (docId, origin) => Number((await client.query("select count(*)::int as n from public.public_links_v2 where src_kind = 'legal_doc' and src_id = $1 and origin = $2", [docId, origin])).rows[0].n);

test("기준 설정이 비어 있으면 유사도 카드는 0이다", () =>
  h.tx(async () => {
    const { lawId, docId } = await fixture();
    assert.equal((await addSim(docId, lawId, 0.99)).ok, true);
    await setThreshold({});
    assert.equal(await v2count(docId, "similarity"), 0);
    await setThreshold({ min: "0.5" });
    assert.equal(await v2count(docId, "similarity"), 0);
  }));

test("기준 점수 경계 - min과 같으면 보이고 바로 아래는 안 보인다", () =>
  h.tx(async () => {
    const { lawId, docId } = await fixture();
    await setThreshold({ min: 0.8 });
    assert.equal((await addSim(docId, lawId, 0.7999)).ok, true);
    assert.equal(await v2count(docId, "similarity"), 0, "0.7999는 제외");
    const doc2 = await h.doc();
    assert.equal((await addSim(doc2, lawId, 0.8)).ok, true);
    assert.equal(await v2count(doc2, "similarity"), 1, "0.8은 포함");
    await setThreshold({ min: 0.8001 });
    assert.equal(await v2count(doc2, "similarity"), 0, "기준을 올리면 다시 제외");
  }));

test("v1 공개 뷰(public_links)에는 유사도 연결이 나오지 않는다", () =>
  h.tx(async () => {
    const { lawId, docId } = await fixture();
    await setThreshold({ min: 0 });
    await addSim(docId, lawId, 0.9);
    assert.equal(await v2count(docId, "similarity"), 1);
    const v1 = await client.query("select count(*)::int as n from public.public_links where src_id = $1", [docId]);
    assert.equal(v1.rows[0].n, 0);
  }));

test("유사도 연결은 이유와 점수가 필수이고 공개 아닌 자료는 거부된다", () =>
  h.tx(async () => {
    const { lawId, docId } = await fixture();
    assert.equal((await addSim(docId, lawId, 0.9, "   ")).ok, false, "빈 이유");
    assert.equal((await addSim(docId, lawId, 1.01)).ok, false, "점수 1 초과");
    assert.equal((await addSim(docId, lawId, -0.01)).ok, false, "점수 음수");
    const hidden = await h.doc({ rights_status: "unchecked" });
    assert.equal((await addSim(hidden, lawId, 0.9)).ok, false, "권리 미확인 문서");
    const direct = await h.link({ src_id: docId, dst_id: lawId, dst_article_no: 11, dst_branch_no: 0, origin: "similarity" });
    assert.equal(direct.ok, false, "점수·이유 없는 유사도 직접 삽입");
  }));

test("같은 유사도 연결을 다시 넣으면 새로 만들지 않고 같은 번호를 돌려준다", () =>
  h.tx(async () => {
    const { lawId, docId } = await fixture();
    const a = await addSim(docId, lawId, 0.9);
    const b = await addSim(docId, lawId, 0.95);
    assert.equal(a.rows[0].id, b.rows[0].id);
  }));

test("지식창고 시작 연결은 없는 노드를 거부한다", () =>
  h.tx(async () => {
    const { lawId } = await fixture();
    const r = await h.link({ src_kind: "pub_node", src_id: 999999999, dst_id: lawId, dst_article_no: 11, dst_branch_no: 0 });
    assert.equal(r.ok, false);
  }));

const mapping = (over = {}) => {
  const row = { account_code: "land_test", account_name: "시험용 계정", target_type: "law_provision", target_id: null, target_article_no: 11, target_branch_no: 0, relation: "related", std_ref: "시험기준 제1호", version: 1, ...over };
  const keys = Object.keys(row);
  return h.attempt(`insert into public.account_mappings (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, keys.map((k) => row[k]));
};
const visible = async (code) => (await client.query("select id, version from public.public_account_mappings where account_code = $1 order by version", [code])).rows;

test("서명 전에는 공개 0, 서명 뒤 공개, 기능 키가 꺼지면 다시 0", () =>
  h.tx(async () => {
    const { lawId } = await fixture();
    await setFeature("account_links", true);
    const m = await mapping({ target_id: lawId });
    assert.equal(m.ok, true);
    const id = m.rows[0].id;
    assert.deepEqual(await visible("land_test"), []);
    const r = (await client.query("select public.account_mapping_sign($1, '시험 감수자') as r", [id])).rows[0].r;
    assert.equal(r.ok, true);
    assert.equal((await visible("land_test")).length, 1);
    await setFeature("account_links", false);
    assert.deepEqual(await visible("land_test"), []);
  }));

test("서명자 이름이 없거나 이미 서명된 행은 서명 거부", () =>
  h.tx(async () => {
    const { lawId } = await fixture();
    const id = (await mapping({ target_id: lawId })).rows[0].id;
    assert.equal((await client.query("select public.account_mapping_sign($1, '  ') as r", [id])).rows[0].r.code, "signer_required");
    assert.equal((await client.query("select public.account_mapping_sign($1, '감수자') as r", [id])).rows[0].r.ok, true);
    assert.equal((await client.query("select public.account_mapping_sign($1, '다른 감수자') as r", [id])).rows[0].r.code, "already_signed");
    assert.equal((await client.query("select public.account_mapping_sign(999999999, '감수자') as r")).rows[0].r.code, "not_found");
  }));

test("공개 뷰는 서명된 가장 높은 버전만 보인다 - 서명 안 된 새 버전은 이전 서명본을 가리지 않는다", () =>
  h.tx(async () => {
    const { lawId } = await fixture();
    await setFeature("account_links", true);
    const v1 = (await mapping({ target_id: lawId, version: 1 })).rows[0].id;
    const v2 = (await mapping({ target_id: lawId, version: 2 })).rows[0].id;
    await client.query("select public.account_mapping_sign($1, '감수자')", [v1]);
    assert.deepEqual((await visible("land_test")).map((r) => r.version), [1]);
    await client.query("select public.account_mapping_sign($1, '감수자')", [v2]);
    assert.deepEqual((await visible("land_test")).map((r) => r.version), [2]);
  }));

test("삭제와 내용 수정은 거부되고, 없는 대상·문장형 기준 참조도 거부된다", () =>
  h.tx(async () => {
    const { lawId } = await fixture();
    const id = (await mapping({ target_id: lawId })).rows[0].id;
    assert.equal((await h.attempt("delete from public.account_mappings where id = $1", [id])).ok, false);
    assert.equal((await h.attempt("update public.account_mappings set account_name = '바꿈' where id = $1", [id])).ok, false);
    assert.equal((await mapping({ target_id: lawId, version: 3, target_article_no: 999 })).ok, false, "없는 조문");
    assert.equal((await mapping({ target_id: lawId, version: 4, std_ref: "첫 문장입니다. 둘째 문장입니다" })).ok, false, "문장형 std_ref");
    assert.equal((await mapping({ target_id: lawId, version: 5, std_ref: "가".repeat(81) })).ok, false, "81자");
  }));

test("계정과목 연결 표에는 회계기준 본문을 담는 칸이 없고 anon·authenticated 직접 권한도 없다", () => h.tx(async () => {
  const cols = (await client.query("select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'account_mappings'")).rows;
  const free = cols.filter((c) => c.data_type === "text").map((c) => c.column_name).sort();
  assert.deepEqual(free, ["account_code", "account_name", "created_by", "relation", "signed_by", "std_ref", "target_type"]);
  assert.equal((await h.attempt("select * from public.account_mappings", [], "anon")).ok, false);
  assert.equal((await h.attempt("select * from public.account_mappings", [], "authenticated")).ok, false);
}));
