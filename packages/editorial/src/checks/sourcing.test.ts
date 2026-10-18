// NAV-02 출처가 보도자료뿐인 보도기사 · NAV-04 출처·자체 취재 근거·사진 권리
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { TAX_EXPLAINER } from "../../fixtures/explainer";
import { uniqueIds, withExtraBlock } from "../../fixtures/helpers";
import { QUANTITATIVE_NEWS } from "../../fixtures/quantitative";
import { evaluatePublish } from "../evaluate";
import type { ArticleForPublish } from "../model";

const q = QUANTITATIVE_NEWS;
const run = (article: ArticleForPublish) => evaluatePublish(article, BASE_CONTEXT);
const blockers = (article: ArticleForPublish) => uniqueIds(run(article).blockers);
const pressOnly = q.sources.filter((s) => s.kind === "press_release");

describe("NAV-02 보도자료 단순 재게시", () => {
  it("출처가 보도자료 2건뿐인 reported_news는 발행 불가", () => {
    const twoPress = [pressOnly[0]!, { ...pressOnly[0]!, id: "src-press-2", title: "가온시 하반기 세수 전망 발표" }];
    expect(blockers({ ...q, sources: twoPress })).toEqual(["nav02.press-release-only"]);
  });

  it("보도자료 + 공공데이터 원자료를 함께 쓰면 통과", () => {
    expect(blockers(q)).toEqual([]);
  });

  it("보도기사가 아닌 해설은 출처가 보도자료뿐이어도 이 규칙 대상이 아니다", () => {
    expect(blockers({ ...TAX_EXPLAINER, sources: pressOnly })).toEqual([]);
  });
});

describe("NAV-04 자체 취재 증거", () => {
  it("출처가 0건인 reported_news는 발행 불가", () => {
    expect(blockers({ ...q, sources: [] })).toEqual(["nav04.sources-required"]);
  });

  it("검증된 자체 취재 근거가 1건이면 통과 (경계)", () => {
    expect(blockers({ ...q, evidence: q.evidence.filter((e) => e.id === "ev-ds-1") })).toEqual([]);
  });

  it("근거가 모두 미검증이면 자체 취재 근거 0건으로 보고, 미확인 인터뷰 기록도 반려", () => {
    const unverified = q.evidence.map((e) => ({ ...e, verificationStatus: "pending" as const }));
    expect(blockers({ ...q, evidence: unverified })).toEqual(["nav04.own-evidence-required", "nav11.unverified-evidence"]);
  });

  it("해설은 자체 취재 근거가 없어도 된다", () => {
    expect(TAX_EXPLAINER.evidence).toEqual([]);
    expect(blockers(TAX_EXPLAINER)).toEqual([]);
  });
});

describe("NAV-04 사진 권리 — 유형과 상관없이 미확인이면 발행 거부", () => {
  it("대표 사진 권리 미확인 → 위치 leadImage", () => {
    const result = run({ ...TAX_EXPLAINER, leadImage: { ...TAX_EXPLAINER.leadImage!, rightsStatus: "unconfirmed" } });
    expect(result.blockers).toEqual([
      expect.objectContaining({ id: "nav04.image-rights", location: { field: "leadImage", phrase: "media-0103-lead" } }),
    ]);
  });

  it("본문 이미지 블록 권리 미확인 → 위치 블록 번호", () => {
    const article = withExtraBlock(TAX_EXPLAINER, {
      type: "image",
      mediaId: "media-0103-office",
      alt: "구청 세무과 창구",
      caption: "취득세 신고 창구",
      rightsStatus: "unconfirmed",
    });
    expect(run(article).blockers).toEqual([
      expect.objectContaining({ id: "nav04.image-rights", location: { field: "blocks", blockIndex: 7, phrase: "media-0103-office" } }),
    ]);
  });

  it("인포그래픽 블록 권리 미확인도 같다", () => {
    const article = withExtraBlock(TAX_EXPLAINER, {
      type: "infographic",
      mediaId: "media-0103-steps",
      alt: "신고 4단계",
      caption: "신고 절차",
      rightsStatus: "unconfirmed",
      chart: null,
      template: "flow",
      data: { kind: "list", items: ["계약", "잔금", "신고", "납부"] },
    });
    expect(blockers(article)).toEqual(["nav04.image-rights"]);
  });

  it("사진 출처(kind photo) 권리 미확인 → 위치 출처 ID", () => {
    const photo = {
      id: "src-photo-1",
      kind: "photo" as const,
      title: "가온시청 전경(가온시 제공)",
      url: null,
      provider: "가온시",
      accessedAt: "2026-10-10",
      rightsStatus: "unconfirmed" as const,
    };
    expect(run({ ...TAX_EXPLAINER, sources: [...TAX_EXPLAINER.sources, photo] }).blockers).toEqual([
      expect.objectContaining({ id: "nav04.image-rights", location: { field: "sources", phrase: "src-photo-1" } }),
    ]);
  });

  it("권리를 확인한 이미지는 통과", () => {
    const article = withExtraBlock(TAX_EXPLAINER, {
      type: "image",
      mediaId: "media-0103-office",
      alt: "구청 세무과 창구",
      caption: "취득세 신고 창구",
      rightsStatus: "confirmed",
    });
    expect(blockers(article)).toEqual([]);
  });
});

describe("DB 상태 값과 같은 이름 — 확인됨·검증됨만 통과 (W2-a 설계 2장)", () => {
  it("근거가 모두 검증 대기(pending)·반려(rejected)면 자체 취재 근거 없음으로 발행 불가", () => {
    const evidence = q.evidence.map((e, i) => ({ ...e, verificationStatus: i % 2 ? ("rejected" as const) : ("pending" as const) }));
    expect(run({ ...q, evidence }).blockers.map((f) => f.id)).toContain("nav04.own-evidence-required");
  });

  it("대표 이미지 권리가 거절(rejected)·제한(restricted)이면 발행 불가", () => {
    for (const rightsStatus of ["rejected", "restricted"] as const) {
      const lead = { ...q.leadImage!, rightsStatus };
      expect(run({ ...q, leadImage: lead }).blockers.length).toBeGreaterThan(0);
    }
  });
});
