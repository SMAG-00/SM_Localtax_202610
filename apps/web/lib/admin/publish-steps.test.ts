// 발행까지 할 일 단계표 시험 (F4 · 2026-10-31 3단계) — 실제 규칙 ID로 만든 막힘(finding)이 어느 단계·항목·누구에게 가는지, 한 버튼 계획이 언제 생기는지 확인한다
import { describe, expect, test } from "vitest";
import { finding, type Finding } from "@ltr/editorial";
import { SELF_PUBLISH_NOTE, allChecks, publishSteps, targetOfFinding, type StepsInput, type StepsViewer } from "./publish-steps";

const REPORTER: StepsViewer = { canEdit: true, canSubmit: true, canConfirmRights: false, canDeskEdit: false, canTaxReview: false, canPublish: false, isAuthor: true };
const EDITOR: StepsViewer = { canEdit: true, canSubmit: false, canConfirmRights: true, canDeskEdit: true, canTaxReview: false, canPublish: true, isAuthor: false };
const REVIEWER: StepsViewer = { canEdit: false, canSubmit: false, canConfirmRights: false, canDeskEdit: false, canTaxReview: true, canPublish: false, isAuthor: false };

const input = (findings: Finding[], over: Partial<StepsInput> = {}): StepsInput => ({
  articleId: 7,
  articleStatus: "draft",
  canPublish: findings.length === 0,
  failed: [...new Set(findings.filter((f) => f.level === "block").map((f) => f.id))],
  findings,
  taxReviewReasons: [],
  contentType: "reported_news",
  reportingMethod: "qualitative",
  regional: false,
  viewer: REPORTER,
  ...over,
});
/** 항목(예전 8단계) 하나 — ①·②·③ 안에서 찾는다 */
const step = (steps: ReturnType<typeof publishSteps>, id: string) => allChecks(steps).find((s) => s.id === id)!;
const top = (steps: ReturnType<typeof publishSteps>, id: string) => steps.find((s) => s.id === id)!;
const TAX = finding("nav03.tax-review-required", "세무 감수 서명이 없습니다");
const DESK = finding("nav03.desk-edit-required", "독립 편집자의 편집 승인이 없습니다");

