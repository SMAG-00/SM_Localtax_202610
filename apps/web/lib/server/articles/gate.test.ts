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
    // 지역 기사 3항목(REG1-17)은 그대로 두고 '인과 단정 없음'만 뺀다
    const noCheck = { ...base.reviews[0]!, checklist: { evidence: true, relation: true, ad_independence: true } };
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

describe("W4 5단계 공식 자료·공공누리 — DB 칸 → 발행 판정 (REG1-07 · REG1-09 · PR-07)", () => {
  const base = graph();
  const src = base.sources[0]!;
  const PRESS = "시험용 가상구는 상반기 지방세 세수가 집계됐다고 밝혔다. 구는 거래 감소가 원인이라고 설명했다.";

  test("공식 자료의 기준일·지역 단위가 비면 칸마다 reg1_09.official-fields — 위치에 API 칸 이름", () => {
    const g = graph({ sources: [{ ...src, reference_date: null, region_unit: "  " }] });
    const r = runGate(g, SETTINGS, GATE_OPTIONS);
    expect(r.failed).toContain("reg1_09.official-fields");
    expect(r.evaluation.blockers.filter((f) => f.id === "reg1_09.official-fields").map((f) => f.location?.field)).toEqual(["sources.referenceDate", "sources.regionUnit"]);
  });

  test("공공누리 유형이 목록 밖이거나 비면 pr07.license-required (공식 자료·보도자료)", () => {
    expect(failedOf(graph({ sources: [{ ...src, license_type: "kogl_9" }] }))).toContain("pr07.license-required");
    expect(failedOf(graph({ sources: [src, { ...src, id: 4, kind: "press_release", license_type: null, source_type: null }] }))).toContain("pr07.license-required");
    expect(failedOf(graph({ sources: [src, { ...src, id: 4, kind: "interview", license_type: null, source_type: null }] }))).not.toContain("pr07.license-required");
  });

  test("자료 종류 — 차단 4종은 설정 목록에 있어도 reg1_07.source-type, 설정 목록 밖도 차단, 설정에 더하면 통과", () => {
    expect(failedOf(graph({ sources: [{ ...src, source_type: "tourism" }] }))).toContain("reg1_07.source-type");
    const opened = { ...SETTINGS, officialSourceTypes: ["tourism", "public_property"] };
    expect(runGate(graph({ sources: [{ ...src, source_type: "tourism" }] }), opened, GATE_OPTIONS).failed).toContain("reg1_07.source-type");
    expect(failedOf(graph({ sources: [{ ...src, source_type: "public_property" }] }))).toContain("reg1_07.source-type");
    expect(runGate(graph({ sources: [{ ...src, source_type: "public_property" }] }), opened, GATE_OPTIONS).failed).not.toContain("reg1_07.source-type");
  });

  test("보도자료(제1유형) 문장을 그대로 옮기면 pr07.full-text — 기본값 전재 0, 설정이 연 유형·해당 없음은 통과", () => {
    const copied = (licenseType: string) =>
      graph(
        { sources: [src, { ...src, id: 4, kind: "press_release", license_type: licenseType, source_type: null, snapshot_id: 51 }], snapshots: [{ id: 51, payload: PRESS }] },
        { summary: null, body: { blocks: [{ type: "paragraph", text: PRESS }], claims: [] } },
      );
    const blocked = runGate(copied("kogl_1"), SETTINGS, GATE_OPTIONS);
    expect(blocked.failed).toContain("pr07.full-text");
    expect(blocked.evaluation.blockers.find((f) => f.id === "pr07.full-text")?.location).toMatchObject({ field: "blocks", sentenceIndex: 0, phrase: "src:4" });
    const open = { ...SETTINGS, kogl: { photoTypes: ["kogl_1", "not_applicable"] as const, fullTextTypes: ["kogl_1"] as const } };
    expect(runGate(copied("kogl_1"), open, GATE_OPTIONS).failed).not.toContain("pr07.full-text");
    expect(runGate(copied("kogl_4"), open, GATE_OPTIONS).failed).toContain("pr07.full-text");
    expect(runGate(copied("not_applicable"), SETTINGS, GATE_OPTIONS).failed).not.toContain("pr07.full-text");
  });

  test("대표 사진 — 권리 확인 + 제2유형은 기본값에서 pr07.photo-license, 설정이 열면 통과, 미표시는 늘 차단", () => {
    const lead = (licenseType: string) =>
      graph({ media: [mediaRow({ id: 61, rights_status: "confirmed", credit: "시험용 가상구청", photographer: "시험 촬영자", license: "공공누리", license_type: licenseType })] }, { lead_media_id: 61 });
    expect(failedOf(lead("kogl_2"))).toContain("pr07.photo-license");
    expect(failedOf(lead("kogl_1"))).not.toContain("pr07.photo-license");
    const open = { ...SETTINGS, kogl: { photoTypes: ["kogl_1", "kogl_2", "not_applicable"] as const, fullTextTypes: [] as const } };
    expect(runGate(lead("kogl_2"), open, GATE_OPTIONS).failed).not.toContain("pr07.photo-license");
    expect(runGate(lead("unmarked"), open, GATE_OPTIONS).failed).toContain("pr07.photo-license");
  });

  test("대체된 옛 판은 판정에 넣지 않는다 — 새 판만 보고, 새 판이 칸을 채우면 통과", () => {
    // loadArticleGraph가 대체된 행을 뺀 뒤의 모양: 옛 판(3, 칸 빔)은 없고 새 판(9)만
    const r = runGate(graph({ sources: [{ ...src, id: 9, supersedes_id: 3, revision_reason: "기준일 정정" }] }), SETTINGS, GATE_OPTIONS);
    expect(r.failed).toEqual([]);
  });

  test("설정 읽기 — kogl_usage·official_source_types가 없으면 권고 기본값·씨앗, 모양이 틀리면 문제로 알리고 닫힌 쪽", () => {
    const dict = [
      { key: "forbidden_phrases", value: { version: "v1", phrases: ["절세 보장"] } },
      { key: "fear_phrases", value: { version: "v1", phrases: ["큰일"] } },
    ];
    const none = parseGateSettings(dict, []);
    expect(none.settings.kogl).toEqual({ photoTypes: ["kogl_1", "not_applicable"], fullTextTypes: [] });
    expect(none.settings.officialSourceTypes).toEqual(["ordinance", "notice", "budget_settlement", "local_tax_revenue", "realestate_transaction", "redevelopment"]);
    const bad = parseGateSettings([...dict, { key: "kogl_usage", value: { photoTypes: ["kogl_4"], fullTextTypes: [] } }, { key: "official_source_types", value: ["tourism"] }], []);
    expect(bad.problems).toEqual(expect.arrayContaining(["settings.kogl_usage 형식이 틀립니다", "settings.official_source_types 형식이 틀립니다"]));
    expect(bad.settings.kogl).toEqual({ photoTypes: ["kogl_1", "not_applicable"], fullTextTypes: [] });
    const set = parseGateSettings([...dict, { key: "kogl_usage", value: { photoTypes: ["kogl_1", "kogl_2"], fullTextTypes: ["kogl_1"] } }, { key: "official_source_types", value: ["notice", "public_property"] }], []);
    expect(set.settings.kogl).toEqual({ photoTypes: ["kogl_1", "kogl_2"], fullTextTypes: ["kogl_1"] });
    expect(set.settings.officialSourceTypes).toEqual(["notice", "public_property"]);
  });
});

