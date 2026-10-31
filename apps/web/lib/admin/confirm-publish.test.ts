// ② 확인 한 버튼 시험 — 계획에서 나온 요청 순서·본문, 첫 실패에서 멈추기, 서버 문장 그대로 보이기
//  서버 대신 요청을 받아 적고 정해 둔 응답을 돌려주는 가짜 호출을 쓴다 (서버 계약: reviews 201 · publish 200 · 거부 403/422 + error 문장)
import { describe, expect, test } from "vitest";
import { finding } from "@ltr/editorial";
import type { ApiResult } from "./api-client";
import { allConfirmChecked, confirmRequests, doneNote, runConfirmPublish, type ApiCall } from "./confirm-publish";
import { publishSteps, type ConfirmPlan, type StepsInput, type StepsViewer } from "./publish-steps";

const EDITOR: StepsViewer = { canEdit: true, canSubmit: false, canConfirmRights: true, canDeskEdit: true, canTaxReview: false, canPublish: true, isAuthor: false };
const BOTH: StepsViewer = { ...EDITOR, canTaxReview: true };
const TAX = finding("nav03.tax-review-required", "세무 감수 서명이 없습니다");
const DESK = finding("nav03.desk-edit-required", "독립 편집자의 편집 승인이 없습니다");

/** 실제 단계표 함수로 계획을 만든다 — 손으로 만든 계획이 아니다 */
function planFor(over: Partial<StepsInput>): ConfirmPlan {
  const findings = over.findings ?? [];
  const base: StepsInput = {
    articleId: 42,
    articleStatus: "in_review",
    canPublish: false,
    failed: findings.map((f) => f.id),
    findings,
    taxReviewReasons: [],
    contentType: "reported_news",
    reportingMethod: "qualitative",
    regional: false,
    viewer: EDITOR,
  };
  const plan = publishSteps({ ...base, ...over }).find((s) => s.id === "confirm")!.plan;
  if (!plan) throw new Error("계획이 없습니다");
  return plan;
}

/** 요청을 받아 적고 차례대로 응답을 돌려주는 가짜 호출 */
function fakeApi(responses: ApiResult[]): { call: ApiCall; sent: { path: string; body: unknown }[] } {
  const sent: { path: string; body: unknown }[] = [];
  const queue = [...responses];
  const call: ApiCall = async (_method, path, body) => {
    sent.push({ path, body });
    const next = queue.shift();
    if (!next) throw new Error(`응답을 준비하지 않은 요청: ${path}`);
    return next;
  };
  return { call, sent };
}

describe("요청 순서·본문", () => {
  test("[감수하고 발행] — 세무 감수 승인 → 편집 승인 → 발행, 체크 항목은 모두 true", () => {
    const plan = planFor({ findings: [TAX, DESK], viewer: BOTH, taxReviewReasons: ["세액 계산"] });
    expect(confirmRequests(plan).map((r) => [r.kind, r.path, r.body, r.okStatus])).toEqual([
      ["tax_review", "/api/admin/articles/42/reviews", { kind: "tax_review", decision: "approve", checklist: { lawBasisChecked: true, taxStatementsChecked: true } }, 201],
      ["desk_edit", "/api/admin/articles/42/reviews", { kind: "desk_edit", decision: "approve", checklist: { sourcesChecked: true, claimsChecked: true, titleChecked: true, imagesChecked: true } }, 201],
      ["publish", "/api/admin/articles/42/publish", undefined, 200],
    ]);
  });

  test("[승인하고 발행] — 세무 감수 대상이 아니면 감수 요청 없이 편집 승인 → 발행", () => {
    expect(confirmRequests(planFor({ findings: [DESK] })).map((r) => r.kind)).toEqual(["desk_edit", "publish"]);
  });

  test("[본인 발행] — 편집 승인 checklist에 selfPublish: true가 붙는다", () => {
    const plan = planFor({ findings: [DESK], viewer: { ...EDITOR, isAuthor: true } });
    const desk = confirmRequests(plan)[0]!;
    expect(desk.body).toEqual({ kind: "desk_edit", decision: "approve", checklist: { sourcesChecked: true, claimsChecked: true, titleChecked: true, imagesChecked: true, selfPublish: true } });
  });

  test("다른 사람 기사의 편집 승인에는 selfPublish가 붙지 않는다", () => {
    const desk = confirmRequests(planFor({ findings: [DESK] }))[0]!;
    expect((desk.body as { checklist: Record<string, unknown> }).checklist).not.toHaveProperty("selfPublish");
  });
});

describe("체크 항목", () => {
  test("세무 감수·편집 확인 항목을 모두 체크해야 버튼이 켜진다", () => {
    const plan = planFor({ findings: [TAX, DESK], viewer: BOTH, taxReviewReasons: ["세액 계산"] });
    const desk = { "desk.sourcesChecked": true, "desk.claimsChecked": true, "desk.titleChecked": true, "desk.imagesChecked": true };
    expect(allConfirmChecked(plan, {})).toBe(false);
    expect(allConfirmChecked(plan, desk)).toBe(false);
    expect(allConfirmChecked(plan, { ...desk, "tax.lawBasisChecked": true })).toBe(false);
    expect(allConfirmChecked(plan, { ...desk, "tax.lawBasisChecked": true, "tax.taxStatementsChecked": true })).toBe(true);
    expect(allConfirmChecked(plan, { ...desk, "desk.titleChecked": false, "tax.lawBasisChecked": true, "tax.taxStatementsChecked": true })).toBe(false);
  });
});

