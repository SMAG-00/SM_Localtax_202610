// REG1-14 지역 기사 편집 경고 4종 · 단계 순서 (01B — W4 8단계, docs/dev/W4_설계.md 1장 8단계 · 2.1 · 2.2 · 2.3)
// 견본(QUANTITATIVE_NEWS — 지역 태그가 있는 통과 원고, 경고 0)에서 한 곳씩 바꿔 경고 ID·위치·문장을 본다. 경고는 발행을 막지 않는다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { TAX_EXPLAINER } from "../../fixtures/explainer";
import { uniqueIds } from "../../fixtures/helpers";
import { QUANTITATIVE_NEWS } from "../../fixtures/quantitative";
import { evaluatePublish } from "../evaluate";
import {
  SEPARATE_PRODUCT_STATUSES,
  STALE_STATISTICS_DAYS_DEFAULT,
  type ArticleBlock,
  type ArticleForPublish,
  type ArticleSource,
  type PublishContext,
} from "../model";
import { checkRegionalWarnings, daysBetween, isStatisticsSource, regionalFigures, stageSkipProblem, type StageTransition } from "./regional-warnings";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESIGN = fs.readFileSync(path.join(HERE, "..", "..", "..", "..", "docs", "dev", "W4_설계.md"), "utf8");
const designLine = (prefix: string): string => {
  const line = DESIGN.split("\n").find((l) => l.startsWith(prefix));
  if (!line) throw new Error(`설계 문서에 '${prefix}' 줄이 없다`);
  return line;
};
const designCodes = (prefix: string, col = 2): string[] => [...designLine(prefix).split("|")[col]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

const q = QUANTITATIVE_NEWS;
const warnIds = (a: ArticleForPublish, ctx: PublishContext = BASE_CONTEXT) => uniqueIds(checkRegionalWarnings(a, ctx));
const withBlocks = (extra: ArticleBlock[], base: ArticleForPublish = q): ArticleForPublish => ({ ...base, blocks: [...base.blocks, ...extra] });
const FIGURE_PARAGRAPH: ArticleBlock = { type: "paragraph", text: "가온시 누리구의 올해 재산세 징수액은 312억 원으로 늘었다." };

describe("값 목록 — 설계 2.1 · 2.2와 같다", () => {
  it("별도 상품 검토 큐 상태 = 2.1 separate_product_queue.status, 오래된 통계 기준 씨앗 = 2.2 stale_statistics_days 초기값", () => {
    expect(designCodes("| separate_product_queue.status")).toEqual([...SEPARATE_PRODUCT_STATUSES]);
    expect(designCodes("| `stale_statistics_days` |")[0]).toBe(String(STALE_STATISTICS_DAYS_DEFAULT));
    expect(STALE_STATISTICS_DAYS_DEFAULT).toBe(365);
  });
});

describe("통과 견본 — 지역 기사 편집 경고 0", () => {
  it("QUANTITATIVE_NEWS(지역 태그·수치 문단마다 근거 연결·권리 확인 사진·기준일 109일 전 통계)는 경고 0", () => {
    expect(checkRegionalWarnings(q, BASE_CONTEXT)).toEqual([]);
  });
  it("지역 기사가 아니면(세법 해설) 네 경고를 보지 않는다 — 근거 없는 수치 문단·재게시 비율이 있어도 0", () => {
    const ctx = { ...BASE_CONTEXT, similarity: { status: "pass" as const, reposted: [{ sourceId: "src-press", ratio: 0.9 }] } };
    expect(warnIds(withBlocks([FIGURE_PARAGRAPH], TAX_EXPLAINER), ctx)).toEqual([]);
  });
});

describe("① 보도자료 재게시 — 유사도 설정 기준 이상인 보도자료마다 1건", () => {
  it("같은 보도자료 비율이 기준 이상 → 경고 1건(출처 위치·비율 글자), 발행은 막지 않는다", () => {
    const ctx = { ...BASE_CONTEXT, similarity: { status: "pass" as const, reposted: [{ sourceId: "src-press", ratio: 0.75 }] } };
    const found = checkRegionalWarnings(q, ctx);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: "reg1_14.press-release-repost", level: "warn", ruleRef: "REG1-14", location: { field: "sources", phrase: "src-press" } });
    expect(found[0]!.message).toContain("75%");
    const result = evaluatePublish(q, ctx);
    expect(result.canPublish).toBe(true);
    expect(uniqueIds(result.warnings)).toEqual(["reg1_14.press-release-repost"]);
  });
  it("보도자료가 아닌 출처·없는 출처 번호는 재게시가 아니다 — 0건", () => {
    const ctx = { ...BASE_CONTEXT, similarity: { status: "pass" as const, reposted: [{ sourceId: "src-collection", ratio: 0.9 }, { sourceId: "src-none", ratio: 1 }] } };
    expect(warnIds(q, ctx)).toEqual([]);
  });
});

