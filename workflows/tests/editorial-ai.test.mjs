// W12-f 편집국 AI 단위 시험 (AIOPS-07~10 · CASE-05 · ART-13·14) - 외부 호출 0, 가짜 모델만 쓴다. 값은 모두 지어낸 시험용
//  · 요지 - 사건번호·일자는 요지 줄에 허용 0, 3줄·글자 수, 태그는 사전에서만, 원문에 없는 조문 후보 버림, 1회 재시도
//  · 검사기 - 원문에 없는 숫자·고유명사 경고, 금지 표현
//  · 채널 원고 - 상한 초과 0(자르지 않고 실패), 끝줄(링크 + AI 활용 표기) 코드가 붙임
//  · 정합성 - 1영업일 기한 경계(시각 주입), 주 키, 영향 문장은 기사에 있는 것만
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  unsupportedFigures, unsupportedNumbers, forbiddenHits, hasCaseIdentifier,
  draftCaseSummary, validateCaseSummary, eligibleTags,
  draftArticleBox, validateArticleBox,
  parseChannelLimits, draftChannelCopy, channelFooter, AI_NOTICE_LINE, CHANNELS,
  judgeImpactSentences, proposalDeadline, proposalLate, isKstMonday, isoWeekKey,
} from "../src/ops/index.ts";

const usage = { inputTokens: 10, outputTokens: 5 };
/** 답을 순서대로 돌려주는 가짜 모델 - 호출 횟수를 센다 */
function fake(...answers) {
  const m = { name: "fake", calls: 0, async complete() { const a = answers[Math.min(m.calls, answers.length - 1)]; m.calls++; if (a instanceof Error) throw a; return { text: typeof a === "string" ? a : JSON.stringify(a), usage }; } };
  return m;
}

const BODY = "시험용 결정례 본문입니다. 청구인은 시험용법 제3조 적용을 다투었고 시험용심판원은 청구를 기각했습니다. 쟁점 금액은 1,000원이었습니다.";
const TAGS = [
  { tagKey: "tag_a", label: "시험 태그 A", taxItems: ["취득세"] },
  { tagKey: "tag_b", label: "시험 태그 B", taxItems: ["재산세"] },
  { tagKey: "tag_c", label: "시험 태그 C" },
];
const goodSummary = (over = {}) => ({
  lines: ["청구인의 주장을 받아들이지 않았습니다.", "시험용법 적용 여부가 쟁점이었습니다.", "쟁점 금액은 1,000원이었습니다."],
  resultType: "dismissed", popularity: 40, tagKeys: ["tag_a", "tag_b", "tag_zzz"], newTagCandidates: [{ label: "새 시험 태그", reason: "사전에 없음" }],
  provisionCandidates: ["시험용법 제3조", "없는법 제9조"], ...over,
});
const input = { body: BODY, taxKinds: ["취득세"], tags: TAGS, forbiddenWords: ["절대금지어"] };

// ── 검사기 ──
test("원문에 없는 숫자는 경고하고 원문에 있는 숫자(쉼표 차이 포함)는 통과", () => {
  assert.deepEqual(unsupportedNumbers("금액은 1000원입니다", BODY), []);
  assert.equal(unsupportedNumbers("금액은 2,500원입니다", BODY).length, 1);
});
test("원문에 없는 고유명사 모양을 경고하고 있는 것은 통과", () => {
  assert.deepEqual(unsupportedFigures("시험용심판원은 시험용법을 적용했습니다", BODY), []);
  assert.ok(unsupportedFigures("가짜위원회가 판단했습니다", BODY).some((m) => m.includes("가짜위원회")));
});
test("금지 표현은 대소문자 무관으로 찾고 빈 목록은 0", () => {
  assert.deepEqual(forbiddenHits("이것은 절대금지어 입니다", ["절대금지어", ""]), ["절대금지어"]);
  assert.deepEqual(forbiddenHits("문제 없음", ["절대금지어"]), []);
});
test("사건번호·일자 모양 판별", () => {
  assert.equal(hasCaseIdentifier("조심2023서1234 결정"), true);
  assert.equal(hasCaseIdentifier("2026. 3. 1. 선고"), true);
  assert.equal(hasCaseIdentifier("제123호 사건"), true);
  assert.equal(hasCaseIdentifier("청구를 기각했습니다."), false);
});

