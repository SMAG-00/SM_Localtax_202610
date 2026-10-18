// 기사 편집기 상태 ↔ API 요청 본문 시험 (ART-01 · ART-05 · NAV-10 · NAV-11 · CORE-01)
// 편집기가 만든 PATCH 본문을 실제 API 입력 검사(parseArticleInput)에 넣어 통과하는지, 저장된 기사를 다시 읽으면 같은 상태가 되는지 본다.
import { describe, expect, test } from "vitest";
import { RULES } from "@ltr/editorial";
import { EMPTY_CHECKLISTS, parseBodyInput, type StoredBody } from "@/lib/server/articles/content";
import { parseArticleInput } from "@/lib/server/articles/input";
import {
  addBlock,
  editorPayload,
  editorStateFromArticle,
  fieldErrorsFromServer,
  moveBlock,
  needsActionCheck,
  qualitativeRecords,
  quantitativeGroups,
  removeBlock,
  rowsToText,
  textToRows,
  validateEditor,
  type EditorArticle,
  type EditorState,
} from "./editor-state";

let n = 0;
const key = () => `k${++n}`;

const QUANT_BODY: StoredBody = {
  blocks: [
    { type: "key_summary", lines: ["상반기 취득세 징수액은 1,284억 원입니다.", "1년 전보다 18.4% 줄었습니다."] },
    { type: "paragraph", text: "편집국이 세목별 징수 실적을 집계했다." },
    { type: "table", caption: "구별 징수액", rows: [["구", "억 원"], ["한빛구", "512"]], chart: { axis: "구", unit: "억 원", source: "세정과" } },
    { type: "quote", text: "세입 여건이 어렵습니다.", speaker: "세정과 주무관", origin: "interview", refId: "ev:3" },
    { type: "callout", kind: "mistake", title: "자주 틀리는 점", text: "신고 기한은 60일입니다.", checklist: { actionWritten: true } },
  ],
  claims: [{ id: "claim-1", text: "징수액은 1,284억 원이다.", kind: "fact", evidenceIds: ["ev:3", "src:4"], blockIndex: 1 }],
};

function article(over: Partial<EditorArticle> = {}): EditorArticle {
  return {
    id: 10,
    slug: "gaon-2026h1",
    title: "가온시 상반기 취득세 18.4% 감소",
    summary: "요약입니다.",
    status: "draft",
    version: 3,
    firstPublishedAt: null,
    section: "local",
    categoryId: 14,
    contentType: "reported_news",
    reportingMethod: "quantitative",
    format: "general",
    subtype: "general",
    label: "none",
    partnerId: null,
    leadMediaId: null,
    legalBasisDate: null,
    regionCodes: ["11680"],
    editorialField: null,
    publicQuestion: null,
    seriesTitle: null,
    seriesEpisode: null,
    body: QUANT_BODY,
    solvedCase: null,
    taxLens: null,
    checklists: { ...EMPTY_CHECKLISTS, quantitative: { sourceCrossCheck: "대조함", limitations: null, relatedPartyCheck: null } },
    ...over,
  };
}

const ctx = (s: EditorState, over: Partial<{ published: boolean; version: number }> = {}) => ({ published: false, version: 3, ...over });

