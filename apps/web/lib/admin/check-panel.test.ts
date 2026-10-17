// 최적화 점검 패널 묶기 시험 (OPT-03) — GET /check · 발행 422 응답 → 차단(발행 불가)·경고 목록, 위치·한국어 문장, 축별 점수.
// 견본 응답은 발행 판정(@ltr/editorial)·점검(@ltr/seo-lint)이 실제로 내는 모양을 옮겼다.
import { describe, expect, test } from "vitest";
import { FORBIDDEN_PANEL_WORDS, SCORE_DISCLAIMER } from "@ltr/seo-lint";
import { PANEL_FIXED_COPY, failedItemNames, locationText, panelView, publishButtonState, type CheckReport } from "./check-panel";

const report = (over: Partial<CheckReport> = {}): CheckReport => ({
  canPublish: false,
  failed: ["nav10.related-party-check", "seo.canonical"],
  warnings: ["ux01.jargon-unexplained", "seo.internal-links"],
  findings: [
    { id: "nav10.related-party-check", level: "block", ruleRef: "NAV-10", message: "관계자 확인 묶음이 비었습니다 — 관련 기관·전문가 확인 기록을 남겨 주세요" },
    { id: "opt03.seo-lint-blocker", level: "block", ruleRef: "OPT-03", message: "최적화 점검 차단 항목 ‘seo.canonical’ — 해소해야 발행됩니다", location: { field: "seoLint", phrase: "seo.canonical" } },
    { id: "ux01.forbidden-phrase", level: "block", ruleRef: "UX-01", message: "금지 표현 ‘절세 보장’", location: { field: "blocks", blockIndex: 2, sentenceIndex: 0, phrase: "절세 보장" } },
    { id: "ux01.jargon-unexplained", level: "warn", ruleRef: "UX-01", message: "‘과세표준’ 풀이가 없습니다", location: { field: "blocks", blockIndex: 1 } },
    { id: "opt03.seo-lint-warning", level: "warn", ruleRef: "OPT-03", message: "최적화 점검 경고 항목 ‘seo.internal-links’ — 발행 기록에 남습니다", location: { field: "seoLint", phrase: "seo.internal-links" } },
  ],
  taxReviewReasons: [],
  seoLint: {
    disclaimer: SCORE_DISCLAIMER,
    ruleVersion: "2026.10-w1b",
    engineVersion: "0.1.0",
    scores: { SEO: 62, AEO: 80, GEO: 100, 공통: 75 },
    blockers: ["seo.canonical"],
    warnings: ["seo.internal-links"],
    items: [
      { id: "seo.canonical", axis: "SEO", name: "canonical 중복", level: "block", message: "canonical 주소가 없거나 절대 주소(https://…)가 아닙니다", applicable: true },
      { id: "seo.internal-links", axis: "SEO", name: "내부 링크", level: "warn", message: "내부 링크 0개 (권장 2개 이상)", applicable: true },
    ],
  },
  ...over,
});

describe("차단·경고 묶기", () => {
  test("차단은 발행 불가, 경고는 발행 가능 — 순서는 판정 순서 그대로", () => {
    const v = panelView(report(), ["key_summary", "paragraph", "paragraph"]);
    expect(v.blockers.map((b) => b.id)).toEqual(["nav10.related-party-check", "seo.canonical", "ux01.forbidden-phrase"]);
    expect(v.warnings.map((w) => w.id)).toEqual(["ux01.jargon-unexplained", "seo.internal-links"]);
  });

  test("편집 판정 항목은 규칙 이름과 판정 문장, 최적화 점검 항목은 점검 이름과 점검 문장", () => {
    const v = panelView(report(), []);
    expect(v.blockers[0]).toMatchObject({ title: "관련 기관·전문가 확인 빔", ruleRef: "NAV-10", message: "관계자 확인 묶음이 비었습니다 — 관련 기관·전문가 확인 기록을 남겨 주세요" });
    expect(v.blockers[1]).toMatchObject({ title: "canonical 중복", ruleRef: "OPT-03", message: "canonical 주소가 없거나 절대 주소(https://…)가 아닙니다" });
  });

  test("위치 — 본문 몇 번째 블록·문장·표현", () => {
    const v = panelView(report(), ["key_summary", "paragraph", "paragraph"]);
    expect(v.blockers[2]!.where).toBe("본문 3번째 블록(문단) · 1번째 문장 · ‘절세 보장’");
    expect(v.warnings[0]!.where).toBe("본문 2번째 블록(문단)");
    expect(v.blockers[0]!.where).toBeNull();
  });

  test("축별 점수 4개와 고정 문구 — 점수 없음이면 '—'", () => {
    const v = panelView(report(), []);
    expect(v.scores).toEqual([
      { label: "SEO", value: "62" },
      { label: "AEO", value: "80" },
      { label: "GEO", value: "100" },
      { label: "공통", value: "75" },
    ]);
    expect(v.disclaimer).toBe(SCORE_DISCLAIMER);
    const odd = panelView(report({ seoLint: { ...report().seoLint, scores: { SEO: 101, AEO: Number.NaN, GEO: 0, 공통: 50.5 } } }), []);
    expect(odd.scores.map((s) => s.value)).toEqual(["—", "—", "0", "—"]);
  });
});

