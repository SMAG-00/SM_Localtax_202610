// ART-10 제휴 콘텐츠 — 표기가 있으면 sponsored, 공동 기획은 제휴사, 제휴사면 표기, 계약 종료일
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { TAX_EXPLAINER } from "../../fixtures/explainer";
import { uniqueIds } from "../../fixtures/helpers";
import { QUANTITATIVE_NEWS } from "../../fixtures/quantitative";
import { evaluatePublish } from "../evaluate";
import type { ArticleForPublish, PartnerRef } from "../model";

const partner: PartnerRef = { id: "partner-01", name: "가온세무법인", contractFrom: "2026-01-01", contractTo: "2026-12-31" };
const sponsored: ArticleForPublish = { ...TAX_EXPLAINER, contentType: "sponsored", label: "co_planned", partner };
const run = (article: ArticleForPublish) => evaluatePublish(article, BASE_CONTEXT);
const blockers = (article: ArticleForPublish) => uniqueIds(run(article).blockers);

describe("ART-10 표기와 유형", () => {
  it("공동 기획 + 제휴사 + sponsored는 통과", () => {
    expect(blockers(sponsored)).toEqual([]);
  });

  it("표기가 있는 기사를 reported_news로 발행하면 거부", () => {
    expect(blockers({ ...QUANTITATIVE_NEWS, label: "co_planned", partner })).toEqual(["art10.label-requires-sponsored"]);
  });

  it("광고 표기 + 해설 유형도 거부", () => {
    expect(blockers({ ...TAX_EXPLAINER, label: "ad" })).toEqual(["art10.label-requires-sponsored"]);
  });

  it("공동 기획인데 제휴사가 없으면 배지('공동 기획 ○○')를 만들 수 없어 거부", () => {
    expect(blockers({ ...sponsored, partner: null })).toEqual(["art10.co-planned-partner-required"]);
  });

  it("제휴사를 지정했는데 표기가 '없음'이면 거부", () => {
    expect(blockers({ ...TAX_EXPLAINER, partner })).toEqual(["art10.partner-requires-label"]);
  });

  it("공동 기획과 광고는 표기 칸 하나(label)라 함께 지정할 수 없다 — 값 목록은 셋 중 하나", () => {
    const labels: ArticleForPublish["label"][] = ["none", "co_planned", "ad"];
    expect(labels.map((label) => run({ ...sponsored, label, partner: label === "co_planned" ? partner : null }).canPublish)).toEqual([
      false,
      true,
      true,
    ]);
  });
});

describe("ART-10 계약 종료일 (2026-10-17 기준)", () => {
  it.each([
    ["어제(10-16) 끝난 계약", "2026-10-16", ["art10.partner-contract-expired"]],
    ["오늘(10-17) 끝나는 계약", "2026-10-17", []],
    ["종료일 없는 계약", null, []],
  ] as const)("새 기사에 %s 제휴사 지정 → %j", (_name, contractTo, expected) => {
    expect(blockers({ ...sponsored, partner: { ...partner, contractTo } })).toEqual(expected);
  });

  it("차단 위치에 제휴사 ID를 알려 준다", () => {
    const result = run({ ...sponsored, partner: { ...partner, contractTo: "2026-09-30" } });
    expect(result.blockers[0]!.location).toEqual({ field: "partner", phrase: "partner-01" });
  });

  it("이미 발행된 기사의 배지는 계약이 끝나도 남는다 (수정 재발행 허용)", () => {
    const published: ArticleForPublish = {
      ...sponsored,
      partner: { ...partner, contractTo: "2026-09-30" },
      firstPublishedAt: "2026-09-01T09:00:00+09:00",
      updateKind: "typo",
      updatedReason: "오탈자 수정 — '잔금일' 표기",
    };
    expect(blockers(published)).toEqual([]);
  });
});