describe("발행까지 할 일 단계표 (F4)", () => {
  test("단계는 ① 쓰기 → ② 확인 → ③ 발행 3개이고, 예전 8단계는 그 안의 항목으로 순서 그대로 들어간다", () => {
    const steps = publishSteps(input([]));
    expect(steps.map((s) => [s.number, s.id, s.title])).toEqual([
      [1, "write", "쓰기"],
      [2, "confirm", "확인"],
      [3, "publish", "발행"],
    ]);
    expect(steps.map((s) => s.checks.map((c) => c.id))).toEqual([["save", "image-rights", "sources", "other-blockers"], ["submit", "tax-review", "desk-edit"], ["publish"]]);
  });

  test("단계 상태는 안의 항목으로 정한다 — 내가 할 항목이 있으면 할 일, 남은 항목이 모두 남의 몫이면 다른 사람 차례", () => {
    const rights = finding("nav04.image-rights", "대표 사진의 이용 권리를 확인하지 않았습니다", { field: "leadImage" });
    // 기자: 사진 권리(편집 책임자 몫)만 남았다 → ① 다른 사람 차례
    expect(top(publishSteps(input([rights])), "write").status).toBe("other");
    // 출처까지 남으면 기자가 할 일이 생긴다 → ① 할 일
    const both = publishSteps(input([rights, finding("nav04.sources-required", "보도기사는 공개 출처가 1건 이상 있어야 합니다")]));
    expect(top(both, "write").status).toBe("todo");
    expect(top(both, "write").description).toContain("[저장]");
    // 막힘이 없으면 ① 끝남
    expect(top(publishSteps(input([], { articleStatus: "in_review" })), "write").status).toBe("done");
  });

  test("막힘이 하나도 없고 검토 요청까지 마치면 끝나지 않은 단계는 발행뿐이고 발행이 켜진다", () => {
    const steps = publishSteps(input([], { articleStatus: "approved", viewer: EDITOR }));
    expect(steps.filter((s) => s.status !== "done").map((s) => s.id)).toEqual(["publish"]);
    for (const s of allChecks(steps).filter((s) => s.id !== "publish")) expect(s.status).toBe("done");
    expect(steps.map((s) => s.status)).toEqual(["done", "done", "todo"]);
    expect(top(steps, "confirm").plan).toBeNull();
    expect(step(steps, "publish")).toMatchObject({ enabled: true, status: "todo", whoIsMe: true });
  });

  test("막힘이 남아 있으면 발행 단계는 꺼져 있다", () => {
    const steps = publishSteps(input([finding("nav04.sources-required", "보도기사는 공개 출처가 1건 이상 있어야 합니다")]));
    expect(step(steps, "publish").enabled).toBe(false);
  });

  test("법안 상태 출처 막힘은 출처 단계로 가고 출처 더하기 폼으로 이동하며 공식 문서 안내가 붙는다", () => {
    const f = finding("pr13.bill-status-source", "법안 상태를 다룬 기사에 공식 자료 출처가 없습니다");
    const s = step(publishSteps(input([f])), "sources");
    expect(s.status).toBe("todo");
    expect(s.items.map((i) => i.message)).toEqual([f.message]);
    expect(s.target).toEqual({ kind: "local", selector: "#source-suggest-button" });
    expect(s.description).toBe("본문 링크에서 자동으로 채워 드립니다 — 확인 후 추가");
  });

  test("사진 권리 막힘은 사진 보관함 화면으로 가고, 확인 권한이 없으면 다른 사람 차례", () => {
    const f = finding("nav04.image-rights", "대표 사진의 이용 권리를 확인하지 않았습니다", { field: "leadImage", phrase: "m-1" });
    const byReporter = step(publishSteps(input([f])), "image-rights");
    expect(byReporter).toMatchObject({ status: "other", whoIsMe: false, who: "편집 책임자", target: { kind: "page", href: "/admin/media" } });
    expect(step(publishSteps(input([f], { viewer: EDITOR })), "image-rights").status).toBe("todo");
  });

  test("모르는 finding id는 '그 밖의 막힘'에 메시지 그대로 들어가고 location으로 이동한다", () => {
    const unknown = { id: "zz99.unknown", level: "block", ruleRef: "ZZ-99", message: "처음 보는 막힘", location: { field: "blocks", blockIndex: 2 } } as unknown as Finding;
    const s = step(publishSteps(input([unknown])), "other-blockers");
    expect(s.status).toBe("todo");
    expect(s.items).toEqual([{ message: "처음 보는 막힘", target: { kind: "local", selector: '[data-testid="block-2"]' } }]);
  });

  test("막힘 문장이 없는 failed id도 사라지지 않고 점검 패널로 보낸다", () => {
    const s = step(publishSteps(input([], { failed: ["opt06.similarity-blocked"], canPublish: false })), "other-blockers");
    expect(s.items).toHaveLength(1);
    expect(s.items[0]!.message).toContain("opt06.similarity-blocked");
    expect(s.items[0]!.target).toEqual({ kind: "local", selector: '[data-testid="check-panel"]' });
  });

  test("경고(warn)는 단계에 넣지 않는다", () => {
    const warn = { id: "opt03.seo-lint-warning", level: "warn", ruleRef: "OPT-03", message: "제목이 깁니다" } as unknown as Finding;
    const steps = publishSteps(input([warn], { canPublish: true, failed: [] }));
    expect(allChecks(steps).flatMap((s) => s.items)).toEqual([]);
  });

  test("역할별 '누가' — 단계마다 역할 이름과 로그인한 계정이 할 수 있는지", () => {
    const f = [finding("nav03.tax-review-required", "세무 감수 서명이 없습니다"), finding("nav03.desk-edit-required", "독립 편집자의 편집 승인이 없습니다")];
    const asReviewer = publishSteps(input(f, { viewer: REVIEWER, articleStatus: "in_review", taxReviewReasons: ["세액 계산"] }));
    expect(step(asReviewer, "tax-review")).toMatchObject({ who: "세무 감수위원", whoIsMe: true, status: "todo" });
    expect(step(asReviewer, "desk-edit")).toMatchObject({ who: "편집 책임자", whoIsMe: false, status: "other" });
    const asEditor = publishSteps(input(f, { viewer: EDITOR, articleStatus: "in_review", taxReviewReasons: ["세액 계산"] }));
    expect(step(asEditor, "tax-review")).toMatchObject({ whoIsMe: false, status: "other" });
    expect(step(asEditor, "desk-edit")).toMatchObject({ whoIsMe: true, status: "todo" });
    expect(step(asEditor, "desk-edit").note).toContain("마지막에");
  });

  test("작성자 본인이 편집 책임자여도 세무 감수 대상 기사면 편집 승인은 다른 사람 차례이고 안내 문장이 나온다", () => {
    const self = { ...EDITOR, isAuthor: true };
    const s = step(publishSteps(input([DESK], { viewer: self, taxReviewReasons: ["세액 계산"] })), "desk-edit");
    expect(s).toMatchObject({ status: "other", whoIsMe: false });
    expect(s.description).toContain("작성자가 아닌 편집 책임자 계정으로 로그인해 승인");
    expect(s.description).toContain("작성자 본인은 승인할 수 없습니다");
  });

  test("작성자 본인 승인 막힘(nav12)도 편집 승인 단계에 들어간다", () => {
    const f = finding("nav12.self-desk-edit", "작성 기자 본인의 편집 승인은 승인으로 치지 않습니다", { field: "reviews", phrase: "u-1" });
    expect(step(publishSteps(input([f], { viewer: EDITOR })), "desk-edit").items).toHaveLength(1);
  });

  test("세무 감수 대상이 아니면 세무 감수 항목은 끝남이고 대상이면 설명이 달라진다", () => {
    expect(step(publishSteps(input([])), "tax-review")).toMatchObject({ status: "done", description: "이 기사는 세무 감수 대상이 아닙니다." });
    expect(step(publishSteps(input([], { taxReviewReasons: ["세액 계산"] })), "tax-review").description).toBe("세무 감수 서명이 있습니다.");
  });

  test("검수 요청 단계는 초안·보류일 때만 할 일이고, 요청 권한이 없으면 다른 사람 차례", () => {
    expect(step(publishSteps(input([])), "submit").status).toBe("todo");
    expect(step(publishSteps(input([], { articleStatus: "held" })), "submit").status).toBe("todo");
    expect(step(publishSteps(input([], { articleStatus: "in_review" })), "submit").status).toBe("done");
    expect(step(publishSteps(input([], { viewer: REVIEWER })), "submit").status).toBe("other");
  });

  test("기본 정보 막힘(제목·요약·작성 기자)은 ① 쓰기의 저장 항목으로 가고 해당 입력 칸으로 이동한다", () => {
    const f = finding("art08.summary-required", "요약이 비어 있습니다", { field: "summary" });
    const s = step(publishSteps(input([f])), "save");
    expect(s.status).toBe("todo");
    expect(s.target).toEqual({ kind: "local", selector: "#meta-summary" });
    expect(step(publishSteps(input([finding("nav03.author-required", "작성 기자가 지정되지 않았습니다")])), "save").items).toHaveLength(1);
  });

  test("같은 막힘이 두 단계에 겹쳐 들어가지 않는다", () => {
    const fs = [
      finding("nav04.image-rights", "대표 사진의 이용 권리를 확인하지 않았습니다", { field: "leadImage" }),
      finding("nav04.sources-required", "보도기사는 공개 출처가 1건 이상 있어야 합니다", { field: "sources" }),
      finding("nav03.desk-edit-required", "독립 편집자의 편집 승인이 없습니다"),
    ];
    const all = allChecks(publishSteps(input(fs))).flatMap((s) => s.items.map((i) => i.message));
    expect(all.sort()).toEqual(fs.map((f) => f.message).sort());
  });
});

