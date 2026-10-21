// OPT-02 — 생성기는 화면 데이터 객체에 있는 값만 JSON-LD로 옮긴다.
import { describe, expect, it } from "vitest";
import {
  book,
  breadcrumbList,
  course,
  dataset,
  event,
  newsArticle,
  newsMediaOrganization,
  person,
  profilePage,
  videoObject,
} from "./generators";
import { pageJsonLd } from "./page";
import { EVENT_STATUS_MAP } from "./event-status";
import { displayTitle, sponsorLabelText } from "./labels";
import type { EventScreenStatus } from "./models";
import {
  extraPassSamples,
  passSamples,
  sampleAdArticle,
  sampleArticle,
  sampleArticleBreadcrumb,
  sampleBook,
  sampleCourse,
  sampleDataset,
  sampleEvent,
  sampleOrganization,
  samplePartnerArticle,
  samplePerson,
  sampleSponsoredEvent,
  sampleVideo,
  sampleVideoArticle,
} from "../fixtures/samples";
import { blockedSamples } from "../fixtures/blocked";

const CTX = "https://schema.org";

describe("newsArticle", () => {
  it("감수자(reviewer)가 있을 때만 기사 페이지(WebPage)의 reviewedBy(Person) — 없으면 칸 0, 주소 없으면 이름만 (W3 10단계 · BR-03)", () => {
    expect(newsArticle(sampleArticle).mainEntityOfPage).toEqual({ "@type": "WebPage", "@id": sampleArticle.url });
    expect(JSON.stringify(newsArticle(sampleArticle))).not.toContain("reviewedBy");
    const signed = newsArticle({ ...sampleArticle, reviewer: { name: "시험용 감수위원", url: "https://news.example/people/reviewer-1" } });
    expect(signed.mainEntityOfPage).toEqual({
      "@type": "WebPage",
      "@id": sampleArticle.url,
      reviewedBy: { "@type": "Person", name: "시험용 감수위원", url: "https://news.example/people/reviewer-1" },
    });
    expect(newsArticle({ ...sampleArticle, reviewer: { name: "시험용 감수위원" } }).mainEntityOfPage).toEqual({
      "@type": "WebPage",
      "@id": sampleArticle.url,
      reviewedBy: { "@type": "Person", name: "시험용 감수위원" },
    });
  });

  it("기사 견본의 제목·저자·날짜·이미지·매체를 그대로 옮긴다", () => {
    expect(newsArticle(sampleArticle)).toEqual({
      "@context": CTX,
      "@type": "NewsArticle",
      url: "https://news.example/news/acquisition-tax-relief-deadline",
      mainEntityOfPage: { "@type": "WebPage", "@id": "https://news.example/news/acquisition-tax-relief-deadline" },
      headline: "취득세 감면 신청 기한, 잔금일로부터 60일 안에 해야",
      description: "생애최초 주택 취득세 감면은 잔금일로부터 60일 안에 신청해야 한다.",
      articleSection: "지방세",
      author: [{ "@type": "Person", name: "한예린", url: "https://news.example/people/han-yerin" }],
      publisher: {
        "@type": "Organization",
        name: "가상지방세신문",
        url: "https://news.example",
        logo: { "@type": "ImageObject", url: "https://news.example/brand/logo.png", width: 600, height: 60 },
      },
      datePublished: "2026-10-20T09:00:00+09:00",
      dateModified: "2026-10-21T14:30:00+09:00",
      image: {
        "@type": "ImageObject",
        url: "https://news.example/images/2026/10/relief-deadline.jpg",
        width: 1200,
        height: 675,
      },
    });
  });

  it("수정일·요약·분야가 없는 기사는 그 속성을 내지 않는다 (빈 값 0)", () => {
    const out = newsArticle(sampleVideoArticle);
    expect(out).not.toHaveProperty("dateModified");
    expect(out).not.toHaveProperty("description");
    expect(out.articleSection).toBe("지방세");
  });

  it("단체 저자는 Organization으로 낸다", () => {
    expect(newsArticle(sampleAdArticle).author).toEqual([{ "@type": "Organization", name: "가상지방세신문 광고국" }]);
  });

  it("광고 기사의 headline은 화면 제목과 같은 '[광고]' 표기를 가진다", () => {
    expect(newsArticle(sampleAdArticle).headline).toBe("[광고] 지방세 신고, 앱 하나로 챙기는 법");
    expect(displayTitle(sampleAdArticle.title, sampleAdArticle.sponsorship)).toBe(newsArticle(sampleAdArticle).headline);
  });

  it("공동 기획 기사의 headline은 제휴 배지 '공동 기획 ○○'를 가진다 (ART-10)", () => {
    expect(newsArticle(samplePartnerArticle).headline).toBe("[공동 기획 예시회계연구소] 지방재정 바로 보기 ① 세입 구조");
  });

  it("공동 기획 배지 글자는 '공동 기획 ' + 제휴사 이름, 광고는 '광고' — 이름 앞뒤 공백은 뺀다 (ART-10 · PRD-00 8.8)", () => {
    expect(sponsorLabelText({ kind: "공동 기획", partnerName: " 가온세무법인 " })).toBe("공동 기획 가온세무법인");
    expect(sponsorLabelText({ kind: "광고" })).toBe("광고");
    expect(displayTitle("세입 구조", { kind: "공동 기획", partnerName: "가온세무법인" })).toBe("[공동 기획 가온세무법인] 세입 구조");
  });

  it("제휴사 이름이 비면 '[공동 기획]'만 붙인다 — PRD 배지('공동 기획 ○○')가 아니므로 seo-lint 광고 표기 점검과 발행 판정이 막는다", () => {
    expect(displayTitle("세입 구조", { kind: "공동 기획", partnerName: "" })).toBe("[공동 기획] 세입 구조");
    expect(displayTitle("세입 구조", { kind: "공동 기획", partnerName: "   " })).toBe("[공동 기획] 세입 구조");
  });

  it("광고와 공동 기획은 한 표기 칸이라 섞이지 않는다 — 광고 기사 headline에 '공동 기획'이 없다", () => {
    expect(newsArticle(sampleAdArticle).headline).not.toContain("공동 기획");
    expect(newsArticle(samplePartnerArticle).headline).not.toContain("[광고]");
  });

  it("표기가 없는 기사는 원 제목 그대로다", () => {
    expect(displayTitle("세입 구조", undefined)).toBe("세입 구조");
  });
});

