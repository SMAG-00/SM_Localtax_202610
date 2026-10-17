// 기사 상세 규칙 — 비슷한 사례·관련 기사·다음 행동 띠(ART-06) · 「지방세로 읽기」 자리(CORE-01) · 정정/업데이트(NAV-06 · ART-05) · 갱신 배너(TX-08)
import { describe, expect, test } from "vitest";
import type { StoredBlock, StoredTaxLens } from "../articles/content";
import {
  blockMediaIds,
  correctionEntries,
  publicBio,
  publicBioItems,
  publicBlocks,
  reporterKind,
  selectNextActions,
  selectRelated,
  selectSimilarCases,
  shareDescription,
  solvedCaseView,
  splitCardNews,
  sponsorMark,
  stageBanner,
  taxLensSlot,
  updateEntries,
} from "./article-logic";
import { NEXT_ACTION_KEYS } from "./constants";
import { CLOSED_FEATURES } from "./settings";
import { listItem } from "./test-items";

const OPEN = { ...CLOSED_FEATURES, region_hubs: true, sm_calculator: true, expert_finder: true, store: true };

describe("비슷한 사례 3건 (ART-06)", () => {
  const current = { id: 1, section: "tax" as const };

  test("자기 자신 0 — 해결 사례 먼저, 그다음 같은 태그 수, 같은 분야, 최신 순", () => {
    const candidates = [
      listItem({ id: 1, section: "tax" }),
      listItem({ id: 2, section: "tax", publishedAt: "2026-10-10T00:00:00Z" }),
      listItem({ id: 3, section: "tax", publishedAt: "2026-10-12T00:00:00Z" }),
      listItem({ id: 4, section: "realestate", publishedAt: "2026-10-01T00:00:00Z" }),
      listItem({ id: 5, section: "tax", subtype: "solved_case", publishedAt: "2026-09-01T00:00:00Z" }),
    ];
    const tags = new Map([
      [4, 2],
      [2, 1],
    ]);
    expect(selectSimilarCases(current, candidates, tags).map((c) => [c.id, c.kind])).toEqual([
      [5, "해결 사례"],
      [4, "기사"],
      [2, "기사"],
    ]);
  });

  test("후보가 3건 미만이면 있는 만큼, 0건이면 빈 목록 (줄 숨김)", () => {
    expect(selectSimilarCases(current, [listItem({ id: 2, section: "tax" })], new Map())).toHaveLength(1);
    expect(selectSimilarCases(current, [listItem({ id: 1, section: "tax" })], new Map())).toEqual([]);
    expect(selectSimilarCases(current, [], new Map())).toEqual([]);
  });

  test("광고·금주 핫뉴스·유형 미분류 0, 태그가 겹치지 않는 다른 분야 기사 0, 같은 기사 두 번 0", () => {
    const r = selectSimilarCases(
      current,
      [
        listItem({ id: 2, section: "tax", contentType: "sponsored" }),
        listItem({ id: 3, section: "tax", contentType: "digest" }),
        listItem({ id: 4, section: "tax", contentType: null }),
        listItem({ id: 5, section: "finance" }),
        listItem({ id: 6, section: "tax" }),
        listItem({ id: 6, section: "tax" }),
      ],
      new Map(),
    );
    expect(r.map((c) => c.id)).toEqual([6]);
  });
});

describe("관련 기사", () => {
  test("같은 개정안 → 같은 하위 분야 → 같은 분야 최신, 자기 자신·비슷한 사례와 겹침 0, 4건까지", () => {
    const current = { id: 1, section: "tax" as const, categoryId: 7, amendmentId: 3 };
    const r = selectRelated(
      current,
      [
        listItem({ id: 1, amendmentId: 3 }),
        listItem({ id: 2, section: "tax", publishedAt: "2026-10-15T00:00:00Z" }),
        listItem({ id: 3, section: "tax", categoryId: 7, publishedAt: "2026-10-01T00:00:00Z" }),
        listItem({ id: 4, section: "tax", amendmentId: 3, publishedAt: "2026-09-01T00:00:00Z" }),
        listItem({ id: 5, section: "tax", categoryId: 7 }),
        listItem({ id: 6, section: "realestate" }),
        listItem({ id: 7, section: "tax", contentType: "sponsored" }),
        listItem({ id: 8, section: "tax", publishedAt: "2026-10-16T00:00:00Z" }),
      ],
      new Set([5]),
    );
    expect(r.map((a) => a.id)).toEqual([4, 3, 8, 2]);
  });
});

