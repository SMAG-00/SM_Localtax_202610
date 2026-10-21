// 허브 "이 분야의 지방세 포인트" 입력 검사 (CORE-02 · W3 9단계 — 설계 2.3 '3줄 이하 (4줄 저장 거부) · 기준일 필수'). 문구는 '시험용' 가짜 글자다.
import { describe, expect, it } from "vitest";
import {
  HUB_POINT_HREF,
  isIsoDate,
  lineCountError,
  parseHubPointDraft,
  pointState,
  readStoredPoints,
  splitPointLines,
  splitPointLinks,
  withDraft,
  withReview,
  withoutSection,
  type StoredHubPoints,
} from "./hub-point-rules";

const OPTS = { forbiddenPhrases: ["무조건 감면"] };
const good = (over: Record<string, unknown> = {}) => ({
  section: "realestate",
  lines: ["시험용 포인트 첫째 줄", "시험용 포인트 둘째 줄", "시험용 포인트 셋째 줄"],
  baseDate: "2026-10-01",
  links: [{ label: "시험용 지방세 해설", href: "/tax" }],
  ...over,
});
const fields = (r: ReturnType<typeof parseHubPointDraft>) => (r.ok ? [] : r.errors.map((e) => e.split(":")[0]));

describe("줄 수 — 3줄 저장, 4줄 거부 (4번째 줄 거부 문장은 화면·서버 같다)", () => {
  it("1줄·3줄은 저장된다", () => {
    expect(parseHubPointDraft(good({ lines: ["시험용 한 줄"] }), OPTS).ok).toBe(true);
    const r = parseHubPointDraft(good(), OPTS);
    expect(r.ok && r.value.lines).toEqual(["시험용 포인트 첫째 줄", "시험용 포인트 둘째 줄", "시험용 포인트 셋째 줄"]);
  });
  it("4줄은 lines 칸 오류 하나 — '4번째 줄은 저장하지 않습니다'", () => {
    const r = parseHubPointDraft(good({ lines: ["시험용 1", "시험용 2", "시험용 3", "시험용 4"] }), OPTS);
    expect(r.ok).toBe(false);
    expect(fields(r)).toEqual(["lines"]);
    expect(r.ok ? "" : r.errors[0]).toMatch(/4번째 줄은 저장하지 않습니다/);
    expect(lineCountError(["a", "b", "c", "d"])).toMatch(/^lines: .*4번째 줄/);
    expect(lineCountError(["a", "b", "c"])).toBeNull();
    expect(lineCountError([])).toMatch(/1줄 이상/);
  });
  it("편집 칸 글(줄바꿈)도 같은 규칙 — 빈 줄은 세지 않는다", () => {
    expect(splitPointLines("  시험용 1 \n\n시험용 2\r\n   \n시험용 3\n")).toEqual(["시험용 1", "시험용 2", "시험용 3"]);
    expect(parseHubPointDraft(good({ lines: "시험용 1\n\n시험용 2\n시험용 3" }), OPTS).ok).toBe(true);
    expect(fields(parseHubPointDraft(good({ lines: "시험용 1\n시험용 2\n시험용 3\n시험용 4" }), OPTS))).toEqual(["lines"]);
  });
  it("목록 안의 빈 줄·61자·경력 연수 표기·세액 표현·금지 표현은 그 줄 칸 오류", () => {
    expect(fields(parseHubPointDraft(good({ lines: ["시험용", " "] }), OPTS))).toEqual(["lines[1]"]);
    expect(fields(parseHubPointDraft(good({ lines: ["가".repeat(61)] }), OPTS))).toEqual(["lines[0]"]);
    expect(parseHubPointDraft(good({ lines: ["가".repeat(60)] }), OPTS).ok).toBe(true);
    expect(fields(parseHubPointDraft(good({ lines: ["시험용", "시험용 50년 노하우"] }), OPTS))).toEqual(["lines[1]"]);
    expect(fields(parseHubPointDraft(good({ lines: ["시험용 300만 원 예시"] }), OPTS))).toEqual(["lines[0]"]);
    expect(fields(parseHubPointDraft(good({ lines: ["시험용", "시험용", "무조건 감면입니다"] }), OPTS))).toEqual(["lines[2]"]);
  });
});

