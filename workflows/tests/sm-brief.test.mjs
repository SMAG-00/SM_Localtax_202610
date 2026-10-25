// W10-e SM 주간 브리핑 이식 단위 시험 - 외부 호출 0, 값은 모두 지어낸 시험용
//  · 수집 틀 - 기간 경계, 관련 낱말 거르기, 결정례 결론 표지
//  · 달력 - 매년 반복(연말 걸침)·한 번만·상시, 진행 중 개정안 기준일 경계
//  · 검사기 추가분 - DRF 노출, 빈 링크, 결론 표지와 주문, 필수 코너, 출처 줄 대조
//  · 지시문 - 금지어 주입, 감수 낱말 0, 형식 안내
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BRIEF_CORNERS, COLLECT_TARGETS, LAW_NAMES, REQUIRED_CORNER_KEYS,
  isNewInRange, isoFromCompact, pickRelevant, prioritizeDecisions, decisionBadge,
  calendarOccurrences, ongoingNeedsRefresh,
  runBriefChecks, buildBriefSystemPrompt, draftBriefItem, REVIEW_WORD,
} from "../src/ops/index.ts";

test("코너 순서 - 한눈에가 맨 앞, 알아둘 날짜가 맨 뒤, 키는 겹치지 않는다", () => {
  const keys = BRIEF_CORNERS.map((c) => c.key);
  assert.equal(keys[0], "editor_notes");
  assert.equal(keys.at(-1), "dates");
  assert.equal(new Set(keys).size, keys.length);
  for (const k of REQUIRED_CORNER_KEYS) assert.ok(keys.includes(k), k);
});

test("수집 틀 - 법령 12개, 대상 4개는 모두 data_sources 키를 가리키고 코너가 실제 코너다", () => {
  assert.equal(LAW_NAMES.length, 12);
  assert.equal(COLLECT_TARGETS.length, 4);
  const keys = BRIEF_CORNERS.map((c) => c.key);
  for (const t of COLLECT_TARGETS) {
    assert.ok(keys.includes(t.cornerKey), t.key);
    assert.ok(["law_api", "admrul", "mois_interpretation", "tribunal_decision"].includes(t.sourceKey), t.key);
  }
});

test("기간 판정 - 시작일은 제외, 끝일은 포함, 모양이 틀리면 거짓", () => {
  assert.equal(isNewInRange("2026-11-01", "2026-11-01", "2026-11-08"), false);
  assert.equal(isNewInRange("2026-11-02", "2026-11-01", "2026-11-08"), true);
  assert.equal(isNewInRange("2026-11-08", "2026-11-01", "2026-11-08"), true);
  assert.equal(isNewInRange("2026-11-09", "2026-11-01", "2026-11-08"), false);
  assert.equal(isNewInRange("20261105", "2026-11-01", "2026-11-08"), false);
  assert.equal(isNewInRange(null, "2026-11-01", "2026-11-08"), false);
  assert.equal(isoFromCompact("20261105"), "2026-11-05");
  assert.equal(isoFromCompact("2026-11-05"), null);
});

test("관련 낱말 거르기와 결정례 우선순위 - 제목에 걸린 것만, 우선 낱말이 앞, 같으면 원래 순서", () => {
  const rows = [{ t: "시험용 항만 안건" }, { t: "시험용 재산세 안건" }, { t: "시험용 취득세 안건" }];
  assert.deepEqual(pickRelevant(rows, (r) => r.t, 5).map((r) => r.t), ["시험용 재산세 안건", "시험용 취득세 안건"]);
  assert.equal(pickRelevant(rows, (r) => r.t, 1).length, 1);
  const d = [{ t: "시험용 일반 사건" }, { t: "시험용 경매 사건" }, { t: "시험용 기타 사건" }, { t: "시험용 임대 사건" }];
  assert.deepEqual(prioritizeDecisions(d, (r) => r.t, 3).map((r) => r.t), ["시험용 경매 사건", "시험용 임대 사건", "시험용 일반 사건"]);
});

