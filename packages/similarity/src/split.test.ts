import { describe, expect, it } from "vitest";
import { segmentDraft, splitSentences } from "./index";

describe("splitSentences — 종결어미·종결부호", () => {
  it("종결어미 뒤 마침표에서 나눈다", () => {
    expect(splitSentences("가온시는 재산세를 감면한다고 밝혔다. 신청은 다음 달까지다.")).toEqual([
      "가온시는 재산세를 감면한다고 밝혔다.",
      "신청은 다음 달까지다.",
    ]);
  });

  it("물음표·느낌표에서 나누고, 이어진 부호(?!)는 앞 문장에 붙인다", () => {
    expect(splitSentences("감면 대상일까? 그렇다! 정말?! 신청하자.")).toEqual([
      "감면 대상일까?",
      "그렇다!",
      "정말?!",
      "신청하자.",
    ]);
  });

  it("전각 부호(。？！．)에서도 띄어쓰기 없이 나눈다", () => {
    expect(splitSentences("감면한다。신청하라？늦지 마라！끝이다．")).toEqual([
      "감면한다。",
      "신청하라？",
      "늦지 마라！",
      "끝이다．",
    ]);
  });

  it("말줄임표(…·...)를 문장 끝으로 보고 부호는 앞 문장에 남긴다", () => {
    expect(splitSentences("감면은 계속된다… 다만 기한이 있다. 기다려라... 곧 발표한다.")).toEqual([
      "감면은 계속된다…",
      "다만 기한이 있다.",
      "기다려라...",
      "곧 발표한다.",
    ]);
  });

  it("'등.'은 약어가 아니라 문장 끝으로 본다", () => {
    expect(splitSentences("감면 세목은 재산세, 취득세 등. 이번에 바뀐다.")).toEqual([
      "감면 세목은 재산세, 취득세 등.",
      "이번에 바뀐다.",
    ]);
  });

  it("종결부호 뒤 닫는 괄호는 앞 문장에 붙는다", () => {
    expect(splitSentences("(감면 대상이다.) 다음 문장이다.")).toEqual(["(감면 대상이다.)", "다음 문장이다."]);
  });
});

describe("splitSentences — 숫자·날짜·주소 경계", () => {
  it("소수점 숫자(3.5%, 1.2배) 안에서는 나누지 않는다", () => {
    expect(splitSentences("인하율은 3.5%다. 참여 임대인은 1.2배 늘었다.")).toEqual([
      "인하율은 3.5%다.",
      "참여 임대인은 1.2배 늘었다.",
    ]);
  });

  it("보도자료식 날짜(2026. 11. 2.(월), 12. 15.까지) 안에서는 나누지 않는다", () => {
    expect(splitSentences("신청은 2026. 11. 2.(월)부터 12. 15.까지 받는다. 환급은 12월이다.")).toEqual([
      "신청은 2026. 11. 2.(월)부터 12. 15.까지 받는다.",
      "환급은 12월이다.",
    ]);
  });

  it("연·월·일을 모두 쓴 날짜 뒤에 띄어쓰기가 와도 날짜 마침표에서 나누지 않는다", () => {
    expect(splitSentences("시행일은 2026. 1. 1. 이후 신청분부터다. 다음 문장이다.")).toEqual([
      "시행일은 2026. 1. 1. 이후 신청분부터다.",
      "다음 문장이다.",
    ]);
  });

  it("누리집 주소·이메일 안의 마침표·물음표에서 나누지 않고, 주소 뒤 문장 끝 마침표에서는 나눈다", () => {
    expect(
      splitSentences(
        "누리집은 www.gaon-si.example. 공고는 https://gaon-si.example/notice?id=3&page=2 에서 본다. 문의는 tax.team@gaon-si.example 로 한다.",
      ),
    ).toEqual([
      "누리집은 www.gaon-si.example.",
      "공고는 https://gaon-si.example/notice?id=3&page=2 에서 본다.",
      "문의는 tax.team@gaon-si.example 로 한다.",
    ]);
  });

  it("문장 첫머리 번호(1. · 가.)의 마침표는 문장 끝이 아니다", () => {
    expect(
      splitSentences("1. 감면 대상은 상가건물 소유자다. 2. 신청 기한은 12월 15일이다.\n가. 방문 신청\n나. 온라인 신청"),
    ).toEqual(["1. 감면 대상은 상가건물 소유자다.", "2. 신청 기한은 12월 15일이다.", "가. 방문 신청", "나. 온라인 신청"]);
  });
});

