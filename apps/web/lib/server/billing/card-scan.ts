// 카드번호 패턴 검사 (W10-f, PAY-07) — 순수 함수. 13~19자리 숫자열(공백·하이픈 허용)이면서 Luhn 검사를 통과하는 것만 카드번호로 본다.
// 날짜·식별자·금액 같은 긴 숫자열의 오탐을 줄이려고 Luhn을 함께 쓴다. 정기 스캔(작업 billing-reconcile)과 시험이 같은 함수를 쓴다.

const RUN = /(?<![0-9])[0-9](?:[ -]?[0-9]){12,18}(?![0-9])/g;

export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** 글자 안에서 카드번호로 보이는 숫자열(구분 기호 뺀 것) 목록 */
export function cardLikeRuns(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(RUN)) {
    const digits = m[0].replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) out.push(digits);
  }
  return out;
}

/** 값 하나(문자열·숫자·객체)를 훑어 카드번호 모양이 있으면 true. 결과에 번호 자체는 돌려주지 않는다 */
export function containsCardNumber(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return cardLikeRuns(text).length > 0;
}
