// W10-e 운영 배치 단위 시험 (AIOPS-01·03·04 · BRIEF-02 · TX-05) - 외부 호출 0, AI 끈 상태와 가짜 모델만 쓴다. 값은 모두 지어낸 시험용
//  · 일정 - 재확인 기한 경계 (주간 브리핑 호 발행 일정·검사기 8종·O4 브리핑 편집은 PO 2026-11-01 결정으로 지웠다)
//  · 예산 - 79%/80%/100% 경계, 비어 있는 설정은 호출 0
//  · 단계 후보 - 공포는 항상, 시행은 시행일 당일부터 / 공포 전 단계는 룰셋 영향 제안 0
//  · 운영 AI - 키 없음 null, 인용 검증
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  kstDate, addMonths, reconfirmDue, reconfirmState, parseReconfirmMonths,
  budgetLevel, parseBudget, costOf, DEFAULT_WARN_RATIO,
  proposeStages, canSuggestRulesetImpact, isConfirmedStage,
  createOpsModel, suggestRulesetImpact, verifyCitations,
} from "../src/ops/index.ts";

const iso = (d) => d.toISOString();

// ── 일정 ──────────────────────────────────────────────────

test("재확인 기한 - 한국 날짜 기준 24개월, 달 끝은 그 달 마지막 날, 당일 안내 1번·다음 날부터 중지", () => {
  assert.equal(kstDate(new Date("2026-10-31T15:30:00Z")), "2026-11-01");
  assert.equal(reconfirmDue(new Date("2026-10-31T15:30:00Z")), "2028-11-01");
  assert.equal(addMonths("2026-08-31", 6), "2027-02-28");
  assert.equal(addMonths("2027-12-15", 1), "2028-01-15");
  assert.equal(parseReconfirmMonths({}), 24);
  assert.equal(parseReconfirmMonths({ interval_months: 12 }), 12);
  assert.equal(reconfirmState("2028-11-01", "2028-10-31"), "ok"); // 전날 - 안내 0
  assert.equal(reconfirmState("2028-11-01", "2028-11-01"), "notify_today");
  assert.equal(reconfirmState("2028-11-01", "2028-11-02"), "stopped"); // 다음 날 - 발송 중지, 안내 중복 0
});

// ── 예산 ──────────────────────────────────────────────────

test("월 예산 경계 - 79%는 정상, 80%는 경보, 100%는 초과", () => {
  assert.equal(budgetLevel(790, 1000), "ok");
  assert.equal(budgetLevel(799.999999, 1000), "ok");
  assert.equal(budgetLevel(800, 1000), "warn");
  assert.equal(budgetLevel(999.999999, 1000), "warn");
  assert.equal(budgetLevel(1000, 1000), "exceeded");
  assert.equal(budgetLevel(1500, 1000), "exceeded");
  assert.equal(budgetLevel(90, 100, 0.9), "warn"); // 경보 비율을 설정으로 바꾼 경우
  assert.equal(DEFAULT_WARN_RATIO, 0.8);
});

test("예산 설정 - 한도·단위가 없는 씨앗(빈 객체)은 null이라 운영 AI 호출 0", () => {
  assert.equal(parseBudget({}), null);
  assert.equal(parseBudget({ monthly_limit: 0, unit: "USD" }), null);
  assert.equal(parseBudget({ monthly_limit: 100, unit: "usd" }), null);
  const b = parseBudget({ monthly_limit: 100, unit: "USD", prices: { "시험-모델": { input_per_mtok: 3, output_per_mtok: 15 } } });
  assert.equal(b.limit, 100);
  assert.equal(b.warnRatio, 0.8);
  assert.equal(costOf({ inputTokens: 1_000_000, outputTokens: 500_000 }, "시험-모델", b), 10.5);
  assert.equal(costOf({ inputTokens: 10, outputTokens: 10 }, "단가 없는 모델", b), null, "단가가 없으면 비용을 지어내지 않는다");
});

// ── 단계 후보 ─────────────────────────────────────────────

test("단계 후보 - 공포는 항상, 시행은 시행일 당일부터 (전날은 공포만)", () => {
  const v = { promulgatedOn: "2099-01-05", effectiveOn: "2099-02-10" };
  assert.deepEqual(proposeStages(v, "2099-02-09").map((c) => c.stage), ["promulgated"]);
  assert.deepEqual(proposeStages(v, "2099-02-10").map((c) => c.stage), ["promulgated", "effective"]);
  const [p] = proposeStages(v, "2099-01-06");
  assert.equal(p.occurredOn, "2099-01-05");
  assert.equal(p.sourceKey(7), "law_event:7:promulgated");
});