describe("기준일·링크·분야", () => {
  it("기준일 필수 — 실제 날짜만", () => {
    expect(fields(parseHubPointDraft(good({ baseDate: undefined }), OPTS))).toEqual(["baseDate"]);
    expect(fields(parseHubPointDraft(good({ baseDate: "2026-02-30" }), OPTS))).toEqual(["baseDate"]);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026.10.01")).toBe(false);
  });
  it("링크 1~3개, 사이트 안 지방세 해설 주소만 (DB 트리거와 같은 식)", () => {
    expect(fields(parseHubPointDraft(good({ links: [] }), OPTS))).toEqual(["links"]);
    const four = Array.from({ length: 4 }, (_, i) => ({ label: `시험용 ${i}`, href: "/tax" }));
    expect(fields(parseHubPointDraft(good({ links: four }), OPTS))).toEqual(["links"]);
    expect(fields(parseHubPointDraft(good({ links: [{ label: "", href: "/tax" }] }), OPTS))).toEqual(["links[0].label"]);
    for (const href of ["https://example.test/tax", "/tax?x=1", "/tax#a", "/news/", "//evil.test", "/calc", "/realestate"]) {
      expect(HUB_POINT_HREF.test(href), href).toBe(false);
      expect(fields(parseHubPointDraft(good({ links: [{ label: "시험용", href }] }), OPTS))).toEqual(["links[0].href"]);
    }
    for (const href of ["/tax", "/tax/amendments", "/tax/interpretations", "/news/e2e-test-slug"]) expect(HUB_POINT_HREF.test(href), href).toBe(true);
    expect(splitPointLinks("시험용 해설 | /tax/amendments\n\n/tax")).toEqual([
      { label: "시험용 해설", href: "/tax/amendments" },
      { label: "", href: "/tax" },
    ]);
  });
  it("분야는 부동산·개발금융·지자체뉴스만 — 지방세 허브는 거부", () => {
    expect(fields(parseHubPointDraft(good({ section: "tax" }), OPTS))).toEqual(["section"]);
    for (const section of ["realestate", "finance", "local"]) expect(parseHubPointDraft(good({ section }), OPTS).ok).toBe(true);
  });
});

describe("저장 모양 — 초안을 고치면 서명이 지워지고, 서명은 저장된 초안에만", () => {
  const draft = (lines = ["시험용 줄"]) => {
    const r = parseHubPointDraft(good({ lines }), OPTS);
    if (!r.ok) throw new Error(r.errors.join());
    return r.value;
  };
  const T1 = "2026-10-21T01:00:00.000Z";
  const T2 = "2026-10-21T02:00:00.000Z";

  it("초안 → 서명 → 같은 내용 다시 저장은 서명 유지 → 내용을 바꾸면 서명 0", () => {
    let v: StoredHubPoints = withDraft({}, draft(), "user:editor", T1);
    expect(pointState(v.realestate)).toBe("draft");
    expect(v.realestate).toMatchObject({ drafted_by: "user:editor", drafted_at: T1, reviewed_by: null, reviewed_at: null, base_date: "2026-10-01" });
    const signed = withReview(v, "realestate", "user:reviewer", T2);
    expect(signed.ok).toBe(true);
    v = signed.ok ? signed.value : v;
    expect(pointState(v.realestate)).toBe("reviewed");
    expect(withDraft(v, draft(), "user:editor2", T2)).toBe(v);
    const changed = withDraft(v, draft(["시험용 바뀐 줄"]), "user:editor2", T2);
    expect(changed.realestate).toMatchObject({ lines: ["시험용 바뀐 줄"], drafted_by: "user:editor2", reviewed_by: null, reviewed_at: null });
  });
  it("초안 없는 분야의 서명은 거부, 이미 서명된 분야는 그대로", () => {
    expect(withReview({}, "finance", "user:reviewer", T1)).toEqual({ ok: false, errors: [expect.stringMatching(/^section: 저장된 초안이 없습니다/)] });
    const v = withDraft({}, draft(), "user:editor", T1);
    const once = withReview(v, "realestate", "user:r1", T1);
    const twice = once.ok ? withReview(once.value, "realestate", "user:r2", T2) : once;
    expect(twice.ok && twice.value.realestate?.reviewed_by).toBe("user:r1");
  });
  it("분야 지우기·모양이 틀린 저장 값은 건너뛴다", () => {
    const v = withDraft({}, draft(), "user:editor", T1);
    expect(withoutSection(v, "realestate")).toEqual({});
    expect(readStoredPoints({ realestate: { lines: "x" }, tax: {}, local: v.realestate })).toEqual({ local: v.realestate });
    expect(readStoredPoints(null)).toEqual({});
  });
});
