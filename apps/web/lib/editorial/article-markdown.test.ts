// 편집위원 데스크 → 기사 초안 옮기기: 지침 v4 11장 출고 형식 md 읽기
// 두 형식을 다 읽는다 — ① 대괄호 형식(2026-11-15·11-01_4: [섹션] 줄, ## 본문, ◇ 소제목) ② 머리말 형식(10-31·11-01: --- title ---, **[섹션]**, ## 1. 소제목)
import { describe, expect, test } from "vitest";
import { parseArticleMarkdown } from "./article-markdown";

const BRACKET = `# 30년 산 집에 공제 한도 10억…장기거주 소득공제의 역설

[섹션] 전문가 칼럼

[제목] 30년 산 집에 공제 한도 10억…장기거주 소득공제의 역설

[제목 대안]

1. 보유는 빼고 거주만 센다
2. 오래 지킨 집일수록 손해 보는 공제

[부제] 2028년부터 거주 중심으로 개편…세금이 3.6배까지 차이가 납니다

[이미지 캡션] ▲오래 살아온 아파트 거실 창가. (이미지: AI 생성, OpenAI gpt-image-2)

## 본문

이준수 기자(공인회계사·세무사)

은퇴를 앞둔 1주택자라면 **2027년 12월 31일**을 기억해 둘 필요가 있습니다.
개편 방향 자체는 수긍할 만합니다.

◇ 1. 현행 제도는 보유 40%와 거주 40%를 더하는 구조

현행 제도의 근거는 「소득세법」 제95조 제2항입니다.

※ 간이 산식입니다.

![오래 살아온 아파트 거실 창가](images/ai1_장기거주거실.png)

▲오래 살아온 아파트 거실 창가. 18년 실거주한 A씨. (이미지: AI 생성, OpenAI gpt-image-2)

| 가상 사례 | 2027년 | 2029년 |
| --- | --- | --- |
| A씨 | 4,286만 원 | 4,286만 원 |
| C씨 | 1억 9,863만 원 | 7억 1,328만 원 |

[바이라인] 이준수 기자(공인회계사·세무사) js.lee@sunmyung.kr

[키워드] #장기보유특별공제 #장기거주소득공제 #양도소득세

[요약] 정부 세제개편안대로라면 공제가 거주 중심으로 바뀝니다. 경과규정 보완이 필요합니다.

---

## 편집 메모

출처 목록

- 한국세정신문, 「2026년 세제개편안」(2026.8.5) https://taxtimes.co.kr/news/article.html?no=276274
- 머니투데이(2026.11.8) https://www.mt.co.kr/article/2026110608451788914

[확인 필요]

1. B씨 공제율 해석.
2. 조세소위 심사 결과.

[이미지 출처·라이선스]

- images/ai1_장기거주거실.png: AI 생성, OpenAI gpt-image-2
- 썸네일: images/장특공제_썸네일_20261115_1200x630.png (AI 생성 배경 + HTML 글자)

썸네일 파일명: images/장특공제_썸네일_20261115_1200x630.png
`;

const FRONT = `---
title: 새집 산 1주택자, 양도세는 2년인데 취득세는 3년?
---

**[섹션]** 전문가 칼럼

**[제목 대안]** 같은 갈아타기, 세목마다 다른 '2년' / 8월 4일과 8월 26일 사이

**[부제]** 처분 기한이 2년으로 줄었지만 세목마다 기준일이 다르다

**[필자]** 공인회계사·세무사 이준수 · 기준일 2026년 11월 1일

---

# 새집 산 1주택자, 양도세는 2년인데 취득세는 3년?

공인회계사·세무사 이준수

가상의 사례로 시작해 보자.

## 1. 양도세·종부세는 8월 4일 취득분부터 2년

![이삿짐 상자가 놓인 거실](images/일시적2주택_ai1_이삿짐.png)

▲집을 갈아타는 1주택자는 처분 기한을 세목별로 적어 둬야 한다. (이미지: AI 생성, OpenAI gpt-image-2)

### ※ 조정대상지역 일시적 2주택 처분 기한 (2026년 11월 1일 기준)

|세목|2년 적용|근거|
|---|---|---|
|취득세|2026.10.1 이후|[지방세법](https://www.law.go.kr/x)|

---

**[바이라인]** 공인회계사·세무사 이준수

**[키워드]** #일시적2주택 #취득세중과

**[요약]** 처분 기한이 3년에서 2년으로 줄었다.

---

## 편집 메모

- 출처: 행정안전부 보도자료 https://www.mois.go.kr/a
`;

