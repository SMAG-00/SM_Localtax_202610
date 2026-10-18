// DB 기사 한 판 → 발행 판정 — 매핑(mapping.ts)과 판정 묶음(gate.ts) 시험. 견본은 test-graph.ts (발행 통과 상태)에서 한 곳만 바꾼다.
import { describe, expect, test } from "vitest";
import { sponsorBadge } from "@ltr/editorial";
import { sponsorLabelText } from "@ltr/structured-data";
import { runGate, kstDate, parseGateSettings, saveChecks } from "./gate";
import { renderedFacts, similarityDraft, similaritySources, toArticleForPublish, toArticleView, toLintArticle } from "./mapping";
import { AUTHOR_PERSON, EDITOR_PERSON, GATE_OPTIONS, SETTINGS, articleRow, graph, mediaRow } from "./test-graph";

const failedOf = (g: ReturnType<typeof graph>) => runGate(g, SETTINGS, GATE_OPTIONS).failed;

describe("발행 판정 통과 견본", () => {
  test("정량형 보도기사 견본은 차단 0", () => {
    const result = runGate(graph(), SETTINGS, GATE_OPTIONS);
    expect(result.failed).toEqual([]);
    expect(result.canPublish).toBe(true);
    expect(result.lint.blockers).toEqual([]);
    expect(result.structuredDataMismatches).toEqual([]);
  });
  test("비교 원문이 없으면 유사도는 '비교 대상 없음' 경고로 남는다 (통과로 표시하지 않음)", () => {
    const result = runGate(graph(), SETTINGS, GATE_OPTIONS);
    expect(result.similarity.status).toBe("no_sources");
    expect(result.warnings).toContain("opt06.similarity-unverified");
    expect(result.warnings).toContain("common.similarity");
  });
});

describe("NAV-10 정량형 묶음 — DB 칸 하나만 비워도 그 묶음 ID로 차단", () => {
  const cases: [string, Partial<ReturnType<typeof graph>["datasets"][number]>, string][] = [
    ["분모", { denominator: null }, "nav10.indicator-definition"],
    ["재현 파일 해시", { repro_file_hash: "  " }, "nav10.calculation"],
    ["이용권리", { license: null }, "nav10.source-data"],
  ];
  for (const [name, change, id] of cases) {
    test(`${name}이 비면 ${id}`, () => {
      const base = graph();
      const failed = failedOf({ ...base, datasets: [{ ...base.datasets[0]!, ...change }] });
      expect(failed).toContain(id);
    });
  }
  test("관계자 확인 기록이 비면 nav10.related-party-check", () => {
    const failed = failedOf(graph({}, { check_log: { checklists: { quantitative: { sourceCrossCheck: "대조함", limitations: "한계", relatedPartyCheck: "" } } } }));
    expect(failed).toEqual(["nav10.related-party-check"]);
  });
  test("'인과 단정 없음'은 현재 버전의 독립 편집 승인 checklist에서만 읽는다", () => {
    const base = graph();
    const noCheck = { ...base.reviews[0]!, checklist: {} };
    expect(failedOf({ ...base, reviews: [noCheck] })).toEqual(["nav10.no-causal-claim"]);
    // 확인 목록(check_log)에 기자가 적어 넣어도 세지 않는다
    const forged = graph({ reviews: [noCheck] }, {
      check_log: { checklists: { quantitative: { sourceCrossCheck: "대조함", limitations: "한계", relatedPartyCheck: "확인", noCausalClaim: true } } },
    });
    expect(failedOf(forged)).toContain("nav10.no-causal-claim");
  });
});

