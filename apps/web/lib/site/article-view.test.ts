// 기사 상세 화면 값 — 표기 배지(목록 카드와 같은 규칙) · 부분 순서 · 날짜 줄 · 문단 링크 · 표 · 「지방세로 읽기」 링크 · 정책 링크
import { describe, expect, test } from "vitest";
import {
  ARTICLE_PARTS,
  articleParts,
  dateLines,
  kstDateTime,
  paragraphSegments,
  partnerBadgeFor,
  reporterPolicyLinks,
  seriesLine,
  sponsorText,
  tableView,
  taxLensBoxLinks,
  typeBadgeFor,
  videoHref,
  type ArticleShape,
} from "./article-view";

describe("표기 배지 (ART-10 · PRD-00 8.8)", () => {
  test("광고 — 유형 배지 '광고' 하나 (제휴 배지 0)", () => {
    expect(typeBadgeFor("sponsored", { kind: "ad" })).toBe("sponsored");
    expect(partnerBadgeFor({ kind: "ad" })).toBeUndefined();
    expect(sponsorText({ kind: "ad" })).toBe("광고");
  });
  test("공동 기획 — 제휴 배지 '공동 기획 ○○' 하나, 유형 배지 '광고'는 붙이지 않는다", () => {
    const co = { kind: "co_planned" as const, partner: "가온세무법인" };
    expect(typeBadgeFor("sponsored", co)).toBeUndefined();
    expect(partnerBadgeFor(co)).toBe("가온세무법인");
    expect(sponsorText(co)).toBe("공동 기획 가온세무법인");
  });
  test.each([
    ["reported_news", "reported_news"],
    ["explainer", "explainer"],
    ["guide", "guide"],
    ["opinion", "opinion"],
    [null, undefined],
    ["unknown", undefined],
  ] as const)("표기 없는 기사 — 유형 %s → 배지 %s", (type, kind) => {
    expect(typeBadgeFor(type, null)).toBe(kind);
    expect(sponsorText(null)).toBeNull();
  });
});

describe("부분 순서 (ART-02)", () => {
  const base: ArticleShape = {
    updates: [],
    corrections: [],
    banner: null,
    taxLens: null,
    author: null,
    product: null,
    disclaimer: false,
    related: [],
    similarCases: [],
    nextActions: [],
    policyLinks: [],
  };
  test("내용 0건이면 머리·본문만 — 정정 이력·박스·기자 소개 자리 0", () => {
    expect(articleParts(base)).toEqual(["head", "body"]);
  });
  test("모두 있으면 고정 순서 — 알림은 본문 위, 「지방세로 읽기」는 본문 뒤·기자 소개 앞", () => {
    const all = articleParts({ ...base, updates: [1], taxLens: {}, author: {}, product: {}, disclaimer: true, related: [1], nextActions: [1], policyLinks: [1] });
    expect(all).toEqual([...ARTICLE_PARTS]);
    expect(all.indexOf("notices")).toBeLessThan(all.indexOf("body"));
    expect(all.indexOf("body")).toBeLessThan(all.indexOf("tax-lens"));
    expect(all.indexOf("tax-lens")).toBeLessThan(all.indexOf("reporter"));
  });
  test("정정 1건·갱신 배너만 있어도 알림 자리, 비슷한 사례만 있어도 다음 행동 띠", () => {
    expect(articleParts({ ...base, corrections: [1] })).toContain("notices");
    expect(articleParts({ ...base, banner: { stageLabel: "공포" } })).toContain("notices");
    expect(articleParts({ ...base, similarCases: [1] })).toContain("next");
  });
});

describe("날짜 줄 (OPT-07)", () => {
  test("최초 발행은 한국 시간, 실질 수정은 있을 때만", () => {
    expect(dateLines({ firstPublishedAt: "2026-10-17T15:30:00Z", substantiveUpdatedAt: null, legalBasisDate: null })).toEqual({
      published: { iso: "2026-10-17T15:30:00Z", text: "2026-10-18 00:30" },
      modified: null,
      basis: null,
    });
    const d = dateLines({ firstPublishedAt: "2026-10-17T15:30:00Z", substantiveUpdatedAt: "2026-10-19T01:00:00+00:00", legalBasisDate: "2026-10-01" });
    expect(d.modified).toEqual({ iso: "2026-10-19T01:00:00+00:00", text: "2026-10-19 10:00" });
    expect(d.basis).toBe("2026-10-01");
  });
  test("읽을 수 없는 시각은 글자 그대로", () => expect(kstDateTime("곧")).toBe("곧"));
});

