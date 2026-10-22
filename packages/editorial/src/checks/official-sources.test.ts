// REG1-07 자료 종류 · REG1-09 공식 원자료 필수 칸 · PR-07 공공누리 (01B — W4 5단계, docs/dev/W4_설계.md 1장 5단계 · 2.1 · 12장 #13)
import { describe, expect, it } from "vitest";
import { BASE_CONTEXT } from "../../fixtures/context";
import { TAX_EXPLAINER } from "../../fixtures/explainer";
import { uniqueIds, withExtraBlock } from "../../fixtures/helpers";
import { QUANTITATIVE_NEWS } from "../../fixtures/quantitative";
import { evaluatePublish } from "../evaluate";
import {
  BLOCKED_OFFICIAL_SOURCE_TYPES,
  KOGL_USAGE_DEFAULT,
  LICENSE_TYPES,
  LICENSE_TYPE_LABELS,
  OFFICIAL_SOURCE_TYPES,
  type ArticleForPublish,
  type ArticleSource,
  type LicenseType,
  type PublishContext,
} from "../model";
import { OFFICIAL_REQUIRED_FIELDS, photoLicenseAllowed, photoLicenseProblem, sourceTypeProblem } from "./official-sources";
import { taxReviewReasons } from "./reviews";

const q = QUANTITATIVE_NEWS;
const run = (article: ArticleForPublish, ctx: PublishContext = BASE_CONTEXT) => evaluatePublish(article, ctx);
const blockers = (article: ArticleForPublish, ctx?: PublishContext) => uniqueIds(run(article, ctx).blockers);
const dataset = q.sources.find((s) => s.kind === "dataset")!;
const press = q.sources.find((s) => s.kind === "press_release")!;
const withSource = (article: ArticleForPublish, id: string, patch: Partial<ArticleSource>): ArticleForPublish => ({
  ...article,
  sources: article.sources.map((s) => (s.id === id ? { ...s, ...patch } : s)),
});

describe("값 목록 (W4 설계 2.1)", () => {
  it("공공누리 6값 · 허용 6종 · 차단 4종 · 배지 글자는 유형마다 하나", () => {
    expect(LICENSE_TYPES).toEqual(["kogl_1", "kogl_2", "kogl_3", "kogl_4", "unmarked", "not_applicable"]);
    expect(OFFICIAL_SOURCE_TYPES).toEqual(["ordinance", "notice", "budget_settlement", "local_tax_revenue", "realestate_transaction", "redevelopment"]);
    expect(BLOCKED_OFFICIAL_SOURCE_TYPES).toEqual(["transport", "tourism", "restaurant", "living_guide"]);
    expect(Object.keys(LICENSE_TYPE_LABELS)).toEqual([...LICENSE_TYPES]);
    expect(new Set(Object.values(LICENSE_TYPE_LABELS)).size).toBe(6);
    expect(LICENSE_TYPE_LABELS.kogl_1).toBe("공공누리 제1유형 (출처표시)");
    expect(LICENSE_TYPE_LABELS.unmarked).toBe("공공누리 표시 없음");
  });

  it("견본(정량형 보도)은 공식 자료 칸이 모두 있어 이 규칙의 차단 0", () => {
    expect(blockers(q).filter((id) => id.startsWith("reg1_") || id.startsWith("pr07."))).toEqual([]);
  });
});

describe("REG1-09 공식 자료 필수 칸 — 빈 칸마다 차단, 위치에 API 칸 이름", () => {
  for (const [key, name, api] of OFFICIAL_REQUIRED_FIELDS) {
    it(`${name}(${api})이 비면 발행 불가`, () => {
      for (const blank of [null, "", "  ", undefined]) {
        const r = run(withSource(q, dataset.id, { [key]: blank }));
        const hit = r.blockers.filter((f) => f.id === "reg1_09.official-fields");
        expect(hit).toHaveLength(1);
        expect(hit[0]!.location).toEqual({ field: `sources.${api}`, phrase: dataset.id });
        expect(hit[0]!.message).toContain(`${name}(${api})`);
      }
    });
  }

  it("두 칸이 비면 칸마다 하나씩 (2개)", () => {
    const r = run(withSource(q, dataset.id, { publishedOn: null, regionUnit: null }));
    expect(r.blockers.filter((f) => f.id === "reg1_09.official-fields").map((f) => f.location?.field)).toEqual(["sources.publishedOn", "sources.regionUnit"]);
  });

  it("보도자료·인터뷰 출처는 이 칸들이 없어도 된다 (공식 자료만)", () => {
    expect(blockers(withSource(q, press.id, { publishedOn: null, referenceDate: null, regionUnit: null, collectedAt: null }))).toEqual([]);
  });
});

