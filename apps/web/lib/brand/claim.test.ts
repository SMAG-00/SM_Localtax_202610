// 경력 연수 표기('50년') 검사와 시그니처 연재 입력 검사 (W3 8단계 — 설계 2.6 표를 읽는다. DB 시험 w3-signature가 같은 표로 brand_claim_token을 본다)
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  SERIES_KEYS,
  THEN_NOW_MAX_ITEMS,
  episodeTextErrors,
  freeSeriesTitleErrors,
  hasClaimToken,
  parseEpisodeAssign,
  parseThenNowItems,
  seriesTitleErrors,
  textsOf,
} from "./claim";

const DESIGN = fs.readFileSync(path.resolve(__dirname, "../../../../docs/dev/W3_설계.md"), "utf8");

/** 설계 표 한 줄의 백틱 값들 */
function row(marker: string): string[] {
  const line = DESIGN.split("\n").find((l) => l.startsWith(`| ${marker} `));
  if (!line) throw new Error(`설계 문서에 '${marker}' 줄이 없다`);
  return [...line.split("|")[2]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
}

describe("설계 2.6 표 — 막는 표기는 모두 걸리고, 막지 않는 표기는 하나도 안 걸린다", () => {
  const blocked = row("막는 표기");
  const allowed = row("막지 않는 표기");
  test("표가 비어 있지 않다 (숫자·띄어쓰기·한글 수사·영어·로마자·주소 변형이 다 있다)", () => {
    expect(blocked.length).toBeGreaterThanOrEqual(20);
    expect(blocked).toEqual(expect.arrayContaining(["50년", "50 년", "５０년", "오십 년", "반세기", "50 years", "50nyeon"]));
    expect(allowed).toEqual(expect.arrayContaining(["1950년", "50년대", "150년"]));
  });
  test.each(row("막는 표기"))("막는다: %s", (text) => {
    expect(hasClaimToken(text)).toBe(true);
    expect(hasClaimToken(`시험용 지방세 ${text} 칼럼`)).toBe(true);
  });
  test.each(row("막지 않는 표기"))("막지 않는다: %s", (text) => {
    expect(hasClaimToken(text)).toBe(false);
    expect(hasClaimToken(`시험용 지방세 ${text} 기준`)).toBe(false);
  });
});

describe("숨은 변형", () => {
  test("보이지 않는 글자를 끼워 넣어도 막는다 (폭 없는 공백·소프트 하이픈·BOM)", () => {
    expect(hasClaimToken("5​0년")).toBe(true);
    expect(hasClaimToken("50­년")).toBe(true);
    expect(hasClaimToken("오﻿십 년")).toBe(true);
  });
  test("줄바꿈·탭·여러 칸 공백도 구분 글자", () => {
    expect(hasClaimToken("50\n년")).toBe(true);
    expect(hasClaimToken("50\t 년")).toBe(true);
    expect(hasClaimToken("50 _ 년")).toBe(true);
  });
  test("자모가 나뉜 '년'(NFD)도 합쳐서 본다", () => {
    expect(hasClaimToken("50년".normalize("NFD"))).toBe(true);
  });
  test("글자가 아니거나 빈 값은 false", () => {
    expect(hasClaimToken(null)).toBe(false);
    expect(hasClaimToken(50)).toBe(false);
    expect(hasClaimToken("")).toBe(false);
  });
  test("깨진 퍼센트 인코딩은 그대로 본다 (오류 없이)", () => {
    expect(hasClaimToken("%E0%A4%A-50년")).toBe(true);
    expect(hasClaimToken("%E0%A4%A")).toBe(false);
  });
});

describe("시그니처 회차의 글 — 승인과 상관없이 연수 표기 0", () => {
  test("제목·요약·주소·본문 칸마다 오류 한 줄", () => {
    const errors = episodeTextErrors({
      title: "시험용 오십 년 칼럼",
      summary: "시험용 50 년 요약",
      slug: "signature-50nyeon",
      body: { blocks: [{ type: "paragraph", text: "시험용 본문" }, { type: "faq", items: [{ q: "질문", a: "반세기 동안" }] }], claims: [] },
    });
    expect(errors.map((e) => e.split(":")[0])).toEqual(["title", "summary", "slug", "body"]);
  });
  test("연수 표기가 없으면 오류 0 — 연도(1975년)·연대(50년대)는 쓸 수 있다", () => {
    expect(episodeTextErrors({ title: "시험용 1975년과 지금", summary: "50년대 제도 비교", slug: "then-now-1", body: { blocks: [{ type: "paragraph", text: "1975년 기준" }] } })).toEqual([]);
  });
  test("기사 연재 이름 칸이 차 있으면 거부 (연재 이름은 설정 한 곳)", () => {
    expect(episodeTextErrors({ title: "시험용", seriesTitle: "다른 연재" })).toEqual([expect.stringMatching(/^seriesTitle: /)]);
    expect(episodeTextErrors({ title: "시험용", seriesTitle: "  " })).toEqual([]);
  });
  test("본문 글자 모으기 — 중첩 객체·배열의 글자 값만", () => {
    expect(textsOf({ a: ["x", { b: "y", n: 50 }], c: null })).toEqual(["x", "y"]);
  });
});

describe("연재 제목 — 연수 표기는 경력 표시 승인 뒤에만", () => {
  test("승인 전: '50년'·'50 년'·'오십 년' 거부 (칸 title)", () => {
    for (const t of ["시험용 지방세 50년", "시험용 지방세 50 년", "시험용 지방세 오십 년"]) {
      expect(seriesTitleErrors(t, false)).toEqual([expect.stringMatching(/^title: .*career_claim_approved/)]);
    }
  });
  test("승인 뒤: 같은 제목 저장 가능", () => {
    expect(seriesTitleErrors("시험용 지방세 50년", true)).toEqual([]);
  });
  test("연수 표기 없는 중립 가제는 승인 전에도 저장", () => {
    expect(seriesTitleErrors("시그니처 칼럼", false)).toEqual([]);
  });
  test("빈 제목·101자 거부, 100자 경계 허용", () => {
    expect(seriesTitleErrors("", true)).toEqual(["title: 연재 제목이 필요합니다"]);
    expect(seriesTitleErrors(null, true)).toEqual(["title: 연재 제목이 필요합니다"]);
    expect(seriesTitleErrors("가".repeat(101), true)).toEqual(["title: 연재 제목은 100자까지입니다"]);
    expect(seriesTitleErrors("가".repeat(100), false)).toEqual([]);
  });
  test("기사 연재 이름 칸은 승인과 상관없이 늘 거부", () => {
    expect(freeSeriesTitleErrors("지방세 50년")).toEqual([expect.stringMatching(/^seriesTitle: /)]);
    expect(freeSeriesTitleErrors("그때와 지금")).toEqual([]);
    expect(freeSeriesTitleErrors(null)).toEqual([]);
  });
});

describe("회차 지정 입력", () => {
  test("연재 키는 설계 2.1 값 그대로", () => {
    expect([...SERIES_KEYS]).toEqual(row("signature_episode.series_key (8단계)"));
  });
  test("지정 — 기사 번호·연재·회차", () => {
    expect(parseEpisodeAssign({ articleId: 3, seriesKey: "then_now", episode: 2 })).toEqual({ ok: true, value: { articleId: 3, seriesKey: "then_now", episode: 2 } });
  });
  test("빼기 — seriesKey null이면 회차 없음", () => {
    expect(parseEpisodeAssign({ articleId: 3, seriesKey: null })).toEqual({ ok: true, value: { articleId: 3, seriesKey: null, episode: null } });
  });
  test("모르는 연재·회차 0·10000·소수·기사 번호 없음 거부", () => {
    expect(parseEpisodeAssign({ articleId: 3, seriesKey: "kim" })).toEqual({ ok: false, errors: [expect.stringMatching(/^seriesKey: /)] });
    expect(parseEpisodeAssign({ articleId: 3, seriesKey: "signature", episode: 0 })).toEqual({ ok: false, errors: [expect.stringMatching(/^episode: /)] });
    expect(parseEpisodeAssign({ articleId: 3, seriesKey: "signature", episode: 10000 })).toEqual({ ok: false, errors: [expect.stringMatching(/^episode: /)] });
    expect(parseEpisodeAssign({ articleId: 3, seriesKey: "signature", episode: 1.5 })).toEqual({ ok: false, errors: [expect.stringMatching(/^episode: /)] });
    expect(parseEpisodeAssign({ seriesKey: "signature", episode: 1 })).toEqual({ ok: false, errors: [expect.stringMatching(/^articleId: /)] });
  });
});

describe("「그때와 지금」 비교 항목 — 출처·기준연도 둘 다 필수", () => {
  const good = { thenText: "시험용 과거 제도", nowText: "시험용 현재 제도", source: "시험용 출처", baseYear: 1995 };
  test("출처·기준연도가 있으면 저장 모양으로", () => {
    expect(parseThenNowItems([{ ...good, label: "시험용 항목", sourceUrl: "https://example.test/a" }], 2026)).toEqual({
      ok: true,
      value: [{ label: "시험용 항목", then_text: "시험용 과거 제도", now_text: "시험용 현재 제도", source: "시험용 출처", source_url: "https://example.test/a", base_year: 1995 }],
    });
  });
  test("출처 없음 → items[0].source 칸 오류", () => {
    const r = parseThenNowItems([{ ...good, source: "  " }], 2026);
    expect(r).toEqual({ ok: false, errors: [expect.stringMatching(/^items\[0\]\.source: 출처가 필요합니다/)] });
  });
  test("기준연도 없음 → items[1].baseYear 칸 오류 (두 번째 항목)", () => {
    const r = parseThenNowItems([good, { ...good, baseYear: undefined }], 2026);
    expect(r).toEqual({ ok: false, errors: [expect.stringMatching(/^items\[1\]\.baseYear: 기준연도가 필요합니다/)] });
  });
  test("둘 다 없으면 오류 두 줄", () => {
    const r = parseThenNowItems([{ thenText: "a", nowText: "b" }], 2026);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.split(":")[0])).toEqual(["items[0].source", "items[0].baseYear"]);
  });
  test("기준연도 경계 — 1900·올해 허용, 1899·내년·글자·소수 거부", () => {
    expect(parseThenNowItems([{ ...good, baseYear: 1900 }], 2026).ok).toBe(true);
    expect(parseThenNowItems([{ ...good, baseYear: 2026 }], 2026).ok).toBe(true);
    for (const y of [1899, 2027, "1995", 1995.5]) expect(parseThenNowItems([{ ...good, baseYear: y }], 2026).ok).toBe(false);
  });
  test("항목 글자에 연수 표기 거부 (연도는 기준연도 칸)", () => {
    const r = parseThenNowItems([{ ...good, thenText: "50년 전 제도" }], 2026);
    expect(r).toEqual({ ok: false, errors: [expect.stringMatching(/^items\[0\]\.thenText: /)] });
  });
  test("출처 주소는 http(s)만, 목록 아님·상한 초과 거부", () => {
    expect(parseThenNowItems([{ ...good, sourceUrl: "javascript:alert(1)" }], 2026)).toEqual({ ok: false, errors: [expect.stringMatching(/^items\[0\]\.sourceUrl: /)] });
    expect(parseThenNowItems("x", 2026)).toEqual({ ok: false, errors: ["items: 비교 항목 목록이 필요합니다"] });
    expect(parseThenNowItems(Array.from({ length: THEN_NOW_MAX_ITEMS + 1 }, () => good), 2026).ok).toBe(false);
    expect(parseThenNowItems(Array.from({ length: THEN_NOW_MAX_ITEMS }, () => good), 2026).ok).toBe(true);
  });
  test("빈 목록은 모양으로는 통과 (발행된 회차의 빈 목록은 DB·서버가 따로 막는다)", () => {
    expect(parseThenNowItems([], 2026)).toEqual({ ok: true, value: [] });
  });
});
