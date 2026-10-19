// 비밀번호 규칙 시험 — 설계 문서 W2-e 2.6 견본 표를 읽어 그대로 대조한다 (표가 바뀌면 이 시험이 따라 바뀐다)
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { COMMON_PASSWORDS, EMAIL_LOCAL_MIN_CHARS, byteLength, charCount, checkPassword, type PasswordProblem, type PasswordRules } from "./password";

const MD = fs.readFileSync(path.resolve(__dirname, "../../../../docs/dev/W2-e_설계.md"), "utf8");
const sec2 = MD.split(/^## /m).find((s) => s.startsWith("2. 값 목록"))!;
const sub = (no: string) => sec2.split(/^### /m).find((s) => s.startsWith(no))!;
const MEMBER = JSON.parse(sec2.match(/^#### `member`[^\n]*\n+```json\n([\s\S]*?)\n```/m)![1]!) as { password_min_chars: number; password_max_bytes: number };
const RULES: PasswordRules = { minChars: MEMBER.password_min_chars, maxBytes: MEMBER.password_max_bytes };

/** 표의 거부 사유 문장 → 규칙 이름 */
const PROBLEM_OF: ReadonlyArray<[string, PasswordProblem]> = [
  ["10글자 미만", "too_short"],
  ["공백뿐", "blank"],
  ["한 글자 반복", "repeated"],
  ["흔한 값", "common"],
  ["이메일 앞부분", "contains_email"],
  ["이메일과 같음", "same_as_email"],
  ["72바이트 초과", "too_long"],
];

interface Sample {
  label: string;
  password: string;
  email: string;
  expected: "ok" | PasswordProblem;
}

const DEFAULT_EMAIL = "a@example.test";
/** 표에 글자로 쓸 수 없는 두 줄(바이트 길이로 설명한 입력)은 표의 설명대로 만든다 */
const BY_DESCRIPTION: Record<string, string> = {
  "73바이트 이상 영문": "Ab1".repeat(24) + "Z", // 73바이트
  "72바이트 영문·숫자 혼합": "Zx9".repeat(24), // 72바이트
};

const SAMPLES: Sample[] = sub("2.6")
  .split("\n")
  .filter((l) => l.startsWith("|") && !/^\|\s*-/.test(l))
  .slice(1)
  .map((line) => {
    const [input = "", result = ""] = line.split("|").slice(1, -1).map((c) => c.trim());
    const tick = input.match(/^`([^`]*)`/);
    const email = input.match(/\(([^)\s]+@[^)\s]+)\)/)?.[1] ?? DEFAULT_EMAIL;
    const password = tick ? tick[1]! : BY_DESCRIPTION[input];
    if (password === undefined) throw new Error(`설계 2.6 견본을 읽지 못했다: ${input}`);
    const expected = result.startsWith("통과") ? "ok" : (PROBLEM_OF.find(([text]) => result.includes(text))?.[1] ?? null);
    if (expected === null) throw new Error(`설계 2.6 거부 사유를 모른다: ${result}`);
    return { label: input, password, email, expected };
  });

describe("설계 2.6 견본 표", () => {
  test("표를 모두 읽었다 — 12줄, 통과 3 · 거부 9", () => {
    expect(SAMPLES).toHaveLength(12);
    expect(SAMPLES.filter((s) => s.expected === "ok")).toHaveLength(3);
    expect(RULES).toEqual({ minChars: 10, maxBytes: 72 });
  });

  test.each(SAMPLES)("$label → $expected", ({ password, email, expected }) => {
    const r = checkPassword(password, email, RULES);
    if (expected === "ok") expect(r).toEqual({ ok: true });
    else expect(r).toMatchObject({ ok: false, problem: expected });
  });

  test("견본 입력의 크기 — 73바이트는 정확히 73, 72바이트는 정확히 72, 한글 12글자는 36바이트", () => {
    expect(byteLength(BY_DESCRIPTION["73바이트 이상 영문"]!)).toBe(73);
    expect(byteLength(BY_DESCRIPTION["72바이트 영문·숫자 혼합"]!)).toBe(72);
    expect(charCount("푸른하늘은행나무길가에서")).toBe(12);
    expect(byteLength("푸른하늘은행나무길가에서")).toBe(36);
  });
});

describe("경계값", () => {
  test("글자 수 — 9글자는 짧고 10글자는 통과, 한글도 글자 수로 센다(바이트가 아니다)", () => {
    expect(checkPassword("Tn7!kQ2m9", DEFAULT_EMAIL, RULES)).toMatchObject({ ok: false, problem: "too_short" });
    expect(checkPassword("Tn7!kQ2m9z", DEFAULT_EMAIL, RULES)).toEqual({ ok: true });
    expect(checkPassword("푸른하늘은행나무길가", DEFAULT_EMAIL, RULES)).toEqual({ ok: true }); // 10글자·30바이트
    expect(checkPassword("푸른하늘은행나무길", DEFAULT_EMAIL, RULES)).toMatchObject({ ok: false, problem: "too_short" }); // 9글자·27바이트
  });

  test("바이트 수 — 72바이트까지 통과, 73바이트부터 거부, 한글 25글자(75바이트)는 거부·24글자(72바이트)는 통과", () => {
    expect(checkPassword("Zx9".repeat(24), DEFAULT_EMAIL, RULES)).toEqual({ ok: true });
    expect(checkPassword("Zx9".repeat(24) + "k", DEFAULT_EMAIL, RULES)).toMatchObject({ ok: false, problem: "too_long" });
    expect(checkPassword("푸른하늘은행나무길가에서".repeat(2), DEFAULT_EMAIL, RULES)).toEqual({ ok: true }); // 24글자 72바이트
    expect(checkPassword("푸른하늘은행나무길가에서".repeat(2) + "가", DEFAULT_EMAIL, RULES)).toMatchObject({ ok: false, problem: "too_long" });
  });

  test("한도는 설정에서 온다 — 최소 글자를 12로 올리면 10글자 비밀번호도 짧다", () => {
    expect(checkPassword("Tn7!kQ2m9z", DEFAULT_EMAIL, { minChars: 12, maxBytes: 72 })).toMatchObject({ ok: false, problem: "too_short" });
    expect(checkPassword("Tn7!kQ2m9z", DEFAULT_EMAIL, { minChars: 8, maxBytes: 10 })).toEqual({ ok: true });
    expect(checkPassword("Tn7!kQ2m9zA", DEFAULT_EMAIL, { minChars: 8, maxBytes: 10 })).toMatchObject({ ok: false, problem: "too_long" });
  });

  test("공백뿐 — 탭·전각 공백·줄바꿈도 공백이다, 글자가 섞이면 공백이 있어도 된다", () => {
    expect(checkPassword("\t\t\t\t\t\t\t\t\t\t", DEFAULT_EMAIL, RULES)).toMatchObject({ problem: "blank" });
    expect(checkPassword("　".repeat(12), DEFAULT_EMAIL, RULES)).toMatchObject({ problem: "blank" });
    expect(checkPassword("푸른 하늘 은행 나무 길가", DEFAULT_EMAIL, RULES)).toEqual({ ok: true });
  });

  test("한 글자 반복 — 두 글자 이상 번갈아 쓰면 반복이 아니고, 한글·이모지 한 글자 반복도 잡는다", () => {
    expect(checkPassword("가".repeat(12), DEFAULT_EMAIL, RULES)).toMatchObject({ problem: "repeated" });
    expect(checkPassword("😀".repeat(12), DEFAULT_EMAIL, RULES)).toMatchObject({ problem: "repeated" });
    expect(checkPassword("abababababab", DEFAULT_EMAIL, RULES)).toEqual({ ok: true });
  });

  test("흔한 값 — 대소문자를 가리지 않고 비교한다, 흔한 값에 글자를 덧붙이면 통과", () => {
    expect(checkPassword("PassWord1234", DEFAULT_EMAIL, RULES)).toMatchObject({ problem: "common" });
    expect(checkPassword("QWERTYUIOP", DEFAULT_EMAIL, RULES)).toMatchObject({ problem: "common" });
    expect(checkPassword("password1234!x", DEFAULT_EMAIL, RULES)).toEqual({ ok: true });
  });

  test("흔한 값 목록은 30개 안팎이고 모두 소문자·중복 없음", () => {
    expect(COMMON_PASSWORDS.length).toBeGreaterThanOrEqual(25);
    expect(COMMON_PASSWORDS.length).toBeLessThanOrEqual(40);
    expect(new Set(COMMON_PASSWORDS).size).toBe(COMMON_PASSWORDS.length);
    for (const p of COMMON_PASSWORDS) expect(p).toBe(p.toLowerCase());
  });

  test("이메일 앞부분 — 4글자 이상일 때만 본다(3글자는 우연히 들어가기 쉽다), 대소문자·전체 이메일 모두 잡는다", () => {
    expect(EMAIL_LOCAL_MIN_CHARS).toBe(4);
    expect(checkPassword("xxMYUSER-2026xx!", "myuser-2026@example.test", RULES)).toMatchObject({ problem: "contains_email" });
    expect(checkPassword("Tn7!abc9z-kQ2m", "abc@example.test", RULES)).toEqual({ ok: true }); // 앞부분 abc는 3글자
    expect(checkPassword("Tn7!abcd9z-kQ2m", "abcd@example.test", RULES)).toMatchObject({ problem: "contains_email" }); // 4글자
    expect(checkPassword("MyUser-2026@Example.TEST", "myuser-2026@example.test", RULES)).toMatchObject({ problem: "same_as_email" });
  });

  test("이메일이 없으면(빈 글자) 이메일 규칙은 건너뛴다", () => {
    expect(checkPassword("Tn7!kQ2m9z", "", RULES)).toEqual({ ok: true });
    expect(checkPassword("Tn7!kQ2m9z", "   ", RULES)).toEqual({ ok: true });
  });

  test("사유 문장 — 거부마다 사람이 읽는 문장이 있고, 최소 글자·최대 바이트 문장에는 설정 숫자가 들어간다", () => {
    const short = checkPassword("짧은암호1", DEFAULT_EMAIL, RULES);
    expect(short).toMatchObject({ ok: false, message: "비밀번호는 10글자 이상이어야 합니다" });
    const long = checkPassword("a1".repeat(40), DEFAULT_EMAIL, RULES);
    expect(long).toMatchObject({ ok: false });
    if (!long.ok) expect(long.message).toContain("72바이트");
  });
});