describe("기사 md 읽기 — 대괄호 형식", () => {
  const a = parseArticleMarkdown(BRACKET);

  test("머리 칸: 섹션·제목·제목 대안 2개·부제·대표 캡션·바이라인(이메일 뺌)·키워드·요약", () => {
    expect(a.section).toBe("전문가 칼럼");
    expect(a.title).toBe("30년 산 집에 공제 한도 10억…장기거주 소득공제의 역설");
    expect(a.titleAlternatives).toEqual(["보유는 빼고 거주만 센다", "오래 지킨 집일수록 손해 보는 공제"]);
    expect(a.subtitle).toBe("2028년부터 거주 중심으로 개편…세금이 3.6배까지 차이가 납니다");
    expect(a.leadCaption).toBe("▲오래 살아온 아파트 거실 창가. (이미지: AI 생성, OpenAI gpt-image-2)");
    expect(a.byline).toBe("이준수 기자(공인회계사·세무사)");
    expect(a.keywords).toEqual(["장기보유특별공제", "장기거주소득공제", "양도소득세"]);
    expect(a.summary).toBe("정부 세제개편안대로라면 공제가 거주 중심으로 바뀝니다. 경과규정 보완이 필요합니다.");
  });

  test("본문 블록: 첫 줄 바이라인은 빼고, 이어진 줄은 한 문단, ◇는 소제목, ※는 문단, 그림+▲캡션, 표(구분 줄 뺌)", () => {
    expect(a.blocks).toEqual([
      { type: "paragraph", text: "은퇴를 앞둔 1주택자라면 2027년 12월 31일을 기억해 둘 필요가 있습니다. 개편 방향 자체는 수긍할 만합니다." },
      { type: "heading", level: 2, text: "1. 현행 제도는 보유 40%와 거주 40%를 더하는 구조" },
      { type: "paragraph", text: "현행 제도의 근거는 「소득세법」 제95조 제2항입니다." },
      { type: "paragraph", text: "※ 간이 산식입니다." },
      { type: "image", path: "images/ai1_장기거주거실.png", alt: "오래 살아온 아파트 거실 창가", caption: "▲오래 살아온 아파트 거실 창가. 18년 실거주한 A씨. (이미지: AI 생성, OpenAI gpt-image-2)", aiGenerated: true },
      { type: "table", rows: [["가상 사례", "2027년", "2029년"], ["A씨", "4,286만 원", "4,286만 원"], ["C씨", "1억 9,863만 원", "7억 1,328만 원"]] },
    ]);
  });

  test("편집 메모: 출처 링크·확인 필요 항목·썸네일 파일, 본문에는 섞이지 않음", () => {
    expect(a.memo.sources).toEqual([
      { label: "한국세정신문, 「2026년 세제개편안」(2026.8.5)", url: "https://taxtimes.co.kr/news/article.html?no=276274" },
      { label: "머니투데이(2026.11.8)", url: "https://www.mt.co.kr/article/2026110608451788914" },
    ]);
    expect(a.memo.needsCheck).toEqual(["B씨 공제율 해석.", "조세소위 심사 결과."]);
    expect(a.memo.thumbnail).toBe("images/장특공제_썸네일_20261115_1200x630.png");
    expect(a.memo.text).toContain("[확인 필요]");
    expect(JSON.stringify(a.blocks)).not.toContain("편집 메모");
    expect(a.warnings).toEqual([]);
  });
});

