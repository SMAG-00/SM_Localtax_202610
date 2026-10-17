// 점검 항목별 경계 시험 — 통과 견본에서 한 칸씩 바꿔 경계 양쪽을 본다 (OPT-03)
import { describe, expect, it } from "vitest";
import rawRules from "../rules/rules.v1.json";
import { PASSING_SAMPLE, RULES_V1, lintArticle, parseRules } from "./index";
import type { ArticleForLint, LintContext, LintItem, RuleSet } from "./index";

const base = PASSING_SAMPLE.article;
const art = (over: Partial<ArticleForLint>): ArticleForLint => ({ ...base, ...over });
const lint = (a: ArticleForLint, ctx: LintContext = PASSING_SAMPLE.context, rules: RuleSet = RULES_V1) => lintArticle(a, ctx, rules);
const item = (a: ArticleForLint, id: string, ctx?: LintContext): LintItem => lint(a, ctx).items.find((i) => i.id === id)!;
const withDates = (data: Partial<ArticleForLint["dates"]["data"]>, displayed: Partial<ArticleForLint["dates"]["displayed"]>) =>
  art({ dates: { data: { ...base.dates.data, ...data }, displayed: { ...base.dates.displayed, ...displayed } } });

describe("법령 기준일 — 지방세 분야·세무 감수 대상·「지방세로 읽기」가 있는 기사에서만 필수", () => {
  const nonTarget = { section: "realestate", taxReviewTarget: false, hasTaxLens: false } as const;

  it.each([
    ["지방세 분야", { section: "tax", taxReviewTarget: false, hasTaxLens: false }],
    ["세무 감수 대상", { section: "realestate", taxReviewTarget: true, hasTaxLens: false }],
    ["「지방세로 읽기」가 있는", { section: "local", taxReviewTarget: false, hasTaxLens: true }],
  ] as const)("%s 기사는 기준일이 없으면 차단되고 사유가 문구에 나온다", (reason, flags) => {
    const result = lint(art({ ...flags, lawBasisDate: null }));
    expect(result.blockers).toEqual(["geo.law-basis-date"]);
    expect(result.items.find((i) => i.id === "geo.law-basis-date")!.message).toBe(`법령 기준일이 없습니다 — ${reason} 기사는 필수입니다`);
  });

  it("대상이 아닌 기사(부동산 분야·감수 비대상·박스 없음)는 기준일이 없어도 막지 않고 '해당 없음'으로 둔다", () => {
    const result = lint(art({ ...nonTarget, lawBasisDate: null }));
    expect(result.blockers).toEqual([]);
    expect(result.canPublish).toBe(true);
    expect(result.items.find((i) => i.id === "geo.law-basis-date")).toMatchObject({
      level: "pass",
      applicable: false,
      message: "법령 기준일 필수 대상이 아닙니다 (선택)",
    });
  });

  it("사유가 여럿이면 모두 적는다", () => {
    expect(item(art({ section: "tax", taxReviewTarget: true, hasTaxLens: true, lawBasisDate: null }), "geo.law-basis-date").message).toBe(
      "법령 기준일이 없습니다 — 지방세 분야 · 세무 감수 대상 · 「지방세로 읽기」가 있는 기사는 필수입니다",
    );
  });

  it.each(["2026-02-30", "2026/10/01", "2026-10-1", ""])("대상 기사의 기준일이 날짜가 아니면(%s) 없는 것으로 보고 차단한다", (value) => {
    expect(item(art({ lawBasisDate: value }), "geo.law-basis-date").level).toBe("block");
  });

  it("대상 기사에 올바른 기준일이 있으면 통과하고 기준일을 보여 준다", () => {
    expect(item(art({ lawBasisDate: "2026-10-01" }), "geo.law-basis-date")).toMatchObject({ level: "pass", applicable: true, message: "법령 기준일 2026-10-01" });
  });
});