describe("② 근거 없는 지역 수치 — 숫자 + 단위 문단에 공식 자료·근거 연결 0", () => {
  it("수치 표현 찾기 — 금액·비율·건수·면적·큰 수 낱말은 세고, 날짜·기간·한글 수 낱말은 세지 않는다", () => {
    expect(regionalFigures("징수액은 1,284억 원으로 18.4% 줄었고 거래는 7,300건이다.")).toEqual(["1,284억 원", "18.4%", "7,300건"]);
    expect(regionalFigures("예산 3억이 들고 120만 명이 찾는다. 면적은 1,200㎡다.")).toEqual(["3억", "120만 명", "1,200㎡"]);
    expect(regionalFigures("2026년 1~6월 실적을 12월 15일까지 3개월 동안 본다.")).toEqual([]);
    expect(regionalFigures("상가 세 곳을 찾아갔다.")).toEqual([]);
  });
  it("수치 문단에 핵심 주장 연결이 없으면 그 블록 위치로 1건 — 문단 하나에 수치가 여럿이어도 1건", () => {
    const a = withBlocks([{ type: "paragraph", text: "누리구 재산세는 312억 원, 증가율은 4.2%다." }]);
    const found = checkRegionalWarnings(a, BASE_CONTEXT);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: "reg1_14.unsupported-figure", location: { field: "blocks", blockIndex: q.blocks.length, phrase: "312억 원" } });
  });
  it("연결이 보도자료뿐·반려된 근거·없는 번호면 여전히 경고, 공식 자료 출처나 반려 아닌 근거면 0", () => {
    const index = q.blocks.length;
    const claim = (evidenceIds: string[]) => ({ ...q, blocks: [...q.blocks, FIGURE_PARAGRAPH], claims: [...q.claims, { id: "claim-x", text: "312억 원", kind: "fact" as const, evidenceIds, blockIndex: index }] });
    expect(warnIds(claim(["src-press"]))).toEqual(["reg1_14.unsupported-figure"]);
    expect(warnIds(claim(["src-none"]))).toEqual(["reg1_14.unsupported-figure"]);
    const rejected = { ...claim(["ev-ds-1"]), evidence: q.evidence.map((e) => (e.id === "ev-ds-1" ? { ...e, verificationStatus: "rejected" as const } : e)) };
    expect(warnIds(rejected).filter((id) => id === "reg1_14.unsupported-figure")).toEqual(["reg1_14.unsupported-figure"]);
    expect(warnIds(claim(["src-collection"]))).toEqual([]);
    expect(warnIds(claim(["ev-ds-2"]))).toEqual([]);
    // 다른 블록을 가리키는 주장은 이 문단의 근거가 아니다
    const elsewhere = { ...q, blocks: [...q.blocks, FIGURE_PARAGRAPH], claims: [...q.claims, { id: "claim-y", text: "x", kind: "fact" as const, evidenceIds: ["src-collection"], blockIndex: 2 }] };
    expect(warnIds(elsewhere)).toEqual(["reg1_14.unsupported-figure"]);
  });
  it("문단만 본다 — 표·핵심 요약 상자의 수치는 이 경고 밖(표는 NAV-10 표기, 요약은 본문 문단의 근거로 본다)", () => {
    expect(warnIds(withBlocks([{ type: "callout", kind: "info", title: "참고", text: "예산은 312억 원입니다." }]))).toEqual([]);
  });
});

