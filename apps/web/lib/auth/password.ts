// 비밀번호 규칙 (W2-e 설계 2.6 · 12장 #16) — 순수 함수. 길이와 흔한 값 거르기만 본다(대문자·기호 필수 같은 구성 규칙은 두지 않는다).
//  · 글자 수는 사람이 보는 글자(자소 묶음) 기준, 길이 상한은 UTF-8 바이트(bcrypt가 72바이트까지만 읽는다)
//  · 한도(최소 글자·최대 바이트)는 설정 member(password_min_chars · password_max_bytes)에서 와서 호출하는 쪽이 넘긴다 — 이 파일에 숫자를 두지 않는다
//  · 같은 규칙을 비밀번호 바꾸기 화면(입력 중 안내)과 서버가 쓴다. 서버가 최종 판정이다
// 시험(password.test.ts)은 설계 문서 2.6 견본 표를 읽어 그대로 대조한다.

export interface PasswordRules {
  /** 최소 글자 수 (사람이 보는 글자) */
  minChars: number;
  /** 최대 바이트 수 (UTF-8) */
  maxBytes: number;
}

export type PasswordProblem = "blank" | "too_short" | "too_long" | "same_as_email" | "repeated" | "common" | "contains_email";

export type PasswordCheck = { ok: true } | { ok: false; problem: PasswordProblem; message: string };

/** 이메일 앞부분을 비밀번호에 넣었는지 볼 때 앞부분이 이 글자 수 이상일 때만 본다 (짧은 앞부분은 우연히 들어가기 쉽다 — 설계 2.6) */
export const EMAIL_LOCAL_MIN_CHARS = 4;

/** 흔한 값 — 소문자로 맞춰 비교한다. 30개 안팎의 짧은 목록이다(완전한 금지어 사전이 아니라 가장 흔한 것을 막는 안전망) */
export const COMMON_PASSWORDS: readonly string[] = [
  "1234567890",
  "0123456789",
  "12345678910",
  "1234512345",
  "9876543210",
  "1111111111",
  "0000000000",
  "1212121212",
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "password12345",
  "passw0rd123",
  "qwertyuiop",
  "qwerty1234",
  "qwerty12345",
  "asdfghjkl1",
  "zxcvbnm123",
  "1qaz2wsx3edc",
  "1q2w3e4r5t",
  "iloveyou123",
  "abcd123456",
  "abc1234567",
  "admin12345",
  "administrator",
  "welcome123",
  "letmein1234",
  "changeme123",
  "dkssudgktpdy", // 한글 자판으로 친 '안녕하세요'
  "gksrmf1234", // 한글 자판으로 친 '한글'
];

export const PASSWORD_PROBLEM_MESSAGES: Readonly<Record<PasswordProblem, string>> = {
  blank: "공백만으로는 비밀번호를 만들 수 없습니다",
  too_short: "비밀번호가 너무 짧습니다",
  too_long: "비밀번호가 너무 깁니다",
  same_as_email: "이메일 주소와 같은 비밀번호는 쓸 수 없습니다",
  repeated: "한 글자만 반복한 비밀번호는 쓸 수 없습니다",
  common: "너무 흔한 비밀번호입니다 — 다른 값을 써 주세요",
  contains_email: "이메일 주소의 앞부분이 들어 있는 비밀번호는 쓸 수 없습니다",
};

const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });

/** 사람이 보는 글자 수 */
export function charCount(text: string): number {
  return [...segmenter.segment(text)].length;
}

/** UTF-8 바이트 수 */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function allSameChar(text: string): boolean {
  const parts = [...segmenter.segment(text)].map((s) => s.segment);
  return parts.length >= 2 && parts.every((p) => p === parts[0]);
}

/**
 * 새 비밀번호 판정 — 처음 걸린 규칙 하나를 돌려준다. 차례: 공백뿐 → 너무 짧음 → 너무 김 → 이메일과 같음 → 한 글자 반복 → 흔한 값 → 이메일 앞부분 포함.
 * email은 계정 이메일(없으면 빈 글자 — 이메일 규칙은 건너뛴다)
 */
export function checkPassword(password: string, email: string, rules: PasswordRules): PasswordCheck {
  const fail = (problem: PasswordProblem, message?: string): PasswordCheck => ({ ok: false, problem, message: message ?? PASSWORD_PROBLEM_MESSAGES[problem] });
  if (password.trim() === "") return fail("blank");
  if (charCount(password) < rules.minChars) return fail("too_short", `비밀번호는 ${rules.minChars}글자 이상이어야 합니다`);
  if (byteLength(password) > rules.maxBytes) return fail("too_long", `비밀번호는 ${rules.maxBytes}바이트(영문 기준 ${rules.maxBytes}글자, 한글은 글자당 3바이트) 이하여야 합니다`);
  const lower = password.toLowerCase();
  const address = email.trim().toLowerCase();
  if (address !== "" && lower === address) return fail("same_as_email");
  if (allSameChar(password)) return fail("repeated");
  if (COMMON_PASSWORDS.includes(lower)) return fail("common");
  const local = address.split("@")[0] ?? "";
  if (address !== "" && charCount(local) >= EMAIL_LOCAL_MIN_CHARS && lower.includes(local)) return fail("contains_email");
  return { ok: true };
}