describe("발행/수정일 — 기록 값과 화면 표시 값", () => {
  const datesItem = (a: ArticleForLint) => item(a, "geo.dates");

  it("같은 순간을 다른 시간대로 적으면 같은 값으로 본다 (14:30+09:00 = 05:30Z)", () => {
    expect(datesItem(withDates({}, { updatedAt: "2026-10-20T05:30:00Z" })).level).toBe("pass");
    expect(datesItem(withDates({}, { updatedAt: "2026-10-20T14:30:00.000+09:00" })).level).toBe("pass");
  });

  it("1분이라도 다르면 차단하고 어느 날짜인지 적는다", () => {
    expect(datesItem(withDates({}, { updatedAt: "2026-10-20T14:31:00+09:00" }))).toMatchObject({
      level: "block",
      message: "수정일: 기록 값과 화면 표시 값이 다릅니다",
    });
    expect(datesItem(withDates({}, { publishedAt: "2026-10-15T08:59:00+09:00" })).message).toBe("발행일: 기록 값과 화면 표시 값이 다릅니다");
    expect(datesItem(withDates({}, { publishedAt: "2026-10-15T09:01:00+09:00", updatedAt: "2026-10-20T14:29:00+09:00" })).message).toBe(
      "발행일, 수정일: 기록 값과 화면 표시 값이 다릅니다",
    );
  });

  it("화면에 날짜만 보이면 한국 시각 날짜로 비교한다 — 23:59 KST는 같은 날, 00:00 KST는 다음 날", () => {
    expect(datesItem(withDates({ publishedAt: "2026-10-15T23:59:00+09:00" }, { publishedAt: "2026-10-15" })).level).toBe("pass");
    expect(datesItem(withDates({ publishedAt: "2026-10-15T15:00:00Z" }, { publishedAt: "2026-10-15" })).level).toBe("block");
    expect(datesItem(withDates({ publishedAt: "2026-10-15T14:59:00Z" }, { publishedAt: "2026-10-15" })).level).toBe("pass");
  });

  it("실질 수정이 없으면(양쪽 null) 통과, 한쪽에만 수정일이 있으면 차단", () => {
    expect(datesItem(withDates({ updatedAt: null }, { updatedAt: null })).level).toBe("pass");
    expect(datesItem(withDates({ updatedAt: null }, {})).message).toBe("수정일: 기록 값과 화면 표시 값이 다릅니다");
    expect(datesItem(withDates({}, { updatedAt: null })).message).toBe("수정일: 기록 값과 화면 표시 값이 다릅니다");
  });

  it("수정일이 발행일보다 앞서면 화면과 같아도 차단한다 (날짜 조작 금지 OPT-10). 같은 순간은 통과", () => {
    const before = "2026-10-15T08:59:00+09:00";
    expect(datesItem(withDates({ updatedAt: before }, { updatedAt: before })).message).toBe("수정일이 발행일보다 앞섭니다");
    const same = "2026-10-15T09:00:00+09:00";
    expect(datesItem(withDates({ updatedAt: same }, { updatedAt: same })).level).toBe("pass");
  });

  it.each([
    ["발행일 null", { publishedAt: null }, {}, "발행일"],
    ["시간대 없는 시각(실행 환경마다 해석이 달라짐)", { publishedAt: "2026-10-15T09:00:00" }, {}, "발행일"],
    ["없는 날짜", { publishedAt: "2026-02-30T09:00:00+09:00" }, {}, "발행일"],
    ["기록 값이 날짜만", { updatedAt: "2026-10-20" }, {}, "수정일"],
    ["화면 값이 날짜가 아님", {}, { publishedAt: "10월 15일" }, "발행일"],
  ] as const)("%s → 형식 오류로 차단", (_label, data, displayed, field) => {
    expect(datesItem(withDates(data, displayed))).toMatchObject({
      level: "block",
      message: `${field} 값이 없거나 형식이 올바르지 않습니다 (시간대가 붙은 ISO 8601)`,
    });
  });
});