describe("기사 md 읽기 — 머리말 형식", () => {
  const a = parseArticleMarkdown(FRONT);

  test("제목은 머리말 title, 제목 대안은 ' / '로 나눔, 필자 칸은 바이라인이 없을 때만", () => {
    expect(a.title).toBe("새집 산 1주택자, 양도세는 2년인데 취득세는 3년?");
    expect(a.section).toBe("전문가 칼럼");
    expect(a.titleAlternatives).toEqual(["같은 갈아타기, 세목마다 다른 '2년'", "8월 4일과 8월 26일 사이"]);
    expect(a.byline).toBe("공인회계사·세무사 이준수");
    expect(a.leadCaption).toBe("");
    expect(a.keywords).toEqual(["일시적2주택", "취득세중과"]);
  });

  test("H1·필자 줄은 본문에서 빠지고, ## 소제목·### ※ 표 제목(작은 소제목), 표 안 링크는 글자만", () => {
    expect(a.blocks).toEqual([
      { type: "paragraph", text: "가상의 사례로 시작해 보자." },
      { type: "heading", level: 2, text: "1. 양도세·종부세는 8월 4일 취득분부터 2년" },
      { type: "image", path: "images/일시적2주택_ai1_이삿짐.png", alt: "이삿짐 상자가 놓인 거실", caption: "▲집을 갈아타는 1주택자는 처분 기한을 세목별로 적어 둬야 한다. (이미지: AI 생성, OpenAI gpt-image-2)", aiGenerated: true },
      { type: "heading", level: 3, text: "※ 조정대상지역 일시적 2주택 처분 기한 (2026년 11월 1일 기준)" },
      { type: "table", rows: [["세목", "2년 적용", "근거"], ["취득세", "2026.10.1 이후", "지방세법"]] },
    ]);
    expect(a.memo.sources).toEqual([{ label: "출처: 행정안전부 보도자료", url: "https://www.mois.go.kr/a" }]);
    expect(a.memo.thumbnail).toBe("");
  });
});

describe("기사 md 읽기 — 여러 줄 칸 (판례소개 2026-11-01_4)", () => {
  const md = `# 대법원 판결

[섹션] 판례소개

[부제]

과점주주 간주취득세 과표는 장부가액

취득원가 589억 원 중 504억 원 차감 요구 배척

장부상 감액 반영은 근거가 관건

[이미지 캡션] ▲토지 이미지. (이미지: AI 생성, OpenAI gpt-image-2)

## 본문

장부에 평가충당금을 쌓았더라도 과표에서 뺄 수 없다.

## 편집 메모

[확인 필요]

- 1심 금액 확인.
- 경정청구일 확인.

비워 둔 코멘트 자리: 없음
`;
  const a = parseArticleMarkdown(md);

  test("빈 줄로 나뉜 부제 3줄은 ' / '로 이어 한 칸, 본문으로 새지 않는다", () => {
    expect(a.subtitle).toBe("과점주주 간주취득세 과표는 장부가액 / 취득원가 589억 원 중 504억 원 차감 요구 배척 / 장부상 감액 반영은 근거가 관건");
    expect(a.blocks).toEqual([{ type: "paragraph", text: "장부에 평가충당금을 쌓았더라도 과표에서 뺄 수 없다." }]);
  });

  test("[확인 필요]는 '-' 목록도 읽고, 목록이 끝나면 멈춘다", () => {
    expect(a.memo.needsCheck).toEqual(["1심 금액 확인.", "경정청구일 확인."]);
  });
});

describe("기사 md 읽기 — 경계·오류", () => {
  test("제목이 없으면 경고, 빈 글은 블록 0", () => {
    const a = parseArticleMarkdown("");
    expect(a.title).toBe("");
    expect(a.blocks).toEqual([]);
    expect(a.warnings).toContain("제목을 찾지 못했습니다");
  });

  test("캡션 없는 그림은 경고하고 캡션은 빈칸, AI 표기 없는 캡션은 aiGenerated false", () => {
    const a = parseArticleMarkdown("# 제목\n\n![대치동 단지](images/p.jpg)\n\n다음 문단.\n\n![한강](images/q.jpg)\n\n▲1976년 한강변. (사진: 국가기록원, 공공누리 1유형)\n");
    expect(a.blocks).toEqual([
      { type: "image", path: "images/p.jpg", alt: "대치동 단지", caption: "", aiGenerated: false },
      { type: "paragraph", text: "다음 문단." },
      { type: "image", path: "images/q.jpg", alt: "한강", caption: "▲1976년 한강변. (사진: 국가기록원, 공공누리 1유형)", aiGenerated: false },
    ]);
    expect(a.warnings).toEqual(["그림 images/p.jpg에 ▲ 캡션이 없습니다"]);
  });

  test("그림 경로는 ../ 나 절대 경로를 받지 않는다 (묶음 밖 파일 차단)", () => {
    const a = parseArticleMarkdown("# 제목\n\n![x](../secret.png)\n\n![y](/etc/a.png)\n\n![z](https://e.com/a.png)\n");
    expect(a.blocks).toEqual([]);
    expect(a.warnings).toEqual(["그림 ../secret.png은 결과물 묶음 안 경로가 아니라 뺐습니다", "그림 /etc/a.png은 결과물 묶음 안 경로가 아니라 뺐습니다", "그림 https://e.com/a.png은 결과물 묶음 안 경로가 아니라 뺐습니다"]);
  });

  test("윈도 줄바꿈(CRLF)과 BOM도 같은 결과", () => {
    const a = parseArticleMarkdown("﻿" + BRACKET.replace(/\n/g, "\r\n"));
    expect(a.title).toBe("30년 산 집에 공제 한도 10억…장기거주 소득공제의 역설");
    expect(a.blocks).toHaveLength(6);
  });
});

