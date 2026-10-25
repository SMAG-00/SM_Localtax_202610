// W10-e 운영 배치 단위 시험 (AIOPS-01·02·03·04 · BRIEF-01~04 · TX-05) - 외부 호출 0, AI 끈 상태와 가짜 모델만 쓴다. 값은 모두 지어낸 시험용
//  · 일정 - 한국 시간 월 10:00 발행(09:59:59/10:00:00 경계, 서버 시간대와 무관), 재확인 기한 경계
//  · 예산 - 79%/80%/100% 경계, 비어 있는 설정은 호출 0
//  · 단계 후보 - 공포는 항상, 시행은 시행일 당일부터 / 공포 전 단계는 룰셋 영향 제안 0
//  · 검사기 8종 - 종류마다 통과와 실패 입력 한 쌍
//  · 운영 AI - 키 없음 null, 형식 위반 1회 재시도, 두 번 실패하면 검수자 작성 표시, 인용 검증
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextPublishAt, parsePublishPolicy, DEFAULT_PUBLISH_POLICY, kstDate, addMonths, reconfirmDue, reconfirmState, parseReconfirmMonths, isPublishDue,
  budgetLevel, parseBudget, costOf, DEFAULT_WARN_RATIO,
  proposeStages, canSuggestRulesetImpact, isConfirmedStage,
  runBriefChecks, issueSubject, longestCommonRun, CHECK_IDS,
  renderIssueText, issueSlug,
  createOpsModel, draftBriefItem, validateBriefDraft, suggestRulesetImpact, verifyCitations, FALLBACK_NOTE,
} from "../src/ops/index.ts";

const iso = (d) => d.toISOString();

// ── 일정 ──────────────────────────────────────────────────

test("발행 시각 - 월 10:00 KST 직전 1초는 같은 날 10:00, 10:00 정각부터는 다음 주", () => {
  assert.equal(iso(nextPublishAt(new Date("2026-11-02T00:59:59Z"))), "2026-11-02T01:00:00.000Z"); // 월 09:59:59 KST
  assert.equal(iso(nextPublishAt(new Date("2026-11-02T01:00:00Z"))), "2026-11-09T01:00:00.000Z"); // 월 10:00:00 KST - 이미 발행 시각
  assert.equal(iso(nextPublishAt(new Date("2026-11-01T14:00:00Z"))), "2026-11-02T01:00:00.000Z"); // 일 23:00 KST(O4 실행 시각)
  assert.equal(iso(nextPublishAt(new Date("2026-11-01T15:30:00Z"))), "2026-11-02T01:00:00.000Z"); // UTC로는 일요일, 한국은 월 00:30
});

test("발행 시각은 서버 시간대에 따르지 않는다 - TZ를 바꿔도 같은 순간", () => {
  const before = process.env.TZ;
  const results = [];
  for (const tz of ["UTC", "Asia/Seoul", "America/Los_Angeles"]) {
    process.env.TZ = tz;
    results.push(iso(nextPublishAt(new Date("2026-11-04T05:00:00Z"))));
  }
  if (before === undefined) delete process.env.TZ;
  else process.env.TZ = before;
  assert.deepEqual(results, ["2026-11-09T01:00:00.000Z", "2026-11-09T01:00:00.000Z", "2026-11-09T01:00:00.000Z"]);
});

test("정책 값 - 요일·시각을 바꾸면 따르고, 모양이 틀린 칸은 PRD 기본값", () => {
  assert.deepEqual(parsePublishPolicy({}), DEFAULT_PUBLISH_POLICY);
  assert.deepEqual(parsePublishPolicy({ weekday: 9, hour: 25, minute: -1 }), DEFAULT_PUBLISH_POLICY);
  const fri = parsePublishPolicy({ weekday: 5, hour: 8, minute: 30 });
  assert.equal(iso(nextPublishAt(new Date("2026-11-02T00:00:00Z"), fri)), "2026-11-05T23:30:00.000Z".replace("11-05", "11-05")); // 금 08:30 KST = 목 23:30 UTC
});

test("발행 시각이 됐나 - 같은 순간부터 참, 1밀리초 전은 거짓", () => {
  const at = new Date("2026-11-02T01:00:00Z");
  assert.equal(isPublishDue(at, new Date("2026-11-02T00:59:59.999Z")), false);
  assert.equal(isPublishDue(at, new Date("2026-11-02T01:00:00.000Z")), true);
});

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

// ── 검사기 8종 ────────────────────────────────────────────