describe("저장된 기사 → 편집기 상태 → PATCH 본문", () => {
  test("PATCH 본문은 API 입력 검사(parseArticleInput patch)를 통과한다", () => {
    const s = editorStateFromArticle(article(), key);
    const payload = editorPayload(s, ctx(s));
    const parsed = parseArticleInput(payload, "patch");
    expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    expect(payload.expectedVersion).toBe(3);
  });

  test("본문 블록·핵심 주장이 그대로 돌아온다 (왕복)", () => {
    const s = editorStateFromArticle(article(), key);
    const body = editorPayload(s, ctx(s)).body as StoredBody;
    expect(body).toEqual(QUANT_BODY);
    expect(parseBodyInput(body).ok).toBe(true);
  });

  test("블록 순서를 바꾸면 핵심 주장의 블록 번호도 따라간다", () => {
    const s = editorStateFromArticle(article(), key);
    const moved = { ...s, blocks: moveBlock(s.blocks, 1, -1) };
    const body = editorPayload(moved, ctx(moved)).body as StoredBody;
    expect(body.blocks[0]!.type).toBe("paragraph");
    expect(body.claims[0]!.blockIndex).toBe(0);
  });

  test("블록을 지우면 그 블록을 가리키던 핵심 주장은 블록 없음(null)", () => {
    const s = editorStateFromArticle(article(), key);
    const removed = { ...s, blocks: removeBlock(s.blocks, 1) };
    const body = editorPayload(removed, ctx(removed)).body as StoredBody;
    expect(body.blocks).toHaveLength(4);
    expect(body.claims[0]!.blockIndex).toBeNull();
  });

  test("새 블록 — 종류별 빈 모양, 자주 틀리는 점 상자는 제목이 고정", () => {
    let blocks = addBlock([], "callout", key);
    blocks = [{ ...blocks[0]!, kind: "mistake", title: "다른 제목" }];
    blocks = addBlock(blocks, "faq", key);
    blocks = addBlock(blocks, "image", key);
    const s = { ...editorStateFromArticle(article(), key), blocks, claims: [] };
    const stored = (editorPayload(s, ctx(s)).body as StoredBody).blocks;
    expect(stored[0]).toEqual({ type: "callout", kind: "mistake", title: "자주 틀리는 점", text: "" });
    expect(stored[1]).toEqual({ type: "faq", items: [{ question: "", answer: "" }] });
    expect(stored[2]).toEqual({ type: "image", mediaId: "", alt: "", caption: "" });
  });

  test("표 — 줄마다 한 행, 칸은 | 로 나눈다. 축·단위·출처가 모두 비면 표기 없음(null)", () => {
    expect(textToRows("구 | 억 원\n한빛구|512\n\n누리구 | 431 ")).toEqual([["구", "억 원"], ["한빛구", "512"], ["누리구", "431"]]);
    expect(rowsToText([["구", "억 원"], ["한빛구", "512"]])).toBe("구 | 억 원\n한빛구 | 512");
    const s = editorStateFromArticle(article(), key);
    const blocks = s.blocks.map((b) => (b.type === "table" ? { ...b, axis: "", unit: " ", source: "" } : b));
    const table = (editorPayload({ ...s, blocks }, ctx(s)).body as StoredBody).blocks[2] as { chart: unknown };
    expect(table.chart).toBeNull();
  });

  test("'기한'·'가산세'가 든 블록만 '할 일을 함께 썼다' 확인이 필요하다 (UX-03)", () => {
    const s = editorStateFromArticle(article(), key);
    expect(needsActionCheck(s.blocks[4]!)).toBe(true);
    expect(needsActionCheck(s.blocks[1]!)).toBe(false);
    expect(needsActionCheck({ ...s.blocks[1]!, text: "가산세가 붙습니다." })).toBe(true);
    expect(needsActionCheck({ ...s.blocks[0]!, linesText: "신고 기한은 60일" })).toBe(true);
  });

  test("보도기사가 아니면 취재 방식을 null로 보낸다 (DB 규칙)", () => {
    const s = { ...editorStateFromArticle(article(), key), contentType: "explainer" };
    expect(editorPayload(s, ctx(s)).reportingMethod).toBeNull();
  });

  test("지역 코드·법령 기준일·하위 분야 — 빈 칸은 null·빈 목록", () => {
    const s = { ...editorStateFromArticle(article(), key), regionCodesText: " 11680, 11650 ,", legalBasisDate: "", categoryId: "" };
    const p = editorPayload(s, ctx(s));
    expect(p.regionCodes).toEqual(["11680", "11650"]);
    expect(p.legalBasisDate).toBeNull();
    expect(p.categoryId).toBeNull();
  });

  test("확인 목록 — 빈 글자는 null, 정량형 3칸·관점 기록은 그대로 API 모양", () => {
    const s = editorStateFromArticle(article(), key);
    s.checklists = {
      ...s.checklists,
      isLocalPolicyIssue: true,
      quantitative: { sourceCrossCheck: "대조함", limitations: "  ", relatedPartyCheck: "세정과 확인" },
      perspectives: { local_gov: { status: "interviewed", evidenceId: "ev:3", contactedAt: "2026-10-13" }, residents_taxpayers: { status: "no_response", evidenceId: null, contactedAt: "2026-10-12" }, experts: null },
      originalTextChecks: [{ sourceId: "src:4", checkedAt: "2026-10-14" }],
    };
    const p = editorPayload(s, ctx(s));
    const parsed = parseArticleInput(p, "patch");
    expect(parsed.ok).toBe(true);
    expect((p.checklists as { quantitative: unknown }).quantitative).toEqual({ sourceCrossCheck: "대조함", limitations: null, relatedPartyCheck: "세정과 확인" });
  });
});