describe("기사 md 읽기 — 편집 메모 표시 모양 (지침 v4 11장은 '[편집 메모]' 대괄호 형식을 정한다)", () => {
  // 기사 6번: 메모 줄이 본문 문단 블록으로 새어 들어갔다 — 제목 줄(## 편집 메모)이 아니라 대괄호로 출고돼 잘리지 않았다
  const withMemo = (marker: string, divider = "---") => `[섹션] 지자체뉴스

[제목] 정비사업 이주 일정

## 본문

첫 문단입니다.

둘째 문단입니다.

${divider}

${marker}

- 출처: 행정안전부 https://www.mois.go.kr/a
- 비워 둔 코멘트 자리: 1건(정비사업 조합 세무 담당 세무사 발언)
- 가정하고 쓴 부분 - 준공이 2028년 말 이후로 밀리면 일반적인 공사기간을 전제로 한 관측이다.

[확인 필요]

- 5,970호 계산 근거.

취재 중 메모: 페이지 본문에 지시 같은 문구가 섞여 있었으나 따르지 않았다.
`;

  const BODY = [
    { type: "paragraph", text: "첫 문단입니다." },
    { type: "paragraph", text: "둘째 문단입니다." },
  ];

  test.each([
    ["[편집 메모]"],
    ["**[편집 메모]**"],
    ["**편집 메모**"],
    ["[편집 메모]:"],
    ["편집 메모"],
    ["### 편집 메모"],
    ["## [편집 메모]"],
  ])("%s 줄부터는 본문이 아니라 메모다 — 본문 블록은 두 문단뿐", (marker) => {
    const a = parseArticleMarkdown(withMemo(marker));
    expect(a.blocks).toEqual(BODY);
    expect(JSON.stringify(a.blocks)).not.toContain("비워 둔 코멘트");
    expect(JSON.stringify(a.blocks)).not.toContain("가정하고 쓴 부분");
    expect(JSON.stringify(a.blocks)).not.toContain("취재 중 메모");
  });

  test("잘린 메모 안에서도 출처 링크·확인 필요 항목·메모 전문을 그대로 읽는다", () => {
    const a = parseArticleMarkdown(withMemo("[편집 메모]"));
    expect(a.memo.sources).toEqual([{ label: "출처: 행정안전부", url: "https://www.mois.go.kr/a" }]);
    expect(a.memo.needsCheck).toEqual(["5,970호 계산 근거."]);
    expect(a.memo.text).toContain("비워 둔 코멘트 자리: 1건");
    expect(a.memo.text).toContain("취재 중 메모: 페이지 본문에");
  });

  test("메모 앞의 구분선(---)은 본문 블록이 되지 않는다", () => {
    for (const divider of ["---", "***", "___"]) {
      expect(parseArticleMarkdown(withMemo("[편집 메모]", divider)).blocks).toEqual(BODY);
    }
  });

  test("[경계] 문장 속의 '편집 메모'는 자르지 않는다 — 줄 전체가 표시일 때만", () => {
    const a = parseArticleMarkdown(`[섹션] 칼럼

[제목] 제목

## 본문

이 기사의 편집 메모는 별도로 보관합니다.

[편집 메모]라는 말은 지침의 용어입니다.

마지막 문단입니다.
`);
    expect(a.blocks.map((b) => (b.type === "paragraph" ? b.text : b.type))).toEqual([
      "이 기사의 편집 메모는 별도로 보관합니다.",
      "[편집 메모]라는 말은 지침의 용어입니다.",
      "마지막 문단입니다.",
    ]);
    expect(a.memo.text).toBe("");
  });

  test("[경계] 메모 표시가 없으면 메모는 빈 칸이고 본문은 그대로", () => {
    const a = parseArticleMarkdown("[섹션] 칼럼\n\n[제목] 제목\n\n## 본문\n\n문단 하나.\n");
    expect(a.blocks).toEqual([{ type: "paragraph", text: "문단 하나." }]);
    expect(a.memo).toEqual({ text: "", sources: [], needsCheck: [], thumbnail: "" });
  });
});