describe("다음 행동 띠 버튼 (ART-06 — 열린 것 중 우선순위 앞 2개)", () => {
  const all = {
    situation: { href: "/situations/car-sold" },
    same_section: { href: "/tax/interpretations" },
    local_news: { href: "/local/seoul" },
    sm_calculator: { href: "https://sm.example.com/calc/acquisition", external: true },
    expert_finder: { href: "/experts?field=tax" },
  };

  test("우선순위 순서로 앞의 2개만", () => {
    expect(selectNextActions([...NEXT_ACTION_KEYS], all, OPEN).map((a) => a.key)).toEqual(["situation", "same_section"]);
    expect(selectNextActions(["expert_finder", "sm_calculator", "situation"], all, OPEN).map((a) => [a.key, a.external])).toEqual([
      ["expert_finder", false],
      ["sm_calculator", true],
    ]);
  });

  test("닫힌 기능의 버튼은 없다 — 1단계 기본값(모두 꺼짐)에서는 상황·같은 분야만", () => {
    const r = selectNextActions(["sm_calculator", "expert_finder", "local_news", "self_calculator", "taxbot", "same_section"], all, CLOSED_FEATURES);
    expect(r.map((a) => a.key)).toEqual(["same_section"]);
  });

  test("갈 곳이 없으면 그 버튼은 없다 — 연결된 상황이 없는 기사, 지역 태그가 없는 기사", () => {
    const r = selectNextActions(["situation", "local_news", "same_section"], { ...all, situation: null, local_news: null }, OPEN);
    expect(r.map((a) => a.key)).toEqual(["same_section"]);
  });

  test("숨긴 경로로 가는 버튼은 없다 (자체 계산기 /calc/… 1단계 0)", () => {
    const r = selectNextActions(["self_calculator", "same_section"], { ...all, self_calculator: { href: "/calc/acquisition" } }, { ...OPEN, self_calculator: true });
    expect(r.map((a) => a.key)).toEqual(["same_section"]);
  });

  test("버튼 글자는 하는 일 (설계 2.3)", () => {
    expect(selectNextActions(["situation"], all, OPEN)[0]!.label).toBe("이 상황 모아 보기");
  });
});