describe("편집 승인 — 버전과 사람 (NAV-03 · NAV-12)", () => {
  test("이전 버전의 승인은 세지 않는다", () => {
    const base = graph();
    const failed = failedOf({ ...base, reviews: [{ ...base.reviews[0]!, version: 2 }] });
    expect(failed).toContain("nav03.desk-edit-required");
    expect(failed).toContain("nav10.no-causal-claim");
  });
  test("작성자 본인의 승인 기록은 승인이 아니고 차단 항목으로 남는다", () => {
    const base = graph();
    const failed = failedOf({ ...base, reviews: [{ ...base.reviews[0]!, reviewer_id: AUTHOR_PERSON }] });
    expect(failed).toEqual(expect.arrayContaining(["nav12.self-desk-edit", "nav03.desk-edit-required"]));
  });
  test("세법 해설은 편집 승인만으로 발행되지 않는다 — 세무 감수 승인을 더하면 통과", () => {
    const explainer = graph(
      { category: { id: 1, section: "tax", slug: "interpretations", name: "해석", needs_disclaimer: true, needs_tax_lens: false }, datasets: [], evidence: [] },
      { section: "tax", content_type: "explainer", reporting_method: null, legal_basis_date: "2026-10-01", tax_lens: null, check_log: null, body: { blocks: [{ type: "paragraph", text: "취득세는 60일 안에 신고한다." }], claims: [] } },
    );
    expect(failedOf(explainer)).toEqual(["nav03.tax-review-required"]);
    const tax = { id: 2, article_id: 101, version: 3, kind: "tax_review", reviewer_id: 33, decision: "approve", checklist: {}, reason: null, at: "2026-10-12T08:00:00+00:00" };
    expect(failedOf({ ...explainer, reviews: [...explainer.reviews, tax] })).toEqual([]);
  });
});

describe("출처·이미지 권리 (NAV-02 · NAV-04)", () => {
  test("출처가 보도자료뿐이면 nav02.press-release-only", () => {
    const base = graph();
    const failed = failedOf({ ...base, sources: [{ ...base.sources[0]!, kind: "press_release" }] });
    expect(failed).toContain("nav02.press-release-only");
  });
  test("이미지 블록의 권리는 본문에 적힌 값이 아니라 media 표에서 읽는다", () => {
    const body = articleRow().body as { blocks: unknown[]; claims: unknown[] };
    const withImage = { ...body, blocks: [...body.blocks, { type: "image", mediaId: "9", alt: "민원 창구", caption: "", rightsStatus: "confirmed" }] };
    const unconfirmed = graph({ media: [mediaRow({ id: 9, alt: "민원 창구", rights_status: "unconfirmed" })] }, { body: withImage });
    expect(failedOf(unconfirmed)).toContain("nav04.image-rights");
    const confirmed = graph({ media: [mediaRow({ id: 9, alt: "민원 창구", rights_status: "confirmed" })] }, { body: withImage });
    expect(failedOf(confirmed)).not.toContain("nav04.image-rights");
    const missingRow = graph({}, { body: withImage });
    expect(failedOf(missingRow)).toContain("nav04.image-rights");
  });
  test("핵심 주장의 근거가 이 기사의 출처·근거가 아니면 seo-lint 차단(geo.claim-evidence)", () => {
    const body = articleRow().body as { blocks: unknown[]; claims: { evidenceIds: string[] }[] };
    const failed = failedOf(graph({}, { body: { ...body, claims: [{ ...body.claims[0]!, evidenceIds: ["ev:999"] }] } }));
    expect(failed).toContain("geo.claim-evidence");
  });
});

describe("최적화 점검 입력 (seo-lint)", () => {
  test("사이트 주소가 없으면 canonical이 없어 발행이 막힌다 (OPT-11)", () => {
    const result = runGate(graph(), SETTINGS, { ...GATE_OPTIONS, siteUrl: undefined });
    expect(result.failed).toContain("seo.canonical");
  });
  test("작성자가 없으면 geo.author와 nav03.author-required", () => {
    const failed = failedOf(graph({ author: null }, { author_id: null }));
    expect(failed).toEqual(expect.arrayContaining(["geo.author", "nav03.author-required"]));
  });
  test("지방세 분야는 법령 기준일이 없으면 geo.law-basis-date", () => {
    const failed = failedOf(graph({ category: null }, { section: "tax", category_id: null, tax_lens: null }));
    expect(failed).toContain("geo.law-basis-date");
  });
  test("발행 전 기사는 판정 시각을 발행일로 보고, 화면·구조화 데이터·기록 값이 같다", () => {
    const g = graph();
    const view = toArticleView(g, GATE_OPTIONS);
    expect(view.datePublished).toBe(GATE_OPTIONS.now);
    const lint = toLintArticle(g, toArticleForPublish(g), view, GATE_OPTIONS, { similarityStatus: "pass", structuredDataMismatches: [], structuredHeadline: view.title });
    expect(lint.dates.data.publishedAt).toBe(GATE_OPTIONS.now);
    expect(lint.canonical).toBe("https://e2e.example.test/news/gaon-acquisition-tax-2026h1");
    expect(renderedFacts(view)).toEqual({ title: view.title, authorNames: ["견본 기자"], datePublished: GATE_OPTIONS.now });
  });
  test("광고 기사는 화면 제목·메타·JSON-LD에 같은 표기", () => {
    const g = graph({}, { label: "ad", content_type: "sponsored", reporting_method: null });
    const view = toArticleView(g, GATE_OPTIONS);
    const lint = toLintArticle(g, toArticleForPublish(g), view, GATE_OPTIONS, { similarityStatus: "pass", structuredDataMismatches: [], structuredHeadline: "[광고] 가온시 상반기 취득세 18.4% 감소" });
    expect(lint.metaTitle).toBe("[광고] 가온시 상반기 취득세 18.4% 감소");
    expect(lint.metaDescription.startsWith("[광고] ")).toBe(true);
    expect(lint.sponsorship).toEqual({ label: "광고", partnerName: null, pageBadge: "광고", structuredHeadline: "[광고] 가온시 상반기 취득세 18.4% 감소" });
    expect(runGate(g, SETTINGS, GATE_OPTIONS).lint.blockers).not.toContain("common.sponsor-label");
  });
});

