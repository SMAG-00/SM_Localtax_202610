import { describe, expect, it } from "vitest";
import { passesSimilarity, parseSimilarityMin, reasonFor, sortItems, filterByKind, countByKind, isLocked, type PanelItemV2 } from "./panel-v2";
import { buildTimeline, isIsoDate, timelineKindOfDoc, type TimelineItem } from "./timeline";
import { closePanel, keyAction, layoutFor, openPanel, parsePanels, parseSpec, parseWidths, resizeWidths, visibleIndexes, buildSplitHref, parseActive } from "./split";
import { isStdRef, publicMappings, type AccountMappingRow } from "./accounts";

const item = (o: Partial<PanelItemV2>): PanelItemV2 => ({ linkId: 1, kind: "case", origin: "editor", relation: "cites", title: "시험용", reason: "시험용 이유", href: "/x", decidedOn: null, similarity: null, locked: false, splitSpec: null, ...o });

describe("패널 v2", () => {
  it("저장된 이유가 없거나 공백이면 관계 값에서 만든 이유가 나오고 비지 않는다", () => {
    expect(reasonFor(null, { kind: "case", relation: "cites" })).toBe("이 조문을 인용한 판례");
    expect(reasonFor("   ", { kind: "node", relation: "explains" })).toBe("이 조문을 설명한 지식창고 항목");
    expect(reasonFor(" 같은 쟁점 태그 ", { kind: "case", relation: "cites" })).toBe("같은 쟁점 태그");
    expect(Array.from(reasonFor("가".repeat(130), { kind: "case", relation: "cites" }))).toHaveLength(120);
  });
  it("유사도 기준은 숫자일 때만 켜지고 경계값(min)은 통과, min 바로 아래는 탈락", () => {
    expect(parseSimilarityMin({})).toBeNull();
    expect(parseSimilarityMin({ min: "0.8" })).toBeNull();
    expect(parseSimilarityMin({ min: 1.1 })).toBeNull();
    expect(parseSimilarityMin({ min: 0.8 })).toBe(0.8);
    const s = (similarity: number) => item({ origin: "similarity", similarity });
    expect(passesSimilarity(s(0.8), 0.8)).toBe(true);
    expect(passesSimilarity(s(0.7999), 0.8)).toBe(false);
    expect(passesSimilarity(s(1), null)).toBe(false);
    expect(passesSimilarity(item({ origin: "auto" }), null)).toBe(true);
  });
  it("잠금은 프리미엄이고 권한이 없을 때만", () => {
    expect(isLocked("premium", false)).toBe(true);
    expect(isLocked("premium", true)).toBe(false);
    expect(isLocked("public", false)).toBe(false);
    expect(isLocked(null, false)).toBe(false);
  });
  it("최신순은 결정일 내림차순(없으면 뒤), 관련도순은 편집자>자동>유사도(점수 높은 순)", () => {
    const a = item({ linkId: 1, decidedOn: "2024-01-01", origin: "auto" });
    const b = item({ linkId: 2, decidedOn: "2025-01-01", origin: "similarity", similarity: 0.9 });
    const c = item({ linkId: 3, decidedOn: null, origin: "editor" });
    const d = item({ linkId: 4, decidedOn: "2023-01-01", origin: "similarity", similarity: 0.95 });
    expect(sortItems([a, b, c, d], "latest").map((x) => x.linkId)).toEqual([2, 1, 4, 3]);
    expect(sortItems([a, b, c, d], "relevance").map((x) => x.linkId)).toEqual([3, 1, 4, 2]);
  });
  it("유형 필터와 개수", () => {
    const xs = [item({ linkId: 1, kind: "case" }), item({ linkId: 2, kind: "node" }), item({ linkId: 3, kind: "node" })];
    expect(filterByKind(xs, "node").map((x) => x.linkId)).toEqual([2, 3]);
    expect(filterByKind(xs, "all")).toHaveLength(3);
    expect(countByKind(xs)).toMatchObject({ all: 3, case: 1, node: 2, article: 0 });
  });
});

const t = (o: Partial<TimelineItem>): TimelineItem => ({ key: "k", kind: "law", date: "2024-01-01", title: "시험용", origin: "tag", conclusion: null, href: "/x", splitSpec: "case:1", numericId: 1, ...o });

describe("타임라인", () => {
  it("날짜 오름차순, 같은 날은 법령 → 해석 → 심판 → 판례", () => {
    const out = buildTimeline([
      t({ key: "a", kind: "case", date: "2024-05-01" }),
      t({ key: "b", kind: "tribunal", date: "2024-05-01" }),
      t({ key: "c", kind: "law", date: "2024-05-01" }),
      t({ key: "d", kind: "interpretation", date: "2024-05-01" }),
      t({ key: "e", kind: "case", date: "2023-12-31" }),
    ]);
    expect(out.map((x) => x.key)).toEqual(["e", "c", "d", "b", "a"]);
  });
  it("잘못된 날짜(없음·형식·없는 달력 날짜)와 중복 키는 넣지 않는다", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2023-02-29")).toBe(false);
    expect(isIsoDate("2024-2-1")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
    const out = buildTimeline([t({ key: "a", date: "2024-13-01" }), t({ key: "b", date: "" }), t({ key: "c" }), t({ key: "c", date: "2020-01-01" })]);
    expect(out.map((x) => x.key)).toEqual(["c"]);
    expect(out[0].date).toBe("2024-01-01");
  });
  it("개정판 경계: 하루 차이도 순서를 지키고 같은 날 같은 종류는 번호 순", () => {
    const out = buildTimeline([t({ key: "n2", date: "2024-03-02", numericId: 2 }), t({ key: "n1", date: "2024-03-01", numericId: 9 }), t({ key: "n3", date: "2024-03-02", numericId: 1 })]);
    expect(out.map((x) => x.key)).toEqual(["n1", "n3", "n2"]);
  });
  it("문서 종류를 타임라인 종류로", () => {
    expect(timelineKindOfDoc("ruling")).toBe("interpretation");
    expect(timelineKindOfDoc("circular")).toBe("interpretation");
    expect(timelineKindOfDoc("tribunal")).toBe("tribunal");
    expect(timelineKindOfDoc("case")).toBe("case");
    expect(timelineKindOfDoc("x")).toBeNull();
  });
});

