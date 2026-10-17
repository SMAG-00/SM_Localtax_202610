import { describe, expect, it } from "vitest";
import { normalizeForComparison, sentenceSimilarity } from "./index";

/** 서로 다른 한글 음절 n개 — start가 다르면 겹치는 글자가 없다 (경계값을 정확히 만들기 위한 합성 문자열) */
function syllables(start: number, n: number): string {
  return Array.from({ length: n }, (_, i) => String.fromCharCode(0xac00 + start + i)).join("");
}

describe("normalizeForComparison", () => {
  it("띄어쓰기·문장부호·기호를 지우고 글자·숫자만 남긴다", () => {
    expect(normalizeForComparison("가온시는 3.5%를, “감면”한다!")).toBe("가온시는35를감면한다");
  });

  it("전각 숫자·로마자를 반각으로 접고 로마자는 소문자로 바꾼다 (NFKC)", () => {
    expect(normalizeForComparison("２０２６년 ＷＴＡＸ 신청")).toBe("2026년wtax신청");
  });

  it("자모가 분리된 한글(NFD)을 완성형 글자로 맞춘다", () => {
    expect(normalizeForComparison("재산세".normalize("NFD"))).toBe("재산세");
  });
});

describe("sentenceSimilarity — 글자 2-gram Dice 계수", () => {
  it("같은 문장은 1", () => {
    const s = "가온시는 착한 임대인에게 재산세를 최대 50%까지 감면한다.";
    expect(sentenceSimilarity(s, s)).toBe(1);
  });

  it("띄어쓰기·문장부호만 다르면 1", () => {
    expect(sentenceSimilarity("재산세를 최대 50% 감면한다.", "재산세를최대 50 % 감면 한다")).toBe(1);
  });

  it("겹치는 2-gram이 하나도 없으면 0", () => {
    expect(sentenceSimilarity("재산세 감면", "취득세 환급")).toBe(0);
  });

  it("2-gram 10개 중 9개가 같으면 정확히 0.9 — 90% 경계", () => {
    const source = syllables(0, 11); // 2-gram 10개
    const draft = syllables(0, 10) + syllables(500, 1); // 앞 9개 2-gram 공유, 마지막 1개만 다름
    expect(sentenceSimilarity(draft, source)).toBe(0.9);
  });

  it("2-gram 100개 중 89개가 같으면 정확히 0.89 — 89% 경계", () => {
    const source = syllables(0, 101); // 2-gram 100개
    const draft = syllables(0, 90) + syllables(1000, 11); // 앞 89개 공유, 11개 다름
    expect(sentenceSimilarity(draft, source)).toBe(0.89);
  });

  it("대칭이다 — 두 문장 순서를 바꿔도 값이 같다", () => {
    const a = "시는 이미 낸 재산세를 12월 말까지 돌려줄 계획이다.";
    const b = "이미 재산세를 냈더라도 감면이 결정되면 연말까지 차액을 돌려받는다.";
    expect(sentenceSimilarity(a, b)).toBe(sentenceSimilarity(b, a));
    expect(sentenceSimilarity(a, b)).toBeGreaterThan(0);
    expect(sentenceSimilarity(a, b)).toBeLessThan(0.5);
  });

  it("같은 2-gram이 반복되면 양쪽에 있는 개수만큼만 겹친 것으로 센다 (중복집합)", () => {
    // "가나가나가나" 2-gram 5개(가나×3·나가×2), "가나" 1개 → 겹침 1 → 2·1/(5+1)
    expect(sentenceSimilarity("가나가나가나", "가나")).toBe(2 / 6);
  });

  it("한 글자 문장은 같은 글자일 때만 1, 아니면 0", () => {
    expect(sentenceSimilarity("네.", "네!")).toBe(1);
    expect(sentenceSimilarity("네.", "예.")).toBe(0);
    expect(sentenceSimilarity("네.", "네 그렇다.")).toBe(0);
  });

  it("글자·숫자가 없는 문장끼리는 0", () => {
    expect(sentenceSimilarity("...", "!!!")).toBe(0);
  });

  it("어미 한두 곳만 바꾼 보도자료 문장은 0.9 이상, 같은 사실을 다시 쓴 문장은 0.9 미만", () => {
    const release = "다만 임대인과 임차인이 특수관계인이거나 유흥주점 등 사치성 영업장으로 쓰이는 건물은 감면 대상에서 제외된다.";
    const lightlyEdited = "다만 임대인과 임차인이 특수관계인이거나 유흥주점 등 사치성 영업장으로 쓰이는 건물은 감면 대상에서 빠진다.";
    const rewritten = "세입자가 가족 등 특수관계인이거나 건물이 유흥주점 같은 사치성 영업장으로 쓰이면 혜택을 받을 수 없다.";
    expect(sentenceSimilarity(lightlyEdited, release)).toBeGreaterThanOrEqual(0.9);
    expect(sentenceSimilarity(rewritten, release)).toBeLessThan(0.9);
  });
});