describe("「지방세로 읽기」 (CORE-01)", () => {
  test("박스 — 세목은 쉼표, 포인트는 줄마다. 생략 사유는 null", () => {
    const s = { ...editorStateFromArticle(article(), key), taxLensMode: "box" as const, taxTopicsText: "취득세, 재산세", taxPointsText: "포인트 1\n포인트 2", taxLinks: [{ kind: "explainer" as const, label: "해설", url: "/tax/x" }] };
    expect(editorPayload(s, ctx(s)).taxLens).toEqual({ topics: ["취득세", "재산세"], points: ["포인트 1", "포인트 2"], links: [{ kind: "explainer", label: "해설", url: "/tax/x" }], omissionReason: null });
  });

  test("생략 — 박스 칸은 비우고 사유만", () => {
    const s = { ...editorStateFromArticle(article(), key), taxLensMode: "skip" as const, omissionReason: "세금 영향은 후속 기사에서 다룬다", taxTopicsText: "취득세" };
    expect(editorPayload(s, ctx(s)).taxLens).toEqual({ topics: [], points: [], links: [], omissionReason: "세금 영향은 후속 기사에서 다룬다" });
  });

  test("안 씀 — null", () => {
    const s = editorStateFromArticle(article(), key);
    expect(s.taxLensMode).toBe("none");
    expect(editorPayload(s, ctx(s)).taxLens).toBeNull();
  });

  test("저장된 생략 사유 → 생략 모드로 읽는다", () => {
    const s = editorStateFromArticle(article({ taxLens: { topics: [], points: [], links: [], skip_reason: "후속 기사", reviewed: false, reviewed_for_version: null, reviewed_by: null, reviewed_at: null } }), key);
    expect(s.taxLensMode).toBe("skip");
    expect(s.omissionReason).toBe("후속 기사");
  });
});

describe("발행 뒤 수정 (ART-05)", () => {
  test("발행된 기사는 수정 종류·사유를 함께 보낸다", () => {
    const s = { ...editorStateFromArticle(article({ status: "published", firstPublishedAt: "2026-10-16T01:00:00Z" }), key), updateKind: "typo", reason: "오탈자 고침" };
    const p = editorPayload(s, ctx(s, { published: true }));
    expect(p.updateKind).toBe("typo");
    expect(p.reason).toBe("오탈자 고침");
    expect(parseArticleInput(p, "patch").ok).toBe(true);
  });

  test("발행 전에는 수정 종류·사유를 보내지 않는다", () => {
    const s = { ...editorStateFromArticle(article(), key), updateKind: "typo", reason: "x" };
    const p = editorPayload(s, ctx(s));
    expect("updateKind" in p).toBe(false);
    expect("reason" in p).toBe(false);
  });

  test("수정 종류·사유가 없으면 칸마다 오류", () => {
    const s = editorStateFromArticle(article({ firstPublishedAt: "2026-10-16T01:00:00Z" }), key);
    const errors = validateEditor(s, { published: true, canSkipTaxLens: true, storedOmissionReason: null });
    expect(errors["save-update-kind"]).toMatch(/수정 종류/);
    expect(errors["save-reason"]).toMatch(/사유/);
  });
});

