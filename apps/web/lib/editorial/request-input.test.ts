// 편집위원 데스크 요청 입력 검사 (PO 2026-11-18) — 지침 v4 2장 접수 인터뷰 항목을 양식으로 받는다
import { describe, expect, test } from "vitest";
import { ATTACHMENT_EXTENSIONS, attachmentName, parseLinks, parseRequestInput } from "./request-input";

describe("요청 입력 — 기본값", () => {
  test("주제만 적으면 나머지는 지침 기본값 (유형·섹션 자동, 독자 세무 실무자 전반, 요약표 포함, 파생물 3종, 이미지 생성은 승인 전이라 꺼짐)", () => {
    const r = parseRequestInput({ topic: "  조정지역 일시적 2주택 처분기한  " });
    expect(r).toEqual({
      ok: true,
      value: {
        topic: "조정지역 일시적 2주택 처분기한",
        articleType: "auto",
        links: [],
        sourceNote: "",
        section: "자동",
        message: "",
        reader: "세무 실무자 전반",
        byline: "",
        comments: "",
        length: "",
        baseDate: "",
        summaryTable: true,
        imagesApproved: false,
        derivatives: ["cardnews", "threads", "youtube"],
        memo: "",
      },
    });
  });

  test("고른 값은 그대로 — 파생물은 지침 순서(카드뉴스 → 쓰레드 → 유튜브)로 정렬", () => {
    const r = parseRequestInput({
      topic: "재산세 공동과세",
      articleType: "quantitative",
      section: "법령개정",
      reader: "세무 공무원",
      baseDate: "2026-11-18",
      imagesApproved: true,
      summaryTable: false,
      derivatives: ["youtube", "cardnews"],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.articleType).toBe("quantitative");
      expect(r.value.section).toBe("법령개정");
      expect(r.value.reader).toBe("세무 공무원");
      expect(r.value.baseDate).toBe("2026-11-18");
      expect(r.value.imagesApproved).toBe(true);
      expect(r.value.summaryTable).toBe(false);
      expect(r.value.derivatives).toEqual(["cardnews", "youtube"]);
    }
  });

  test("파생물을 모두 빼면 빈 목록 (기사만)", () => {
    const r = parseRequestInput({ topic: "t", derivatives: [] });
    expect(r.ok && r.value.derivatives).toEqual([]);
  });
});

describe("요청 입력 — 거부", () => {
  test("주제가 비면 거부", () => {
    expect(parseRequestInput({ topic: "   " })).toEqual({ ok: false, errors: ["주제: 꼭 적어 주세요"] });
  });
  test("주제 200자 경계 — 200자는 받고 201자는 거부", () => {
    expect(parseRequestInput({ topic: "가".repeat(200) }).ok).toBe(true);
    const r = parseRequestInput({ topic: "가".repeat(201) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain("200자 이내");
  });
  test("목록 밖 값·모르는 칸·없는 날짜·문자열 아닌 값은 모두 사유와 함께 거부", () => {
    const r = parseRequestInput({ topic: "t", articleType: "novel", section: "연예", baseDate: "2026-02-30", reader: 3, derivatives: ["tiktok"], extra: 1, imagesApproved: "yes" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const all = r.errors.join("\n");
      for (const w of ["기사 유형", "게재 섹션", "기준일", "주 독자", "파생물", "모르는 칸입니다: extra", "이미지 생성 승인"]) expect(all).toContain(w);
    }
  });
  test("제어 문자가 섞인 글은 거부 (줄바꿈·탭은 허용)", () => {
    expect(parseRequestInput({ topic: "t", memo: "첫 줄\n\t둘째 줄" }).ok).toBe(true);
    expect(parseRequestInput({ topic: "t\u0007" }).ok).toBe(false);
  });
  test("배열·null은 요청으로 읽지 않는다", () => {
    expect(parseRequestInput([]).ok).toBe(false);
    expect(parseRequestInput(null).ok).toBe(false);
  });
});

describe("소재 링크", () => {
  test("https만, 빈 줄은 건너뛰고, 같은 주소는 한 번", () => {
    const errors: string[] = [];
    expect(parseLinks("https://www.mois.go.kr/a\n\nhttps://www.mois.go.kr/a\r\nhttps://law.go.kr/b ", errors)).toEqual(["https://www.mois.go.kr/a", "https://law.go.kr/b"]);
    expect(errors).toEqual([]);
  });
  test("http·javascript·주소 아닌 글은 거부", () => {
    const errors: string[] = [];
    parseLinks("http://example.com\njavascript:alert(1)\n그냥 글", errors);
    expect(errors).toHaveLength(3);
  });
  test("20개 경계 — 21개는 거부", () => {
    const many = Array.from({ length: 21 }, (_, i) => `https://e.kr/${i}`);
    const ok: string[] = [];
    parseLinks(many.slice(0, 20), ok);
    expect(ok).toEqual([]);
    const bad: string[] = [];
    parseLinks(many, bad);
    expect(bad[0]).toContain("20개까지");
  });
});

describe("첨부 파일 이름", () => {
  test("허용 확장자는 받고 경로·특수 문자는 지운다", () => {
    expect(attachmentName("C:\\자료\\2026 보도자료.PDF")).toEqual({ ok: true, safe: "2026 보도자료.PDF", ext: "pdf" });
    expect(attachmentName("../../etc/판결문#1.hwpx")).toEqual({ ok: true, safe: "판결문_1.hwpx", ext: "hwpx" });
  });
  test("실행 파일·확장자 없음·숨김 파일은 거부", () => {
    for (const n of ["setup.exe", "readme", ".pdf", "", 3]) expect(attachmentName(n).ok).toBe(false);
  });
  test("허용 목록에 실행·스크립트 형식이 없다", () => {
    for (const bad of ["exe", "bat", "js", "html", "svg", "sh", "ps1"]) expect(ATTACHMENT_EXTENSIONS as readonly string[]).not.toContain(bad);
  });
});