describe("「지방세로 읽기」 자리 (CORE-01 · 01C BR-03)", () => {
  const lens = (over: Partial<StoredTaxLens> = {}): StoredTaxLens => ({
    topics: ["취득세"],
    points: ["관리처분인가 뒤 입주권 취득은 취득세 대상입니다."],
    links: [
      { kind: "explainer", label: "해설 읽기", url: "/news/membership-acquisition" },
      { kind: "calculator", label: "SM 취득세 계산기", url: "https://sm.example.com/calc" },
      { kind: "book", label: "지방세 50문 50답", url: "/store/books/fifty" },
      { kind: "expert", label: "전문가 찾기", url: "/experts?field=realestate" },
    ],
    skip_reason: null,
    reviewed: true,
    reviewed_for_version: 3,
    reviewed_by: 41,
    reviewed_at: "2026-10-16T05:00:00Z",
    ...over,
  });
  const REVIEWERS = new Map([[41, "이감수 세무사"]]);

  test("감수된 현재 버전 박스 — 세목·포인트·기준일·서명한 감수위원, 링크는 열린 기능만", () => {
    expect(taxLensSlot(lens(), 3, "2026-10-01", CLOSED_FEATURES, REVIEWERS)).toEqual({
      topics: ["취득세"],
      points: ["관리처분인가 뒤 입주권 취득은 취득세 대상입니다."],
      links: [{ kind: "explainer", label: "해설 읽기", href: "/news/membership-acquisition", external: false }],
      basisDate: "2026-10-01",
      reviewer: "이감수 세무사",
    });
    expect(taxLensSlot(lens(), 3, "2026-10-01", OPEN, REVIEWERS)!.links.map((l) => [l.kind, l.external])).toEqual([
      ["explainer", false],
      ["calculator", true],
      ["book", false],
      ["expert", false],
    ]);
  });

  test("감수자 이름은 서명 기록에서만 — 서명자가 없거나 비공개 인물이면 박스 0 (손으로 넣은 이름 0)", () => {
    expect(taxLensSlot(lens({ reviewed_by: null }), 3, "2026-10-01", OPEN, REVIEWERS)).toBeNull();
    expect(taxLensSlot(lens({ reviewed_by: 99 }), 3, "2026-10-01", OPEN, REVIEWERS)).toBeNull();
    expect(taxLensSlot(lens(), 3, "2026-10-01", OPEN, new Map([[41, "  "]]))).toBeNull();
  });

  test("법령 기준일이 없으면 박스 0 (박스가 '기준일'을 함께 보인다)", () => {
    expect(taxLensSlot(lens(), 3, null, OPEN, REVIEWERS)).toBeNull();
  });

  test("생략 사유가 있거나 감수 전·이전 버전 감수면 박스 요소 0 (null)", () => {
    expect(taxLensSlot(lens({ skip_reason: "세금 쟁점 없음" }), 3, "2026-10-01", OPEN, REVIEWERS)).toBeNull();
    expect(taxLensSlot(lens({ reviewed: false }), 3, "2026-10-01", OPEN, REVIEWERS)).toBeNull();
    expect(taxLensSlot(lens({ reviewed_for_version: 2 }), 3, "2026-10-01", OPEN, REVIEWERS)).toBeNull();
    expect(taxLensSlot(null, 3, "2026-10-01", OPEN, REVIEWERS)).toBeNull();
  });

  test("포인트 0줄·4줄·세목 0개면 박스 없음, 1줄·3줄은 박스", () => {
    expect(taxLensSlot(lens({ points: [] }), 3, "2026-10-01", OPEN, REVIEWERS)).toBeNull();
    expect(taxLensSlot(lens({ points: ["1", "2", "3", "4"] }), 3, "2026-10-01", OPEN, REVIEWERS)).toBeNull();
    expect(taxLensSlot(lens({ topics: [] }), 3, "2026-10-01", OPEN, REVIEWERS)).toBeNull();
    expect(taxLensSlot(lens({ points: ["1", "2", "3"] }), 3, "2026-10-01", OPEN, REVIEWERS)!.points).toHaveLength(3);
  });

  test("열린 링크가 하나도 없으면 박스 없음 — 숨긴 경로·사이트 밖 주소 형식이 아닌 링크도 뺀다", () => {
    const onlyClosed = lens({ links: [{ kind: "calculator", label: "SM 계산기", url: "https://sm.example.com/calc" }] });
    expect(taxLensSlot(onlyClosed, 3, "2026-10-01", CLOSED_FEATURES, REVIEWERS)).toBeNull();
    const blocked = lens({ links: [{ kind: "explainer", label: "옛 주소", url: "/region/seoul" }, { kind: "explainer", label: "이상한 주소", url: "news/x" }] });
    expect(taxLensSlot(blocked, 3, "2026-10-01", OPEN, REVIEWERS)).toBeNull();
  });
});

describe("정정 이력 · 업데이트 표시", () => {
  test("정정은 게재 시각 순(오래된 것부터), 독자 표시가 없으면 종류 이름, 삭제 기록은 화면에 없다", () => {
    const r = correctionEntries([
      { id: 2, article_id: 1, kind: "correction", reason: "수치 오류", reader_notice: "취득세 세수 수치를 고쳤습니다", published_at: "2026-10-20T01:00:00Z" },
      { id: 1, article_id: 1, kind: "rebuttal", reason: "반론 게재", reader_notice: null, published_at: "2026-10-19T01:00:00Z" },
      { id: 3, article_id: 1, kind: "deletion", reason: "삭제", reader_notice: null, published_at: "2026-10-21T01:00:00Z" },
    ]);
    expect(r.map((e) => [e.id, e.what, e.why])).toEqual([
      [1, "반론", "반론 게재"],
      [2, "취득세 세수 수치를 고쳤습니다", "수치 오류"],
    ]);
  });

  test("정정이 0건이면 빈 목록 (블록 요소 0)", () => expect(correctionEntries([])).toEqual([]));

  test("업데이트 표시는 실질 수정 기록만 — 오탈자·사유 없는 기록 0, 한국 날짜, 판 순서", () => {
    const r = updateEntries([
      { id: 3, article_id: 1, version: 4, edited_at: "2026-10-20T16:00:00Z", reason: "2026년 3분기 통계 반영", update_kind: "substantive" },
      { id: 2, article_id: 1, version: 3, edited_at: "2026-10-19T01:00:00Z", reason: "오탈자", update_kind: "typo" },
      { id: 1, article_id: 1, version: 2, edited_at: "2026-10-18T01:00:00Z", reason: "개정안 단계 반영", update_kind: "substantive" },
    ]);
    expect(r).toEqual([
      { version: 2, date: "2026-10-18", reason: "개정안 단계 반영" },
      { version: 4, date: "2026-10-21", reason: "2026년 3분기 통계 반영" },
    ]);
  });
});

