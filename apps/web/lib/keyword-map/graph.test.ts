import { describe, expect, it } from "vitest";
import { buildKeywordMap, keywordHref, nextFocusIndex, parseKeywordState, taxItemKey, toggleTag } from "./graph";

const nodes = [
  { tag_key: "tag_a", label: "시험용 태그 A", n: 5 },
  { tag_key: "tag_b", label: "시험용 태그 B", n: 3 },
  { tag_key: "tag_c", label: "시험용 태그 C", n: 3 },
];
const edges = [
  { tag_a: "tag_a", tag_b: "tag_b", n: 2 },
  { tag_a: "tag_b", tag_b: "tag_c", n: 1 },
  { tag_a: "tag_a", tag_b: "tag_zz", n: 9 },
];

describe("키워드 맵 주소 상태", () => {
  const keys = nodes.map((n) => n.tag_key);
  it("세목은 탭에 있는 값만, 없으면 첫 탭", () => {
    expect(parseKeywordState({ tax: "시험세" }, ["시험세", "다른세"], keys).tax).toBe("시험세");
    expect(parseKeywordState({ tax: "없는세" }, ["시험세", "다른세"], keys).tax).toBe("시험세");
    expect(parseKeywordState({}, [], keys).tax).toBeNull();
  });
  it("태그는 노드에 있는 키만, 중복·형식 밖 값은 버린다", () => {
    const s = parseKeywordState({ tax: "시험세", tag: ["tag_a", "tag_a", "TAG_B", "tag_zz", "tag_c"] }, ["시험세"], keys);
    expect(s.tags).toEqual(["tag_a", "tag_c"]);
  });
  it("쪽 번호는 1~500 정수만", () => {
    expect(parseKeywordState({ page: "3" }, ["x"], keys).page).toBe(3);
    expect(parseKeywordState({ page: "0" }, ["x"], keys).page).toBe(1);
    expect(parseKeywordState({ page: "abc" }, ["x"], keys).page).toBe(1);
  });
  it("주소를 만들고 다시 읽으면 같은 상태", () => {
    const href = keywordHref("시험세", ["tag_a", "tag_b"]);
    const sp = Object.fromEntries([...new URL(href, "http://x").searchParams.keys()].map((k) => [k, new URL(href, "http://x").searchParams.getAll(k)]));
    const s = parseKeywordState(sp, ["시험세"], keys);
    expect(s).toEqual({ tax: "시험세", tags: ["tag_a", "tag_b"], page: 1 });
  });
  it("노드 토글: 더하고, 다시 누르면 빼고, 5개를 넘으면 오래된 것을 뺀다", () => {
    expect(toggleTag(["tag_a"], "tag_b")).toEqual(["tag_a", "tag_b"]);
    expect(toggleTag(["tag_a", "tag_b"], "tag_a")).toEqual(["tag_b"]);
    expect(toggleTag(["a1", "a2", "a3", "a4", "a5"], "a6")).toEqual(["a2", "a3", "a4", "a5", "a6"]);
  });
});

describe("키워드 맵 그림과 표", () => {
  const d = buildKeywordMap("시험세", nodes, edges, ["tag_a"]);
  it("원 수 = 노드 표 행 수, 선 수 = 연결선 표 행 수 (노드에 없는 끝점의 선은 둘 다 빠진다)", () => {
    expect(d.circles).toHaveLength(3);
    expect(d.nodeRows).toHaveLength(3);
    expect(d.lines).toHaveLength(2);
    expect(d.edgeRows).toHaveLength(2);
  });
  it("표의 건수·태그가 원과 같고 건수 많은 순, 같으면 키 순", () => {
    expect(d.nodeRows.map((r) => [r.tag_key, r.n])).toEqual([["tag_a", 5], ["tag_b", 3], ["tag_c", 3]]);
    expect(d.circles.map((c) => c.n)).toEqual(d.nodeRows.map((r) => r.n));
  });
  it("고른 노드는 selected이고 링크는 토글 결과 주소", () => {
    expect(d.circles[0]!.selected).toBe(true);
    expect(d.circles[0]!.href).toBe("/cases/keywords?tax=%EC%8B%9C%ED%97%98%EC%84%B8");
    expect(d.circles[1]!.href).toContain("tag=tag_a&tag=tag_b");
  });
  it("건수가 클수록 원이 크다", () => {
    expect(d.circles[0]!.r).toBeGreaterThan(d.circles[1]!.r);
  });
  it("노드가 없으면 빈 그림", () => {
    const e = buildKeywordMap(null, [], [], []);
    expect(e.circles).toHaveLength(0);
    expect(e.lines).toHaveLength(0);
  });
});

describe("키보드 이동과 측정 키", () => {
  it("방향키는 돌아 이어지고 Home·End는 양 끝, 다른 키는 null", () => {
    expect(nextFocusIndex(2, "ArrowRight", 3)).toBe(0);
    expect(nextFocusIndex(0, "ArrowLeft", 3)).toBe(2);
    expect(nextFocusIndex(1, "Home", 3)).toBe(0);
    expect(nextFocusIndex(1, "End", 3)).toBe(2);
    expect(nextFocusIndex(1, "a", 3)).toBeNull();
    expect(nextFocusIndex(0, "ArrowRight", 0)).toBeNull();
  });
  it("세목 이름은 영문 키로 바뀌고 모르면 other", () => {
    expect(taxItemKey("취득세")).toBe("acquisition");
    expect(taxItemKey("처음 보는 세")).toBe("other");
    expect(taxItemKey(null)).toBe("other");
  });
});