describe("W4 7단계 지역 기사 게이트 — DB 칸 → 발행 판정 (REG1-17)", () => {
  const regionalFailed = (g: ReturnType<typeof graph>, settings = SETTINGS) => runGate(g, settings, GATE_OPTIONS).failed.filter((id) => id.startsWith("reg1_17."));
  test("견본(지역 태그·편집 분야·공익적 질문·3항목 승인)은 지역 게이트 차단 0", () => {
    expect(regionalFailed(graph())).toEqual([]);
  });
  test("지자체뉴스 새 원고의 지역 태그 0 → region-tag-required, 한 번 발행된 기사는 그대로", () => {
    expect(regionalFailed(graph({}, { region_codes: [] }))).toEqual(["reg1_17.region-tag-required"]);
    expect(regionalFailed(graph({}, { region_codes: [], first_published_at: "2026-09-01T00:00:00+00:00", update_kind: "substantive", updated_reason: "갱신" }))).toEqual([]);
  });
  test("편집 분야·공익적 질문 칸 → 차단 ID, 목록 밖 편집 분야는 빈 것으로", () => {
    expect(regionalFailed(graph({}, { editorial_field: null, public_question: " " }))).toEqual(["reg1_17.editorial-field", "reg1_17.public-question"]);
    expect(regionalFailed(graph({}, { editorial_field: "tourism" }))).toEqual(["reg1_17.editorial-field"]);
  });
  test("소재·관계 유형·근거 — 축제 + 관계 0 → relation-required, 목록 밖 관계 유형은 빼고 센다, 근거 0 → relation-evidence", () => {
    expect(regionalFailed(graph({}, { subject_kind: "festival", relation_types: [] }))).toEqual(["reg1_17.relation-required"]);
    expect(regionalFailed(graph({}, { subject_kind: "festival", relation_types: ["tourism"] }))).toEqual(["reg1_17.relation-required"]);
    expect(regionalFailed(graph({ evidence: [] }, { subject_kind: "commerce", relation_types: ["budget"] }))).toEqual(["reg1_17.relation-evidence"]);
    expect(regionalFailed(graph({}, { subject_kind: "festival", relation_types: ["budget"] }))).toEqual([]);
  });
  test("편집자 판정 여행 후기 + 보도기사 → non-news-judgement", () => {
    expect(regionalFailed(graph({}, { editorial_judgement: "travel_review", judged_by: "user:x", judged_at: "2026-10-20T00:00:00Z" }))).toEqual(["reg1_17.non-news-judgement"]);
  });
  test("편집 승인 checklist는 DB 칸(checklist)에서 읽는다 — 3항목 하나 빠지면 desk-checklist", () => {
    const base = graph();
    const partial = { ...base.reviews[0]!, checklist: { noCausalClaim: true, evidence: true, relation: true } };
    expect(regionalFailed({ ...base, reviews: [partial] })).toEqual(["reg1_17.desk-checklist"]);
  });
  test("다룬 제휴사 중 계약 기록이 있는 곳만 이해관계 표시를 요구한다", () => {
    const contracted = { id: 7, name: "시험용 가상상회", contract_from: "2026-01-01", contract_to: null };
    const noContract = { id: 8, name: "시험용 가상기관", contract_from: null, contract_to: null };
    expect(regionalFailed(graph({ coveredPartners: [noContract] }, { covered_partner_ids: [8] }))).toEqual([]);
    expect(regionalFailed(graph({ coveredPartners: [contracted] }, { covered_partner_ids: [7] }))).toEqual(["reg1_17.interest-disclosure"]);
    expect(regionalFailed(graph({ coveredPartners: [contracted] }, { covered_partner_ids: [7], interest_disclosure: "시험용 가상상회는 광고주입니다" }))).toEqual([]);
  });
  test("판정 책임자 설정 — 행이 없으면 씨앗 4종, 모양이 틀리면 빈 목록(모든 분야 보류), 고친 목록 밖 분야 → field-judge-missing", () => {
    const dict = [
      { key: "forbidden_phrases", value: { phrases: ["절세 보장"] } },
      { key: "fear_phrases", value: { phrases: ["큰일"] } },
    ];
    expect(parseGateSettings(dict, []).settings.regionalJudgeFields).toEqual(["local_tax", "realestate", "local_finance", "urban_policy"]);
    expect(parseGateSettings([...dict, { key: "regional_judge_fields", value: ["local_tax", "local_tax"] }], []).settings.regionalJudgeFields).toEqual([]);
    const narrowed = parseGateSettings([...dict, { key: "regional_judge_fields", value: ["local_tax"] }], []);
    expect(narrowed.problems).toEqual([]);
    expect(regionalFailed(graph(), { ...SETTINGS, regionalJudgeFields: narrowed.settings.regionalJudgeFields })).toEqual(["reg1_17.field-judge-missing"]);
  });
});