const GOOD = () => ({
  title: "시험용 브리핑 0호",
  subject: "(광고) 시험용 브리핑 0호",
  hasAd: true,
  corners: [
    {
      key: "amendments",
      title: "개정 단계",
      items: [
        { id: "a1", text: "시험용 법 개정이 공포 단계입니다. 제99999호, 2099-01-05", origin: "system", reviewed: true, sourceUrl: "https://example.test/law/1", sourceNo: "제99999호", sourceDate: "2099-01-05", amendment: { stageLabel: "공포", confirmed: true } },
      ],
    },
    { key: "docs", title: "새 문서", items: [], emptyNote: "이번 주 새 문서가 없습니다" },
  ],
  footer: { disclaimer: "시험용 면책 문구", noHarvestNotice: "시험용 무단수집 거부 안내", adInfoUrl: "https://example.test/ad" },
  excerpts: { a1: "시험용 원문 발췌 공포번호 제99999호 공포일 2099년 1월 5일" },
  linkStatus: { "https://example.test/law/1": "ok" },
  forbiddenWords: ["반드시 지금"],
  reviewLabelAllowed: false,
});
const only = (doc, check) => runBriefChecks(doc).findings.filter((f) => f.check === check);

test("검사기 - 모든 칸이 맞는 호는 차단 0·경고 0", () => {
  const r = runBriefChecks(GOOD());
  assert.deepEqual([r.blocking, r.warnings], [0, 0], JSON.stringify(r.findings));
  assert.deepEqual(Object.keys(r.byCheck), [...CHECK_IDS]);
});

test("검사기 1 번호·일자·링크 원문 일치 - 원문에 없는 번호·일자·주소는 각각 차단, 날짜 표기가 달라도 같은 날이면 통과", () => {
  const d = GOOD();
  d.corners[0].items[0].text = "공포 단계 제88888호, 2099-03-01, https://example.test/other";
  const f = only(d, "source_match");
  assert.equal(f.length, 3);
  assert.ok(f.every((x) => x.level === "block"));
  const ok = GOOD();
  ok.corners[0].items[0].text = "공포 단계, 2099년 1월 5일 제 99999 호".replace("제 99999 호", "제99999호");
  assert.equal(only(ok, "source_match").length, 0);
});

test("검사기 2 인증키 노출 - 본문·링크의 OC=값은 차단", () => {
  const d = GOOD();
  d.corners[0].items[0].links = ["https://example.test/api?OC=abc123secret"];
  assert.equal(only(d, "credential").length, 1);
  assert.equal(only(GOOD(), "credential").length, 0);
});

test("검사기 3 금지어 - 설정 금지어와 '감수'는 차단, 감수 체계 확정 뒤(reviewLabelAllowed)에는 감수만 허용", () => {
  const d = GOOD();
  d.corners[0].items[0].text += " 반드시 지금 확인하세요. 감수를 거쳤습니다";
  const f = only(d, "forbidden_word");
  assert.equal(f.length, 2);
  d.reviewLabelAllowed = true;
  assert.equal(only(d, "forbidden_word").length, 1);
});

test("검사기 4 면책·표기 - 칸이 비면 차단, 광고성 호 제목에 (광고)가 없으면 차단", () => {
  const d = GOOD();
  d.footer = { disclaimer: "", noHarvestNotice: " ", adInfoUrl: "" };
  assert.equal(only(d, "disclaimer").length, 3);
  const e = GOOD();
  e.subject = "시험용 브리핑 0호";
  const f = only(e, "disclaimer");
  assert.equal(f.length, 1);
  assert.match(f[0].message, /\(광고\)/);
  e.hasAd = false;
  assert.equal(only(e, "disclaimer").length, 0);
});

test("검사기 5 링크 동작 - 열리지 않음·확인 전은 차단", () => {
  const d = GOOD();
  d.linkStatus["https://example.test/law/1"] = "broken";
  assert.equal(only(d, "link_alive").length, 1);
  d.linkStatus = {};
  assert.match(only(d, "link_alive")[0].message, /확인하지 않았습니다/);
});

test("검사기 6 진행 단계 표기 - 단계 이름 누락과 확정 전 개정안의 '확정 아님' 누락은 차단", () => {
  const d = GOOD();
  d.corners[0].items[0].text = "개정 소식 제99999호, 2099-01-05";
  assert.equal(only(d, "stage_label").length, 1);
  const e = GOOD();
  e.corners[0].items[0].amendment = { stageLabel: "입법예고", confirmed: false };
  e.corners[0].items[0].text = "입법예고 단계입니다 제99999호, 2099-01-05";
  assert.equal(only(e, "stage_label").length, 1);
  e.corners[0].items[0].text += " 확정 아님";
  assert.equal(only(e, "stage_label").length, 0);
});

test("검사기 7 원문 15단어 이상 일치 - 14단어는 통과, 15단어는 경고(차단 아님)", () => {
  const words = Array.from({ length: 20 }, (_, i) => `단어${i}`);
  const d = GOOD();
  d.excerpts.a1 = `${words.join(" ")} 제99999호 2099-01-05`;
  d.corners[0].items[0].text = `공포 ${words.slice(0, 14).join(" ")} 제99999호 2099-01-05`;
  assert.equal(only(d, "verbatim_run").length, 0);
  d.corners[0].items[0].text = `공포 ${words.slice(0, 15).join(" ")} 제99999호 2099-01-05`;
  const f = only(d, "verbatim_run");
  assert.equal(f.length, 1);
  assert.equal(f[0].level, "warn");
  assert.equal(longestCommonRun(["가", "나", "다"], ["나", "다", "라"]), 2);
});