describe("본문 이미지 — 읽을 수 있는(권리 확인·공개) media만", () => {
  const blocks: StoredBlock[] = [
    { type: "paragraph", text: "본문" },
    { type: "image", mediaId: "11", alt: "현장 사진", caption: "" },
    { type: "infographic", mediaId: "12", alt: "그림", caption: "", chart: null },
    { type: "image", mediaId: "13", alt: "권리 미확인", caption: "" },
  ];

  test("읽히지 않는 이미지·인포그래픽 블록은 뺀다 — 다른 블록은 그대로", () => {
    expect(publicBlocks(blocks, new Set(["11", "12"])).map((b) => b.type)).toEqual(["paragraph", "image", "infographic"]);
    expect(blockMediaIds(blocks)).toEqual(["11", "12", "13"]);
  });
});

describe("개정 브리핑 갱신 배너 (TX-08)", () => {
  const stage = { current: "submitted", label: "국회 제출", recordedAt: "2026-10-28T03:00:00Z" };

  test("기사 발행 뒤 단계가 기록되면 배너", () => {
    expect(stageBanner(stage, { firstPublishedAt: "2026-10-20T00:00:00Z", substantiveUpdatedAt: null })).toEqual({ stageLabel: "국회 제출", changedAt: "2026-10-28T03:00:00Z" });
  });

  test("단계 기록 뒤에 실질 수정했으면 배너 없음, 발행 전 기록이면 없음", () => {
    expect(stageBanner(stage, { firstPublishedAt: "2026-10-20T00:00:00Z", substantiveUpdatedAt: "2026-10-29T00:00:00Z" })).toBeNull();
    expect(stageBanner(stage, { firstPublishedAt: "2026-10-29T00:00:00Z", substantiveUpdatedAt: null })).toBeNull();
    expect(stageBanner({ ...stage, current: null }, { firstPublishedAt: "2026-10-20T00:00:00Z", substantiveUpdatedAt: null })).toBeNull();
  });
});

describe("공개 약력 — 평문 이메일 0 (HELP-03)", () => {
  test("증빙 번호가 있는 글자 항목만, 이메일이 섞인 줄은 뺀다", () => {
    expect(publicBio([{ item: "세무사", evidence_id: "doc-1" }, { item: "연락 kim@example.com", evidence_id: "doc-2" }, { item: " ", evidence_id: "doc-3" }, { evidence_id: "x" }, "글자"])).toEqual(["세무사"]);
    expect(publicBio(null)).toEqual([]);
  });
  test("증빙 번호가 비면 공개 뷰를 지나왔어도 빼고(이중 방어), 인물 페이지 항목은 증빙 번호를 함께 준다", () => {
    expect(publicBio([{ item: "증빙 없는 경력", evidence_id: "  " }, { item: "경력 50년" }])).toEqual([]);
    expect(publicBioItems([{ item: "지방세 실무 30년", evidence_id: 17 }])).toEqual([{ id: "bio-0", text: "지방세 실무 30년", evidenceId: "17" }]);
  });
});

describe("카드뉴스 장 나누기 (ART-03)", () => {
  const slide = (n: number, over: Partial<Extract<StoredBlock, { type: "slide" }>> = {}): StoredBlock => ({ type: "slide", title: `${n}장 제목`, text: `${n}장 첫 줄\n${n}장 둘째 줄`, alt: `${n}장 그림 설명`, ...over });
  const faq: StoredBlock = { type: "faq", items: [{ question: "질문", answer: "답" }] };

  test("카드뉴스면 장은 슬라이드(번호·제목·줄·대체 텍스트), 나머지 블록은 본문으로 — 순서 그대로", () => {
    const r = splitCardNews("cardnews", [slide(1), faq, slide(2)]);
    expect(r.slides).toEqual([
      { number: 1, title: "1장 제목", lines: ["1장 첫 줄", "1장 둘째 줄"], alt: "1장 그림 설명" },
      { number: 2, title: "2장 제목", lines: ["2장 첫 줄", "2장 둘째 줄"], alt: "2장 그림 설명" },
    ]);
    expect(r.rest).toEqual([faq]);
  });

  test("카드뉴스가 아닌 기사의 장 블록은 그리지 않는다 (슬라이드 0 · 본문에서도 빠진다)", () => {
    expect(splitCardNews("general", [slide(1), faq])).toEqual({ slides: [], rest: [faq] });
  });

  test("글자가 없는 장은 빼고 번호를 다시 매긴다, 대체 텍스트가 빈 장은 'n번째 장'으로 읽힌다", () => {
    const r = splitCardNews("cardnews", [slide(1, { title: " ", text: "" }), slide(2, { alt: "  " }), slide(3)]);
    expect(r.slides.map((s) => [s.number, s.title, s.alt])).toEqual([
      [1, "2장 제목", "1번째 장"],
      [2, "3장 제목", "3장 그림 설명"],
    ]);
  });
});