describe("W4 8단계 지역 기사 편집 경고 — DB 칸·유사도 결과 → 경고 (REG1-14)", () => {
  const base = graph();
  const src = base.sources[0]!;
  const PRESS = "시험용 가상구는 상반기 지방세 세수가 집계됐다고 밝혔다. 구는 거래 감소가 원인이라고 설명했다. 다음 달 세부 자료를 낸다.";
  const editorialWarnings = (g: ReturnType<typeof graph>, settings = SETTINGS) =>
    runGate(g, settings, GATE_OPTIONS).evaluation.warnings.filter((f) => f.ruleRef === "REG1-14");
  const withPress = (text: string) =>
    graph(
      { sources: [src, { ...src, id: 4, kind: "press_release", source_type: null, snapshot_id: 51 }], snapshots: [{ id: 51, payload: PRESS }] },
      { summary: null, body: { blocks: [{ type: "paragraph", text }], claims: [] } },
    );

  test("견본(지역 기사)은 편집 경고 0", () => {
    expect(editorialWarnings(graph())).toEqual([]);
  });
  test("같은 보도자료와 기사 비율 기준(유사도 설정 60% 초과) 이상 → 재게시 경고 1건, 기준 이하 → 0", () => {
    const all = editorialWarnings(withPress(PRESS)).filter((f) => f.id === "reg1_14.press-release-repost");
    expect(all).toHaveLength(1);
    expect(all[0]!.location).toMatchObject({ field: "sources", phrase: "src:4" });
    expect(all[0]!.message).toContain("100%");
    // 3문장 중 1문장만 같음 = 33% → 경고 0 (자체 문장 2개)
    const one = "시험용 가상구는 상반기 지방세 세수가 집계됐다고 밝혔다. 편집국이 구별 징수 실적을 따로 대조했다. 감소 폭은 구마다 달랐다.";
    expect(editorialWarnings(withPress(one)).map((f) => f.id)).not.toContain("reg1_14.press-release-repost");
    // 기준을 낮추면(설정) 같은 원고도 경고
    const loose = { ...SETTINGS, similarity: { ...SETTINGS.similarity, articleRatio: 0.3 } };
    expect(editorialWarnings(withPress(one), loose).map((f) => f.id)).toContain("reg1_14.press-release-repost");
  });
  test("지역 기사가 아니면(지역 태그 없는 지방세 기사) 재게시 경고 0 — 유사도 차단은 그대로", () => {
    const g = withPress(PRESS);
    const tax = { ...g, article: { ...g.article, section: "tax" as const, region_codes: [] }, category: { ...g.category!, section: "tax" as const } };
    expect(editorialWarnings(tax)).toEqual([]);
  });
  test("수치 문단에 근거 연결이 없으면 근거 없는 지역 수치 경고 — 핵심 주장이 공식 자료(src)·근거(ev)를 이으면 0", () => {
    const text = "누리구 재산세는 312억 원으로 늘었다.";
    const bare = graph({}, { body: { blocks: [...(base.article.body as { blocks: unknown[] }).blocks, { type: "paragraph", text }], claims: (base.article.body as { claims: unknown[] }).claims } });
    expect(editorialWarnings(bare).map((f) => f.id)).toEqual(["reg1_14.unsupported-figure"]);
    const blocks = (bare.article.body as { blocks: unknown[] }).blocks;
    const linked = graph({}, { body: { blocks, claims: [...(base.article.body as { claims: unknown[] }).claims, { id: "claim-9", text, kind: "fact", evidenceIds: ["src:3"], blockIndex: blocks.length - 1 }] } });
    expect(editorialWarnings(linked)).toEqual([]);
  });
  test("오래된 통계 — 설정 stale_statistics_days(없으면 365) 기준, 기준 당일 0·하루 넘김 1 (오늘 = KST 2026-10-17)", () => {
    expect(editorialWarnings(graph({ sources: [{ ...src, reference_date: "2025-10-17" }] }))).toEqual([]);
    expect(editorialWarnings(graph({ sources: [{ ...src, reference_date: "2025-10-16" }] })).map((f) => f.id)).toEqual(["reg1_14.stale-statistics"]);
    const dict = [
      { key: "forbidden_phrases", value: { phrases: ["절세 보장"] } },
      { key: "fear_phrases", value: { phrases: ["큰일"] } },
    ];
    expect(parseGateSettings(dict, []).settings.staleStatisticsDays).toBe(365);
    expect(parseGateSettings([...dict, { key: "stale_statistics_days", value: 30 }], []).settings.staleStatisticsDays).toBe(30);
    for (const bad of [0, 3651, "30", 1.5]) expect(parseGateSettings([...dict, { key: "stale_statistics_days", value: bad }], []).settings.staleStatisticsDays).toBe(365);
    const thirty = { ...SETTINGS, staleStatisticsDays: 30 };
    expect(editorialWarnings(graph(), thirty).map((f) => f.id)).toEqual(["reg1_14.stale-statistics"]);
  });
  test("사진 권리 누락 — 대표 사진의 공공누리 유형이 비면 경고 목록에 1건", () => {
    const g = graph({ media: [mediaRow({ id: 61, rights_status: "confirmed", license_type: null })] }, { lead_media_id: 61 });
    expect(editorialWarnings(g).map((f) => [f.id, f.location?.field])).toEqual([["reg1_14.photo-rights", "leadImage"]]);
  });
});

