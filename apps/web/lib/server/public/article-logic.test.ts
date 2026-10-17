// 기사 상세 규칙 — 비슷한 사례·관련 기사·다음 행동 띠(ART-06) · 「지방세로 읽기」 자리(CORE-01) · 정정/업데이트(NAV-06 · ART-05) · 갱신 배너(TX-08)
import { describe, expect, test } from "vitest";
import type { StoredBlock, StoredTaxLens } from "../articles/content";
import {
  blockMediaIds,
  correctionEntries,
  publicBio,
  publicBlocks,
  selectNextActions,
  selectRelated,
  selectSimilarCases,
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

describe("「지방세로 읽기」 자리 (CORE-01)", () => {
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
    ...over,
  });

  test("감수된 현재 버전 박스 — 세목·포인트·기준일, 링크는 열린 기능만", () => {
    expect(taxLensSlot(lens(), 3, "2026-10-01", CLOSED_FEATURES)).toEqual({
      topics: ["취득세"],
      points: ["관리처분인가 뒤 입주권 취득은 취득세 대상입니다."],
      links: [{ kind: "explainer", label: "해설 읽기", href: "/news/membership-acquisition", external: false }],
      basisDate: "2026-10-01",
      reviewer: null,
    });
    expect(taxLensSlot(lens(), 3, null, OPEN)!.links.map((l) => [l.kind, l.external])).toEqual([
      ["explainer", false],
      ["calculator", true],
      ["book", false],
      ["expert", false],
    ]);
  });

  test("생략 사유가 있거나 감수 전·이전 버전 감수면 박스 요소 0 (null)", () => {
    expect(taxLensSlot(lens({ skip_reason: "세금 쟁점 없음" }), 3, null, OPEN)).toBeNull();
    expect(taxLensSlot(lens({ reviewed: false }), 3, null, OPEN)).toBeNull();
    expect(taxLensSlot(lens({ reviewed_for_version: 2 }), 3, null, OPEN)).toBeNull();
    expect(taxLensSlot(null, 3, null, OPEN)).toBeNull();
  });

  test("포인트 0줄·4줄·세목 0개면 박스 없음, 1줄·3줄은 박스", () => {
    expect(taxLensSlot(lens({ points: [] }), 3, null, OPEN)).toBeNull();
    expect(taxLensSlot(lens({ points: ["1", "2", "3", "4"] }), 3, null, OPEN)).toBeNull();
    expect(taxLensSlot(lens({ topics: [] }), 3, null, OPEN)).toBeNull();
    expect(taxLensSlot(lens({ points: ["1", "2", "3"] }), 3, null, OPEN)!.points).toHaveLength(3);
  });

  test("열린 링크가 하나도 없으면 박스 없음 — 숨긴 경로·사이트 밖 주소 형식이 아닌 링크도 뺀다", () => {
    const onlyClosed = lens({ links: [{ kind: "calculator", label: "SM 계산기", url: "https://sm.example.com/calc" }] });
    expect(taxLensSlot(onlyClosed, 3, null, CLOSED_FEATURES)).toBeNull();
    const blocked = lens({ links: [{ kind: "explainer", label: "옛 주소", url: "/region/seoul" }, { kind: "explainer", label: "이상한 주소", url: "news/x" }] });
    expect(taxLensSlot(blocked, 3, null, OPEN)).toBeNull();
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
  test("글자 항목만, 이메일이 섞인 줄은 뺀다", () => {
    expect(publicBio([{ item: "세무사" }, { item: "연락 kim@example.com" }, { item: " " }, { evidence_id: "x" }, "글자"])).toEqual(["세무사"]);
    expect(publicBio(null)).toEqual([]);
  });
});