describe("저장 전 확인 — 칸마다 오류", () => {
  const ok = { published: false, canSkipTaxLens: true, storedOmissionReason: null };

  test("통과하는 상태는 오류 0", () => {
    expect(validateEditor(editorStateFromArticle(article(), key), ok)).toEqual({});
  });

  test("제목 빔·주소 공백·보도기사 취재 방식 빔", () => {
    const s = { ...editorStateFromArticle(article(), key), title: " ", slug: "a b", reportingMethod: "" };
    expect(Object.keys(validateEditor(s, ok)).sort()).toEqual(["meta-reporting-method", "meta-slug", "meta-title"]);
  });

  test("제목 41자·요약 61자는 칸 오류 — API와 같은 문장, 40·60자는 통과 (휴대폰 첫 화면 R1)", () => {
    const base = editorStateFromArticle(article(), key);
    expect(validateEditor({ ...base, title: "가".repeat(40), summary: "나".repeat(60) }, ok)).toEqual({});
    const errors = validateEditor({ ...base, title: "가".repeat(41), summary: "나".repeat(61) }, ok);
    expect(errors["meta-title"]).toBe("제목은 40자 이하여야 합니다 (지금 41자 — 휴대폰 첫 화면 글자 기준 R1)");
    expect(errors["meta-summary"]).toBe("요약은 60자 이하여야 합니다 (지금 61자 — 휴대폰 첫 화면 글자 기준 R1)");
  });

  test("표기는 광고·협찬에만, 광고·협찬은 표기 필수 (ART-10)", () => {
    const labeled = { ...editorStateFromArticle(article(), key), label: "ad" };
    expect(validateEditor(labeled, ok)["meta-label"]).toBeTruthy();
    const sponsored = { ...editorStateFromArticle(article({ contentType: "sponsored", reportingMethod: null }), key), label: "none" };
    expect(validateEditor(sponsored, ok)["meta-label"]).toBeTruthy();
  });

  test("이미지 블록은 media 번호가 있어야 한다", () => {
    const s = editorStateFromArticle(article(), key);
    const blocks = addBlock(s.blocks, "image", key);
    const errors = validateEditor({ ...s, blocks }, ok);
    expect(errors[`block-${blocks.at(-1)!.key}-mediaId`]).toBeTruthy();
  });

  test("생략 사유 — 비면 오류, 편집 책임자가 아닌 사람이 새로 쓰면 오류", () => {
    const s = { ...editorStateFromArticle(article(), key), taxLensMode: "skip" as const, omissionReason: "" };
    expect(validateEditor(s, ok)["taxlens-omission"]).toBeTruthy();
    const byReporter = { ...s, omissionReason: "후속 기사에서 다룬다" };
    expect(validateEditor(byReporter, { ...ok, canSkipTaxLens: false })["taxlens-omission"]).toMatch(/편집 책임자/);
    expect(validateEditor(byReporter, { ...ok, canSkipTaxLens: false, storedOmissionReason: "후속 기사에서 다룬다" })).toEqual({});
  });
});

describe("서버 422 오류 → 칸", () => {
  test("칸 이름·블록 번호를 화면 칸 id로 바꾼다", () => {
    const errors = fieldErrorsFromServer(
      ["title: 비울 수 없습니다", "body.blocks[1].mediaId: media 표의 번호여야 합니다", "body.blocks[2].items[0].question: 글자가 필요합니다", "legalBasisDate: YYYY-MM-DD 날짜여야 합니다", "모르는 칸: x"],
      undefined,
      ["a", "b", "c"],
    );
    expect(errors).toEqual({
      "meta-title": "비울 수 없습니다",
      "block-b-mediaId": "media 표의 번호여야 합니다",
      "block-c-items": "글자가 필요합니다",
      "meta-legal-basis-date": "YYYY-MM-DD 날짜여야 합니다",
      form: "모르는 칸: x",
    });
  });

  test("발행 뒤 수정 실패 항목(art05) → 수정 종류·사유 칸", () => {
    expect(fieldErrorsFromServer(undefined, ["art05.update-kind-required", "art05.reason-required"], [])).toEqual({
      "save-update-kind": "수정 종류를 골라 주세요 (ART-05)",
      "save-reason": "수정 사유를 적어 주세요 (ART-05)",
    });
  });

  test("같은 칸의 오류 여러 개는 이어 붙인다", () => {
    expect(fieldErrorsFromServer(["slug: 공백 안 됨", "slug: 예약된 이름"], undefined, [])["meta-slug"]).toBe("공백 안 됨 · 예약된 이름");
  });
});