describe("videoObject · breadcrumbList", () => {
  it("동영상 견본을 VideoObject로 옮긴다", () => {
    expect(videoObject(sampleVideo)).toEqual({
      "@context": CTX,
      "@type": "VideoObject",
      name: "1분 해설 — 재산세 납부 기한",
      description: "재산세 7월·9월 납부 기한과 분할 납부 조건을 1분 동안 설명한다.",
      thumbnailUrl: "https://news.example/images/2026/10/property-tax-video.jpg",
      uploadDate: "2026-10-18T10:00:00+09:00",
      duration: "PT1M30S",
      embedUrl: "https://www.youtube-nocookie.com/embed/EXAMPLE0001",
    });
  });

  it("경로 표시 항목에 1부터 차례 번호를 매기고, url이 없는 마지막 항목은 item을 내지 않는다", () => {
    expect(breadcrumbList(sampleArticleBreadcrumb)).toEqual({
      "@context": CTX,
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "홈", item: "https://news.example/" },
        { "@type": "ListItem", position: 2, name: "지방세", item: "https://news.example/tax" },
        { "@type": "ListItem", position: 3, name: "취득세 감면 신청 기한, 잔금일로부터 60일 안에 해야" },
      ],
    });
  });
});

describe("newsMediaOrganization", () => {
  it("매체 견본을 NewsMediaOrganization으로 옮기고 정책 페이지 주소를 속성으로 낸다", () => {
    expect(newsMediaOrganization(sampleOrganization)).toEqual({
      "@context": CTX,
      "@type": "NewsMediaOrganization",
      name: "가상지방세신문",
      url: "https://news.example",
      logo: { "@type": "ImageObject", url: "https://news.example/brand/logo.png", width: 600, height: 60 },
      description: "지방세·부동산·지방재정·지자체 소식을 다루는 가상의 전문 매체",
      sameAs: ["https://social.example/news-example"],
      publishingPrinciples: "https://news.example/about/editorial-policy",
      correctionsPolicy: "https://news.example/about/corrections",
      ethicsPolicy: "https://news.example/about/ethics",
    });
  });

  it("매체 이름은 입력으로만 정해진다 — 다른 이름을 넘기면 그 이름이 나온다", () => {
    expect(newsMediaOrganization({ ...sampleOrganization, name: "다른가상매체" }).name).toBe("다른가상매체");
  });
});