// ── 요지 ──
test("태그 후보는 세목이 겹치거나 세목 제한이 없는 것만", () => {
  assert.deepEqual(eligibleTags(TAGS, ["취득세"]).map((t) => t.tagKey), ["tag_a", "tag_c"]);
});
test("정상 요지 - 3줄, 사전 밖·세목 밖 태그 버림, 원문에 없는 조문 후보 버림", async () => {
  const m = fake(goodSummary());
  const r = await draftCaseSummary(m, input);
  assert.equal(r.ok, true);
  assert.equal(r.draft.lines.length, 3);
  assert.deepEqual(r.draft.tagKeys, ["tag_a"]);
  assert.deepEqual(r.draft.provisionCandidates, ["시험용법 제3조"]);
  assert.equal(r.draft.newTagCandidates.length, 1);
  assert.equal(r.draft.warnings.length, 0);
  assert.equal(m.calls, 1);
});
test("요지 줄에 사건번호·일자가 있으면 형식 위반 - 재시도 후에도 같으면 실패(초안 0)", async () => {
  const bad = goodSummary({ lines: ["조심2023서1234 사건입니다.", "둘째 줄입니다.", "셋째 줄입니다."] });
  const m = fake(bad);
  const r = await draftCaseSummary(m, input);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "format");
  assert.equal(m.calls, 2);
});
test("첫 답이 형식을 어기면 1회 재시도로 통과", async () => {
  const m = fake("JSON 아님", goodSummary());
  const r = await draftCaseSummary(m, input);
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.equal(r.usage.inputTokens, 20);
});
test("줄 수·글자 수·결론 유형·금지어 위반은 각각 문제로 잡힌다", () => {
  assert.ok(validateCaseSummary(goodSummary({ lines: ["하나", "둘"] }), input).problems.length > 0);
  assert.ok(validateCaseSummary(goodSummary({ lines: ["가".repeat(141), "둘", "셋"] }), input).problems.length > 0);
  assert.ok(validateCaseSummary(goodSummary({ resultType: "other2" }), input).problems.length > 0);
  assert.ok(validateCaseSummary(goodSummary({ popularity: 101 }), input).problems.length > 0);
  assert.ok(validateCaseSummary(goodSummary({ lines: ["절대금지어 포함", "둘", "셋"] }), input).problems.some((p) => p.includes("금지 표현")));
});
test("원문에 없는 숫자가 요지에 있으면 초안은 만들어지되 경고가 붙는다", () => {
  const v = validateCaseSummary(goodSummary({ lines: ["청구를 기각했습니다.", "둘째입니다.", "금액은 9,999원이었습니다."] }), input);
  assert.ok(v.draft);
  assert.ok(v.draft.warnings.some((w) => w.includes("9,999")));
});
test("모델 오류는 api_error(재시도 없음)", async () => {
  const m = fake(new Error("boom"));
  const r = await draftCaseSummary(m, input);
  assert.deepEqual([r.ok, r.reason, m.calls], [false, "api_error", 1]);
});

// ── 요약 상자 ──
const ART = "시험용 기사 본문입니다. 시험용법 제3조가 쟁점이었습니다.";
const goodBox = (over = {}) => ({
  threeLines: ["쟁점은 시험용법 적용이었습니다.", "기사는 한 가지 사례를 다뤘습니다.", "결론은 본문을 확인하세요."], meaning: "독자는 본문을 읽고 판단할 수 있습니다.",
  cardnews: { situation: "상황입니다.", issue: "쟁점입니다.", judgment: "판단입니다.", lesson: "교훈입니다.", checkpoint: "확인할 점입니다." }, seoTitle: "시험용 제목", seoDescription: "시험용 설명입니다.", ...over,
});
test("요약 상자 - 정상 초안에 카드뉴스 5칸과 검색 제목·설명이 있다", async () => {
  const r = await draftArticleBox(fake(goodBox()), { title: "시험용 기사", articleText: ART });
  assert.equal(r.ok, true);
  assert.equal(Object.keys(r.draft.cardnews).length, 5);
  assert.equal(r.draft.threeLines.length, 3);
});
test("요약 상자 - 기사에 없는 숫자는 경고, 칸 누락·초과는 형식 위반", () => {
  const w = validateArticleBox(goodBox({ meaning: "독자는 777을 알아야 합니다." }), { title: "t", articleText: ART });
  assert.ok(w.draft.warnings.some((x) => x.includes("777")));
  assert.ok(validateArticleBox(goodBox({ seoTitle: "" }), { title: "t", articleText: ART }).problems.length > 0);
  assert.ok(validateArticleBox(goodBox({ meaning: "가".repeat(301) }), { title: "t", articleText: ART }).problems.length > 0);
});