describe("② 확인 한 버튼 계획 (감수하고 발행 · 승인하고 발행 · 본인 발행)", () => {
  const BOTH: StepsViewer = { ...EDITOR, canTaxReview: true };
  const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);

  test("감수위원+편집 책임자(작성자 아님)이고 세무 감수·편집 승인이 남았으면 한 칸에서 [감수하고 발행]", () => {
    const steps = publishSteps(input([TAX, DESK], { viewer: BOTH, articleStatus: "in_review", taxReviewReasons: ["세액 계산"] }));
    const plan = top(steps, "confirm").plan!;
    expect(plan).toMatchObject({ articleId: 7, mode: "combined", label: "감수하고 발행", tax: true, desk: true, ready: true, blockedReason: null, note: null });
    expect(ids(plan.taxChecks)).toEqual(["lawBasisChecked", "taxStatementsChecked"]);
    expect(ids(plan.deskChecks)).toEqual(["sourcesChecked", "claimsChecked", "titleChecked", "imagesChecked"]);
    expect(top(steps, "confirm").status).toBe("todo");
    expect(top(steps, "confirm").description).toContain("[감수하고 발행]");
    // 같은 화면에서 하므로 검토·발행 화면으로 가는 바로 가기는 없다
    expect(step(steps, "tax-review").target).toBeNull();
    expect(step(steps, "desk-edit").target).toBeNull();
    expect(step(steps, "publish").description).toBe("② 확인의 [감수하고 발행] 버튼을 누르면 발행까지 한 번에 끝납니다.");
  });

  test("세무 감수 대상이 아니면 편집 책임자 혼자 [승인하고 발행] — 세무 감수 요청은 보내지 않는다", () => {
    const plan = top(publishSteps(input([DESK], { viewer: EDITOR, articleStatus: "in_review" })), "confirm").plan!;
    expect(plan).toMatchObject({ mode: "combined", label: "승인하고 발행", tax: false, desk: true, taxChecks: [] });
  });

  test("편집 승인은 이미 있고 세무 감수만 남았으면 감수만 보내고 발행한다", () => {
    const plan = top(publishSteps(input([TAX], { viewer: BOTH, articleStatus: "approved", taxReviewReasons: ["세액 계산"] })), "confirm").plan!;
    expect(plan).toMatchObject({ label: "감수하고 발행", tax: true, desk: false, deskChecks: [] });
  });

  test("정량형 지역 기사는 편집 확인에 '인과 단정 없음'과 지역 3항목이 붙는다", () => {
    const plan = top(publishSteps(input([DESK], { viewer: EDITOR, reportingMethod: "quantitative", regional: true })), "confirm").plan!;
    expect(ids(plan.deskChecks)).toEqual(["sourcesChecked", "claimsChecked", "titleChecked", "imagesChecked", "noCausalClaim", "evidence", "relation", "ad_independence"]);
  });

  test("역할 하나만 있는 계정은 한 버튼 계획이 없고 예전처럼 자기 몫만 보인다", () => {
    // 편집 책임자인데 세무 감수가 남았다 → 감수는 남의 몫
    const asEditor = publishSteps(input([TAX, DESK], { viewer: EDITOR, articleStatus: "in_review", taxReviewReasons: ["세액 계산"] }));
    expect(top(asEditor, "confirm").plan).toBeNull();
    expect(step(asEditor, "desk-edit")).toMatchObject({ whoIsMe: true, status: "todo", target: { kind: "page", href: "/admin/reviews/7#desk-edit" } });
    expect(step(asEditor, "tax-review")).toMatchObject({ whoIsMe: false, status: "other" });
    // 감수위원(발행 권한 없음) → 계획 없음
    expect(top(publishSteps(input([TAX], { viewer: REVIEWER, taxReviewReasons: ["세액 계산"] })), "confirm").plan).toBeNull();
    // 기자 → 계획 없음
    expect(top(publishSteps(input([DESK])), "confirm").plan).toBeNull();
  });

  test("① 쓰기에 막힘이 남으면 계획은 보이되 버튼은 꺼지고 이유가 붙는다", () => {
    const steps = publishSteps(input([DESK, finding("nav04.sources-required", "보도기사는 공개 출처가 1건 이상 있어야 합니다")], { viewer: EDITOR }));
    expect(top(steps, "confirm").plan).toMatchObject({ ready: false, blockedReason: "① 쓰기의 할 일을 먼저 끝내면 이 버튼이 켜집니다." });
  });

  test("검수 요청 전(초안)이라도 계획이 있으면 검수 요청 없이 진행할 수 있다고 알린다", () => {
    const steps = publishSteps(input([DESK], { viewer: EDITOR, articleStatus: "draft" }));
    expect(step(steps, "submit").note).toBe("지금 계정은 아래 [승인하고 발행] 버튼으로 검수 요청 없이 바로 진행할 수 있습니다.");
    expect(step(publishSteps(input([DESK], { viewer: EDITOR, articleStatus: "in_review" })), "submit").note).toBeNull();
  });

  test("본인 발행 — 작성자 본인 + 편집 책임자 + 세무 감수 대상 아님 + 칼럼 아님이면 [본인 발행]과 기록 안내", () => {
    const self = { ...EDITOR, isAuthor: true };
    const steps = publishSteps(input([DESK], { viewer: self }));
    const plan = top(steps, "confirm").plan!;
    expect(plan).toMatchObject({ mode: "self", label: "본인 발행", tax: false, desk: true, ready: true, note: SELF_PUBLISH_NOTE });
    expect(SELF_PUBLISH_NOTE).toBe("다른 사람 승인 없이 발행합니다 — '본인 발행'으로 기록됩니다");
    expect(step(steps, "desk-edit")).toMatchObject({ status: "todo", whoIsMe: true });
    expect(step(steps, "desk-edit").description).toContain("[본인 발행]");
  });

  test.each([
    ["칼럼(opinion)", { contentType: "opinion" }],
    ["세무 감수 대상", { taxReviewReasons: ["세액 계산"] }],
  ])("본인 발행은 %s이면 없다", (_name, over) => {
    const self = { ...EDITOR, isAuthor: true };
    const steps = publishSteps(input([DESK], { viewer: self, ...over }));
    expect(top(steps, "confirm").plan).toBeNull();
    expect(step(steps, "desk-edit")).toMatchObject({ status: "other", whoIsMe: false });
  });

  test("편집 책임자 역할이 없는 작성자(기자)에게는 본인 발행이 없다", () => {
    expect(top(publishSteps(input([DESK], { viewer: REPORTER })), "confirm").plan).toBeNull();
  });

  test("감수위원+편집 책임자라도 칼럼 필자 본인이면 한 버튼이 없다 (BR-08)", () => {
    expect(top(publishSteps(input([TAX], { viewer: { ...BOTH, isAuthor: true }, contentType: "opinion", taxReviewReasons: ["세액 계산"], articleStatus: "approved" })), "confirm").plan).toBeNull();
  });
});

describe("막힘 위치 → 이동할 칸", () => {
  test.each([
    [{ field: "title" }, "#meta-title"],
    [{ field: "blocks" }, "#blocks"],
    [{ field: "blocks", blockIndex: 0 }, '[data-testid="block-0"]'],
    [{ field: "sources" }, "#sources"],
    [{ field: "taxLens" }, "#taxlens"],
    [{ field: "coversBillStatus" }, "#meta-covers-bill-status"],
    [{ field: "처음 보는 칸" }, '[data-testid="check-panel"]'],
    [undefined, '[data-testid="check-panel"]'],
  ])("%j → %s", (location, selector) => {
    expect(targetOfFinding({ location })).toEqual({ kind: "local", selector });
  });
});