describe("person · profilePage", () => {
  const expectedPerson = {
    "@type": "Person",
    name: "윤서진",
    url: "https://news.example/people/yoon-seojin",
    jobTitle: "수석 연구위원",
    affiliation: { "@type": "Organization", name: "예시세무회계사무소" },
    hasCredential: [{ "@type": "EducationalOccupationalCredential", name: "세무사" }],
    knowsAbout: ["취득세", "재산세"],
    sameAs: ["https://profiles.example/yoon-seojin"],
    image: { "@type": "ImageObject", url: "https://news.example/images/people/yoon-seojin.jpg", width: 400, height: 400 },
  };

  it("인물 견본을 Person으로 옮긴다 — 증빙 항목의 글자만 낸다", () => {
    expect(person(samplePerson)).toEqual({ "@context": CTX, ...expectedPerson });
  });

  it("인물 페이지는 ProfilePage이고 주 엔터티가 같은 Person이다", () => {
    expect(profilePage(samplePerson)).toEqual({
      "@context": CTX,
      "@type": "ProfilePage",
      url: "https://news.example/people/yoon-seojin",
      mainEntity: expectedPerson,
    });
  });

  it("수상은 증빙 항목이 있을 때 award로 낸다", () => {
    const withAward = { ...samplePerson, awards: [{ text: "가상 언론상 2025", evidenceId: "ev-2026-0009" }] };
    expect(person(withAward).award).toEqual(["가상 언론상 2025"]);
  });

  it("사진·직함·소속이 없는 인물은 그 속성을 내지 않는다", () => {
    const out = person({ url: samplePerson.url, name: "윤서진" });
    expect(Object.keys(out).sort()).toEqual(["@context", "@type", "name", "url"]);
  });
});

describe("event — 상태 대응 (LG-12 · LG-16 · REG1-04)", () => {
  it("행사 견본을 Event로 옮긴다 — 이름·시작/종료·장소·주최·상태·공식 URL", () => {
    expect(event(sampleEvent)).toEqual({
      "@context": CTX,
      "@type": "Event",
      name: "예시시 2027년도 예산안 주민설명회",
      url: "https://news.example/local/events/yesi-city-2027-budget-briefing",
      sameAs: "https://city.example/notice/2027-budget-briefing",
      startDate: "2026-11-03T14:00:00+09:00",
      endDate: "2026-11-03T16:00:00+09:00",
      eventStatus: "https://schema.org/EventScheduled",
      location: { "@type": "Place", name: "예시시청 대회의실", address: "예시시 중앙로 1" },
      organizer: { "@type": "Organization", name: "예시시청", url: "https://city.example" },
    });
  });

  const cases: [EventScreenStatus, string | null][] = [
    ["예정", "https://schema.org/EventScheduled"],
    ["진행", "https://schema.org/EventScheduled"],
    ["종료", "https://schema.org/EventScheduled"],
    ["취소", "https://schema.org/EventCancelled"],
    ["변경 확인 중", null],
  ];

  it.each(cases)("화면 상태 '%s' → eventStatus %s", (status, expected) => {
    expect(EVENT_STATUS_MAP[status]).toBe(expected);
    const out = event({ ...sampleEvent, status });
    if (expected === null) expect(out).toBeNull();
    else expect(out?.eventStatus).toBe(expected);
  });

  it("상태 칸을 '취소'로 바꾼 같은 객체 하나에서 화면 상태와 Event 데이터가 함께 바뀐다 (원래 일정은 그대로)", () => {
    const cancelled = { ...sampleEvent, status: "취소" as const };
    const out = event(cancelled)!;
    expect(out.eventStatus).toBe("https://schema.org/EventCancelled");
    expect(out.startDate).toBe(sampleEvent.startDate);
    expect(out.endDate).toBe(sampleEvent.endDate);
  });

  it("변경 확인 중인 회차의 페이지 JSON-LD에 Event가 0개다 (경로 표시는 남는다)", () => {
    const nodes = pageJsonLd({
      kind: "event",
      event: { ...sampleEvent, status: "변경 확인 중" },
      breadcrumb: { items: [{ name: "홈", url: "https://news.example/" }, { name: "행사안내" }] },
    });
    expect(nodes.map((n) => n["@type"])).toEqual(["BreadcrumbList"]);
  });

  it("상업 행사의 이름은 화면과 같은 '[광고]' 표기를 가진다 (LG-13)", () => {
    expect(event(sampleSponsoredEvent)?.name).toBe("[광고] 부동산 세금 설명회");
  });

  it("화면 상태 5개 밖의 값(예: DB 원문 'canceled')이 오면 조용히 넘기지 않고 오류를 낸다", () => {
    expect(() => event({ ...sampleEvent, status: "canceled" as EventScreenStatus })).toThrow(TypeError);
  });

  it("주소가 없는 장소는 address를 지어내지 않는다", () => {
    const out = event({ ...sampleEvent, venue: { name: "예시시청 대회의실" } })!;
    expect(out.location).toEqual({ "@type": "Place", name: "예시시청 대회의실" });
  });
});