test("결정례 결론 표지 - 기각은 lose, 취소·경정은 win, 그 밖은 null", () => {
  assert.equal(decisionBadge("심판청구를 기각한다"), "lose");
  assert.equal(decisionBadge("  심판청구를 기각한다"), "lose");
  assert.equal(decisionBadge("처분청이 한 처분을 취소한다"), "win");
  assert.equal(decisionBadge("처분을 경정한다"), "win");
  assert.equal(decisionBadge("심판청구를 각하한다"), null);
});

test("달력 - 매년 반복은 연말을 넘어도 잡히고, 기간 밖은 빠지고, 상시는 맨 뒤", () => {
  const rules = [
    { id: 1, text: "시험용 상시", isAlways: true },
    { id: 2, text: "시험용 연말 반복", isYearly: true, startMd: "12-20", endMd: "12-31" },
    { id: 3, text: "시험용 연초 반복", isYearly: true, startMd: "01-02" },
    { id: 4, text: "시험용 한 번만", startOn: "2027-01-10", endOn: "2027-01-12" },
    { id: 5, text: "시험용 먼 날짜", startOn: "2027-06-01" },
  ];
  const out = calendarOccurrences(rules, "2026-12-25", "2027-01-15");
  assert.deepEqual(out.map((o) => o.id), [2, 3, 4, 1]);
  assert.equal(out[0].start, "2026-12-20");
  assert.equal(out[0].end, "2026-12-31");
  assert.equal(out[3].start, null);
  assert.equal(calendarOccurrences(rules, "2026-12-25", "2027-01-15", 2).length, 2);
  // 끝 날짜가 from과 같은 날이면 포함, 하루 전이면 제외
  assert.equal(calendarOccurrences([rules[1]], "2026-12-31", "2027-01-05").length, 1);
  assert.equal(calendarOccurrences([rules[1]], "2027-01-01", "2027-01-05").length, 0);
});

test("진행 중 개정안 - 기준일에서 45일까지는 정상, 46일부터 다시 확인", () => {
  const e = { id: 1, name: "시험용 개정안", stage: "정부안", asOf: "2026-09-01" };
  assert.equal(ongoingNeedsRefresh(e, "2026-10-16"), false);
  assert.equal(ongoingNeedsRefresh(e, "2026-10-17"), true);
  assert.equal(ongoingNeedsRefresh({ ...e, asOf: "잘못된 값" }, "2026-10-17"), false);
});

// ── 검사기 추가분 ─────────────────────────────────────────

const doc = (items, over = {}) => ({
  title: "시험용 호", subject: "시험용 호", hasAd: false,
  corners: [{ key: "laws", title: "지방세 법령 개정", items, emptyNote: "시험용 빈 코너" }, { key: "dates", title: "알아둘 날짜", items: [], emptyNote: "시험용 빈 코너" }],
  footer: { disclaimer: "시험용 면책", noHarvestNotice: "시험용 거부 안내", adInfoUrl: "/ads" },
  excerpts: {}, linkStatus: {}, forbiddenWords: [], reviewLabelAllowed: false, ...over,
});
const item = (over = {}) => ({ id: "a1", text: "시험용 항목", origin: "human", reviewed: true, ...over });
const msgs = (r, check) => r.findings.filter((f) => f.check === check).map((f) => f.message);

test("API 상세 링크(DRF)와 OC= 파라미터는 차단", () => {
  const r = runBriefChecks(doc([item({ sourceUrl: "https://example.test/DRF/lawService.do", text: "시험용 항목" }), item({ id: "a2", sourceUrl: "https://example.test/x?OC=abc" })], { linkStatus: { "https://example.test/DRF/lawService.do": "ok", "https://example.test/x?OC=abc": "ok" } }));
  assert.ok(msgs(r, "credential").some((m) => m.includes("DRF")));
  assert.ok(msgs(r, "credential").length >= 2); // OC= 값은 기존 인증키 검사가 잡는다
  assert.ok(r.blocking >= 2);
  const clean = runBriefChecks(doc([item({ sourceUrl: "https://example.test/law", })], { linkStatus: { "https://example.test/law": "ok" } }));
  assert.equal(clean.blocking, 0);
});