describe("공동 기획 표기 — 발행 판정·구조화 데이터·seo-lint가 같은 PRD 글자 '공동 기획 ○○'를 쓴다 (ART-10 · PRD-00 8.8)", () => {
  const partner = { id: 9, name: "가온세무법인", contract_from: "2026-01-01", contract_to: "2026-12-31" };
  const coPlanned = (name: string) =>
    graph({ partner: { ...partner, name } }, { label: "co_planned", partner_id: 9, content_type: "sponsored", reporting_method: null });
  const TITLE = "가온시 상반기 취득세 18.4% 감소";

  test("배지 글자 — editorial sponsorBadge = structured-data sponsorLabelText = seo-lint 화면 배지, 제목은 '[공동 기획 가온세무법인] 제목'", () => {
    const g = coPlanned("가온세무법인");
    const view = toArticleView(g, GATE_OPTIONS);
    expect(view.sponsorship).toEqual({ kind: "공동 기획", partnerName: "가온세무법인" });
    expect(sponsorLabelText(view.sponsorship!)).toBe("공동 기획 가온세무법인");
    expect(sponsorBadge("co_planned", "가온세무법인")).toBe(sponsorLabelText(view.sponsorship!));
    const result = runGate(g, SETTINGS, GATE_OPTIONS);
    expect(renderedFacts(view).title).toBe(`[공동 기획 가온세무법인] ${TITLE}`);
    const lint = toLintArticle(g, toArticleForPublish(g), view, GATE_OPTIONS, { similarityStatus: "pass", structuredDataMismatches: [], structuredHeadline: `[공동 기획 가온세무법인] ${TITLE}` });
    expect(lint.sponsorship).toEqual({ label: "공동 기획", partnerName: "가온세무법인", pageBadge: "공동 기획 가온세무법인", structuredHeadline: `[공동 기획 가온세무법인] ${TITLE}` });
    expect(lint.metaTitle).toBe(`[공동 기획 가온세무법인] ${TITLE}`);
    expect(lint.metaDescription.startsWith("[공동 기획 가온세무법인] ")).toBe(true);
    expect(result.lint.blockers).not.toContain("common.sponsor-label");
    expect(result.structuredDataMismatches).toEqual([]);
    expect(result.failed.filter((id) => id.startsWith("art10.") || id === "common.sponsor-label")).toEqual([]);
  });

  test("제휴사 이름이 비면 발행 판정과 seo-lint 둘 다 막는다 (배지를 만들 수 없음)", () => {
    const result = runGate(coPlanned("  "), SETTINGS, GATE_OPTIONS);
    expect(result.failed).toEqual(expect.arrayContaining(["art10.co-planned-partner-required", "common.sponsor-label"]));
    expect(result.lint.items.find((i) => i.id === "common.sponsor-label")!.message).toBe("공동 기획 배지에 제휴사 이름이 없습니다 — 배지는 ‘공동 기획 ○○’입니다");
  });

  test("광고 기사는 제휴사가 있어도 '광고'만 — 공동 기획과 섞지 않는다", () => {
    const g = graph({ partner }, { label: "ad", partner_id: 9, content_type: "sponsored", reporting_method: null });
    const view = toArticleView(g, GATE_OPTIONS);
    expect(view.sponsorship).toEqual({ kind: "광고" });
    const result = runGate(g, SETTINGS, GATE_OPTIONS);
    expect(result.lint.blockers).not.toContain("common.sponsor-label");
    expect(renderedFacts(view).title).toBe(`[광고] ${TITLE}`);
  });
});

