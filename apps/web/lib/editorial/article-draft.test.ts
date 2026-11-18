// 편집위원 결과물 → 기사 초안: 기본값 추천·본문 블록·그림 계획 (PO 2026-11-18 — AI 그림은 권리 확인됨, [요약]은 본문 맨 위 핵심 요약)
import { describe, expect, test } from "vitest";
import type { ParsedArticle } from "./article-markdown";
import { buildDraftBody, draftDefaults, imagePlan, parseDraftForm } from "./article-draft";

const base = (over: Partial<ParsedArticle> = {}): ParsedArticle => ({
  section: "전문가 칼럼",
  title: "30년 산 집에 공제 한도 10억…장기거주 소득공제의 역설",
  titleAlternatives: ["보유는 빼고 거주만 센다…장기보유특별공제 개편, 누가 더 내게 되나 따져 보니", "오래 지킨 집일수록 손해 보는 공제"],
  subtitle: "2028년부터 거주 중심으로 개편…매도 시점에 따라 세금이 3.6배까지 차이",
  leadCaption: "",
  byline: "이준수 기자(공인회계사·세무사)",
  keywords: ["장기보유특별공제"],
  summary: "정부안대로라면 공제가 거주 중심으로 바뀝니다. 30년 거주자는 세금이 크게 늘어 보완이 필요합니다.",
  blocks: [],
  memo: { text: "", sources: [], needsCheck: [], thumbnail: "" },
  warnings: [],
  ...over,
});

const file = (path: string, mime = "image/png", size = 1000) => ({ path, mime, size, key: `packages/2026_11_15/${path.length}.png` });

describe("기본값 추천", () => {
  test("[섹션]별 기사 유형·하위 분야 — 칼럼은 칼럼(columns), 판례·유권해석은 해설(interpretations), 법령개정은 law-updates, 지자체소식은 보도(지자체뉴스)", () => {
    const pick = (section: string) => {
      const d = draftDefaults(base({ section }), "2026_11_15");
      return [d.section, d.contentType, d.categorySlug];
    };
    expect(pick("전문가 칼럼")).toEqual(["tax", "opinion", "columns"]);
    expect(pick("판례소개")).toEqual(["tax", "explainer", "interpretations"]);
    expect(pick("유권해석")).toEqual(["tax", "explainer", "interpretations"]);
    expect(pick("법령개정")).toEqual(["tax", "explainer", "law-updates"]);
    expect(pick("지자체소식")).toEqual(["local", "reported_news", "reporting"]);
    expect(pick("부동산 정보")).toEqual(["realestate", "explainer", null]);
    expect(pick("상담사례")).toEqual(["tax", "explainer", null]);
    expect(pick("")).toEqual(["tax", "explainer", null]);
  });

  test("주소는 desk-날짜(폴더 번호 포함), 제목 후보는 원고 제목 → 제목 대안 순, 40자 넘는 후보는 빠짐", () => {
    const d = draftDefaults(base(), "2026_11_01_2");
    expect(d.slug).toBe("desk-2026-11-01-2");
    expect(d.title).toBe("30년 산 집에 공제 한도 10억…장기거주 소득공제의 역설");
    expect(d.titleOptions).toEqual(["30년 산 집에 공제 한도 10억…장기거주 소득공제의 역설", "오래 지킨 집일수록 손해 보는 공제"]);
  });

  test("요약 칸(60자)은 부제 — 60자 넘으면 ' / ' 앞 첫 줄, 그것도 넘으면 빈칸", () => {
    expect(draftDefaults(base(), "2026_11_15").summary).toBe("2028년부터 거주 중심으로 개편…매도 시점에 따라 세금이 3.6배까지 차이");
    expect(draftDefaults(base({ subtitle: `${"가".repeat(30)} / ${"나".repeat(40)}` }), "2026_11_15").summary).toBe("가".repeat(30));
    expect(draftDefaults(base({ subtitle: "다".repeat(61) }), "2026_11_15").summary).toBe("");
  });

  test("제목이 40자를 넘으면 추천 제목은 비우지 않고 그대로 두되 titleTooLong", () => {
    const long = "가".repeat(41);
    const d = draftDefaults(base({ title: long, titleAlternatives: [] }), "2026_11_15");
    expect(d.title).toBe(long);
    expect(d.titleTooLong).toBe(true);
    expect(d.titleOptions).toEqual([]);
  });
});

