// SM 세금 카드 가져오기 도구 시험 (W11-a a7) - 아래 소스는 모두 시험용 지어낸 글자다. 실제 SM 내용·세율·조문이 아니다.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { DYNAMIC_MARK, assertUnderDataSrc, buildDrafts, extractCards, originOf } from "../import/sm-tax-cards.mjs";

const FIXTURE = `
export function getAcquireCards(ctx) {
  const cards = [];
  cards.push({ code: 'FIX_A', name: '시험용 카드 A', oneLiner: '시험용 한 줄', base: '시험용 기준', rate: rateSummary(ctx), due: '시험용 ' + '시기', law: '시험용 근거', detail: \`시험용 상세\`, kind: 'local' });
  cards.push({ code: 'FIX_B', name: '시험용 카드 B', oneLiner: '시험용 한 줄 B', kind: 'other' });
  return cards;
}
export function getHoldCards(ctx) {
  return [{ code: 'FIX_C', name: '시험용 카드 C', oneLiner: ctx.flag ? '가' : '나', kind: 'national' }, { code: 'FIX_D', name: '시험용 카드 D', oneLiner: '시험용', kind: 'local' }];
}
export function getTransferCards(ctx) {
  return [{ code: 'FIX_T', name: '시험용 양도 카드', oneLiner: '시험용', rate: '시험용 요약', kind: 'other' }];
}
function unrelated() { return { code: 'FIX_X', name: '함수 밖 객체' }; }
`;

test("카드 추출 - 단계별로 모으고, 글자 그대로인 값만 읽고, 계산되는 값은 동적으로 표시한다", () => {
  const cards = extractCards(FIXTURE);
  assert.deepEqual(cards.map((c) => [c.phase, c.code]), [["acquire", "FIX_A"], ["acquire", "FIX_B"], ["hold", "FIX_C"], ["hold", "FIX_D"], ["transfer", "FIX_T"]]);
  const a = cards[0];
  assert.equal(a.fields.due, "시험용 시기", "글자 + 글자는 이어 붙인다");
  assert.equal(a.fields.detail, "시험용 상세");
  assert.equal(a.fields.rate, null);
  assert.deepEqual(a.dynamic, ["rate"]);
  assert.deepEqual(cards[2].dynamic, ["oneLiner"], "조건식 값도 동적");
  assert.equal("rate" in cards[1].fields, false, "없는 칸은 만들지 않는다");
});

test("초안 만들기 - 양도 단계는 제외하고 취득·보유만 초안 2개, 동적 값은 표시 글자만 남는다", () => {
  const { drafts, skipped } = buildDrafts(extractCards(FIXTURE), originOf(FIXTURE));
  assert.equal(skipped, 1);
  assert.deepEqual(drafts.map((d) => [d.topic, d.slug, d.hub, d.tax_scope, d.sections.length]), [
    ["sm_cards_acquire", "sm-cards-acquire", "realestate_tax", "local", 2],
    ["sm_cards_hold", "sm-cards-hold", "realestate_tax", "both", 2],
  ]);
  const body = drafts[0].sections[0].body;
  assert.ok(body.includes(`세율 요약: ${DYNAMIC_MARK}`));
  assert.ok(body.includes("과세표준: 시험용 기준"));
  assert.equal(drafts[0].sections[0].heading, "시험용 카드 A");
  for (const d of drafts) assert.ok(!JSON.stringify(d).includes("양도 카드"), "양도 카드 내용은 초안에 없다");
});

test("출처 표시는 사본 글자 해시로 바뀌고, 같은 글자는 같다", () => {
  assert.match(originOf(FIXTURE), /^sm:content\/tax-cards\.ts sha256:[0-9a-f]{16}$/);
  assert.equal(originOf(FIXTURE), originOf(FIXTURE));
  assert.notEqual(originOf(FIXTURE), originOf(`${FIXTURE}\n`));
});

test("사본 경로 - data-src/ 아래만 읽고 SM 저장소·저장소 밖·상위 경로 탈출은 거부한다", () => {
  const root = path.resolve("/repo-fixture");
  assert.equal(assertUnderDataSrc("data-src/sm/content/tax-cards.ts", root), path.join(root, "data-src", "sm", "content", "tax-cards.ts"));
  for (const bad of ["../12_RealEstate_Tax_Platform/content/tax-cards.ts", "content/tax-cards.ts", "data-src/../secrets.ts", "data-src", "/etc/passwd"]) {
    assert.throws(() => assertUnderDataSrc(bad, root), /data-src/, bad);
  }
});

test("카드가 하나도 없는 소스는 초안 0개", () => {
  const { drafts, skipped } = buildDrafts(extractCards("export const x = 1;"), "o");
  assert.deepEqual([drafts.length, skipped], [0, 0]);
});