describe("차례로 보내기", () => {
  test("모두 성공하면 세 요청을 순서대로 보내고 발행 경고 수를 돌려준다", async () => {
    const plan = planFor({ findings: [TAX, DESK], viewer: BOTH, taxReviewReasons: ["세액 계산"] });
    const api = fakeApi([
      { status: 201, body: { review: { id: 1 } } },
      { status: 201, body: { review: { id: 2 } } },
      { status: 200, body: { warnings: [{ id: "opt03.title-long" }, { id: "opt03.summary-long" }] } },
    ]);
    expect(await runConfirmPublish(plan, api.call)).toEqual({ ok: true, done: ["tax_review", "desk_edit", "publish"], warnings: 2 });
    expect(api.sent.map((s) => s.path)).toEqual(["/api/admin/articles/42/reviews", "/api/admin/articles/42/reviews", "/api/admin/articles/42/publish"]);
  });

  test("세무 감수가 거부되면 거기서 멈추고 편집 승인·발행은 보내지 않는다", async () => {
    const plan = planFor({ findings: [TAX, DESK], viewer: BOTH, taxReviewReasons: ["세액 계산"] });
    const api = fakeApi([{ status: 403, body: { error: "세무 감수 서명은 세무 감수위원(reviewer)만 할 수 있습니다" } }]);
    expect(await runConfirmPublish(plan, api.call)).toEqual({
      ok: false,
      done: [],
      failedAt: "tax_review",
      title: "세무 감수에서 멈췄습니다 — 세무 감수 서명은 세무 감수위원(reviewer)만 할 수 있습니다",
      details: [],
    });
    expect(api.sent).toHaveLength(1);
  });

  test("본인 발행을 서버가 거부(403)하면 서버 이유 문장을 그대로 보이고 발행은 보내지 않는다", async () => {
    const plan = planFor({ findings: [DESK], viewer: { ...EDITOR, isAuthor: true } });
    const api = fakeApi([{ status: 403, body: { error: "세무 감수 대상 기사는 본인 발행을 할 수 없습니다" } }]);
    const r = await runConfirmPublish(plan, api.call);
    expect(r).toMatchObject({ ok: false, failedAt: "desk_edit", done: [], title: "편집 승인에서 멈췄습니다 — 세무 감수 대상 기사는 본인 발행을 할 수 없습니다" });
    expect(api.sent.map((s) => s.path)).toEqual(["/api/admin/articles/42/reviews"]);
  });

  test("승인 뒤 발행이 422로 막히면 앞 단계는 기록됐다고 알리고 막힘 문장을 자세히에 넣는다", async () => {
    const plan = planFor({ findings: [TAX, DESK], viewer: BOTH, taxReviewReasons: ["세액 계산"] });
    const api = fakeApi([
      { status: 201, body: {} },
      { status: 201, body: {} },
      { status: 422, body: { error: "발행할 수 없습니다 — 차단 항목 1개", failed: ["opt06.similarity-blocked"], findings: [{ level: "block", message: "다른 기사와 너무 비슷합니다" }, { level: "warn", message: "제목이 깁니다" }] } },
    ]);
    const r = await runConfirmPublish(plan, api.call);
    expect(r).toEqual({ ok: false, done: ["tax_review", "desk_edit"], failedAt: "publish", title: "발행에서 멈췄습니다 — 발행할 수 없습니다 — 차단 항목 1개", details: ["다른 기사와 너무 비슷합니다"] });
    expect(doneNote(r.done)).toBe("세무 감수·편집 승인은 기록됐습니다. [화면 새로 불러오기]를 누르면 남은 일만 보입니다.");
  });

  test("서버에 닿지 않으면(상태 0) 연결 안내 문장으로 멈춘다", async () => {
    const api = fakeApi([{ status: 0, body: {} }]);
    expect(await runConfirmPublish(planFor({ findings: [DESK] }), api.call)).toMatchObject({ ok: false, failedAt: "desk_edit", title: "편집 승인에서 멈췄습니다 — 서버에 닿지 않았습니다 — 연결을 확인하고 다시 시도하세요" });
  });
});

describe("앞 단계 기록 안내", () => {
  test.each([
    [[], null],
    [["tax_review"], "세무 감수는 기록됐습니다. [화면 새로 불러오기]를 누르면 남은 일만 보입니다."],
    [["desk_edit"], "편집 승인은 기록됐습니다. [화면 새로 불러오기]를 누르면 남은 일만 보입니다."],
  ] as const)("%j → %s", (done, note) => {
    expect(doneNote(done)).toBe(note);
  });
});