describe("위치 글자", () => {
  test.each([
    [{ field: "title" }, "제목"],
    [{ field: "summary", sentenceIndex: 1 }, "요약 · 2번째 문장"],
    [{ field: "taxLens" }, "「지방세로 읽기」"],
    [{ field: "solvedCase.result" }, "해결 사례 — 결과"],
    [{ field: "datasets", phrase: "ev:3" }, "취재 근거 재현 정보 · ‘ev:3’"],
    [{ field: "interviews", phrase: "ev:7" }, "인터뷰 기록 · ‘ev:7’"],
    [{ field: "perspectives", phrase: "local_gov" }, "관점별 기록 · 지자체"],
    [{ field: "leadImage" }, "대표 이미지"],
  ])("%j → %s", (loc, expected) => {
    expect(locationText(loc, [])).toBe(expected);
  });
});

describe("발행 버튼 상태", () => {
  test("편집 책임자 + 차단 0 → 켜짐", () => {
    expect(publishButtonState({ report: report({ canPublish: true, failed: [] }), canPublishRole: true, status: "approved" })).toEqual({ disabled: false, reason: null });
  });

  test("차단이 남으면 꺼지고 남은 개수를 알린다", () => {
    expect(publishButtonState({ report: report(), canPublishRole: true, status: "in_review" })).toEqual({ disabled: true, reason: "차단 항목 2개를 고치면 발행할 수 있습니다" });
  });

  test("발행 권한이 없으면(기자·감수위원·관리자) 차단이 0이어도 꺼진다", () => {
    expect(publishButtonState({ report: report({ canPublish: true, failed: [] }), canPublishRole: false, status: "approved" })).toEqual({
      disabled: true,
      reason: "발행은 편집 책임자(editor)만 합니다",
    });
  });

  test("이미 발행·삭제된 기사, 점검 전", () => {
    expect(publishButtonState({ report: report({ canPublish: true, failed: [] }), canPublishRole: true, status: "published" }).reason).toBe("이미 발행된 기사입니다");
    expect(publishButtonState({ report: null, canPublishRole: true, status: "draft" })).toEqual({ disabled: true, reason: "점검 결과를 불러오는 중입니다" });
    expect(publishButtonState({ report: report({ canPublish: true, failed: [] }), canPublishRole: true, status: "deleted" }).disabled).toBe(true);
  });
});

describe("발행 422 — 실패 항목 이름", () => {
  test("실패 ID를 규칙·점검 이름으로 (모르는 ID는 그대로)", () => {
    expect(failedItemNames(report({ failed: ["nav03.desk-edit-required", "seo.canonical", "x.unknown"] }))).toEqual([
      "편집 승인 없음 (nav03.desk-edit-required)",
      "canonical 중복 (seo.canonical)",
      "x.unknown",
    ]);
  });
});

describe("패널 문구 규칙 (OPT-03)", () => {
  test("고정 문구에 '순위'·'노출 예측'·'상위 노출'이 없다 — 점수 옆 고정 문구만 예외", () => {
    for (const text of PANEL_FIXED_COPY) for (const word of FORBIDDEN_PANEL_WORDS) expect(text).not.toContain(word);
  });
});