describe("book · course · dataset", () => {
  it("도서 견본을 Book으로 옮긴다 — 판차·출판사·출간일, 가격 없음", () => {
    expect(book(sampleBook)).toEqual({
      "@context": CTX,
      "@type": "Book",
      name: "가상 지방세 실무 입문",
      url: "https://news.example/store/books/local-tax-practice-intro",
      author: [{ "@type": "Person", name: "강도윤", url: "https://news.example/people/kang-doyun" }],
      bookEdition: "제3판",
      publisher: { "@type": "Organization", name: "예시출판" },
      datePublished: "2026-03-02",
      image: {
        "@type": "ImageObject",
        url: "https://news.example/images/books/local-tax-practice-intro.jpg",
        width: 600,
        height: 860,
      },
      numberOfPages: 512,
    });
  });

  it("강좌 견본을 Course로 옮기고 회차를 CourseInstance로 낸다", () => {
    expect(course(sampleCourse)).toEqual({
      "@context": CTX,
      "@type": "Course",
      name: "2027 개정 지방세법 실무 과정",
      description: "2027년 시행 지방세법 개정 내용을 세목별로 짚고 신고 실무 사례를 함께 본다.",
      url: "https://news.example/edu/2027-local-tax-amendment-course",
      provider: { "@type": "Organization", name: "예시지방세교육원", url: "https://edu.example" },
      audience: { "@type": "Audience", audienceType: "지자체 세무 공무원" },
      hasCourseInstance: [
        {
          "@type": "CourseInstance",
          courseMode: "Onsite",
          startDate: "2026-12-07T09:30:00+09:00",
          endDate: "2026-12-08T17:00:00+09:00",
          location: { "@type": "Place", name: "예시교육원 강의실 2", address: "예시시 배움로 10" },
        },
      ],
    });
  });

  it("강좌 진행 방식 online·blended를 Online·Blended로 낸다", () => {
    const out = course({
      ...sampleCourse,
      sessions: [
        { startDate: "2027-01-05T10:00:00+09:00", mode: "online" },
        { startDate: "2027-02-05T10:00:00+09:00", mode: "blended" },
      ],
    });
    expect((out.hasCourseInstance as { courseMode: string }[]).map((s) => s.courseMode)).toEqual(["Online", "Blended"]);
  });

  it("통계 견본을 Dataset으로 옮긴다 — 제공기관·이용 조건·기간·지역·지표·원문", () => {
    expect(dataset(sampleDataset)).toEqual({
      "@context": CTX,
      "@type": "Dataset",
      name: "부동산 PF 대출 연체율 분기 추이",
      description: sampleDataset.description,
      url: "https://news.example/finance/trackers/pf-delinquency",
      creator: { "@type": "Organization", name: "예시금융통계원", url: "https://stats.example" },
      license: "https://stats.example/license",
      temporalCoverage: "2024-01/2026-06",
      spatialCoverage: "전국",
      variableMeasured: [{ "@type": "PropertyValue", name: "연체율", unitText: "%" }],
      dateModified: "2026-10-10",
      isBasedOn: "https://stats.example/pf/delinquency",
      distribution: [
        {
          "@type": "DataDownload",
          contentUrl: "https://news.example/finance/trackers/pf-delinquency.csv",
          encodingFormat: "text/csv",
        },
      ],
    });
  });
});