describe("유사도 입력 (OPT-06)", () => {
  const PRESS = "가온시는 상반기 취득세 징수액이 1,284억 원으로 집계됐다고 밝혔다. 시는 거래 감소가 원인이라고 설명했다.";
  test("보도자료 출처의 스냅샷은 press_release, 다른 출처의 스냅샷은 raw_snapshot 비교 원문", () => {
    const base = graph();
    const g = {
      ...base,
      sources: [
        { ...base.sources[0]!, snapshot_id: 50 },
        { ...base.sources[0]!, id: 4, kind: "press_release", snapshot_id: 51 },
      ],
      snapshots: [
        { id: 50, payload: "원자료 설명 문장입니다." },
        { id: 51, payload: PRESS },
      ],
    };
    expect(similaritySources(g)).toEqual([
      { id: "src:3", kind: "raw_snapshot", text: "원자료 설명 문장입니다." },
      { id: "src:4", kind: "press_release", text: PRESS },
    ]);
  });
  test("보도자료 문장을 그대로 옮긴 원고는 유사도 차단", () => {
    const base = graph();
    const copied = graph(
      { sources: [base.sources[0]!, { ...base.sources[0]!, id: 4, kind: "press_release", snapshot_id: 51 }], snapshots: [{ id: 51, payload: PRESS }] },
      { summary: null, body: { blocks: [{ type: "paragraph", text: PRESS }], claims: [] } },
    );
    const result = runGate(copied, SETTINGS, GATE_OPTIONS);
    expect(result.similarity.status).toBe("blocked");
    expect(result.failed).toEqual(expect.arrayContaining(["opt06.similarity-blocked", "common.similarity"]));
  });
  test("원고 글 — 요약, 본문 문단·요약 상자, 인용은 '>' 줄", () => {
    const g = graph({}, { body: { blocks: [{ type: "paragraph", text: "문단이다." }, { type: "quote", text: "인용이다.", speaker: "관계자", origin: "interview", refId: null }], claims: [] } });
    expect(similarityDraft(toArticleForPublish(g))).toBe("가온시의 올해 상반기 취득세 징수액이 1년 전보다 18.4% 줄었습니다.\n문단이다.\n> 인용이다.");
  });
});

describe("저장 검사·설정", () => {
  test("저장 검사는 쉬운 말·압박 완화 항목만 돌려준다 (금지 표현은 차단 등급으로 보이고 저장은 막지 않는다)", () => {
    const g = graph({}, { body: { blocks: [{ type: "paragraph", text: "이 기사는 절세 보장을 말하지 않는다." }], claims: [] } });
    const findings = saveChecks(toArticleForPublish(g), SETTINGS.dictionaries);
    expect(findings.map((f) => f.id)).toEqual(["ux01.forbidden-phrase"]);
    expect(findings[0]!.location).toMatchObject({ field: "blocks", blockIndex: 0, phrase: "절세 보장" });
  });
  test("settings에 금지 표현 사전이 없으면 문제로 알린다 (빈 사전으로 판정하지 않는다)", () => {
    const { problems } = parseGateSettings([{ key: "fear_phrases", value: { phrases: ["큰일"] } }], []);
    expect(problems).toEqual(["settings.forbidden_phrases이 없거나 형식이 틀립니다"]);
  });
  test("settings 사전·유사도 기준과 쉬운 말 사전을 읽는다", () => {
    const { settings, problems } = parseGateSettings(
      [
        { key: "forbidden_phrases", value: { version: "v1", phrases: ["절세 보장", " ", 3] } },
        { key: "fear_phrases", value: { version: "v1", phrases: ["큰일"] } },
        { key: "similarity_internal", value: { version: "s2", sentenceSimilarity: 0.8, sentenceComparator: "gt", articleRatio: 0.5, quoteRatio: 0.2 } },
      ],
      [{ term: "과세표준", plain: "세금을 매기는 기준 금액" }, { term: "누진", plain: null }],
    );
    expect(problems).toEqual([]);
    expect(settings.dictionaries).toEqual({ forbiddenPhrases: ["절세 보장"], fearPhrases: ["큰일"], jargonTerms: [{ term: "과세표준", plain: "세금을 매기는 기준 금액" }] });
    expect(settings.similarity).toMatchObject({ version: "s2", sentenceSimilarity: 0.8, sentenceComparator: "gt", articleRatio: 0.5, articleComparator: "gt", quoteRatio: 0.2 });
  });
  test("KST 날짜 — UTC 15:00은 다음 날", () => {
    expect(kstDate("2026-10-16T14:59:59.000Z")).toBe("2026-10-16");
    expect(kstDate("2026-10-16T15:00:00.000Z")).toBe("2026-10-17");
  });
});

