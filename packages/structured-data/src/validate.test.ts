// 최소 검사기 — 유형별 필수 속성(Google 구조화 데이터 문서 + 이 플랫폼 규칙), 형식, 금지 속성.
import { describe, expect, it } from "vitest";
import { validate, FORBIDDEN_PROPERTIES, REQUIRED_PROPERTIES } from "./validate";
import { dataset, event, newsArticle } from "./generators";
import { sampleArticle, sampleDataset, sampleEvent } from "../fixtures/samples";

const pathsAndCodes = (jsonld: unknown) => validate(jsonld).map((e) => `${e.code} ${e.path}`);

describe("최상위 노드 — @context · @type", () => {
  it("@context가 https://schema.org가 아니면 context 오류", () => {
    const node = { ...newsArticle(sampleArticle), "@context": "http://example.org" };
    expect(pathsAndCodes(node)).toEqual(["context NewsArticle.@context"]);
  });

  it("대응표에 없는 유형(FAQPage)은 type 오류", () => {
    const faq = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [{ "@type": "Question", name: "질문", acceptedAnswer: { "@type": "Answer", text: "답" } }],
    };
    expect(pathsAndCodes(faq)).toEqual(["type FAQPage.@type"]);
  });

  it("객체가 아닌 값은 type 오류", () => {
    expect(pathsAndCodes(null)).toEqual(["type @type"]);
    expect(pathsAndCodes("NewsArticle")).toEqual(["type @type"]);
  });

  it("빈 배열은 검사할 노드가 없어 오류 0", () => {
    expect(validate([])).toEqual([]);
  });

  it("배열의 몇 번째 노드인지 오류에 남는다", () => {
    const bad = { ...newsArticle(sampleArticle), headline: "" };
    const errors = validate([event(sampleEvent), bad]);
    expect(errors.map((e) => [e.node, e.path, e.code])).toEqual([[1, "NewsArticle.headline", "required"]]);
  });
});

describe("필수 속성 표", () => {
  it("7유형 + Person·VideoObject·BreadcrumbList 모두 필수 속성 표가 있고, 근거가 google 또는 platform이다", () => {
    expect(Object.keys(REQUIRED_PROPERTIES).sort()).toEqual(
      [
        "Book",
        "BreadcrumbList",
        "Course",
        "Dataset",
        "Event",
        "NewsArticle",
        "NewsMediaOrganization",
        "Person",
        "ProfilePage",
        "VideoObject",
      ].sort(),
    );
    for (const rules of Object.values(REQUIRED_PROPERTIES)) {
      for (const r of rules) expect(["google", "platform"]).toContain(r.basis);
    }
  });

  it("Event의 Google 필수 속성 name·startDate·location을 각각 지우면 그 오류가 나온다", () => {
    const node = event(sampleEvent)!;
    for (const prop of ["name", "startDate", "location"]) {
      const { [prop]: _removed, ...rest } = node;
      expect(pathsAndCodes(rest), prop).toEqual([`required Event.${prop}`]);
    }
  });

  it("NewsArticle의 headline·datePublished를 지우면 그 오류가 나온다", () => {
    const node = newsArticle(sampleArticle);
    for (const prop of ["headline", "datePublished"]) {
      const { [prop]: _removed, ...rest } = node;
      expect(pathsAndCodes(rest), prop).toEqual([`required NewsArticle.${prop}`]);
    }
  });

  it("BreadcrumbList — 마지막이 아닌 항목에 item이 없으면 오류, 차례 번호가 1부터 이어지지 않으면 오류", () => {
    const list = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "홈" },
        { "@type": "ListItem", position: 3, name: "지방세" },
      ],
    };
    expect(pathsAndCodes(list)).toEqual([
      "required BreadcrumbList.itemListElement[0].item",
      "order BreadcrumbList.itemListElement[1].position",
    ]);
  });

  it("BreadcrumbList — 항목이 0개면 오류", () => {
    expect(pathsAndCodes({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [] })).toEqual([
      "required BreadcrumbList.itemListElement",
    ]);
  });
});