describe("분할 화면", () => {
  it("레이아웃 경계 1023/1024/1279/1280", () => {
    expect(layoutFor(1023)).toBe("tabs");
    expect(layoutFor(1024)).toBe("two");
    expect(layoutFor(1279)).toBe("two");
    expect(layoutFor(1280)).toBe("three");
  });
  it("주소 파서는 목록 검사를 통과한 조각만 받고 3개까지", () => {
    expect(parsePanels("law:1:11,case:55,node:9,note:2")).toEqual([{ kind: "law", id: 1, article: "11" }, { kind: "case", id: 55 }, { kind: "node", id: 9 }]);
    expect(parsePanels("law:1,case:0,bad:1,case:5x,law:2:11-2")).toEqual([{ kind: "law", id: 2, article: "11-2" }]);
    expect(parsePanels(null)).toEqual([]);
    expect(parseSpec("law:1:<script>")).toBeNull();
  });
  it("주소 구성은 새로고침 후 같은 구성으로 복원된다", () => {
    const panels = parsePanels("law:1:11,case:55");
    const href = buildSplitHref(panels, 1, [60, 40]);
    expect(href).toBe("/workspace/split?p=law:1:11,case:55&a=1&w=60-40");
    const q = new URL(href, "http://x").searchParams;
    expect(parsePanels(q.get("p"))).toEqual(panels);
    expect(parseActive(q.get("a"), 2)).toBe(1);
    expect(parseWidths(q.get("w"), 2)).toEqual([60, 40]);
  });
  it("너비 값이 틀리면 균등, 20% 미만도 균등", () => {
    expect(parseWidths("10-90", 2)).toEqual([50, 50]);
    expect(parseWidths("40-30-30", 2)).toEqual([50, 50]);
    expect(parseWidths(null, 3)).toEqual([33, 33, 34]);
  });
  it("너비 조절은 20% 아래로 내려가지 않는다", () => {
    expect(resizeWidths([25, 75], 0, -5)).toEqual([20, 80]);
    expect(resizeWidths([20, 80], 0, -5)).toEqual([20, 80]);
    expect(resizeWidths([50, 50], 1, 5)).toEqual([45, 55]);
  });
  it("열기·닫기: 중복은 이동, 가득 차면 마지막 교체", () => {
    const base = parsePanels("case:1,case:2,case:3");
    expect(openPanel(base, { kind: "case", id: 2 })).toEqual({ panels: base, active: 1 });
    const r = openPanel(base, { kind: "node", id: 9 });
    expect(r.panels.map((p) => p.id)).toEqual([1, 2, 9]);
    expect(r.active).toBe(2);
    expect(closePanel(base, 0).map((p) => p.id)).toEqual([2, 3]);
  });
  it("보이는 패널 창은 활성 패널을 포함한다", () => {
    expect(visibleIndexes("three", 3, 2)).toEqual([0, 1, 2]);
    expect(visibleIndexes("two", 3, 0)).toEqual([0, 1]);
    expect(visibleIndexes("two", 3, 2)).toEqual([1, 2]);
    expect(visibleIndexes("tabs", 3, 1)).toEqual([1]);
    expect(visibleIndexes("two", 1, 0)).toEqual([0]);
  });
  it("키보드 동작", () => {
    expect(keyAction({ key: "ArrowRight", altKey: true, shiftKey: false })).toEqual({ type: "focus", delta: 1 });
    expect(keyAction({ key: "ArrowLeft", altKey: true, shiftKey: true })).toEqual({ type: "resize", delta: -5 });
    expect(keyAction({ key: "w", altKey: true, shiftKey: false })).toEqual({ type: "close" });
    expect(keyAction({ key: "ArrowRight", altKey: false, shiftKey: false })).toBeNull();
    expect(keyAction({ key: "ArrowRight", altKey: true, shiftKey: false, ctrlKey: true })).toBeNull();
  });
});

const row = (o: Partial<AccountMappingRow>): AccountMappingRow => ({ id: 1, account_code: "land_test", account_name: "시험용", target_type: "law_provision", target_id: 1, target_article_no: 1, target_branch_no: 0, relation: "related", std_ref: null, version: 1, signed_at: null, ...o });

describe("계정과목 연결", () => {
  it("서명 없는 행은 공개 0, 서명된 가장 높은 버전만 보인다", () => {
    expect(publicMappings([row({})])).toEqual([]);
    const out = publicMappings([row({ id: 1, version: 1, signed_at: "2026-01-01" }), row({ id: 2, version: 2, signed_at: "2026-02-01" }), row({ id: 3, version: 3 })]);
    expect(out.map((r) => r.id)).toEqual([2]);
  });
  it("std_ref는 기준 이름+조항 번호 길이만, 문장은 거부", () => {
    expect(isStdRef("시험기준 제1호 문단 3")).toBe(true);
    expect(isStdRef("")).toBe(false);
    expect(isStdRef("가".repeat(81))).toBe(false);
    expect(isStdRef("가".repeat(80))).toBe(true);
    expect(isStdRef("첫 문장입니다. 둘째 문장입니다")).toBe(false);
  });
});
