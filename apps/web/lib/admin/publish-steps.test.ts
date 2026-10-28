// 발행까지 할 일 단계표 시험 (F4) — 실제 규칙 ID로 만든 막힘(finding)이 어느 단계·누구에게 가는지 확인한다
import { describe, expect, test } from "vitest";
import { finding, type Finding } from "@ltr/editorial";
import { publishSteps, targetOfFinding, type StepsInput, type StepsViewer } from "./publish-steps";

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
  viewer: REPORTER,
  ...over,
});
const step = (steps: ReturnType<typeof publishSteps>, id: string) => steps.find((s) => s.id === id)!;

describe("발행까지 할 일 단계표 (F4)", () => {
  test("단계는 8개이고 번호·순서가 발행 절차 순이다", () => {
    const steps = publishSteps(input([]));
    expect(steps.map((s) => s.id)).toEqual(["save", "image-rights", "sources", "other-blockers", "submit", "tax-review", "desk-edit", "publish"]);
    expect(steps.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test("막힘이 하나도 없고 검토 요청까지 마치면 끝나지 않은 단계는 발행뿐이고 발행이 켜진다", () => {
    const steps = publishSteps(input([], { articleStatus: "approved", viewer: EDITOR }));
    expect(steps.filter((s) => s.status !== "done").map((s) => s.id)).toEqual(["publish"]);
    for (const s of steps.filter((s) => s.id !== "publish")) expect(s.status).toBe("done");
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
    expect(s.target).toEqual({ kind: "local", selector: "#src-kind" });
    expect(s.description).toContain("법률안·입법예고(bill)");
    expect(s.description).toContain("확인일=원문을 연 날");
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
    expect(steps.flatMap((s) => s.items)).toEqual([]);
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

  test("작성자 본인이 편집 책임자여도 편집 승인은 다른 사람 차례이고 안내 문장이 나온다", () => {
    const self = { ...EDITOR, isAuthor: true };
    const s = step(publishSteps(input([finding("nav03.desk-edit-required", "독립 편집자의 편집 승인이 없습니다")], { viewer: self })), "desk-edit");
    expect(s).toMatchObject({ status: "other", whoIsMe: false });
    expect(s.description).toContain("작성자가 아닌 편집 책임자 계정으로 로그인해 승인");
    expect(s.description).toContain("작성자 본인은 승인할 수 없습니다");
  });

  test("작성자 본인 승인 막힘(nav12)도 편집 승인 단계에 들어간다", () => {
    const f = finding("nav12.self-desk-edit", "작성 기자 본인의 편집 승인은 승인으로 치지 않습니다", { field: "reviews", phrase: "u-1" });
    expect(step(publishSteps(input([f], { viewer: EDITOR })), "desk-edit").items).toHaveLength(1);
  });

  test("세무 감수 대상이 아니면 6단계는 끝남이고 대상이면 설명이 달라진다", () => {
    expect(step(publishSteps(input([])), "tax-review")).toMatchObject({ status: "done", description: "이 기사는 세무 감수 대상이 아닙니다." });
    expect(step(publishSteps(input([], { taxReviewReasons: ["세액 계산"] })), "tax-review").description).toBe("세무 감수 서명이 있습니다.");
  });

  test("검수 요청 단계는 초안·보류일 때만 할 일이고, 요청 권한이 없으면 다른 사람 차례", () => {
    expect(step(publishSteps(input([])), "submit").status).toBe("todo");
    expect(step(publishSteps(input([], { articleStatus: "held" })), "submit").status).toBe("todo");
    expect(step(publishSteps(input([], { articleStatus: "in_review" })), "submit").status).toBe("done");
    expect(step(publishSteps(input([], { viewer: REVIEWER })), "submit").status).toBe("other");
  });

  test("기본 정보 막힘(제목·요약·작성 기자)은 1단계로 가고 해당 입력 칸으로 이동한다", () => {
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
    const all = publishSteps(input(fs)).flatMap((s) => s.items.map((i) => i.message));
    expect(all.sort()).toEqual(fs.map((f) => f.message).sort());
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