describe("매핑 — 인물 참조와 근거 참조", () => {
  test("작성자·승인자는 people 번호로 비교하고, 출처·근거 ID는 src:·ev: 접두어로 겹치지 않는다", () => {
    const a = toArticleForPublish(graph());
    expect(a.authorUserId).toBe(`person:${AUTHOR_PERSON}`);
    expect(a.reviews[0]!.reviewerUserId).toBe(`person:${EDITOR_PERSON}`);
    expect(a.sources.map((s) => s.id)).toEqual(["src:3"]);
    expect(a.evidence.map((e) => e.id)).toEqual(["ev:7"]);
    expect(a.datasets[0]!.evidenceId).toBe("ev:7");
  });
  test("「지방세로 읽기」 저장 칸 skip_reason → 판정 칸 omissionReason", () => {
    expect(toArticleForPublish(graph()).taxLens).toEqual({
      topics: [],
      points: [],
      links: [],
      omissionReason: "세금 영향은 후속 기사에서",
      reviewed: false,
      reviewedForVersion: null,
    });
  });
});

describe("형식 콘텐츠 — media 기록에서 읽는 칸(권리·출처·이용 조건·썸네일 크기)으로 판정 (ART-08 · ART-09 · NAV-04)", () => {
  const body = articleRow().body as { blocks: unknown[]; claims: unknown[] };
  const VIDEO = { type: "video", embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", caption: "", summary: "징수 실적 설명 영상입니다.", captions: true, thumbnailMediaId: "21", durationSeconds: 60 };
  const withVideo = { ...body, blocks: [...body.blocks, VIDEO] };
  const thumb = (over: Parameters<typeof mediaRow>[0]) => mediaRow({ kind: "thumbnail", rights_status: "confirmed", credit: "편집국", license: "자체 제작", width: 1920, height: 1080, ...over });

  test("동영상 기사 — 권리 확인된 16:9 썸네일이면 형식 판정 통과", () => {
    expect(failedOf(graph({ media: [thumb({ id: 21 })] }, { format: "video", body: withVideo })).filter((id) => /^art08|^nav04/.test(id))).toEqual([]);
  });

  test("썸네일 크기를 모르거나 4:3이면 art08.thumbnail-ratio, 권리 미확인이면 nav04.image-rights — 본문에 적은 값은 보지 않는다", () => {
    expect(failedOf(graph({ media: [thumb({ id: 21, width: null, height: null })] }, { format: "video", body: withVideo }))).toContain("art08.thumbnail-ratio");
    expect(failedOf(graph({ media: [thumb({ id: 21, width: 1200, height: 900 })] }, { format: "video", body: withVideo }))).toContain("art08.thumbnail-ratio");
    const forged = { ...body, blocks: [...body.blocks, { ...VIDEO, thumbnail: { rightsStatus: "confirmed", width: 1920, height: 1080 } }] };
    expect(failedOf(graph({ media: [thumb({ id: 21, rights_status: "unconfirmed" })] }, { format: "video", body: forged }))).toContain("nav04.image-rights");
    expect(failedOf(graph({}, { format: "video", body: withVideo })), "media 행이 없으면 권리·크기 모름").toEqual(expect.arrayContaining(["nav04.image-rights", "art08.thumbnail-ratio"]));
  });

  test("포토 기사 — 사진의 출처·이용 조건은 media 기록에서 (본문에 적어 넣어도 무시)", () => {
    const photoBody = { ...body, blocks: [...body.blocks, { type: "image", mediaId: "31", alt: "구청 창구", caption: "", credit: "적어 넣은 출처", license: "적어 넣은 조건" }] };
    const noCredit = mediaRow({ id: 31, rights_status: "unconfirmed", license: "공공누리 제1유형" });
    expect(failedOf(graph({ media: [noCredit] }, { format: "photo", body: photoBody }))).toEqual(expect.arrayContaining(["art09.photo-credit"]));
    const full = mediaRow({ id: 31, rights_status: "confirmed", credit: "가온시청", photographer: "김가온", license: "공공누리 제1유형" });
    expect(failedOf(graph({ media: [full] }, { format: "photo", body: photoBody })).filter((id) => id.startsWith("art09"))).toEqual([]);
  });
});
