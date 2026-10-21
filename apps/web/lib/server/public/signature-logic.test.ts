// 시그니처 연재 틀 공개 규칙 (W3 8단계 — BR-01·04): 근거 링크 없는 연수 표기 0 · 회차 글은 틀의 제목·회차 · 홈 영역은 회차 0이면 없음 · 「그때와 지금」은 출처·기준연도 둘 다
import { describe, expect, test } from "vitest";
import { homeSections, type HomeInput } from "./home-logic";
import { applySignature, evidenceAnchor, framesFrom, homeColumnItems, thenNowViews, type SeriesRow } from "./signature-logic";
import { listItem } from "./test-items";

const row = (over: Partial<SeriesRow> = {}): SeriesRow => ({
  series_key: "signature",
  ord: 1,
  title: "시그니처 칼럼",
  claim_shown: false,
  basis_person_slug: null,
  basis_evidence_id: null,
  cadence: null,
  episodes: 0,
  ...over,
});

describe("연재 틀 — 공개 뷰 줄 → 화면 틀", () => {
  test("연수 표기 없는 제목은 근거 링크 없이 그대로, 연재 순서(ord)대로", () => {
    const frames = framesFrom([row({ series_key: "then_now", ord: 2, title: "그때와 지금", episodes: 3 }), row({ episodes: 1 })]);
    expect([...frames.keys()]).toEqual(["signature", "then_now"]);
    expect(frames.get("signature")).toEqual({ key: "signature", title: "시그니처 칼럼", basisHref: null, cadence: null, episodes: 1 });
    expect(frames.get("then_now")?.episodes).toBe(3);
  });
  test("연수 표기('50년')가 든 제목 — 근거(인물 slug·증빙 번호)가 있으면 근거 링크와 함께", () => {
    const frames = framesFrom([row({ title: "시험용 지방세 50년", claim_shown: true, basis_person_slug: "kim-test", basis_evidence_id: 42 })]);
    expect(frames.get("signature")?.basisHref).toBe(`/people/kim-test#${evidenceAnchor(42)}`);
    expect(evidenceAnchor(42)).toBe("evidence-42");
  });
  test("연수 표기가 들었는데 근거가 하나라도 없으면 틀째 뺀다 — 링크 없는 '50년' 0", () => {
    for (const over of [
      { claim_shown: false, basis_person_slug: "kim-test", basis_evidence_id: 42 },
      { claim_shown: true, basis_person_slug: null, basis_evidence_id: 42 },
      { claim_shown: true, basis_person_slug: "kim-test", basis_evidence_id: null },
      { claim_shown: true, basis_person_slug: "kim-test", basis_evidence_id: "x1" },
    ]) {
      expect(framesFrom([row({ title: "시험용 지방세 오십 년", ...over })]).size).toBe(0);
    }
  });
  test("제목이 비었거나(null — 뷰가 막음) 모르는 연재 키는 뺀다", () => {
    expect(framesFrom([row({ title: null }), row({ title: "  " }), row({ series_key: "kim" })]).size).toBe(0);
  });
  test("발행 주기 — 빈 글자는 null", () => {
    expect(framesFrom([row({ cadence: "  " })]).get("signature")?.cadence).toBeNull();
    expect(framesFrom([row({ cadence: "시험용 주기" })]).get("signature")?.cadence).toBe("시험용 주기");
  });
});