describe("해결 사례 카드 값 (CAT-05)", () => {
  const sc = {
    situation: "계약일부터 60일을 세어 신고했다.",
    issue: "신고 기간의 시작일이 쟁점이었다.",
    result: "잔금일을 취득일로 보았다.",
    lesson: "잔금일과 등기일 중 빠른 날부터 셉니다.",
    resultEvidence: [
      { kind: "decision" as const, number: "조심2025지0001", url: "https://decisions.example.kr/1" },
      { kind: "decision" as const, number: "", url: "https://decisions.example.kr/2" },
      { kind: "interpretation" as const, number: "부동산세제과-12", url: "원문 누리집" },
    ],
    conclusion: "rejected" as const,
  };

  test("4칸 · 결론 배지 · 번호와 링크가 다 있는 근거만 (새 창)", () => {
    expect(solvedCaseView(sc)).toEqual({
      situation: sc.situation,
      issue: sc.issue,
      result: { conclusion: "rejected", text: sc.result, basis: [{ label: "조심2025지0001", href: "https://decisions.example.kr/1", external: true }] },
      lesson: sc.lesson,
    });
  });

  test.each([
    ["빈 칸", { lesson: "  " }],
    ["결론 없음", { conclusion: null }],
    ["모르는 결론", { conclusion: "won" }],
    ["근거 0", { resultEvidence: [] }],
  ])("%s → 카드 값 없음(null — 기사 카드로 대신)", (_name, over) => {
    expect(solvedCaseView({ ...sc, ...over } as typeof sc)).toBeNull();
  });

  test.each(["accepted", "partial", "dismissed", "interpretation"] as const)("결론 %s도 카드가 된다", (conclusion) => {
    expect(solvedCaseView({ ...sc, conclusion })!.result.conclusion).toBe(conclusion);
  });
});

describe("표기 배지 (ART-10 · PRD-00 8.8)", () => {
  test("광고는 '광고' 하나, 공동 기획은 제휴사 이름과 함께 — 둘을 섞지 않는다", () => {
    expect(sponsorMark("ad", "가온세무법인")).toEqual({ kind: "ad" });
    expect(sponsorMark("co_planned", " 가온세무법인 ")).toEqual({ kind: "co_planned", partner: "가온세무법인" });
    expect(sponsorMark("none", "가온세무법인")).toBeNull();
  });
  test("제휴사 이름이 없는 공동 기획은 표기를 만들지 않는다 (발행 판정이 막는 값)", () => {
    expect(sponsorMark("co_planned", null)).toBeNull();
    expect(sponsorMark("co_planned", "  ")).toBeNull();
  });
});

describe("기자 소개 블록 종류", () => {
  test.each([
    ["opinion", "opinion"],
    ["explainer", "explainer"],
    ["guide", "guide"],
    ["reported_news", "report"],
    ["sponsored", "report"],
    [null, "report"],
  ] as const)("%s → %s (칼럼만 필자·의견 고지)", (type, kind) => expect(reporterKind(type)).toBe(kind));
});

describe("공유 미리보기 설명 (ART-03)", () => {
  const slide = { number: 1, title: "취득세 60일", lines: ["잔금일부터 셉니다", "위택스로 신고합니다"], alt: "달력" };
  test("카드뉴스는 첫 장의 제목과 글, 아니면 요약", () => {
    expect(shareDescription("요약입니다", [slide, { ...slide, number: 2, title: "둘째" }], null)).toBe("취득세 60일 잔금일부터 셉니다 위택스로 신고합니다");
    expect(shareDescription(" 요약입니다 ", [], null)).toBe("요약입니다");
  });
  test("표기가 있으면 화면·JSON-LD 제목과 같은 표기를 앞에 붙인다", () => {
    expect(shareDescription("요약", [], "공동 기획 가온세무법인")).toBe("[공동 기획 가온세무법인] 요약");
    expect(shareDescription("", [], "광고")).toBe("");
  });
});