describe("W7 점검 기준 — 리드 직접 답·설정 덮어쓰기·규정 유사도 기준", () => {
  const withLead = (text: string) => {
    const base = graph();
    const body = base.article.body as { blocks: unknown[]; claims: unknown[] };
    return graph({}, { body: { blocks: [{ type: "paragraph", text }, ...body.blocks], claims: body.claims } });
  };
  const threeSentences = "첫째 문장입니다. 둘째 문장입니다. 셋째 문장입니다.";

  test("본문 첫 문단이 3문장이면 리드 직접 답 경고, 2문장이면 통과 (발행은 막지 않음)", () => {
    const long = runGate(withLead(threeSentences), SETTINGS, GATE_OPTIONS);
    expect(long.lint.warnings).toContain("aeo.lead-answer");
    expect(long.lint.blockers).not.toContain("aeo.lead-answer");
    const short = runGate(withLead("첫째 문장입니다. 둘째 문장입니다."), SETTINGS, GATE_OPTIONS);
    expect(short.lint.warnings).not.toContain("aeo.lead-answer");
  });

  test("settings.seo_lint_params가 기준값을 덮어쓴다 — 허용 문장 수 3이면 같은 원고가 통과, 틀린 형식은 무시", () => {
    const loose = { ...SETTINGS, seoLintParams: { "aeo.lead-answer": { maxSentences: 3 } } };
    expect(runGate(withLead(threeSentences), loose, GATE_OPTIONS).lint.warnings).not.toContain("aeo.lead-answer");
    const bad = { ...SETTINGS, seoLintParams: { "aeo.lead-answer": { maxSentences: "3" } } };
    expect(runGate(withLead(threeSentences), bad, GATE_OPTIONS).lint.warnings).toContain("aeo.lead-answer");
  });

  test("parseGateSettings가 seo_lint_params 행을 그대로 싣는다", () => {
    const dict = [
      { key: "forbidden_phrases", value: { phrases: ["가"] } },
      { key: "fear_phrases", value: { phrases: ["나"] } },
    ];
    const value = { "seo.keyword-density": { maxPercent: 12 } };
    expect(parseGateSettings([...dict, { key: "seo_lint_params", value }], []).settings.seoLintParams).toEqual(value);
    expect(parseGateSettings(dict, []).settings.seoLintParams).toBeUndefined();
  });
});