describe("연재 줄 (ART-04)", () => {
  test("연재 칼럼만", () => {
    expect(seriesLine({ title: "그때와 지금", episode: 3 })).toBe("연재 「그때와 지금」 3회");
    expect(seriesLine(null)).toBeNull();
  });
});

describe("문단 링크 [글](주소)", () => {
  test("사이트 안·바깥 http(s) 주소만 링크, 앞뒤 글은 그대로", () => {
    expect(paragraphSegments("자세한 내용은 [해설](/news/acq)과 [법령](https://www.law.go.kr/a)을 보세요.")).toEqual([
      { kind: "text", text: "자세한 내용은 " },
      { kind: "link", text: "해설", href: "/news/acq", external: false },
      { kind: "text", text: "과 " },
      { kind: "link", text: "법령", href: "https://www.law.go.kr/a", external: true },
      { kind: "text", text: "을 보세요." },
    ]);
  });
  test("숨긴 경로·v1.2 경로·다른 사이트(//)·스크립트 주소는 링크로 만들지 않는다 (글 그대로)", () => {
    for (const href of ["/region/seoul", "/calc/acquisition", "//evil.example.com", "javascript:alert(1)"]) {
      expect(paragraphSegments(`[여기](${href})`)).toEqual([{ kind: "text", text: `[여기](${href})` }]);
    }
  });
  test("링크 없는 문단은 조각 하나, 빈 문단은 0", () => {
    expect(paragraphSegments("그냥 문장")).toEqual([{ kind: "text", text: "그냥 문장" }]);
    expect(paragraphSegments("")).toEqual([]);
  });
});

describe("표 블록", () => {
  test("첫 행이 머리 행, 빈 행은 뺀다, 한 행뿐이면 머리 없음, 빈 표는 null", () => {
    expect(tableView([["구", "억 원"], ["한빛구", "512"], [" ", ""]])).toEqual({ head: ["구", "억 원"], body: [["한빛구", "512"]] });
    expect(tableView([["한 줄", "1"]])).toEqual({ head: null, body: [["한 줄", "1"]] });
    expect(tableView([])).toBeNull();
  });
});

describe("「지방세로 읽기」 박스 링크 · 기자 소개 정책 링크", () => {
  test("CMS 링크 종류 → 박스 종류, 같은 종류는 앞의 것", () => {
    expect(
      taxLensBoxLinks([
        { kind: "explainer", href: "/news/a" },
        { kind: "calculator", href: "https://sm.example.com/calc" },
        { kind: "explainer", href: "/news/b" },
        { kind: "book", href: "/store/x" },
        { kind: "expert", href: "/experts?field=tax" },
      ]),
    ).toEqual({
      explainer: { href: "/news/a", enabled: true },
      smCalculator: { href: "https://sm.example.com/calc", enabled: true },
      product: { href: "/store/x", enabled: true },
      experts: { href: "/experts?field=tax", enabled: true },
    });
  });
  test("정정·반론 창구와 편집 원칙은 공개 승인된 것만 — 아니면 null(링크 0)", () => {
    expect(reporterPolicyLinks([])).toEqual({ correctionHref: null, editorialPolicyHref: null });
    expect(reporterPolicyLinks([{ key: "corrections", href: "/about/corrections" }, { key: "about", href: "/about" }])).toEqual({ correctionHref: "/about/corrections", editorialPolicyHref: null });
  });
});

describe("동영상 블록", () => {
  test("유튜브 nocookie https 주소만 (ART-08)", () => {
    expect(videoHref("https://www.youtube-nocookie.com/embed/abc")).toBe("https://www.youtube-nocookie.com/embed/abc");
    expect(videoHref("https://www.youtube.com/embed/abc")).toBeNull();
    expect(videoHref("http://www.youtube-nocookie.com/embed/abc")).toBeNull();
    expect(videoHref("아무 글")).toBeNull();
  });
});
