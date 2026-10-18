// search_submitted 한 번만 (W2-c 2.2 · docs/dev/W2-d_설계.md 8장) — 같은 검색(검색어·거르개)에서 탭·쪽만 바꾸면 새 검색이 아니다.
// 열쇠는 브라우저 안에서만 쓴다(이벤트에 넣지 않는다 — 이벤트 속성은 길이·수·참거짓뿐)
import { describe, expect, test } from "vitest";
import { createSearchMeasure, searchMeasureKey } from "./search-measure";

describe("검색 한 번의 열쇠", () => {
  test("탭·쪽은 빼고 칸 차례와 상관없다", () => {
    expect(searchMeasureKey("?q=%EC%B7%A8%EB%93%9D%EC%84%B8&tab=article&page=2")).toBe(searchMeasureKey("?q=%EC%B7%A8%EB%93%9D%EC%84%B8"));
    expect(searchMeasureKey("?section=tax&q=a")).toBe(searchMeasureKey("?q=a&section=tax"));
    expect(searchMeasureKey("?q=a&section=tax")).not.toBe(searchMeasureKey("?q=a"));
    expect(searchMeasureKey("?q=a")).not.toBe(searchMeasureKey("?q=b"));
  });

  test("빈 거르개 칸(폼이 보낸 section=)은 없는 것과 같다", () => {
    expect(searchMeasureKey("?q=a&section=&type=&region=&from=&to=")).toBe(searchMeasureKey("?q=a"));
  });
});

describe("보낼지 판단", () => {
  test("처음 1번 — 같은 검색에서 탭·쪽을 바꾸면 0번, 검색어나 거르개가 바뀌면 다시 1번", () => {
    const m = createSearchMeasure();
    expect(m.shouldSend("?q=a")).toBe(true);
    expect(m.shouldSend("?q=a")).toBe(false); // 개발 모드 효과 두 번
    expect(m.shouldSend("?q=a&tab=article")).toBe(false);
    expect(m.shouldSend("?q=a&tab=article&page=2")).toBe(false);
    expect(m.shouldSend("?q=a&type=reported_news")).toBe(true);
    expect(m.shouldSend("?q=b")).toBe(true);
    expect(m.shouldSend("?q=a")).toBe(true); // 다른 검색 뒤 돌아온 것은 새 검색
  });
});