describe("PR-07 공공누리 유형 필수 — 공식 자료·보도자료·사진 출처", () => {
  it.each([["dataset"], ["press_release"]] as const)("%s 출처에 유형이 없으면 발행 불가 (위치 sources.licenseType)", (kind) => {
    const id = kind === "dataset" ? dataset.id : press.id;
    const r = run(withSource(q, id, { licenseType: null }));
    expect(r.blockers.filter((f) => f.id === "pr07.license-required").map((f) => f.location)).toEqual([{ field: "sources.licenseType", phrase: id }]);
  });

  it("모든 유형 값이 '있음'으로 통과한다 (사진 게시·전재 규칙은 따로)", () => {
    for (const t of LICENSE_TYPES) expect(blockers(withSource(q, press.id, { licenseType: t }))).not.toContain("pr07.license-required");
  });
});

describe("REG1-07 자료 종류 — 허용 목록 안만, 차단 4종은 늘 거부, 비면 보지 않는다", () => {
  it("허용 6종은 통과, 비어 있어도 통과 (법령 출처)", () => {
    for (const t of OFFICIAL_SOURCE_TYPES) expect(sourceTypeProblem("official_doc", t)).toBeNull();
    for (const t of [null, undefined, "", " "]) expect(sourceTypeProblem("official_doc", t)).toBeNull();
  });

  it("차단 4종은 설정 목록에 있어도 거부 (코드 고정)", () => {
    for (const t of BLOCKED_OFFICIAL_SOURCE_TYPES) {
      expect(sourceTypeProblem("dataset", t, [...OFFICIAL_SOURCE_TYPES, t])).toMatch(/교통·관광·음식점·생활 안내/);
      const r = run(withSource(q, dataset.id, { sourceType: t }));
      expect(r.blockers.find((f) => f.id === "reg1_07.source-type")?.location).toEqual({ field: "sources.sourceType", phrase: dataset.id });
    }
  });

  it("목록 밖 값은 거부 — 설정에 더하면 통과 (다음 판정부터)", () => {
    expect(blockers(withSource(q, dataset.id, { sourceType: "school_meal" }))).toContain("reg1_07.source-type");
    expect(blockers(withSource(q, dataset.id, { sourceType: "school_meal" }), { ...BASE_CONTEXT, officialSourceTypes: [...OFFICIAL_SOURCE_TYPES, "school_meal"] })).not.toContain("reg1_07.source-type");
    expect(blockers(withSource(q, dataset.id, { sourceType: "notice" }), { ...BASE_CONTEXT, officialSourceTypes: ["ordinance"] })).toContain("reg1_07.source-type");
  });

  it("공식 자료가 아닌 출처에 자료 종류를 적으면 거부", () => {
    expect(sourceTypeProblem("press_release", "notice")).toMatch(/공식 자료\(official_doc·dataset\) 출처에만/);
    expect(blockers(withSource(q, press.id, { sourceType: "notice" }))).toContain("reg1_07.source-type");
  });
});

describe("REG1-07 고시·조례 해설은 세무 감수 대상", () => {
  // 다른 감수 이유가 없는 해설 — 세금 주장·면책 분야·세금 쟁점 0
  const plain: ArticleForPublish = { ...TAX_EXPLAINER, hasTaxOrLegalClaims: false, claims: [], isTaxIssue: false, category: { slug: "reporting", needsDisclaimer: false } };
  const notice = { ...dataset, id: "src-notice", kind: "official_doc" as const, sourceType: "notice" };

  it("고시·조례 자료를 쓴 해설·가이드만 이유가 생긴다 (보도·다른 자료 종류는 0)", () => {
    expect(taxReviewReasons(plain)).toEqual([]);
    for (const sourceType of ["notice", "ordinance"]) {
      for (const contentType of ["explainer", "guide"] as const) {
        expect(taxReviewReasons({ ...plain, contentType, sources: [{ ...notice, sourceType }] })).toEqual(["고시·조례 자료를 쓴 해설 (REG1-07)"]);
      }
      expect(taxReviewReasons({ ...plain, contentType: "reported_news", sources: [{ ...notice, sourceType }] })).toEqual([]);
    }
    expect(taxReviewReasons({ ...plain, sources: [{ ...notice, sourceType: "budget_settlement" }] })).toEqual([]);
  });

  it("세무 감수 기록이 없으면 nav03.tax-review-required로 막히고, 감수 승인이 있으면 통과", () => {
    const withNotice = { ...plain, sources: [...plain.sources, notice] };
    expect(blockers(withNotice)).not.toContain("nav03.tax-review-required");
    const noTaxReview = { ...withNotice, reviews: withNotice.reviews.filter((r) => r.kind !== "tax_review") };
    const f = run(noTaxReview).blockers.find((x) => x.id === "nav03.tax-review-required");
    expect(f?.message).toContain("고시·조례 자료를 쓴 해설 (REG1-07)");
  });
});