describe("정량형 필수 7묶음 (NAV-10) — 편집기 안내", () => {
  const fullDataset = {
    source_url: "https://example.test/data",
    provider: "가온시 세정과",
    collected_at: "2026-10-07T00:00:00+09:00",
    license: "공공누리 제1유형",
    definition: "취득세 징수액",
    period: "1~6월",
    unit: "억 원",
    region_unit: "구",
    denominator: "전년 같은 기간",
    exclusions: "지방교육세",
    transform: "합산",
    repro_file_hash: "sha256:abc",
  };

  test("묶음 id는 발행 판정 규칙(NAV-10 차단 7종)과 같다", () => {
    const s = editorStateFromArticle(article(), key);
    const groupIds = quantitativeGroups(s, []).map((g) => g.id);
    const nav10 = RULES.filter((r) => r.ruleRef === "NAV-10" && r.id !== "nav10.no-causal-claim").map((r) => r.id);
    expect(groupIds).toEqual(nav10);
  });

  test("재현 정보 0건이면 1~3묶음이 비고, 다 채우면 채움", () => {
    const s = editorStateFromArticle(article(), key);
    s.checklists = { ...s.checklists, quantitative: { sourceCrossCheck: "대조함", limitations: "상관관계만", relatedPartyCheck: "확인함" } };
    const empty = quantitativeGroups(s, []);
    expect(empty.filter((g) => !g.filled).map((g) => g.id)).toEqual(["nav10.source-data", "nav10.indicator-definition", "nav10.calculation"]);
    const full = quantitativeGroups(s, [fullDataset]);
    expect(full.every((g) => g.filled)).toBe(true);
  });

  test("분모를 지우면 지표 정의 묶음이 빈다 · 표의 출처를 지우면 그래프·표 표기가 빈다", () => {
    const s = editorStateFromArticle(article(), key);
    s.checklists = { ...s.checklists, quantitative: { sourceCrossCheck: "a", limitations: "b", relatedPartyCheck: "c" } };
    const noDenominator = quantitativeGroups(s, [{ ...fullDataset, denominator: " " }]);
    expect(noDenominator.find((g) => g.id === "nav10.indicator-definition")!.filled).toBe(false);
    const blocks = s.blocks.map((b) => (b.type === "table" ? { ...b, source: "" } : b));
    expect(quantitativeGroups({ ...s, blocks }, [fullDataset]).find((g) => g.id === "nav10.chart-labels")!.filled).toBe(false);
  });
});

describe("정성형 필수 기록 (NAV-11) — 편집기 안내", () => {
  const ev = (id: number, type: string, verified = true) => ({ id, evidence_type: type, verification_status: verified ? "verified" : "pending" });

  test("4칸 + 독립 근거 2건 + 문서 근거 + 인용마다 기록", () => {
    const s = editorStateFromArticle(article({ reportingMethod: "qualitative" }), key);
    s.checklists = { ...s.checklists, qualitative: { interviewQuestions: "질문", fieldRecord: "현장", counterPerspective: "반대", conflictsOfInterest: "없음" } };
    const ok = qualitativeRecords(s, [ev(3, "interview"), ev(5, "document")], [3]);
    expect(ok.every((r) => r.filled)).toBe(true);
    const missing = qualitativeRecords(s, [ev(3, "interview"), ev(5, "document", false)], []);
    expect(missing.filter((r) => !r.filled).map((r) => r.id)).toEqual(["nav11.independent-sources", "nav11.document-evidence", "nav11.quote-record"]);
  });
});

describe("카드뉴스 장 블록 (ART-03)", () => {
  test("장 — 제목·글·대체 텍스트가 저장 모양으로 왕복하고 API 입력 검사를 지난다", () => {
    const stored: StoredBody = { blocks: [{ type: "slide", title: "1. 취득세", text: "60일 안에 신고합니다\n잔금일부터 셉니다", alt: "달력 그림" }], claims: [] };
    const s = editorStateFromArticle(article({ format: "cardnews", body: stored }), key);
    const payload = editorPayload(s, { published: false, version: 3 });
    expect((payload.body as StoredBody).blocks).toEqual(stored.blocks);
    expect(parseArticleInput(payload, "patch").ok).toBe(true);
  });
  test("새 장 블록은 빈 칸 — 저장되고 발행 판정이 막는다", () => {
    const s = editorStateFromArticle(article(), key);
    const blocks = addBlock(s.blocks, "slide", key);
    const payload = editorPayload({ ...s, blocks }, { published: false, version: 3 });
    expect((payload.body as StoredBody).blocks.at(-1)).toEqual({ type: "slide", title: "", text: "", alt: "" });
  });
});

