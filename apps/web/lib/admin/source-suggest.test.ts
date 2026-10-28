import { describe, expect, test } from "vitest";
import { domainInfo } from "./source-domains";
import { addBlockers, candidateToForm, publishGaps, singleDateIn, suggestSources, type SourceCheck } from "./source-suggest";

// 기사 1번 원고(docs/demo/briefing-2026-10-19/briefing.md)의 출처 줄 — 미추적 파일이라 필요한 줄을 옮겨 쓴다
const MOIS = "출처: 행정안전부 지방세정책과 · 보도자료 2026.8.26 · [행정안전부 보도자료 원문](https://www.mois.go.kr/frt/bbs/type010/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000008&nttId=129005)";
const MULTI = "출처: 연합뉴스 · 2026.10.16 [기사 원문](https://www.yna.co.kr/view/AKR20261016058300003) · 매일경제 · 2026.10.14 [강남 매물 증가](https://www.mk.co.kr/news/realestate/12175787)";
const NEWS = "출처: 뉴스핌 · 2026.10.15 [기사 원문](https://www.newspim.com/news/view/20261015000426) · 뉴스1 · 2026.10.15 [한국은행 판단](https://www.news1.kr/photos/8160612)";
const CHOSUN = "출처: 조선비즈 · 2026.10.16 [기사 원문](https://biz.chosun.com/real_estate/real_estate_general/2026/10/16/NPJKY2WSG5GUTLRXF7C44ETUZI/)";
const OPTS = { today: "2026-10-28", coversBillStatus: true, allowedSourceTypes: ["ordinance", "bill"], existingUrls: [] as string[] };
const para = (text: string) => ({ type: "paragraph", text });

describe("suggestSources — 기사 1번 출처 줄", () => {
  test("행안부 보도자료 줄: 공식 문서·발표기관·제목·발표일·자료 종류 bill·수집일을 채운다", () => {
    const [c] = suggestSources([para(MOIS)], OPTS);
    expect(c).toMatchObject({
      kind: "official_doc",
      title: "행정안전부 지방세정책과 · 보도자료 2026.8.26",
      publisher: "행정안전부",
      published_on: "2026-08-26",
      source_type: "bill",
      collected_on: "2026-10-28",
    });
    expect(c!.url).toBe("https://www.mois.go.kr/frt/bbs/type010/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000008&nttId=129005");
    expect(c!.basis.published_on).toContain("2026.8.26");
  });

  test("법안 상태 기사가 아니거나 허용 목록에 bill이 없으면 자료 종류를 비운다", () => {
    expect(suggestSources([para(MOIS)], { ...OPTS, coversBillStatus: false })[0]!.source_type).toBe("");
    expect(suggestSources([para(MOIS)], { ...OPTS, allowedSourceTypes: ["ordinance"] })[0]!.source_type).toBe("");
  });

  test("한 줄에 링크 둘: 링크 앞 구간마다 제목·날짜를 따로 읽고 언론사는 기타 종류", () => {
    const list = suggestSources([para(MULTI)], OPTS);
    expect(list.map((c) => [c.kind, c.title, c.publisher, c.published_on, c.source_type])).toEqual([
      ["other", "연합뉴스 · 2026.10.16", "연합뉴스", "2026-10-16", ""],
      ["other", "매일경제 · 2026.10.14", "매일경제", "2026-10-14", ""],
    ]);
  });

  test("뉴스핌·뉴스1·조선비즈 도메인 표", () => {
    const list = suggestSources([para(NEWS), para(CHOSUN)], OPTS);
    expect(list.map((c) => c.publisher)).toEqual(["뉴스핌", "뉴스1", "조선비즈"]);
  });

  test("같은 주소는 하나로 합치고 '출처:' 줄 글자를 우선한다", () => {
    const list = suggestSources([para("본문 설명 [원문](https://www.yna.co.kr/view/A1)"), para("출처: 연합뉴스 · 2026.10.16 [기사 원문](https://www.yna.co.kr/view/A1)")], OPTS);
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe("연합뉴스 · 2026.10.16");
  });

  test("이미 등록된 출처 주소는 뺀다 (끝 슬래시 차이 무시)", () => {
    const list = suggestSources([para(MULTI)], { ...OPTS, existingUrls: ["https://www.yna.co.kr/view/AKR20261016058300003/"] });
    expect(list.map((c) => c.publisher)).toEqual(["매일경제"]);
  });

  test("출처 줄이 아닌 문장의 링크는 링크 글자를 제목으로 쓰고 날짜는 비운다", () => {
    const [c] = suggestSources([para("2026.8.26 정부가 발표했습니다 [발표 원문](https://www.molit.go.kr/a)")], OPTS);
    expect(c).toMatchObject({ title: "발표 원문", published_on: "", publisher: "국토교통부", kind: "official_doc" });
  });

  test("표 칸·안내 상자 안의 링크도 뽑고 소제목은 보지 않는다", () => {
    const blocks = [
      { type: "table", caption: "표", rows: [["항목", "출처: 법제처 · 2026.1.5 [법령](https://www.law.go.kr/x)"]] },
      { type: "callout", kind: "note", title: "안내", text: "[국세청](https://www.nts.go.kr/y)" },
      { type: "heading", level: 2, text: "[제목](https://www.mois.go.kr/z)" },
    ];
    const list = suggestSources(blocks, OPTS);
    expect(list.map((c) => c.publisher)).toEqual(["법제처 국가법령정보센터", "국세청"]);
    expect(list[0]!.published_on).toBe("2026-01-05");
  });

  test("날짜가 여러 개면 발표일을 비운다 (서로 같은 날짜 반복은 하나로)", () => {
    expect(suggestSources([para("출처: 행안부 · 2026.8.26 · 2026.8.27 [원문](https://www.mois.go.kr/a)")], OPTS)[0]!.published_on).toBe("");
    expect(suggestSources([para("출처: 행안부 · 2026.8.26 · 2026-08-26 [원문](https://www.mois.go.kr/a)")], OPTS)[0]!.published_on).toBe("2026-08-26");
  });

  test("모르는 도메인은 발표기관을 비우고 기타 종류, 모르는 .go.kr은 기관 비움·공식 문서", () => {
    const [a, b] = suggestSources([para("출처: 어딘가 [x](https://example.org/p) [y](https://foo.go.kr/q)")], OPTS);
    expect(a).toMatchObject({ kind: "other", publisher: "" });
    expect(b).toMatchObject({ kind: "official_doc", publisher: "" });
  });

  test("링크가 없으면 후보 없음, http 아닌 링크는 무시", () => {
    expect(suggestSources([para("링크 없음"), para("[메일](mailto:a@b.kr)")], OPTS)).toEqual([]);
  });
});