describe("형식", () => {
  it("날짜: 날짜만·오프셋 있는 시각은 통과, 오프셋 없는 시각·다른 형식은 format 오류", () => {
    const at = (d: string) => pathsAndCodes({ ...newsArticle(sampleArticle), datePublished: d, dateModified: undefined });
    expect(at("2026-10-20")).toEqual([]);
    expect(at("2026-10-20T09:00:00+09:00")).toEqual([]);
    expect(at("2026-10-20T00:00:00Z")).toEqual([]);
    expect(at("2026-10-20T09:00:00.250+09:00")).toEqual([]);
    expect(at("2026-10-20T09:00")).toEqual(["format NewsArticle.datePublished"]);
    expect(at("2026.10.20")).toEqual(["format NewsArticle.datePublished"]);
    expect(at("2026-13-01")).toEqual(["format NewsArticle.datePublished"]);
  });

  it("수정일 = 발행일은 통과, 1초라도 이르면 order 오류", () => {
    const base = newsArticle(sampleArticle);
    expect(pathsAndCodes({ ...base, dateModified: base.datePublished })).toEqual([]);
    expect(pathsAndCodes({ ...base, dateModified: "2026-10-20T08:59:59+09:00" })).toEqual(["order NewsArticle.dateModified"]);
  });

  it("종료 = 시작은 통과 (같은 시각 행사)", () => {
    const node = event({ ...sampleEvent, endDate: sampleEvent.startDate })!;
    expect(validate(node)).toEqual([]);
  });

  it("URL 칸이 상대 경로·http(s) 아닌 주소면 format 오류", () => {
    const base = newsArticle(sampleArticle);
    expect(pathsAndCodes({ ...base, url: "/news/x" })).toEqual(["format NewsArticle.url"]);
    expect(pathsAndCodes({ ...base, url: "javascript:alert(1)" })).toEqual(["format NewsArticle.url"]);
  });

  it("eventStatus가 schema.org 값이 아니면 format 오류", () => {
    const node = { ...event(sampleEvent)!, eventStatus: "취소" };
    expect(pathsAndCodes(node)).toEqual(["format Event.eventStatus"]);
  });

  it("Dataset 설명 길이 — 49자 오류, 50자 통과, 5000자 통과, 5001자 오류 (Google 기준)", () => {
    const withLen = (n: number) => pathsAndCodes(dataset({ ...sampleDataset, description: "가".repeat(n) }));
    expect(withLen(49)).toEqual(["format Dataset.description"]);
    expect(withLen(50)).toEqual([]);
    expect(withLen(5000)).toEqual([]);
    expect(withLen(5001)).toEqual(["format Dataset.description"]);
  });

  it("VideoObject 재생 시간이 ISO 8601 기간이 아니면 format 오류", () => {
    const video = {
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: "영상",
      thumbnailUrl: "https://news.example/t.jpg",
      uploadDate: "2026-10-18",
      duration: "1분 30초",
    };
    expect(pathsAndCodes(video)).toEqual(["format VideoObject.duration"]);
    expect(pathsAndCodes({ ...video, duration: "PT1M30S" })).toEqual([]);
  });
});

describe("금지 속성 — 평점·후기·가격 (OPT-02 화면에 없는 값 0)", () => {
  it("금지 목록에 평점·후기·가격 속성이 들어 있다", () => {
    for (const k of ["aggregateRating", "review", "offers", "price", "priceRange", "ratingValue"]) {
      expect(FORBIDDEN_PROPERTIES).toContain(k);
    }
  });

  it("깊은 곳에 있어도 찾아낸다", () => {
    const node = {
      ...newsArticle(sampleArticle),
      author: [{ "@type": "Person", name: "한예린", aggregateRating: { ratingValue: 5 } }],
    };
    expect(pathsAndCodes(node)).toEqual(["forbidden NewsArticle.author[0].aggregateRating"]);
  });

  it("Event에 offers가 있으면 forbidden 오류", () => {
    const node = { ...event(sampleEvent)!, offers: { "@type": "Offer", price: 0 } };
    expect(pathsAndCodes(node)).toEqual(["forbidden Event.offers"]);
  });
});