describe("pageJsonLd — 페이지 단위 조합 (유형 대응표 순서)", () => {
  it("기사 + 경로 표시 → [NewsArticle, BreadcrumbList]", () => {
    expect(pageJsonLd(passSamples.article).map((n) => n["@type"])).toEqual(["NewsArticle", "BreadcrumbList"]);
  });

  it("동영상 기사 → [NewsArticle, VideoObject]", () => {
    expect(pageJsonLd({ kind: "article", article: sampleVideoArticle }).map((n) => n["@type"])).toEqual([
      "NewsArticle",
      "VideoObject",
    ]);
  });

  it("인물 페이지 → [ProfilePage]", () => {
    expect(pageJsonLd(passSamples.person).map((n) => n["@type"])).toEqual(["ProfilePage"]);
  });

  it("모든 최상위 노드에 @context가 있다", () => {
    for (const input of [...Object.values(passSamples), ...extraPassSamples.map((s) => s.input)]) {
      for (const node of pageJsonLd(input)) expect(node["@context"]).toBe(CTX);
    }
  });
});

/** 객체 안의 모든 키 (깊이 끝까지) */
function allKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => allKeys(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      allKeys(v, out);
    }
  }
  return out;
}

const FORBIDDEN = /^(aggregateRating|review|reviews|reviewRating|rating|ratingValue|ratingCount|reviewCount|bestRating|worstRating|offers|price|priceRange|priceCurrency|priceSpecification|lowPrice|highPrice)$/;

describe("화면에 없는 값 0 — 평점·후기·가격 (OPT-02 · EXPL-02 · EXPL-12)", () => {
  it("통과·차단 견본 전부의 생성 결과 어디에도 평점·후기·가격 키가 없다", () => {
    const inputs = [
      ...Object.values(passSamples),
      ...extraPassSamples.map((s) => s.input),
      ...blockedSamples.map((s) => s.input),
    ];
    const keys = inputs.flatMap((i) => allKeys(pageJsonLd(i)));
    expect(keys.length).toBeGreaterThan(100);
    expect(keys.filter((k) => FORBIDDEN.test(k))).toEqual([]);
  });

  it("DB 행처럼 평점·가격 칸이 더 붙은 객체를 넘겨도 생성 결과에 그 값이 없다", () => {
    const bookRow = {
      ...sampleBook,
      price: 32000,
      offers: { price: 32000, priceCurrency: "KRW" },
      aggregateRating: { ratingValue: 4.8 },
    };
    const personRow = { ...samplePerson, rating: 5, review: [{ reviewBody: "좋아요" }], reviewCount: 12 };
    const eventRow = { ...sampleEvent, offers: { price: 0 }, tentativeStartDate: "2026-12-01T10:00:00+09:00" };
    const out = [book(bookRow), profilePage(personRow), event(eventRow)];
    expect(allKeys(out).filter((k) => FORBIDDEN.test(k))).toEqual([]);
    expect(JSON.stringify(out)).not.toContain("32000");
    expect(JSON.stringify(out)).not.toContain("2026-12-01");
  });
});

describe("결정론 · 입력 불변", () => {
  it("같은 입력이면 두 번 생성한 결과가 같다", () => {
    for (const input of Object.values(passSamples)) {
      expect(JSON.stringify(pageJsonLd(input))).toBe(JSON.stringify(pageJsonLd(input)));
    }
  });

  it("생성기는 입력 객체를 바꾸지 않는다 (깊게 얼린 입력으로도 동작)", () => {
    const deepFreeze = <T>(o: T): T => {
      if (o && typeof o === "object") {
        Object.values(o).forEach(deepFreeze);
        Object.freeze(o);
      }
      return o;
    };
    const frozen = deepFreeze(structuredClone(passSamples.article));
    expect(() => pageJsonLd(frozen)).not.toThrow();
    expect(pageJsonLd(frozen)).toEqual(pageJsonLd(passSamples.article));
  });
});