test("검사기 8 빈 코너 표기 - 빈 코너에 표기가 없으면 경고", () => {
  const d = GOOD();
  d.corners[1].emptyNote = "";
  const r = runBriefChecks(d);
  assert.equal(r.byCheck.empty_corner, 1);
  assert.equal(r.findings.find((f) => f.check === "empty_corner").level, "warn");
  assert.equal(r.blocking, 0);
  assert.equal(r.warnings, 1);
});

test("메일 제목 - 광고성 호는 (광고)를 앞에 붙이고 이미 있으면 한 번만", () => {
  assert.equal(issueSubject("시험용 호", true), "(광고) 시험용 호");
  assert.equal(issueSubject("(광고) 시험용 호", true), "(광고) 시험용 호");
  assert.equal(issueSubject("시험용 호", false), "시험용 호");
});

test("메일 본문 - 하단에 광고·제휴 안내 링크와 무단수집 거부 안내, 수신 거부 링크, 웹 주소가 있다", () => {
  const d = GOOD();
  const text = renderIssueText({ title: d.title, corners: d.corners, footer: d.footer, webUrl: "https://example.test/brief/2026-11-02", unsubscribeUrl: "https://example.test/brief/unsubscribe?token=t" });
  for (const needle of ["시험용 무단수집 거부 안내", "광고·제휴 안내: https://example.test/ad", "수신 거부: https://example.test/brief/unsubscribe?token=t", "https://example.test/brief/2026-11-02", "이번 주 새 문서가 없습니다"]) {
    assert.ok(text.includes(needle), needle);
  }
  assert.equal(issueSlug(new Date("2026-11-02T01:00:00Z")), "2026-11-02");
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
const GOOD_DRAFT = { title: "시험용 제목", summary: "시험용 요약", implication: "시험용 시사점", editorLines: ["하나", "둘", "셋"] };
const INPUT = { itemId: "a1", facts: { title: "시험용 개정", sourceNo: "제99999호", sourceDate: "2099-01-05", sourceUrl: "https://example.test/law/1" }, excerpt: "시험용 원문 제99999호" };

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

test("O4 - 형식이 맞으면 한 번에 통과하고 사용량이 기록된다", async () => {
  const m = fakeModel([GOOD_DRAFT]);
  const r = await draftBriefItem(m, INPUT);
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 1);
  assert.deepEqual(r.usage, { inputTokens: 100, outputTokens: 20 });
  assert.equal(m.calls, 1);
});

test("O4 - 형식을 어기면 1회 재시도, 두 번째에 맞으면 통과 (사용량은 합산)", async () => {
  const m = fakeModel(["JSON 아님", GOOD_DRAFT]);
  const r = await draftBriefItem(m, INPUT);
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.deepEqual(r.usage, { inputTokens: 200, outputTokens: 40 });
});

test("O4 - 두 번 다 어기면 '요약 실패 — 검수자 작성'이고 호출은 정확히 2번", async () => {
  const m = fakeModel([{ ...GOOD_DRAFT, editorLines: ["하나"] }]);
  const r = await draftBriefItem(m, INPUT);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "format");
  assert.equal(r.note, FALLBACK_NOTE);
  assert.equal(FALLBACK_NOTE, "요약 실패 — 검수자 작성");
  assert.equal(m.calls, 2);
});

test("O4 - 모델 호출이 실패하면 api_error (재시도하지 않고 다음 실행에 맡긴다)", async () => {
  const m = fakeModel([new Error("네트워크")]);
  const r = await draftBriefItem(m, INPUT);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "api_error");
  assert.equal(m.calls, 1);
});

test("O4 - 초안에 원문에 없는 번호·일자가 있으면 형식 위반 (번호·일자는 코드가 원문에서 넣는다)", () => {
  const ground = "시험용 원문 제99999호 2099-01-05";
  assert.deepEqual(validateBriefDraft(GOOD_DRAFT, ground).problems, []);
  const bad = validateBriefDraft({ ...GOOD_DRAFT, summary: "제12345호가 2099-12-31에 시행" }, ground);
  assert.equal(bad.draft, null);
  assert.equal(bad.problems.length, 2);
  assert.equal(validateBriefDraft({ ...GOOD_DRAFT, title: "가".repeat(61) }, ground).draft, null, "60자 경계 초과");
  assert.notEqual(validateBriefDraft({ ...GOOD_DRAFT, title: "가".repeat(60) }, ground).draft, null, "60자는 통과");
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