describe("canonical·중복", () => {
  const canon = (a: ArticleForLint, ctx?: LintContext) => item(a, "seo.canonical", ctx);

  it.each([null, "", "/news/first-home-acquisition-tax-relief", "localtaxresearch.com/news/x", "ftp://localtaxresearch.com/news/x"])(
    "canonical이 없거나 절대 http(s) 주소가 아니면(%s) 차단",
    (value) => {
      expect(canon(art({ canonical: value }))).toMatchObject({ level: "block", message: "canonical 주소가 없거나 절대 주소(https://…)가 아닙니다" });
    },
  );

  it("호스트 대소문자·끝 슬래시·#조각·http/https만 다른 주소도 같은 canonical로 보고 차단한다", () => {
    for (const value of [
      "https://LocalTaxResearch.com/news/acquisition-tax-rate-table/",
      "https://localtaxresearch.com/news/acquisition-tax-rate-table#faq",
      "http://localtaxresearch.com/news/acquisition-tax-rate-table",
    ]) {
      expect(canon(art({ canonical: value }))).toMatchObject({ level: "block", message: "canonical 주소가 다른 공개 기사(article-sample-0002)와 같습니다" });
    }
  });

  it("경로가 한 글자라도 다르면 중복이 아니다", () => {
    expect(canon(art({ canonical: "https://localtaxresearch.com/news/acquisition-tax-rate-table-2" })).level).toBe("pass");
  });

  it("문맥에 같은 id(자기 자신의 이전 공개본)가 있으면 중복으로 세지 않는다", () => {
    const ctx: LintContext = { publishedArticles: [...PASSING_SAMPLE.context.publishedArticles, { id: base.id, canonical: base.canonical!, title: base.title }] };
    const result = lint(base, ctx);
    expect(result.items.find((i) => i.id === "seo.canonical")!.level).toBe("pass");
    expect(result.items.find((i) => i.id === "seo.unique-title")!.level).toBe("pass");
  });
});

describe("핵심 주장마다 근거", () => {
  const claimItem = (a: ArticleForLint) => item(a, "geo.claim-evidence");

  it("근거 ID가 출처·취재 근거 어디에도 없으면 근거 없는 주장으로 센다", () => {
    expect(claimItem(art({ claims: [{ ...base.claims[0]!, evidenceIds: ["src-deleted"] }] })).message).toBe("핵심 주장 1개에 근거 없음 — 근거를 이어 주세요");
  });

  it("비공개 취재 근거(article_evidence)만 이어도 근거로 친다", () => {
    expect(claimItem(art({ claims: [{ ...base.claims[0]!, evidenceIds: ["ev-interview-1"] }] })).level).toBe("pass");
  });

  it("근거 없는 주장 2개 — 패널 견본 문구 '핵심 주장 2개에 근거 없음'", () => {
    const claims = base.claims.map((c) => ({ ...c, evidenceIds: [] }));
    expect(claimItem(art({ claims }))).toMatchObject({ level: "block", message: "핵심 주장 2개에 근거 없음 — 근거를 이어 주세요" });
  });

  it("핵심 주장을 표시하지 않은 원고는 이 항목에서 막지 않는다", () => {
    expect(claimItem(art({ claims: [] })).level).toBe("pass");
  });
});

describe("저자", () => {
  it.each([
    ["이름이 공백", [{ peopleId: "people-sample-reporter-01", name: "  " }]],
    ["인물 ID가 없음", [{ peopleId: "", name: "견본 기자" }]],
  ] as const)("%s이면 저자 없음으로 차단", (_label, authors) => {
    expect(item(art({ authors }), "geo.author").level).toBe("block");
  });

  it("저자 2명이면 통과하고 인원을 적는다", () => {
    const authors = [...base.authors, { peopleId: "people-sample-reporter-02", name: "견본 기자 둘" }];
    expect(item(art({ authors }), "geo.author")).toMatchObject({ level: "pass", message: "저자 2명" });
  });
});

describe("유사도 — packages/similarity 결과를 입력으로 받는다", () => {
  it("비교 대상 없음(no_sources)은 통과가 아니라 경고로 남고 발행은 막지 않는다", () => {
    const result = lint(art({ similarity: { status: "no_sources" } }));
    expect(result.items.find((i) => i.id === "common.similarity")).toMatchObject({
      level: "warn",
      message: "비교 대상 없음 — 유사도를 통과로 표시하지 않습니다 (발행 기록에 남음)",
    });
    expect(result.warnings).toContain("common.similarity");
    expect(result.blockers).toEqual([]);
    expect(result.canPublish).toBe(true);
  });

  it("판정할 본문이 없음(no_body)도 통과가 아니라 경고 — 발행 기록에 남는다", () => {
    const result = lint(art({ similarity: { status: "no_body" } }));
    expect(result.items.find((i) => i.id === "common.similarity")?.level).toBe("warn");
    expect(result.warnings).toContain("common.similarity");
  });

  it("규칙 파일의 unverifiedLevel을 block으로 바꾸면 비교 대상 없음도 차단한다 (코드 변경 없이)", () => {
    const raw = JSON.parse(JSON.stringify(rawRules));
    raw.rules.find((r: { id: string }) => r.id === "common.similarity").unverifiedLevel = "block";
    const result = lint(art({ similarity: { status: "no_sources" } }), PASSING_SAMPLE.context, parseRules(raw));
    expect(result.blockers).toEqual(["common.similarity"]);
  });
});

