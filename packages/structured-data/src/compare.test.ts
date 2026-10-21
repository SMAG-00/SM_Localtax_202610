// OPT-02 · OPT-03 — 렌더 값 ↔ JSON-LD 대조. 하나라도 다르면 seo-lint의 '구조화 데이터 불일치' 차단 항목이다.
import { describe, expect, it } from "vitest";
import { compareRendered, MISMATCH, MISMATCH_LABELS, type RenderedFacts } from "./compare";
import { pageJsonLd } from "./page";
import { profilePage } from "./generators";
import { toJsonLdScriptContent } from "./serialize";
import type { JsonLdNode } from "./jsonld";
import { passSamples, sampleAdArticle, sampleArticle, sampleEvent, samplePerson } from "../fixtures/samples";
import { renderedAdArticle, renderedArticle, renderedEvent } from "../fixtures/rendered";

const articleNodes = pageJsonLd(passSamples.article);
const eventNodes = pageJsonLd(passSamples.event);

describe("같으면 불일치 0", () => {
  it("기사 화면 값과 기사 JSON-LD가 같으면 []", () => {
    expect(compareRendered(renderedArticle, articleNodes)).toEqual([]);
  });

  it("광고 기사 — 화면 제목의 '[광고]'와 headline이 같으면 []", () => {
    expect(compareRendered(renderedAdArticle, pageJsonLd({ kind: "article", article: sampleAdArticle }))).toEqual([]);
  });

  it("행사 화면 값과 Event JSON-LD가 같으면 []", () => {
    expect(compareRendered(renderedEvent, eventNodes)).toEqual([]);
  });

  it("script 태그 내용(문자열)을 그대로 넘겨도 대조한다", () => {
    expect(compareRendered(renderedArticle, toJsonLdScriptContent(articleNodes))).toEqual([]);
  });

  it("같은 순간을 다른 시간대로 적은 날짜는 같은 값으로 본다", () => {
    const facts = { ...renderedArticle, datePublished: "2026-10-20T00:00:00Z" };
    expect(compareRendered(facts, articleNodes)).toEqual([]);
  });

  it("제목 앞뒤 공백·연속 공백 차이는 불일치가 아니다 (HTML 렌더는 공백을 합친다)", () => {
    const facts = { ...renderedArticle, title: "  취득세 감면 신청 기한,  잔금일로부터 60일 안에 해야 " };
    expect(compareRendered(facts, articleNodes)).toEqual([]);
  });

  it("저자 순서만 다른 것은 불일치가 아니다", () => {
    const twoAuthors = pageJsonLd({
      kind: "article",
      article: {
        ...sampleArticle,
        authors: [
          { kind: "person", name: "한예린" },
          { kind: "person", name: "오지훈" },
        ],
      },
    });
    expect(compareRendered({ ...renderedArticle, authorNames: ["오지훈", "한예린"] }, twoAuthors)).toEqual([]);
  });

  it("인물 페이지는 주 엔터티 Person의 이름·사진과 대조한다", () => {
    const facts: RenderedFacts = {
      title: "윤서진",
      mainImageUrl: "https://news.example/images/people/yoon-seojin.jpg",
    };
    expect(compareRendered(facts, [profilePage(samplePerson)])).toEqual([]);
    expect(compareRendered({ ...facts, title: "윤서준" }, [profilePage(samplePerson)])).toEqual([MISMATCH.HEADLINE]);
  });

  it("인물 약력 — 화면 약력 글자와 Person.description이 같으면 0, 한쪽에만 있거나 다르면 PERSON_DESCRIPTION 하나 (BR-02)", () => {
    const facts: RenderedFacts = { title: "윤서진", mainImageUrl: "https://news.example/images/people/yoon-seojin.jpg" };
    const withBio = [profilePage({ ...samplePerson, description: "시험용 약력 가 · 시험용 약력 나" })];
    expect(compareRendered({ ...facts, description: "시험용 약력 가 · 시험용 약력 나" }, withBio)).toEqual([]);
    expect(compareRendered(facts, withBio), "화면에 없는 약력이 구조화 데이터에만").toEqual([MISMATCH.PERSON_DESCRIPTION]);
    expect(compareRendered({ ...facts, description: "시험용 약력 가" }, withBio), "줄 수가 다름").toEqual([MISMATCH.PERSON_DESCRIPTION]);
    expect(compareRendered({ ...facts, description: "시험용 약력 가" }, [profilePage(samplePerson)]), "화면에만").toEqual([MISMATCH.PERSON_DESCRIPTION]);
  });

  it("기사 페이지는 약력을 보지 않는다 — 기사 대조 결과는 그대로", () => {
    expect(compareRendered(renderedArticle, articleNodes)).toEqual([]);
  });
});