// ── 채널 원고 ──
test("채널 상한 설정 - 비어 있으면 모든 채널 생성 0, 양의 정수만 인정", () => {
  assert.deepEqual(parseChannelLimits({}), {});
  assert.deepEqual(parseChannelLimits(null), {});
  assert.deepEqual(parseChannelLimits({ brief: 200, shorts: 0, naver_blog: "x", cardnews: 1.5 }), { brief: 200 });
  assert.equal(CHANNELS.length, 5);
});
test("채널 원고 - 끝줄(원문 링크 + AI 활용 표기)은 코드가 붙이고 전체가 상한 이내", async () => {
  const url = "https://example.test/news/a?utm_source=x";
  const r = await draftChannelCopy(fake({ text: "시험용 브리프 본문입니다." }), { channel: "brief", title: "t", articleText: ART, articleUrl: url, limit: 300 });
  assert.equal(r.ok, true);
  assert.ok(r.text.endsWith(AI_NOTICE_LINE));
  assert.ok(r.text.includes(url));
  assert.ok(r.text.length <= 300);
  assert.equal(r.text, r.body + channelFooter(url));
});
test("채널 원고 - 상한을 넘기면 재시도 1회 뒤에도 넘으면 실패하고 자르지 않는다", async () => {
  const m = fake({ text: "가".repeat(500) });
  const r = await draftChannelCopy(m, { channel: "cardnews", title: "t", articleText: ART, articleUrl: "https://example.test/a", limit: 200 });
  assert.deepEqual([r.ok, r.reason, m.calls], [false, "too_long", 2]);
});
test("채널 원고 - 끝줄만으로 상한을 넘는 아주 작은 상한은 호출 0", async () => {
  const m = fake({ text: "x" });
  const r = await draftChannelCopy(m, { channel: "shorts", title: "t", articleText: ART, articleUrl: "https://example.test/a", limit: 30 });
  assert.deepEqual([r.ok, m.calls], [false, 0]);
});
test("채널 원고 - 첫 답이 상한을 넘고 둘째 답이 이내면 통과, 금지 표현은 거부", async () => {
  const ok = await draftChannelCopy(fake({ text: "가".repeat(400) }, { text: "짧은 본문입니다." }), { channel: "naver_blog", title: "t", articleText: ART, articleUrl: "https://example.test/a", limit: 200, forbiddenWords: ["절대금지어"] });
  assert.equal(ok.ok, true);
  assert.equal(ok.attempts, 2);
  const bad = await draftChannelCopy(fake({ text: "절대금지어 포함 본문" }), { channel: "naver_post", title: "t", articleText: ART, articleUrl: "https://example.test/a", limit: 200, forbiddenWords: ["절대금지어"] });
  assert.equal(bad.ok, false);
});

// ── 정합성 ──
test("영향 문장 판단 - 기사 글에 실제로 있는 문장만 남긴다", async () => {
  const article = "첫 문장은 개정 전 조문을 전제로 합니다. 둘째 문장은 상관없습니다.";
  const r = await judgeImpactSentences(fake({ sentences: ["첫 문장은 개정 전 조문을 전제로 합니다.", "기사에 없는 지어낸 문장입니다."] }), { articleText: article, oldText: "옛", newText: "새" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.sentences, ["첫 문장은 개정 전 조문을 전제로 합니다."]);
});
test("1영업일 기한 - 월요일 감지는 화요일 끝, 금요일 감지는 월요일 끝(시각 주입, 서버 시간대 무관)", () => {
  const iso = (d) => d.toISOString();
  assert.equal(iso(proposalDeadline(new Date("2026-11-02T03:00:00Z"))), "2026-11-03T14:59:59.999Z"); // 월 12:00 KST -> 화 23:59:59.999 KST
  assert.equal(iso(proposalDeadline(new Date("2026-11-06T03:00:00Z"))), "2026-11-09T14:59:59.999Z"); // 금 -> 다음 월
  assert.equal(iso(proposalDeadline(new Date("2026-11-07T03:00:00Z"))), "2026-11-09T14:59:59.999Z"); // 토 -> 월
  assert.equal(iso(proposalDeadline(new Date("2026-11-02T03:00:00Z"), ["2026-11-03"])), "2026-11-04T14:59:59.999Z"); // 공휴일 건너뜀
  const before = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  assert.equal(iso(proposalDeadline(new Date("2026-11-02T03:00:00Z"))), "2026-11-03T14:59:59.999Z");
  if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
});
test("제안 지연 판정 - 기한 직전은 정시, 1밀리초 뒤는 지연", () => {
  const detected = new Date("2026-11-02T03:00:00Z");
  assert.equal(proposalLate(detected, new Date("2026-11-03T14:59:59.999Z")), false);
  assert.equal(proposalLate(detected, new Date("2026-11-03T15:00:00.000Z")), true);
});
test("월요일 판정과 주 키는 한국 날짜 기준", () => {
  assert.equal(isKstMonday(new Date("2026-11-01T15:30:00Z")), true); // UTC 일요일 = 한국 월요일 00:30
  assert.equal(isKstMonday(new Date("2026-11-02T15:30:00Z")), false);
  assert.equal(isoWeekKey(new Date("2026-11-01T15:30:00Z")), "2026-W45");
  assert.equal(isoWeekKey(new Date("2026-01-01T00:00:00Z")), "2026-W01");
});