describe("칼럼 연재 (ART-04)", () => {
  const opinion = () => editorStateFromArticle(article({ contentType: "opinion", reportingMethod: null, seriesTitle: "그때와 지금", seriesEpisode: 3 }), key);
  test("칼럼은 연재 이름·회차를 보낸다 — 저장된 값이 편집기에 돌아온다", () => {
    const s = opinion();
    expect([s.seriesTitle, s.seriesEpisodeText]).toEqual(["그때와 지금", "3"]);
    const payload = editorPayload(s, { published: false, version: 3 });
    expect([payload.seriesTitle, payload.seriesEpisode]).toEqual(["그때와 지금", 3]);
    expect(parseArticleInput(payload, "patch").ok).toBe(true);
  });
  test("칼럼이 아니면 연재 칸을 비워 보낸다 (DB 규칙 — 연재는 칼럼만)", () => {
    const s = { ...opinion(), contentType: "explainer" };
    const payload = editorPayload(s, { published: false, version: 3 });
    expect([payload.seriesTitle, payload.seriesEpisode]).toEqual([null, null]);
  });
  test("단독 칼럼 — 둘 다 비면 null, 오류 0", () => {
    const s = { ...opinion(), seriesTitle: " ", seriesEpisodeText: "" };
    expect(editorPayload(s, { published: false, version: 3 }).seriesTitle).toBeNull();
    expect(validateEditor(s, { published: false, canSkipTaxLens: true, storedOmissionReason: null })).toEqual({});
  });
  test.each([
    ["이름만", { seriesEpisodeText: "" }, "meta-series-episode"],
    ["회차만", { seriesTitle: "" }, "meta-series-title"],
    ["회차 0", { seriesEpisodeText: "0" }, "meta-series-episode"],
    ["회차 글자", { seriesEpisodeText: "3회" }, "meta-series-episode"],
  ])("%s → 그 칸 오류", (_n, patch, field) => {
    const errors = validateEditor({ ...opinion(), ...patch }, { published: false, canSkipTaxLens: true, storedOmissionReason: null });
    expect(Object.keys(errors)).toEqual([field]);
  });
  test("서버 422 칸 이름(seriesTitle·seriesEpisode) → 화면 칸", () => {
    expect(fieldErrorsFromServer(["seriesEpisode: 1 이상의 회차 번호여야 합니다"], [], [])).toEqual({ "meta-series-episode": "1 이상의 회차 번호여야 합니다" });
  });
});