describe("항목 하나가 다르면 그 불일치 id 하나", () => {
  const cases: [string, RenderedFacts, string][] = [
    ["제목", { ...renderedArticle, title: "취득세 감면 신청 기한, 잔금일로부터 90일 안에 해야" }, MISMATCH.HEADLINE],
    ["저자", { ...renderedArticle, authorNames: ["오지훈"] }, MISMATCH.AUTHOR],
    ["저자 수", { ...renderedArticle, authorNames: ["한예린", "오지훈"] }, MISMATCH.AUTHOR],
    ["발행일", { ...renderedArticle, datePublished: "2026-10-20T10:00:00+09:00" }, MISMATCH.DATE_PUBLISHED],
    ["수정일", { ...renderedArticle, dateModified: "2026-10-22T14:30:00+09:00" }, MISMATCH.DATE_MODIFIED],
    ["대표 이미지", { ...renderedArticle, mainImageUrl: "https://news.example/images/other.jpg" }, MISMATCH.IMAGE],
  ];

  it.each(cases)("기사 %s", (_name, facts, id) => {
    expect(compareRendered(facts, articleNodes)).toEqual([id]);
  });

  const ev = renderedEvent.event!;
  const eventCases: [string, RenderedFacts, string][] = [
    ["행사 이름", { ...renderedEvent, title: "예시시 2027년도 예산안 설명회" }, MISMATCH.HEADLINE],
    ["시작", { ...renderedEvent, event: { ...ev, startDate: "2026-11-03T15:00:00+09:00" } }, MISMATCH.EVENT_START],
    ["종료", { ...renderedEvent, event: { ...ev, endDate: "2026-11-03T17:00:00+09:00" } }, MISMATCH.EVENT_END],
    ["상태", { ...renderedEvent, event: { ...ev, status: "취소" } }, MISMATCH.EVENT_STATUS],
    ["장소", { ...renderedEvent, event: { ...ev, locationName: "예시시청 소회의실" } }, MISMATCH.EVENT_LOCATION],
  ];

  it.each(eventCases)("행사 %s", (_name, facts, id) => {
    expect(compareRendered(facts, eventNodes)).toEqual([id]);
  });

  it("화면에 수정일이 없는데 JSON-LD에 있으면 불일치 (화면에 없는 값 0)", () => {
    const { dateModified: _d, ...facts } = renderedArticle;
    expect(compareRendered(facts, articleNodes)).toEqual([MISMATCH.DATE_MODIFIED]);
  });

  it("화면에 대표 이미지가 있는데 JSON-LD에 없으면 불일치", () => {
    const noImage = pageJsonLd({ kind: "article", article: { ...sampleArticle, mainImage: undefined } });
    expect(compareRendered(renderedArticle, noImage)).toEqual([MISMATCH.IMAGE]);
  });

  it("광고 기사인데 headline에 표기가 빠졌으면 불일치", () => {
    const [node, ...rest] = pageJsonLd({ kind: "article", article: sampleAdArticle });
    const stripped: JsonLdNode = { ...node, headline: sampleAdArticle.title };
    expect(compareRendered(renderedAdArticle, [stripped, ...rest])).toEqual([MISMATCH.HEADLINE]);
  });

  it("여러 항목이 다르면 정해진 순서로 모두 나온다", () => {
    const facts = { ...renderedArticle, title: "다른 제목", mainImageUrl: "https://news.example/x.jpg", authorNames: [] };
    expect(compareRendered(facts, articleNodes)).toEqual([MISMATCH.HEADLINE, MISMATCH.AUTHOR, MISMATCH.IMAGE]);
  });
});

describe("행사 상태 — 화면과 Event가 같은 렌더에서 함께 바뀐다 (LG-12 · LG-16)", () => {
  it("상태 칸을 '취소'로 바꾼 객체로 다시 그리면 화면 '취소'와 Event 취소가 일치한다", () => {
    const cancelled = pageJsonLd({ kind: "event", event: { ...sampleEvent, status: "취소" } });
    const facts = { ...renderedEvent, event: { ...renderedEvent.event!, status: "취소" as const } };
    expect(compareRendered(facts, cancelled)).toEqual([]);
  });

  it("화면만 '취소'로 바뀌고 JSON-LD가 예전(예정)이면 상태 불일치", () => {
    const facts = { ...renderedEvent, event: { ...renderedEvent.event!, status: "취소" as const } };
    expect(compareRendered(facts, eventNodes)).toEqual([MISMATCH.EVENT_STATUS]);
  });

  it("화면이 '변경 확인 중'이고 Event가 없으면 []", () => {
    const pending = pageJsonLd({ kind: "event", event: { ...sampleEvent, status: "변경 확인 중" } });
    const facts = { ...renderedEvent, event: { ...renderedEvent.event!, status: "변경 확인 중" as const } };
    expect(pending).toEqual([]);
    expect(compareRendered(facts, pending)).toEqual([]);
  });

  it("화면이 '변경 확인 중'인데 예전 Event가 남아 있으면 상태 불일치 (확정되지 않은 일정을 확정처럼 보임)", () => {
    const facts = { ...renderedEvent, event: { ...renderedEvent.event!, status: "변경 확인 중" as const } };
    expect(compareRendered(facts, eventNodes)).toEqual([MISMATCH.EVENT_STATUS]);
  });

  it("화면에 행사가 있는데 Event 노드가 없으면 노드 없음", () => {
    expect(compareRendered(renderedEvent, [])).toEqual([MISMATCH.NODE_MISSING]);
  });

  it("화면에 행사 정보가 없는데 Event 노드가 있으면 행사 날짜 불일치", () => {
    expect(compareRendered({ title: renderedEvent.title }, eventNodes)).toEqual([
      MISMATCH.EVENT_START,
      MISMATCH.EVENT_END,
      MISMATCH.EVENT_STATUS,
      MISMATCH.EVENT_LOCATION,
    ]);
  });
});

describe("불일치 id 상수", () => {
  it("id가 겹치지 않고, 모두 편집기 패널에 보일 한국어 이름이 있다", () => {
    const ids = Object.values(MISMATCH);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(MISMATCH_LABELS[id]).toMatch(/[가-힣]/);
  });

  it("수정일 불일치 이름은 편집기 패널 문구와 같다 (PRD-01A 편집기 그림)", () => {
    expect(MISMATCH_LABELS[MISMATCH.DATE_MODIFIED]).toBe("구조화 데이터 수정일 ≠ 화면 수정일");
  });
});
