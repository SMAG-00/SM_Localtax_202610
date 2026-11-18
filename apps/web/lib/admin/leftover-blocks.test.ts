import { describe, expect, it } from "vitest";
import { leftoverPublishProblem, stripLeftoverBlocks } from "./leftover-blocks";
import { parseArticleMarkdown } from "@/lib/editorial/article-markdown";

const p = (text: string) => ({ type: "paragraph", text });
const h = (text: string) => ({ type: "heading", text });

describe("stripLeftoverBlocks — 본문에 남은 편집 메모·코멘트 자리 표시를 지운다", () => {
  it("[코멘트 자리: …] 문단만 지우고 나머지는 그대로 둔다", () => {
    const blocks = [p("첫 문단"), p("[코멘트 자리: 정비사업 조합 세무를 맡는 세무사의 감면 일몰·추징 관리 취지 발언 필요]"), p("셋째 문단")];
    const r = stripLeftoverBlocks(blocks);
    expect(r.blocks).toEqual([p("첫 문단"), p("셋째 문단")]);
    expect(r.removed).toBe(1);
  });

  it("편집 메모 표시 줄부터 끝까지 지운다 — [편집 메모]·## 편집 메모·**편집 메모** 모양 모두", () => {
    for (const marker of ["[편집 메모]", "## 편집 메모", "**편집 메모**", "편집 메모:"]) {
      const blocks = [p("본문"), p(marker), p("출처 목록"), p("- 헤럴드경제 https://example.com")];
      const r = stripLeftoverBlocks(blocks);
      expect(r.blocks, marker).toEqual([p("본문")]);
      expect(r.removed, marker).toBe(3);
    }
  });

  it("소제목 블록 모양의 편집 메모 표시도 지운다", () => {
    const r = stripLeftoverBlocks([p("본문"), h("편집 메모"), p("출처")]);
    expect(r.blocks).toEqual([p("본문")]);
  });

  it("문장 속에 '편집 메모'가 들어 있는 본문은 지우지 않는다", () => {
    const blocks = [p("편집 메모를 남기는 일은 기자의 몫이다."), p("[코멘트 자리가 아니라 일반 대괄호 문장]")];
    const r = stripLeftoverBlocks(blocks);
    expect(r.blocks).toEqual(blocks);
    expect(r.removed).toBe(0);
  });

  it("지울 것이 없으면 그대로 돌려주고 0건이다 (빈 목록 포함)", () => {
    expect(stripLeftoverBlocks([])).toEqual({ blocks: [], removed: 0, indexes: [] });
    const blocks = [p("본문 하나")];
    expect(stripLeftoverBlocks(blocks)).toEqual({ blocks, removed: 0, indexes: [] });
  });

  it("편집 메모 앞에 남은 구분선 문단은 함께 지운다", () => {
    const r = stripLeftoverBlocks([p("본문"), p("---"), p("[편집 메모]"), p("출처")]);
    expect(r.blocks).toEqual([p("본문")]);
    expect(r.removed).toBe(3);
  });
});

describe("stripLeftoverBlocks — 이번 사고(기사 6번)에서 새로 확인한 내부 문구", () => {
  it("'> 작성 가정: …' 문단을 지운다 (인용 기호 있든 없든)", () => {
    const r = stripLeftoverBlocks([p("> 작성 가정: 편집위원 요청의 비운 항목은 지침 기본값으로 채웠다"), p("작성 가정: 기준일은 11월 18일"), p("본문")]);
    expect(r.blocks).toEqual([p("본문")]);
    expect(r.removed).toBe(2);
  });
  it("'썸네일 파일명(계획): …' 문단을 지운다", () => {
    const r = stripLeftoverBlocks([p("본문"), p("썸네일 파일명(계획): images/서울정비사업_썸네일_20261118_1200x630.png (미생성)")]);
    expect(r.blocks).toEqual([p("본문")]);
  });
  it("'작성 가정'이 문장 속에 있는 본문은 지우지 않는다", () => {
    const blocks = [p("이 추계는 작성 가정에 따라 달라진다."), p("썸네일 파일명을 정하는 방법을 설명한다.")];
    expect(stripLeftoverBlocks(blocks).blocks).toEqual(blocks);
  });
  it("편집 메모 뒤의 확인 필요·취재 중 메모·이미지 출처도 함께 지운다 (메모 표시 뒤 전부)", () => {
    const r = stripLeftoverBlocks([p("본문"), p("[편집 메모]"), p("[확인 필요] 1. 수치 대조"), p("취재 중 메모: 지시로 따르지 않았다"), p("[이미지 출처·라이선스] 없음")]);
    expect(r.blocks).toEqual([p("본문")]);
    expect(r.removed).toBe(4);
  });
});