describe("형식 콘텐츠 블록 (ART-07 인포그래픽 · ART-08 동영상) — 편집기 ↔ 저장 모양 · 저장 전 확인은 API와 같은 문장", () => {
  const ok = { published: false, canSkipTaxLens: true, storedOmissionReason: null };
  const ID = "dQw4w9WgXcQ";
  const stored: StoredBody = {
    blocks: [
      {
        type: "infographic",
        mediaId: "12",
        alt: "비교 그림",
        caption: "올해와 작년",
        chart: { axis: "구분", unit: "%", source: "세정과" },
        template: "compare",
        data: { kind: "table", columns: ["구분", "올해", "작년"], rows: [["세율", "1%", "2%"]] },
      },
      { type: "infographic", mediaId: "13", alt: "절차 그림", caption: "", chart: null, template: "flow", data: { kind: "list", items: ["계약", "신고"] } },
      { type: "video", embedUrl: `https://www.youtube-nocookie.com/embed/${ID}`, caption: "따라 하기", summary: "신고 순서를 보여 줍니다.", captions: true, thumbnailMediaId: "21", durationSeconds: 95 },
      { type: "video", embedUrl: `https://www.youtube-nocookie.com/embed/${ID}`, caption: "", summary: "", captions: false, thumbnailMediaId: null, durationSeconds: null },
    ],
    claims: [],
  };

  test("저장 모양 → 편집기 → 저장 모양이 같고, 그 본문이 API 입력 검사(저장 규칙 포함)를 지난다", () => {
    const s = editorStateFromArticle(article({ format: "video", reportingMethod: null, contentType: "explainer", body: stored }), key);
    expect(s.blocks.map((b) => [b.template, b.dataKind, b.dataText])).toEqual([
      ["compare", "table", "구분 | 올해 | 작년\n세율 | 1% | 2%"],
      ["flow", "list", "계약\n신고"],
      ["flow", "list", ""],
      ["flow", "list", ""],
    ]);
    const payload = editorPayload(s, { published: false, version: 3 });
    expect((payload.body as StoredBody).blocks).toEqual(stored.blocks);
    const parsed = parseBodyInput(payload.body);
    expect(parsed.ok).toBe(true);
    expect(validateEditor(s, ok)).toEqual({});
  });

  test("인포그래픽 대체 텍스트·같은 내용이 없으면 저장 전에 막는다 — 문장은 저장 API(parseBodyInput)와 같다", () => {
    const s = editorStateFromArticle(article({ body: stored }), key);
    const blocks = s.blocks.map((b, i) => (i === 0 ? { ...b, alt: " ", dataText: "" } : b));
    const errors = validateEditor({ ...s, blocks }, ok);
    const k = blocks[0]!.key;
    const api = parseBodyInput(editorPayload({ ...s, blocks }, { published: false, version: 3 }).body);
    expect(api.ok).toBe(false);
    const apiErrors = api.ok ? [] : api.errors;
    expect(errors[`block-${k}-alt`]).toBe(apiErrors.find((e) => e.startsWith("body.blocks[0].alt: "))!.slice("body.blocks[0].alt: ".length));
    expect(errors[`block-${k}-data`]).toBe(apiErrors.find((e) => e.startsWith("body.blocks[0].data: "))!.slice("body.blocks[0].data: ".length));
    // 서버 422 문장도 같은 칸으로 간다
    expect(Object.keys(fieldErrorsFromServer(apiErrors, [], blocks.map((b) => b.key))).sort()).toEqual([`block-${k}-alt`, `block-${k}-data`].sort());
  });

  test("youtube-nocookie가 아닌 주소·숫자가 아닌 재생 시간은 저장 전에 막는다", () => {
    const s = editorStateFromArticle(article({ body: stored }), key);
    const blocks = s.blocks.map((b, i) => (i === 2 ? { ...b, embedUrl: `https://www.youtube.com/watch?v=${ID}`, durationText: "1분 35초" } : b));
    const errors = validateEditor({ ...s, blocks }, ok);
    const k = blocks[2]!.key;
    expect(errors[`block-${k}-embedUrl`]).toContain("youtube-nocookie");
    expect(errors[`block-${k}-durationSeconds`]).toContain("초 단위");
  });

  test("새 인포그래픽 블록은 절차 흐름 틀(빈 목록) — 그대로 저장하면 막힌다(대체 텍스트·같은 내용 없음)", () => {
    const s = editorStateFromArticle(article(), key);
    const blocks = addBlock(s.blocks, "infographic", key);
    const last = blocks.at(-1)!;
    expect([last.template, last.dataKind, last.dataText]).toEqual(["flow", "list", ""]);
    const errors = validateEditor({ ...s, blocks: blocks.map((b) => (b.key === last.key ? { ...b, mediaId: "12" } : b)) }, ok);
    expect(Object.keys(errors).sort()).toEqual([`block-${last.key}-alt`, `block-${last.key}-data`]);
  });

  test("요약·같은 내용 글자의 '기한'·'가산세'도 '할 일을 함께 썼다' 확인 대상이다 (UX-03 — 발행 판정과 같은 글)", () => {
    const s = editorStateFromArticle(article({ body: stored }), key);
    expect(needsActionCheck({ ...s.blocks[2]!, summary: "신고 기한을 알려 줍니다." })).toBe(true);
    expect(needsActionCheck({ ...s.blocks[1]!, dataText: "가산세 안내" })).toBe(true);
  });
});