describe("PR-07 사진 — 게시하는 유형만 (권고 기본값: 제1유형·자체 촬영), 제4유형·미표시는 설정으로도 0", () => {
  const image = (licenseType: LicenseType | null) => ({ type: "image" as const, mediaId: `m-${licenseType}`, alt: "시험용 사진", caption: "", rightsStatus: "confirmed" as const, licenseType });

  it("기본값 — 제1유형·해당 없음만 게시, 제2·3유형은 법률 검토 전 0, 제4유형·미표시·유형 없음 0", () => {
    const allowed = LICENSE_TYPES.filter((t) => photoLicenseAllowed(t));
    expect(allowed).toEqual(["kogl_1", "not_applicable"]);
    expect(photoLicenseProblem("kogl_2")).toMatch(/법률 검토 전에는 게시하지 않습니다/);
    expect(photoLicenseProblem("kogl_4")).toMatch(/게시하지 않습니다 — 원문 링크만/);
    expect(photoLicenseProblem(null)).toMatch(/공공누리 유형이 없습니다/);
    for (const t of [...LICENSE_TYPES, null]) {
      const ids = blockers(withExtraBlock(TAX_EXPLAINER, image(t)));
      expect(ids.includes("pr07.photo-license")).toBe(!allowed.includes(t as LicenseType));
    }
  });

  it("설정이 제2유형을 열면 통과, 제4유형·미표시는 설정에 있어도 0", () => {
    const opened = { ...BASE_CONTEXT, kogl: { photoTypes: ["kogl_1", "kogl_2", "kogl_4", "unmarked", "not_applicable"] as LicenseType[], fullTextTypes: [] } };
    expect(blockers(withExtraBlock(TAX_EXPLAINER, image("kogl_2")), opened)).not.toContain("pr07.photo-license");
    expect(blockers(withExtraBlock(TAX_EXPLAINER, image("kogl_4")), opened)).toContain("pr07.photo-license");
    expect(blockers(withExtraBlock(TAX_EXPLAINER, image("unmarked")), opened)).toContain("pr07.photo-license");
  });

  it("대표 사진·동영상 썸네일도 같은 규칙, 위치 leadImage·blocks", () => {
    const r = run({ ...TAX_EXPLAINER, leadImage: { ...TAX_EXPLAINER.leadImage!, licenseType: "kogl_3" } });
    expect(r.blockers.find((f) => f.id === "pr07.photo-license")?.location).toEqual({ field: "leadImage", phrase: TAX_EXPLAINER.leadImage!.mediaId });
  });

  it("권리 미확인 사진은 nav04.image-rights 하나로만 (유형 차단을 겹치지 않는다)", () => {
    const ids = blockers(withExtraBlock(TAX_EXPLAINER, { ...image("kogl_4"), rightsStatus: "unconfirmed" }));
    expect(ids).toContain("nav04.image-rights");
    expect(ids).not.toContain("pr07.photo-license");
  });
});

describe("PR-07 원문 전재 — 유사도 검사기가 같다고 본 본문 문장의 원문 유형", () => {
  const copiedFrom = (sourceId: string): PublishContext => ({ ...BASE_CONTEXT, similarity: { status: "pass", copied: [{ sourceId, sentenceIndex: 3 }, { sourceId, sentenceIndex: 1 }] } });

  it("기본값(모든 유형 전재 0) — 제1~4유형·미표시 원문을 옮기면 차단, 위치 = 첫 문장 · 원문 ID", () => {
    for (const t of ["kogl_1", "kogl_2", "kogl_3", "kogl_4", "unmarked"] as const) {
      const r = run(withSource(q, press.id, { licenseType: t }), copiedFrom(press.id));
      const f = r.blockers.filter((x) => x.id === "pr07.full-text");
      expect(f).toHaveLength(1);
      expect(f[0]!.location).toEqual({ field: "blocks", sentenceIndex: 1, phrase: press.id });
      expect(f[0]!.message).toContain("문장 2개");
      expect(f[0]!.message).toContain(LICENSE_TYPE_LABELS[t]);
    }
  });

  it("해당 없음(자체 자료)·설정이 연 유형은 통과, 제4유형·미표시는 설정에 있어도 차단", () => {
    expect(blockers(withSource(q, press.id, { licenseType: "not_applicable" }), copiedFrom(press.id))).not.toContain("pr07.full-text");
    const opened = { ...copiedFrom(press.id), kogl: { ...KOGL_USAGE_DEFAULT, fullTextTypes: ["kogl_1", "kogl_4"] as LicenseType[] } };
    expect(blockers(withSource(q, press.id, { licenseType: "kogl_1" }), opened)).not.toContain("pr07.full-text");
    expect(blockers(withSource(q, press.id, { licenseType: "kogl_4" }), opened)).toContain("pr07.full-text");
  });

  it("옮긴 문장이 없으면(직접 인용 블록만) 차단 0", () => {
    expect(blockers(withSource(q, press.id, { licenseType: "kogl_4" }), { ...BASE_CONTEXT, similarity: { status: "pass", copied: [] } })).not.toContain("pr07.full-text");
  });
});