test("공포 전 단계(입법예고·국회 제출·의결)는 룰셋 영향 제안 대상이 아니다", () => {
  for (const s of ["announced", "pre_notice", "submitted", "passed"]) {
    assert.equal(canSuggestRulesetImpact(s), false, s);
    assert.equal(isConfirmedStage(s), false, s);
  }
  assert.equal(canSuggestRulesetImpact("promulgated"), true);
  assert.equal(canSuggestRulesetImpact("effective"), true);
});

// ── 운영 AI ───────────────────────────────────────────────

/** 순서대로 답하는 가짜 모델 - 호출 수를 센다 */
function fakeModel(replies) {
  let n = 0;
  return {
    name: "가짜-모델",
    get calls() { return n; },
    async complete() {
      const r = replies[Math.min(n, replies.length - 1)];
      n += 1;
      if (r instanceof Error) throw r;
      return { text: typeof r === "string" ? r : JSON.stringify(r), usage: { inputTokens: 100, outputTokens: 20 } };
    },
  };
}
test("운영 AI 모델 - 키나 모델 이름이 없으면 null (호출 0)", () => {
  assert.equal(createOpsModel({ apiKey: undefined, model: "m" }), null);
  assert.equal(createOpsModel({ apiKey: "k", model: undefined }), null);
  assert.equal(createOpsModel({ apiKey: "", model: "m" }), null);
});

test("운영 AI 모델 - 응답에서 글과 토큰 수를 읽고, 오류 응답은 던진다 (가짜 fetch)", async () => {
  let seen;
  const ok = createOpsModel({
    apiKey: "시험-키", model: "시험-모델", baseUrl: "http://fake.test/",
    fetchImpl: async (url, init) => { seen = { url, headers: init.headers, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ content: [{ type: "text", text: "안녕" }], usage: { input_tokens: 11, output_tokens: 7 } }), { status: 200 }); },
  });
  const r = await ok.complete("시스템", "사용자");
  assert.deepEqual(r, { text: "안녕", usage: { inputTokens: 11, outputTokens: 7 } });
  assert.equal(seen.url, "http://fake.test/v1/messages");
  assert.equal(seen.headers["x-api-key"], "시험-키");
  assert.equal(seen.body.model, "시험-모델");
  const bad = createOpsModel({ apiKey: "k", model: "m", fetchImpl: async () => new Response("{}", { status: 529 }) });
  await assert.rejects(() => bad.complete("s", "u"), /529/);
});

test("O1 - 공포 전 단계는 모델을 한 번도 부르지 않는다 (제안 0)", async () => {
  const m = fakeModel([[]]);
  for (const stage of ["announced", "pre_notice", "submitted", "passed"]) {
    const r = await suggestRulesetImpact(m, { stage, articleText: "시험용 조문 글자" });
    assert.deepEqual(r, { status: "skipped", reason: "not_confirmed_stage" });
  }
  assert.equal(m.calls, 0);
});

test("O1 - 인용 검증: 조문 글자에 없는 문장을 근거로 든 제안은 버린다", async () => {
  const article = "시험용 조문 글자 가나다라마바사 아자차카타파하 입니다";
  const keep = { target: "ruleset", summary: "시험용 제안 하나", quote: "가나다라마바사 아자차카타파하" };
  const drop = { target: "tax_calendar", summary: "시험용 제안 둘", quote: "조문에 전혀 없는 지어낸 문장입니다" };
  const m = fakeModel([[keep, drop]]);
  const r = await suggestRulesetImpact(m, { stage: "promulgated", articleText: article });
  assert.equal(r.status, "proposed");
  assert.deepEqual(r.proposals.map((p) => p.target), ["ruleset"]);
  assert.equal(r.dropped, 1);
  assert.equal(m.calls, 3, "제안자·반론자·정리자");
  assert.deepEqual(verifyCitations([drop], article), { kept: [], dropped: 1 });
});

test("O1 - 남은 제안이 없으면 초안을 만들지 않는다 (none)", async () => {
  const m = fakeModel([[{ target: "ruleset", summary: "시험용", quote: "조문에 없는 문장 조문에 없는 문장" }]]);
  const r = await suggestRulesetImpact(m, { stage: "effective", articleText: "시험용 조문 글자 전혀 다름" });
  assert.equal(r.status, "none");
  const empty = await suggestRulesetImpact(fakeModel([[]]), { stage: "effective", articleText: "시험용 조문" });
  assert.equal(empty.status, "none");
  assert.deepEqual(await suggestRulesetImpact(m, { stage: "effective", articleText: "  " }), { status: "skipped", reason: "no_text" });
});