describe("③ 사진 권리 누락 — 권리 미확인·공공누리 유형 없음·본문 이미지 출처 없음", () => {
  const image = (over: Record<string, unknown>): ArticleBlock => ({ type: "image", mediaId: "media-x", alt: "가온시청", caption: "가온시청 전경", rightsStatus: "confirmed", licenseType: "kogl_1", credit: "가온시", license: "공공누리 제1유형", mediaAlt: "가온시청", ...over }) as ArticleBlock;
  it("권리·유형·출처가 다 있으면 0, 하나라도 빠지면 그 사진마다 1건 (빠진 칸 이름)", () => {
    expect(warnIds(withBlocks([image({})]))).toEqual([]);
    const noCredit = checkRegionalWarnings(withBlocks([image({ credit: "  " })]), BASE_CONTEXT);
    expect(noCredit).toHaveLength(1);
    expect(noCredit[0]).toMatchObject({ id: "reg1_14.photo-rights", location: { field: "blocks", blockIndex: q.blocks.length, phrase: "media-x" } });
    expect(noCredit[0]!.message).toBe("본문 이미지의 권리 정보가 빠졌습니다: 출처(촬영자) (REG1-14)");
    const many = checkRegionalWarnings(withBlocks([image({ rightsStatus: "unconfirmed", licenseType: null, credit: null })]), BASE_CONTEXT);
    expect(many[0]!.message).toBe("본문 이미지의 권리 정보가 빠졌습니다: 이용 권리 확인·공공누리 유형·출처(촬영자) (REG1-14)");
  });
  it("대표 사진 유형 없음·사진 출처 권리 미확인 → 각 1건 (위치 대표 이미지·출처)", () => {
    const lead = checkRegionalWarnings({ ...q, leadImage: { ...q.leadImage!, licenseType: null } }, BASE_CONTEXT);
    expect(lead.map((f) => [f.id, f.location?.field, f.message])).toEqual([["reg1_14.photo-rights", "leadImage", "대표 사진의 권리 정보가 빠졌습니다: 공공누리 유형 (REG1-14)"]]);
    const photo: ArticleSource = { id: "src-photo", kind: "photo", title: "시험용 현장 사진", url: null, provider: "편집국", accessedAt: null, rightsStatus: "unconfirmed", licenseType: "not_applicable" };
    expect(checkRegionalWarnings({ ...q, sources: [...q.sources, photo] }, BASE_CONTEXT).map((f) => f.location?.phrase)).toEqual(["src-photo"]);
  });
});