test("빈 링크 '#'와 빈 문자열은 링크 동작 검사에서 차단", () => {
  const r = runBriefChecks(doc([item({ sourceUrl: "#" }), item({ id: "a2", links: [""] })]));
  assert.equal(msgs(r, "link_alive").filter((m) => m === "빈 링크입니다").length, 2);
});

test("결정례 결론 표지 - 주문이 없으면 차단, 기각 표기에 기각 주문이면 통과, 어긋나면 차단", () => {
  const lose = item({ id: "d1", badge: "lose" });
  assert.ok(msgs(runBriefChecks(doc([lose])), "stage_label").some((m) => m.includes("주문 원문이 없어")));
  assert.equal(msgs(runBriefChecks(doc([lose], { excerpts: { "d1#order": "심판청구를 기각한다" } })), "stage_label").length, 0);
  assert.ok(msgs(runBriefChecks(doc([lose], { excerpts: { "d1#order": "처분을 취소한다" } })), "stage_label").some((m) => m.includes("기각 표기인데")));
  const win = item({ id: "d2", badge: "win" });
  assert.ok(msgs(runBriefChecks(doc([win], { excerpts: { "d2#order": "심판청구를 기각한다" } })), "stage_label").some((m) => m.includes("취소·경정 표기인데")));
  assert.equal(msgs(runBriefChecks(doc([win], { excerpts: { "d2#order": "처분을 경정한다" } })), "stage_label").length, 0);
});

test("출처 줄의 일자가 원문과 다르면 차단, 같으면 통과", () => {
  const bad = item({ id: "m1", meta: ["공포 2026.10.2"], sourceDate: "2026-10-01" });
  assert.ok(msgs(runBriefChecks(doc([bad])), "source_match").some((m) => m.includes("일자가 원문에 없습니다")));
  const ok = item({ id: "m2", meta: ["공포 2026.10.1"], sourceDate: "2026-10-01" });
  assert.equal(msgs(runBriefChecks(doc([ok])), "source_match").length, 0);
});

test("필수 코너가 없으면 경고, 설정하지 않으면 검사하지 않는다", () => {
  const base = doc([]);
  base.corners = base.corners.filter((c) => c.key !== "dates");
  assert.equal(msgs(runBriefChecks(base), "empty_corner").length, 0);
  const r = runBriefChecks({ ...base, requiredCorners: REQUIRED_CORNER_KEYS });
  assert.deepEqual(msgs(r, "empty_corner"), ["필수 코너가 없습니다"]);
  assert.equal(r.findings.find((f) => f.check === "empty_corner").level, "warn");
});

// ── 지시문 ────────────────────────────────────────────────

test("지시문 - 금지어는 주입되고, 감수 낱말·세율 값은 없고, 출력 형식이 있다", () => {
  const p = buildBriefSystemPrompt(["시험금지어", "  "]);
  assert.ok(p.includes("금지 표현: 시험금지어"));
  assert.ok(!p.includes(REVIEW_WORD));
  assert.ok(p.includes('"editorLines"'));
  assert.ok(!buildBriefSystemPrompt([]).includes("금지 표현"));
});

test("초안 만들기가 금지어 목록을 시스템 지시문에 넣어 모델에 넘긴다", async () => {
  const seen = [];
  const model = {
    name: "fake",
    async complete(system) {
      seen.push(system);
      return { text: JSON.stringify({ title: "시험용 제목", summary: "시험용 요약입니다", implication: "시험용 시사점입니다", editorLines: ["하나입니다", "둘입니다", "셋입니다"] }), usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
  const r = await draftBriefItem(model, { itemId: "x", facts: { title: "시험용" }, excerpt: "시험용 원문", forbiddenWords: ["시험금지어"] });
  assert.equal(r.ok, true);
  assert.ok(seen[0].includes("금지 표현: 시험금지어"));
});