describe("확인 창 입력 검사", () => {
  const ok = { title: "제목", summary: "요약", section: "tax", contentType: "opinion", categorySlug: "columns", slug: "desk-2026-11-15" };

  test("정상 입력은 그대로, 빈 하위 분야는 null", () => {
    expect(parseDraftForm(ok)).toEqual({ ok: true, value: ok });
    expect(parseDraftForm({ ...ok, categorySlug: "" })).toEqual({ ok: true, value: { ...ok, categorySlug: null } });
  });

  test("제목 40자·요약 60자 초과, 모르는 분야·유형, 공백 든 주소, 모르는 칸은 거부", () => {
    const r = parseDraftForm({ ...ok, title: "가".repeat(41), summary: "나".repeat(61), section: "x", contentType: "sponsored", slug: "a b", extra: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([
      "extra: 모르는 칸입니다",
      "제목: 40자 이하로 줄여 주세요 (지금 41자)",
      "요약: 60자 이하로 줄여 주세요 (지금 61자)",
      "분야: 부동산·지방세 세금·부동산재테크·부동산금융·지자체뉴스 중에서 골라 주세요",
      "기사 유형: 칼럼·해설·가이드·보도 중에서 골라 주세요",
      "주소: 공백과 '/' 없이 씁니다",
    ]);
  });

  test("제목·주소는 비울 수 없다", () => {
    const r = parseDraftForm({ ...ok, title: "  ", slug: "" });
    expect(r.ok ? [] : r.errors).toEqual(["제목: 비울 수 없습니다", "주소: 비울 수 없습니다"]);
  });
});

describe("그림 계획", () => {
  const parsed = base({
    blocks: [
      { type: "image", path: "images/ai1.png", alt: "거실 창가", caption: "▲거실 창가. (이미지: AI 생성, OpenAI gpt-image-2)", aiGenerated: true },
      { type: "image", path: "images/photo.jpg", alt: "한강", caption: "▲1976년 한강. (사진: 국가기록원, 공공누리 1유형)", aiGenerated: false },
      { type: "image", path: "images/missing.png", alt: "없는 그림", caption: "▲없음. (이미지: AI 생성, OpenAI gpt-image-2)", aiGenerated: true },
    ],
    memo: { text: "- 썸네일: images/thumb_1200x630.png (AI 생성 배경 + HTML 글자)", sources: [], needsCheck: [], thumbnail: "images/thumb_1200x630.png" },
  });
  const files = [file("images/ai1.png"), file("images/photo.jpg", "image/jpeg"), file("images/thumb_1200x630.png"), file("장특.md", "text/markdown")];

  test("썸네일이 대표(첫째·kind thumbnail), AI 그림은 권리 확인됨 + 모델 표기, 실사진은 미확인, 묶음에 없는 그림은 경고", () => {
    const p = imagePlan(parsed, files);
    expect(p.images.map((i) => [i.path, i.kind, i.lead, i.confirmed])).toEqual([
      ["images/thumb_1200x630.png", "thumbnail", true, true],
      ["images/ai1.png", "photo", false, true],
      ["images/photo.jpg", "photo", false, false],
    ]);
    expect(p.images[1]).toMatchObject({ alt: "거실 창가", credit: "AI 생성 (OpenAI gpt-image-2)", photographer: "AI 생성 (OpenAI gpt-image-2)", license_type: "not_applicable" });
    expect(p.images[0]!.alt).toBe("30년 산 집에 공제 한도 10억…장기거주 소득공제의 역설 — 썸네일");
    expect(p.images[2]).toMatchObject({ credit: "국가기록원, 공공누리 1유형", license_type: null });
    expect(p.warnings).toEqual(["그림 images/missing.png이 결과물 묶음에 없어 뺐습니다"]);
  });

  test("썸네일 메모에 AI 표기가 없어도 본문 그림이 모두 AI면 AI로 본다(지침 13-1 썸네일 = AI 배경 + 글자), 실사진이 섞이면 미확인", () => {
    const aiOnly = base({ blocks: parsed.blocks.slice(0, 1), memo: { text: "썸네일 파일명: images/thumb_1200x630.png", sources: [], needsCheck: [], thumbnail: "images/thumb_1200x630.png" } });
    expect(imagePlan(aiOnly, files).images[0]).toMatchObject({ path: "images/thumb_1200x630.png", confirmed: true, credit: "AI 생성 (OpenAI gpt-image-2)" });
    const mixed = base({ blocks: parsed.blocks.slice(0, 2), memo: aiOnly.memo });
    expect(imagePlan(mixed, files).images[0]).toMatchObject({ path: "images/thumb_1200x630.png", confirmed: false, credit: null });
  });

  test("썸네일이 없으면 본문 첫 그림이 대표", () => {
    const p = imagePlan(base({ blocks: parsed.blocks.slice(0, 1) }), files);
    expect(p.images.map((i) => [i.path, i.lead])).toEqual([["images/ai1.png", true]]);
  });

  test("4MB 넘는 그림과 jpg·png·webp가 아닌 그림은 사진 보관함 규칙에 맞지 않아 뺀다", () => {
    const p = imagePlan(base({ blocks: [{ type: "image", path: "images/big.png", alt: "큰 그림", caption: "▲(이미지: AI 생성, OpenAI gpt-image-2)", aiGenerated: true }, { type: "image", path: "images/a.gif", alt: "움짤", caption: "▲(이미지: AI 생성, OpenAI gpt-image-2)", aiGenerated: true }] }), [file("images/big.png", "image/png", 4_000_001), file("images/a.gif", "image/gif")]);
    expect(p.images).toEqual([]);
    expect(p.warnings).toEqual(["그림 images/big.png은 4MB를 넘어 사진 보관함에 넣을 수 없습니다", "그림 images/a.gif은 jpg·png·webp가 아니라 사진 보관함에 넣을 수 없습니다"]);
  });
});

describe("본문 블록", () => {
  test("맨 위 핵심 요약(문장마다 한 줄), 표 바로 위 ※ 줄은 표 제목, 그림은 사진 보관함 번호로", () => {
    const parsed = base({
      blocks: [
        { type: "paragraph", text: "첫 문단." },
        { type: "heading", level: 2, text: "1. 현행 제도" },
        { type: "paragraph", text: "※ 장기보유특별공제 개편 정부안 요약" },
        { type: "table", rows: [["구분", "2027년"], ["한도", "없음"]] },
        { type: "paragraph", text: "※ 정부안 기준이며 달라질 수 있습니다." },
        { type: "heading", level: 3, text: "※ 처분 기한 (11월 1일 기준)" },
        { type: "table", rows: [["세목", "기한"]] },
        { type: "image", path: "images/ai1.png", alt: "거실", caption: "▲거실. (이미지: AI 생성, OpenAI gpt-image-2)", aiGenerated: true },
        { type: "image", path: "images/gone.png", alt: "빠진 그림", caption: "▲빠짐", aiGenerated: true },
      ],
    });
    const r = buildDraftBody(parsed, new Map([["images/ai1.png", 41]]));
    expect(r.body).toEqual({
      blocks: [
        { type: "key_summary", lines: ["정부안대로라면 공제가 거주 중심으로 바뀝니다.", "30년 거주자는 세금이 크게 늘어 보완이 필요합니다."] },
        { type: "paragraph", text: "첫 문단." },
        { type: "heading", level: 2, text: "1. 현행 제도" },
        { type: "table", caption: "장기보유특별공제 개편 정부안 요약", rows: [["구분", "2027년"], ["한도", "없음"]], chart: null },
        { type: "paragraph", text: "※ 정부안 기준이며 달라질 수 있습니다." },
        { type: "table", caption: "처분 기한 (11월 1일 기준)", rows: [["세목", "기한"]], chart: null },
        { type: "image", mediaId: "41", alt: "거실", caption: "▲거실. (이미지: AI 생성, OpenAI gpt-image-2)" },
      ],
      claims: [],
    });
  });

  test("요약이 없으면 핵심 요약 상자 없음, 긴 ※ 문단(80자 초과)은 표 제목으로 쓰지 않는다", () => {
    const longNote = `※ ${"가".repeat(80)}`;
    const r = buildDraftBody(base({ summary: "", blocks: [{ type: "paragraph", text: longNote }, { type: "table", rows: [["a"]] }] }), new Map());
    expect(r.body.blocks).toEqual([
      { type: "paragraph", text: longNote },
      { type: "table", caption: "", rows: [["a"]], chart: null },
    ]);
  });
});