describe("구조화 데이터와 화면 일치 — packages/structured-data 결과를 입력으로 받는다", () => {
  it("다른 칸 이름을 정렬·중복 제거해 적고, 입력 순서가 달라도 같은 문구다", () => {
    const a = item(art({ structuredDataMismatches: ["headline", "dateModified", "headline"] }), "common.structured-data");
    const b = item(art({ structuredDataMismatches: ["dateModified", "headline"] }), "common.structured-data");
    expect(a).toMatchObject({ level: "block", message: "구조화 데이터와 화면 값이 다릅니다 — dateModified, headline" });
    expect(b).toEqual(a);
  });
});

describe("광고 표기 일치 — 배지 '공동 기획 ○○'(ART-10)·'광고'(PRD-00 8.8), 메타·headline은 [배지]", () => {
  const ad = (sponsorship: ArticleForLint["sponsorship"], over: Partial<ArticleForLint> = {}) =>
    item(art({ sponsorship, ...over }), "common.sponsor-label");
  const marked = (marker: string) => ({ metaTitle: `${marker} ${base.metaTitle}`, metaDescription: `${marker} ${base.metaDescription}` });
  const coPlanned = (partnerName: string | null, over: Partial<ArticleForLint["sponsorship"]> = {}): ArticleForLint["sponsorship"] => ({
    label: "공동 기획",
    partnerName,
    pageBadge: partnerName ? `공동 기획 ${partnerName}` : "공동 기획",
    structuredHeadline: `[공동 기획${partnerName ? ` ${partnerName}` : ""}] ${base.title}`,
    ...over,
  });

  it("광고 기사가 배지·메타 제목·메타 설명·headline에 같은 '[광고]' 표기를 하면 통과", () => {
    expect(ad({ label: "광고", partnerName: null, pageBadge: "광고", structuredHeadline: `[광고] ${base.title}` }, marked("[광고]")).level).toBe("pass");
  });

  it("공동 기획 기사는 배지 '공동 기획 ○○'와 메타·headline의 '[공동 기획 ○○]'가 같으면 통과", () => {
    expect(ad(coPlanned("가온세무법인"), marked("[공동 기획 가온세무법인]")).level).toBe("pass");
  });

  it("공동 기획인데 제휴사 이름 없이 '[공동 기획]'만 쓰면 차단 — 배지를 만들 수 없다", () => {
    expect(ad(coPlanned(null), marked("[공동 기획]"))).toMatchObject({ level: "block", message: "공동 기획 배지에 제휴사 이름이 없습니다 — 배지는 ‘공동 기획 ○○’입니다" });
    expect(ad(coPlanned("  "), marked("[공동 기획]")).level).toBe("block");
  });

  it("다른 제휴사 이름·이름 빠진 표기는 빠진 것으로 본다", () => {
    expect(ad(coPlanned("가온세무법인"), marked("[공동 기획]"))).toMatchObject({
      level: "block",
      message: "「공동 기획 가온세무법인」 표기가 빠졌습니다 — 메타 제목, 메타 설명",
    });
    expect(ad(coPlanned("가온세무법인", { pageBadge: "공동 기획 누리일보" }), marked("[공동 기획 가온세무법인]")).message).toBe(
      "「공동 기획 가온세무법인」 표기가 빠졌습니다 — 화면 제휴 배지",
    );
  });

  it("표기가 빠진 곳을 모두 적는다 — 배지 글자가 표기와 다른 것도 빠진 것으로 본다", () => {
    expect(ad({ label: "공동 기획", partnerName: "가온세무법인", pageBadge: "광고", structuredHeadline: base.title })).toMatchObject({
      level: "block",
      message: "「공동 기획 가온세무법인」 표기가 빠졌습니다 — 화면 제휴 배지, 메타 제목, 메타 설명, 구조화 데이터 headline",
    });
  });

  it("공동 기획과 광고를 섞으면 차단 — 표기는 하나만 (PRD-00 8.8)", () => {
    expect(ad(coPlanned("가온세무법인", { structuredHeadline: `[광고] [공동 기획 가온세무법인] ${base.title}` }), marked("[공동 기획 가온세무법인]"))).toMatchObject({
      level: "block",
      message: "공동 기획과 광고 표기를 함께 썼습니다 — 구조화 데이터 headline",
    });
    expect(
      ad({ label: "광고", partnerName: null, pageBadge: "광고", structuredHeadline: `[광고] ${base.title}` }, {
        metaTitle: `[광고] ${base.metaTitle}`,
        metaDescription: `[광고] [공동 기획 가온세무법인] ${base.metaDescription}`,
      }).message,
    ).toBe("공동 기획과 광고 표기를 함께 썼습니다 — 메타 설명");
  });

  it("광고 표기가 없는 기사에 제휴 배지나 [광고]·[공동 기획 ○○] 표기가 있으면 차단", () => {
    const none = { label: "없음" as const, partnerName: null, pageBadge: null, structuredHeadline: base.title };
    expect(ad({ ...none, pageBadge: "광고" }).message).toBe("광고 표기가 없는 기사인데 표기가 있습니다 — 화면 제휴 배지");
    expect(ad(none, { metaTitle: `[광고] ${base.metaTitle}` }).message).toBe("광고 표기가 없는 기사인데 표기가 있습니다 — 메타 제목");
    expect(ad(none, { metaDescription: `[공동 기획 가온세무법인] ${base.metaDescription}` }).message).toBe("광고 표기가 없는 기사인데 표기가 있습니다 — 메타 설명");
    expect(ad({ ...none, structuredHeadline: `[공동 기획] ${base.title}` }).message).toBe("광고 표기가 없는 기사인데 표기가 있습니다 — 구조화 데이터 headline");
  });

  it("제목에 '광고'·'공동 기획'이라는 낱말이 있어도 표기 형식([…])이 아니면 표기로 보지 않는다", () => {
    expect(ad({ label: "없음", partnerName: null, pageBadge: null, structuredHeadline: "옥외광고물 등록면허세 정리" }, { metaTitle: "옥외광고물 등록면허세 정리" }).level).toBe("pass");
    expect(ad({ label: "없음", partnerName: null, pageBadge: null, structuredHeadline: "지자체 공동 기획 사업의 세금" }, { metaTitle: "지자체 공동 기획 사업의 세금" }).level).toBe("pass");
  });
});