describe("④ 오래된 통계 — 기준일이 설정 일수를 넘김 (KST 날짜, 기준 당일 0건·하루 넘김 1건)", () => {
  const stats = (referenceDate: string, over: Partial<ArticleSource> = {}): ArticleForPublish => ({
    ...q,
    sources: q.sources.map((s) => (s.id === "src-collection" ? { ...s, referenceDate, ...over } : s)),
  });
  it("오늘 2026-10-17 · 기준 365일 — 2025-10-17(365일) 0건, 2025-10-16(366일) 1건", () => {
    expect(daysBetween("2025-10-17", "2026-10-17")).toBe(365);
    expect(warnIds(stats("2025-10-17"))).toEqual([]);
    const found = checkRegionalWarnings(stats("2025-10-16"), BASE_CONTEXT);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: "reg1_14.stale-statistics", location: { field: "sources.referenceDate", phrase: "src-collection" } });
    expect(found[0]!.message).toContain("366일 전");
  });
  it("기준 일수는 설정값(stale_statistics_days) — 30일이면 109일 전 통계 2건(자료 2종)", () => {
    expect(warnIds(q, { ...BASE_CONTEXT, staleStatisticsDays: 30 })).toEqual(["reg1_14.stale-statistics"]);
    expect(checkRegionalWarnings(q, { ...BASE_CONTEXT, staleStatisticsDays: 30 })).toHaveLength(2);
    expect(warnIds(q, { ...BASE_CONTEXT, staleStatisticsDays: 109 })).toEqual([]);
  });
  it("통계 자료만 — 자료(dataset)·예산/결산·세수·거래 공식 문서는 보고, 조례·고시·보도자료·기준일 빈 자료는 보지 않는다", () => {
    expect(isStatisticsSource({ kind: "dataset", sourceType: null })).toBe(true);
    expect(isStatisticsSource({ kind: "official_doc", sourceType: "budget_settlement" })).toBe(true);
    expect(isStatisticsSource({ kind: "official_doc", sourceType: "ordinance" })).toBe(false);
    expect(isStatisticsSource({ kind: "press_release", sourceType: null })).toBe(false);
    expect(warnIds(stats("2020-01-01", { kind: "official_doc", sourceType: "ordinance" }))).toEqual([]);
    expect(warnIds(stats("2020-01-01", { kind: "official_doc", sourceType: "local_tax_revenue" }))).toEqual(["reg1_14.stale-statistics"]);
    expect(warnIds(stats(""))).toEqual([]);
  });
});

describe("단계 순서 — 초안 → 취재 검증 → 편집/세무 감수 → 승인 → 공개 (DB articles_stage_order와 같다)", () => {
  const t = (over: Partial<StageTransition>): StageTransition => ({ from: "draft", to: "published", regional: true, firstPublished: false, editorialStatus: "pending", taxReviewStatus: "not_required", ...over });
  it("초안·검토 중·보류 → 발행·예약은 거부, 승인 → 발행·예약은 통과", () => {
    for (const from of ["draft", "in_review", "held"]) {
      for (const to of ["published", "scheduled"]) expect(stageSkipProblem(t({ from, to }))).toMatch(/승인 단계를 거쳐야 공개/);
    }
    expect(stageSkipProblem(t({ from: "approved", to: "published", editorialStatus: "approved" }))).toBeNull();
    expect(stageSkipProblem(t({ from: "approved", to: "scheduled", editorialStatus: "approved" }))).toBeNull();
    expect(stageSkipProblem(t({ from: "scheduled", to: "published" }))).toBeNull();
  });
  it("편집 승인 기록 없이 승인 단계 거부 · 세무 감수 반려·보류면 거부 · 감수 대기·감수 대상 아님은 통과", () => {
    expect(stageSkipProblem(t({ from: "in_review", to: "approved" }))).toMatch(/편집 승인 기록 없이/);
    expect(stageSkipProblem(t({ from: "in_review", to: "approved", editorialStatus: "held" }))).toMatch(/편집 승인 기록 없이/);
    expect(stageSkipProblem(t({ from: "in_review", to: "approved", editorialStatus: "approved", taxReviewStatus: "rejected" }))).toMatch(/반려·보류/);
    expect(stageSkipProblem(t({ from: "in_review", to: "approved", editorialStatus: "approved", taxReviewStatus: "held" }))).toMatch(/반려·보류/);
    expect(stageSkipProblem(t({ from: "in_review", to: "approved", editorialStatus: "approved", taxReviewStatus: "pending" }))).toBeNull();
    expect(stageSkipProblem(t({ from: "draft", to: "approved", editorialStatus: "approved" }))).toBeNull();
  });
  it("지역 기사가 아니거나 이미 공개된 적 있는 기사의 다시 공개, 같은 상태는 이 규칙 밖", () => {
    expect(stageSkipProblem(t({ regional: false }))).toBeNull();
    expect(stageSkipProblem(t({ from: "held", firstPublished: true }))).toBeNull();
    expect(stageSkipProblem(t({ from: "published", to: "published" }))).toBeNull();
  });
});
