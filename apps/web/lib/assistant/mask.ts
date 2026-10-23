// 도우미 개인정보 가림 — 순수 함수 (CHAT-08 · CHAT-09, docs/dev/W7b_설계.md). 모델 호출·저장·로그에 질문 원문이 나가기 전의 가드.
// 가리는 것: 이메일 · 주민/외국인등록번호 · 전화번호 · 카드번호 · 계좌번호 · 그 밖의 9자리 이상 숫자 줄 · 상세 주소(도로명+번호·동+번지·동호수).
// 우회 대응: 전각 숫자(NFKC) · 숫자 사이 띄어쓰기·하이픈·점·줄바꿈 · 눈에 안 보이는 글자 · 한글 숫자("공일공 …") .
// 반복 길이를 묶어 긴 글에서도 직선 시간으로 돈다 (W2-d 가림과 같은 이유).

export const ASSISTANT_MASK_LABELS = {
  email: "[이메일]",
  rrn: "[주민등록번호]",
  phone: "[전화번호]",
  card: "[카드번호]",
  account: "[계좌번호]",
  number: "[번호]",
  address: "[주소]",
} as const;
export type AssistantMaskKind = keyof typeof ASSISTANT_MASK_LABELS;

/** 저장·전송하는 글의 최대 길이 — 이보다 길면 앞부분만 본다 */
export const MASK_SCAN_CHARS = 2000;
const DIGIT_RUN = 9;

const INVISIBLE = /[​-‏‪-‮⁠﻿­]/gu;
/** 남기는 글자(숫자 사이에 끼면 숫자 줄이 끊긴다) — 영문·한글·한자. 그 밖의 글자·기호·공백은 '사이 글자'로 본다 */
const KEEP = "A-Za-z가-힣ᄀ-ᇿㄱ-ㆎ一-鿿";
const EMAIL = /[\p{L}\p{N}_.%+-]{1,64}\s{0,3}@\s{0,3}[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63})*/gu;
const CHAIN = new RegExp(`[+(]?[0-9](?:[^${KEEP}0-9]{0,6}[0-9])*`, "gu");
/** 한글 숫자 줄 — 공일공 … (공·영·일·이·삼·사·오·육·칠·팔·구 9자 이상, 사이 글자 허용) */
const KO_DIGITS = "공영일이삼사오육칠팔구";
const KO_CHAIN = new RegExp(`[${KO_DIGITS}](?:[^${KEEP}0-9]{0,3}[${KO_DIGITS}]){${DIGIT_RUN - 1},}`, "gu");
/** 도로명 + 번호 — "새로 3가지"처럼 뒤에 한글이 바로 붙는 말은 제외 */
const ROAD = /[가-힣A-Za-z0-9]{2,12}(?:대로|로|길)\s?\d{1,5}(?:-\d{1,5})?(?:(?![가-힣])|(?=번지|호|동|층))/gu;
const LOT = /[가-힣]{1,10}[동리가]\s?\d{1,4}(?:-\d{1,4})?\s?번지/gu;
const UNIT = /\d{1,4}\s?동\s?\d{1,4}\s?호/gu;

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function isBirthDate(yymmdd: string): boolean {
  const m = Number(yymmdd.slice(2, 4));
  const d = Number(yymmdd.slice(4, 6));
  return m >= 1 && m <= 12 && d >= 1 && d <= (DAYS_IN_MONTH[m - 1] ?? 0);
}

function classify(chain: string, digits: string): AssistantMaskKind {
  if (digits.length === 13 && isBirthDate(digits.slice(0, 6)) && /^[1-8]$/.test(digits[6] ?? "")) return "rrn";
  const national = chain.startsWith("+") || (digits.startsWith("82") && digits.length >= 11) ? `0${digits.slice(2)}` : digits;
  if (/^0[0-9]{8,10}$/.test(national)) return "phone";
  if (digits.length >= 13 && digits.length <= 19) return "card";
  if (digits.length >= 10 && digits.length <= 14) return "account";
  return "number";
}

const KO_VALUE: Record<string, string> = { 공: "0", 영: "0", 일: "1", 이: "2", 삼: "3", 사: "4", 오: "5", 육: "6", 칠: "7", 팔: "8", 구: "9" };

export interface MaskResult {
  /** 가린 글 — 보내고 저장하는 것은 이것뿐이다 */
  text: string;
  /** 가린 종류 (글 차례) */
  kinds: AssistantMaskKind[];
  /** 카드번호 모양이 있었는가 — "결제 정보는 받지 않습니다" 한 줄을 붙인다 (CHAT-08) */
  cardLike: boolean;
}

/** 정규화 없이 가린다 — 모델 출력 재검사(A6)처럼 글자를 바꾸지 않고 개인정보 모양만 가릴 때 */
export function maskCore(input: string): MaskResult {
  const kinds: AssistantMaskKind[] = [];
  let s = input.replace(INVISIBLE, "");
  const put = (kind: AssistantMaskKind) => {
    kinds.push(kind);
    return ASSISTANT_MASK_LABELS[kind];
  };
  s = s.replace(EMAIL, () => put("email"));
  s = s.replace(KO_CHAIN, (m) => {
    const digits = Array.from(m).map((c) => KO_VALUE[c] ?? "").join("");
    return put(classify(m, digits));
  });
  s = s.replace(CHAIN, (m) => {
    const digits = m.replace(/[^0-9]/g, "");
    return digits.length >= DIGIT_RUN ? put(classify(m, digits)) : m;
  });
  s = s.replace(ROAD, () => put("address")).replace(LOT, () => put("address")).replace(UNIT, () => put("address"));
  return { text: s, kinds, cardLike: kinds.includes("card") };
}

/** 사용자 질문 가림 — NFKC(전각 숫자·호환 글자)로 바꾼 뒤 가리고 공백을 정리한다 */
export function maskText(raw: string | null | undefined): MaskResult {
  const head = Array.from(raw ?? "").slice(0, MASK_SCAN_CHARS).join("");
  const core = maskCore(head.normalize("NFKC"));
  return { ...core, text: core.text.replace(/\s+/gu, " ").trim() };
}

/** 가림 뒤에도 개인정보 모양이 남았는가 — 저장 전 마지막 확인 (DB check와 같은 모양) */
export function stillHasPii(text: string): boolean {
  return /[0-9]([^0-9A-Za-z가-힣]*[0-9]){8}/u.test(text) || /[A-Za-z0-9_.%+-]\s*@\s*[A-Za-z0-9]/u.test(text);
}