describe("경고 항목 경계 — 발행은 막지 않는다", () => {
  it("내부 링크: 2개는 통과, 1개·0개는 경고", () => {
    expect(item(art({ internalLinkCount: 2 }), "seo.internal-links")).toMatchObject({ level: "pass", message: "내부 링크 2개" });
    expect(item(art({ internalLinkCount: 1 }), "seo.internal-links").level).toBe("warn");
    expect(item(art({ internalLinkCount: 0 }), "seo.internal-links").message).toBe("내부 링크 0개 (권장 2개 이상)");
  });

  it("FAQ: 1개·6개는 경고, 2개·5개는 통과, 답이 빈 항목은 세지 않는다", () => {
    const faq = (n: number) => Array.from({ length: n }, (_, i) => ({ question: `질문 ${i + 1}?`, answer: `답 ${i + 1}` }));
    expect(item(art({ faqs: faq(1) }), "aeo.faq")).toMatchObject({ level: "warn", message: "화면에 보이는 FAQ 1개 (권장 2~5개)" });
    expect(item(art({ faqs: faq(2) }), "aeo.faq").level).toBe("pass");
    expect(item(art({ faqs: faq(5) }), "aeo.faq").level).toBe("pass");
    expect(item(art({ faqs: faq(6) }), "aeo.faq").level).toBe("warn");
    expect(item(art({ faqs: [...faq(1), { question: "빈 답?", answer: " " }] }), "aeo.faq").level).toBe("warn");
  });

  it("3줄 요약: 3줄 통과, 4줄 경고, 없거나 빈 줄뿐이면 경고", () => {
    const lines = ["첫째 줄", "둘째 줄", "셋째 줄", "넷째 줄"];
    expect(item(art({ summaryBoxLines: lines.slice(0, 3) }), "aeo.summary-box").level).toBe("pass");
    expect(item(art({ summaryBoxLines: lines }), "aeo.summary-box").message).toBe("핵심 요약 상자가 4줄입니다 (최대 3줄)");
    expect(item(art({ summaryBoxLines: [] }), "aeo.summary-box").message).toBe("핵심 요약 상자가 없습니다");
    expect(item(art({ summaryBoxLines: ["", "  "] }), "aeo.summary-box").message).toBe("핵심 요약 상자가 없습니다");
  });

  it("질문형 소제목: 물음표(전각 포함)로 끝나는 소제목이 있으면 통과", () => {
    const headings = (text: string) => [...base.headings, { level: 2, text }];
    expect(item(art({ headings: headings("감면은 언제 신청하나요?") }), "aeo.question-heading")).toMatchObject({ level: "pass", message: "질문형 소제목 1개" });
    expect(item(art({ headings: headings("추징은 언제 되나요？") }), "aeo.question-heading").level).toBe("pass");
  });

  it("이미지 대체 텍스트: 빈 대체 텍스트 수를 세고, 이미지가 없으면 통과", () => {
    expect(item(art({ images: [...base.images, { alt: " " }] }), "seo.image-alt").message).toBe("대체 텍스트 없는 이미지 1개");
    expect(item(art({ images: [] }), "seo.image-alt").level).toBe("pass");
  });

  it("공식 출처: 보도자료·인터뷰만 있으면 경고, 통계(dataset)는 공식 출처로 친다", () => {
    expect(item(art({ sources: [{ id: "s1", kind: "press_release", title: "구청 보도자료" }] }), "seo.official-source").level).toBe("warn");
    expect(item(art({ sources: [{ id: "s1", kind: "dataset", title: "지방세 통계연감" }] }), "seo.official-source")).toMatchObject({ level: "pass", message: "공식 출처 1건" });
  });

  it("고유 제목·메타 설명: 공백만 다른 같은 제목, 빈 메타 설명은 경고", () => {
    expect(item(art({ title: "  주택 취득세율   한눈에 보기 " }), "seo.unique-title").message).toBe("다른 공개 기사(article-sample-0002)와 제목이 같습니다");
    expect(item(art({ metaDescription: "  " }), "seo.meta-description").level).toBe("warn");
  });

  it("경고 8개가 모두 걸려도 차단 항목이 없으면 발행할 수 있다", () => {
    const result = lint(
      art({
        title: "주택 취득세율 한눈에 보기",
        metaDescription: "",
        internalLinkCount: 0,
        sources: [{ id: "src-law", kind: "press_release", title: "보도자료" }],
        images: [{ alt: "" }],
        summaryBoxLines: [],
        faqs: [],
      }),
    );
    expect(result.warnings).toHaveLength(8);
    expect(result.blockers).toEqual([]);
    expect(result.canPublish).toBe(true);
  });
});

describe("문구 자리 채움", () => {
  it("모든 결과 문구에 채우지 못한 {자리}가 남지 않는다", () => {
    const variants = [
      base,
      art({ canonical: null, lawBasisDate: null, authors: [], claims: base.claims.map((c) => ({ ...c, evidenceIds: [] })) }),
      art({ structuredDataMismatches: ["headline"], similarity: { status: "no_sources" }, sponsorship: { label: "광고", partnerName: null, pageBadge: null, structuredHeadline: base.title } }),
      withDates({ publishedAt: null }, {}),
      art({ section: "finance", taxReviewTarget: false, hasTaxLens: false, lawBasisDate: null, summaryBoxLines: ["1", "2", "3", "4"] }),
    ];
    const messages = variants.flatMap((v) => lint(v).items.map((i) => i.message));
    expect(messages).toHaveLength(variants.length * RULES_V1.rules.length);
    for (const m of messages) expect(m).not.toMatch(/\{[A-Za-z.]+\}/);
  });
});