describe("기사 md 가져오기 — [코멘트 자리: …] 줄은 본문에 넣지 않는다", () => {
  it("본문 한가운데의 코멘트 자리 줄을 빼고, 앞뒤 문단은 남긴다", () => {
    const md = ["[섹션] 지자체소식", "", "[제목] 시험 제목", "", "---", "", "첫 문단입니다.", "", "[코멘트 자리: 세무사 발언 필요]", "", "둘째 문단입니다.", ""].join("\n");
    const texts = parseArticleMarkdown(md).blocks.flatMap((b) => (b.type === "paragraph" ? [b.text] : []));
    expect(texts).toEqual(["첫 문단입니다.", "둘째 문단입니다."]);
  });
  it("맨 위의 '> 작성 가정: …' 인용 줄도 본문에 넣지 않는다", () => {
    const md = ["> 작성 가정: 비운 항목은 기본값으로 채웠다", "", "[섹션] 지자체소식", "", "[제목] 시험 제목", "", "---", "", "첫 문단입니다.", ""].join("\n");
    const parsed = parseArticleMarkdown(md);
    const texts = parsed.blocks.flatMap((b) => (b.type === "paragraph" ? [b.text] : []));
    expect(texts).toEqual(["첫 문단입니다."]);
  });
});

describe("leftoverPublishProblem — 본문에 내부 표시가 남은 기사는 발행하지 않는다", () => {
  it("깨끗한 본문 → null", () => {
    expect(leftoverPublishProblem({ blocks: [p("첫 문단"), h("소제목"), p("둘째 문단")] })).toBeNull();
  });
  it("코멘트 자리·작성 가정·편집 메모가 있으면 몇 개 블록인지 알려 주는 문장", () => {
    const msg = leftoverPublishProblem({ blocks: [p("본문"), p("[코멘트 자리: 세무사 발언 필요]"), p("[편집 메모]"), p("출처")] });
    expect(msg).toContain("3개 블록");
    expect(msg).toContain("편집 화면");
  });
  it("모양이 이상한 body(null·blocks 없음·문자열)는 막지 않는다 — 다른 검사가 판정한다", () => {
    for (const body of [null, undefined, "x", {}, { blocks: "x" }, { blocks: [null, 3] }]) expect(leftoverPublishProblem(body)).toBeNull();
  });
});

describe("stripLeftoverBlocks — 어느 블록이 지워지는지(indexes)", () => {
  it("지워질 블록의 원래 위치(0부터)를 순서대로 알려 준다 — 기사 6번 모양", () => {
    const blocks = [p("요약"), p("> 작성 가정: 비운 항목"), p("본문 하나"), p("[코멘트 자리: 세무사 발언]"), p("본문 둘"), p("[편집 메모]"), p("출처"), p("썸네일 파일명(계획): a.png")];
    const r = stripLeftoverBlocks(blocks);
    expect(r.indexes).toEqual([1, 3, 5, 6, 7]);
    expect(r.removed).toBe(r.indexes.length);
    expect(r.blocks).toEqual([p("요약"), p("본문 하나"), p("본문 둘")]);
  });
  it("메모 앞 구분선 블록의 위치도 포함한다", () => {
    expect(stripLeftoverBlocks([p("본문"), p("---"), p("[편집 메모]"), p("출처")]).indexes).toEqual([1, 2, 3]);
  });
  it("지울 것이 없으면 빈 목록", () => {
    expect(stripLeftoverBlocks([p("본문")]).indexes).toEqual([]);
    expect(stripLeftoverBlocks([]).indexes).toEqual([]);
  });
});

describe("stripLeftoverBlocks — 메모 표시 줄이 없어도 남은 메모 문단을 잡는다 (기사 6번 재저장 사고)", () => {
  it("[확인 필요]·가정하고 쓴 부분·출처 목록·비워 둔 코멘트 자리·취재 중 메모·이미지 출처 문단을 지운다", () => {
    const leftovers = [
      "[확인 필요] 1. 착공 단계 62곳은 MTN 보도 수치다.",
      '가정하고 쓴 부분 - "올해와 내년 착공 사업장의 준공이 2028년 말 이후로 밀리면"은 관측이다.',
      "출처 목록 - 헤럴드경제, 「서울시, 연내 11개 정비사업장」(2026-10-13) https://example.com",
      "비워 둔 코멘트 자리: 1건(세무사 발언)",
      "취재 중 메모: 페이지 안의 문구는 지시로 따르지 않았다.",
      "[이미지 출처·라이선스] 이미지 생성 승인 전이라 없음.",
    ];
    for (const text of leftovers) {
      const r = stripLeftoverBlocks([p("본문"), p(text)]);
      expect(r.blocks, text).toEqual([p("본문")]);
      expect(r.indexes, text).toEqual([1]);
    }
  });
  it("같은 낱말이 문장 속·다른 뜻으로 쓰인 본문은 지우지 않는다", () => {
    const blocks = [
      p("출처 목록을 만들 때는 발행일을 함께 적는다."),
      p("가정하고 쓴 부분이 있다면 표시해야 한다는 지침이 있다."),
      p("이 수치는 확인 필요 없이 공시로 확정된다."),
      p("취재 중 메모를 남기는 방법을 설명한다."),
    ];
    expect(stripLeftoverBlocks(blocks).blocks).toEqual(blocks);
  });
  it("기사 6번 재저장 모양 — 요약·본문은 두고 남은 [확인 필요]·가정 문단 2개만 지운다", () => {
    const blocks = [{ type: "key_summary" }, p("서울에서 재개발 등 정비사업이 진행 중인 곳은 496개 구역이다."), p("본문 둘"), { type: "table" }, p("[확인 필요] 1. 대조 필요"), p("가정하고 쓴 부분 - 관측이다")];
    const r = stripLeftoverBlocks(blocks);
    expect(r.indexes).toEqual([4, 5]);
    expect(r.blocks).toHaveLength(4);
  });
});