describe("splitSentences — 따옴표", () => {
  it("큰따옴표 “…” 안의 마침표에서는 나누지 않는다", () => {
    expect(
      splitSentences("그는 “감면을 확대한다. 신청은 다음 달까지다.”라고 말했다. 시는 연말에 환급한다."),
    ).toEqual(["그는 “감면을 확대한다. 신청은 다음 달까지다.”라고 말했다.", "시는 연말에 환급한다."]);
  });

  it("곧은 따옴표 \"…\" · '…'과 ‘…’ · 「…」 안에서도 나누지 않는다", () => {
    expect(splitSentences('그는 "감면한다. 꼭 신청하라"고 말했다. 시는 환급한다.')).toEqual([
      '그는 "감면한다. 꼭 신청하라"고 말했다.',
      "시는 환급한다.",
    ]);
    expect(splitSentences("'착한 임대인. 착한 세금'이라는 이름이다. 다음 문장이다.")).toEqual([
      "'착한 임대인. 착한 세금'이라는 이름이다.",
      "다음 문장이다.",
    ]);
    expect(splitSentences("‘착한 임대인. 착한 세금’이라는 이름이다. 다음 문장이다.")).toEqual([
      "‘착한 임대인. 착한 세금’이라는 이름이다.",
      "다음 문장이다.",
    ]);
    expect(splitSentences("「지방세특례제한법. 같은 법 시행령」에 따른다. 다음 문장이다.")).toEqual([
      "「지방세특례제한법. 같은 법 시행령」에 따른다.",
      "다음 문장이다.",
    ]);
  });

  it("종결부호로 끝난 따옴표 뒤에 띄어 쓴 새 문장이 오면 닫는 따옴표 뒤에서 나눈다", () => {
    expect(splitSentences("“감면을 확대한다.” 시는 이렇게 밝혔다.")).toEqual([
      "“감면을 확대한다.”",
      "시는 이렇게 밝혔다.",
    ]);
  });

  it("짝이 없는 여는 따옴표는 무시하고 평소대로 나눈다", () => {
    expect(splitSentences("그는 “감면을 확대한다. 신청은 다음 달까지다.")).toEqual([
      "그는 “감면을 확대한다.",
      "신청은 다음 달까지다.",
    ]);
  });

  it("'26년 같은 연도 생략 부호는 따옴표로 짝짓지 않는다", () => {
    expect(splitSentences("'26년 감면은 끝났다. '착한 임대인' 감면은 이어진다.")).toEqual([
      "'26년 감면은 끝났다.",
      "'착한 임대인' 감면은 이어진다.",
    ]);
  });
});

describe("splitSentences — 줄바꿈·빈 입력", () => {
  it("줄바꿈(\\r\\n 포함)은 문장을 가르고 빈 줄은 버린다", () => {
    expect(splitSentences("첫 줄 제목\n본문 문장이다. 둘째 문장이다.\r\n\n  \n마지막 줄")).toEqual([
      "첫 줄 제목",
      "본문 문장이다.",
      "둘째 문장이다.",
      "마지막 줄",
    ]);
  });

  it("따옴표가 열린 채 줄이 바뀌어도 줄바꿈에서 나눈다", () => {
    expect(splitSentences("“첫 줄\n둘째 줄.”")).toEqual(["“첫 줄", "둘째 줄.”"]);
  });

  it("앞뒤 공백을 다듬고, 종결부호 없는 마지막 조각도 문장으로 돌려준다", () => {
    expect(splitSentences("  공백이 있는 문장이다.   종결부호 없는 조각  ")).toEqual([
      "공백이 있는 문장이다.",
      "종결부호 없는 조각",
    ]);
  });

  it("빈 문자열·공백만 있는 입력은 빈 배열", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("  \n\t\n ")).toEqual([]);
  });

  it("부호만 있는 입력과 글자·숫자가 없는 조각은 문장으로 세지 않는다", () => {
    expect(splitSentences("...!?。")).toEqual([]);
    expect(splitSentences("“”")).toEqual([]);
    expect(splitSentences("- - -")).toEqual([]);
    expect(splitSentences("감면한다. ... !")).toEqual(["감면한다."]);
  });
});

describe("segmentDraft — 직접 인용 블록 표시('> ' 줄)", () => {
  it("'>'로 시작하는 줄의 문장은 인용 블록, 나머지는 본문이며 원고 순서를 지킨다", () => {
    const draft = [
      "본문 첫 문장이다. 본문 둘째 문장이다.",
      "> 인용 첫 문장이다. 인용 둘째 문장이다.",
      ">붙여 쓴 인용이다.",
      "  > 들여 쓴 인용이다.",
      "마지막 본문이다.",
    ].join("\n");
    expect(segmentDraft(draft)).toEqual([
      { text: "본문 첫 문장이다.", inQuote: false },
      { text: "본문 둘째 문장이다.", inQuote: false },
      { text: "인용 첫 문장이다.", inQuote: true },
      { text: "인용 둘째 문장이다.", inQuote: true },
      { text: "붙여 쓴 인용이다.", inQuote: true },
      { text: "들여 쓴 인용이다.", inQuote: true },
      { text: "마지막 본문이다.", inQuote: false },
    ]);
  });

  it("문장 중간의 '>'는 인용 표시가 아니다", () => {
    expect(segmentDraft("감면액 > 0 이면 환급한다.")).toEqual([{ text: "감면액 > 0 이면 환급한다.", inQuote: false }]);
  });

  it("'>'만 있는 줄은 문장이 없다", () => {
    expect(segmentDraft(">\n> \n본문이다.")).toEqual([{ text: "본문이다.", inQuote: false }]);
  });
});