describe("singleDateIn · domainInfo", () => {
  test("없는 날짜(2월 30일)는 날짜로 보지 않는다", () => {
    expect(singleDateIn("2026.2.30")).toBeNull();
    expect(singleDateIn("2026.10.16")).toEqual({ iso: "2026-10-16", raw: "2026.10.16" });
  });
  test("하위 도메인은 표에 맞고 이름만 비슷한 도메인은 맞지 않는다", () => {
    expect(domainInfo("https://www.mois.go.kr/a").publisher).toBe("행정안전부");
    expect(domainInfo("https://notmois.go.kr/a").publisher).toBe("");
    expect(domainInfo("https://mois.go.kr.evil.com/a")).toMatchObject({ publisher: "", kind: "other" });
  });
});

describe("candidateToForm · addBlockers", () => {
  const [cand] = suggestSources([para(MOIS)], OPTS);
  const ok: SourceCheck = { ok: true, reason: null, verified_on: "2026-10-28", license_type: "kogl_1", license_status: "공공누리 1유형(출처표시)", license_basis: "x", auto_verified: true };

  test("확인 성공: 확인일·공공누리·이용 조건이 폼에 들어가 이대로 추가 가능, 기준일·지역 단위는 발행 전 빈 칸", () => {
    const f = candidateToForm(cand!, ok);
    expect(f).toMatchObject({ lastVerifiedDate: "2026-10-28", licenseType: "kogl_1", licenseStatus: "공공누리 1유형(출처표시)", sourceName: "행정안전부", sourceType: "bill" });
    expect(addBlockers(f)).toEqual([]);
    expect(publishGaps(f)).toEqual(["기준일", "지역 단위"]);
  });

  test("확인 실패·미확인: 확인일·공공누리를 비우고 이대로 추가를 막는다", () => {
    const failed: SourceCheck = { ...ok, ok: false, reason: "HTTP 404", verified_on: null, license_type: null, license_status: null };
    expect(addBlockers(candidateToForm(cand!, failed))).toEqual(["확인일", "이용 조건", "공공누리 유형"]);
    expect(addBlockers(candidateToForm(cand!, null))).toEqual(["확인일", "이용 조건", "공공누리 유형"]);
  });

  test("공식 자료가 아닌 후보는 막지 않는다", () => {
    const [news] = suggestSources([para(CHOSUN)], OPTS);
    expect(addBlockers(candidateToForm(news!, null))).toEqual([]);
  });
});