describe("목록 카드에 틀 입히기", () => {
  const frames = framesFrom([row({ title: "시험용 지방세 50년", claim_shown: true, basis_person_slug: "kim-test", basis_evidence_id: 7, episodes: 2 })]);
  test("회차 글 = 틀 제목·회차·근거 링크, 회차 아닌 칼럼은 그대로", () => {
    const ep = listItem({ id: 1, contentType: "opinion", seriesTitle: null, seriesEpisode: null });
    const other = listItem({ id: 2, contentType: "opinion", seriesTitle: "다른 연재", seriesEpisode: 4 });
    const out = applySignature([ep, other], new Map([[1, { seriesKey: "signature", episode: 2 }]]), frames);
    expect(out[0]).toMatchObject({ id: 1, seriesTitle: "시험용 지방세 50년", seriesEpisode: 2, seriesBasisHref: "/people/kim-test#evidence-7" });
    expect(out[1]).toEqual(other);
  });
  test("틀이 없으면(기능 키 꺼짐·제목 막힘) 연재 줄 없이 칼럼으로만", () => {
    const ep = listItem({ id: 3, contentType: "opinion" });
    const out = applySignature([ep], new Map([[3, { seriesKey: "then_now", episode: 1 }]]), frames);
    expect(out[0]).toMatchObject({ seriesTitle: null, seriesEpisode: null, seriesBasisHref: null });
  });
});

describe("홈 김의효 칼럼 영역", () => {
  const frames = framesFrom([row({ episodes: 2 }), row({ series_key: "then_now", ord: 2, title: "그때와 지금", episodes: 0 })]);
  const a1 = listItem({ id: 11, contentType: "opinion" });
  const a2 = listItem({ id: 12, contentType: "opinion" });
  test("연재마다 가장 큰 회차 1편 — 회차 0인 연재는 빠진다", () => {
    const items = homeColumnItems(frames, [{ seriesKey: "signature", episode: 1, article: a1 }, { seriesKey: "signature", episode: 2, article: a2 }], () => true);
    expect(items.map((i) => [i.seriesKey, i.episode, i.article.id])).toEqual([["signature", 2, 12]]);
    expect(items[0]?.article.seriesTitle).toBe("시그니처 칼럼");
  });
  test("필자 동의서에 home이 없는 회차는 건너뛰고 다음 회차", () => {
    const items = homeColumnItems(frames, [{ seriesKey: "signature", episode: 1, article: a1 }, { seriesKey: "signature", episode: 2, article: a2 }], (a) => a.id !== 12);
    expect(items.map((i) => i.article.id)).toEqual([11]);
  });
  test("공개 회차가 0이면 빈 목록 → 홈 섹션째 없음(빈 카드 0)", () => {
    const none = homeColumnItems(frames, [], () => true);
    expect(none).toEqual([]);
    const empty: HomeInput = { coreMessage: null, searchEnabled: false, searchChips: [], latestReports: [], weeklyHot: null, trackers: { items: [], source: "none" }, stories: [], column: { key: "column", items: none }, product: null, experts: null };
    expect(homeSections(empty).some((s) => s.key === "column")).toBe(false);
    expect(homeSections({ ...empty, column: null }).some((s) => s.key === "column")).toBe(false);
  });
  test("공개 기사로 읽지 못한(비공개·삭제) 회차는 빠진다", () => {
    expect(homeColumnItems(frames, [{ seriesKey: "signature", episode: 2, article: undefined }], () => true)).toEqual([]);
  });
});

describe("「그때와 지금」 비교 항목", () => {
  const base = { label: null, then_text: "시험용 과거", now_text: "시험용 현재", source_url: null };
  test("출처·기준연도가 둘 다 있는 줄만, 자리 순서", () => {
    const out = thenNowViews([
      { ...base, position: 2, source: "시험용 출처 2", base_year: 2001 },
      { ...base, position: 1, source: "시험용 출처 1", base_year: 1995 },
      { ...base, position: 3, source: "  ", base_year: 1990 },
      { ...base, position: 4, source: "시험용 출처 4", base_year: null },
    ]);
    expect(out.map((v) => [v.position, v.source, v.baseYear])).toEqual([
      [1, "시험용 출처 1", 1995],
      [2, "시험용 출처 2", 2001],
    ]);
  });
  test("출처 주소는 http(s)만 링크", () => {
    expect(thenNowViews([{ ...base, position: 1, source: "s", base_year: 2000, source_url: "javascript:x" }])[0]?.sourceUrl).toBeNull();
    expect(thenNowViews([{ ...base, position: 1, source: "s", base_year: 2000, source_url: "https://example.test" }])[0]?.sourceUrl).toBe("https://example.test");
  });
});
