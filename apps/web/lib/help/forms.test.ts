// 고객센터 폼 순수 규칙 시험 (W2-e 설계 2.8 · 7.1 · 7.4 · 4.5) — 가림 견본은 설계 표 그대로, 첨부는 실제 파일 앞부분 바이트로.
import { describe, expect, test } from "vitest";
import { maskBody } from "@/lib/analytics/query-terms";
import { HELP_FORMS, HELP_SLUGS, articleSlugOf, checkAttachments, checkHelpToken, cleanFileName, parseHelpInput, parseHelpSettings, signHelpToken, type HelpSettings } from "./forms";
import { INQUIRY_KINDS } from "@/lib/access";

const SETTINGS: HelpSettings = { maxFiles: 3, maxTotalBytes: 4_000_000, allowedExtensions: ["pdf", "jpg", "jpeg", "png", "docx", "xlsx", "hwp", "hwpx"], bodyMin: 10, bodyMax: 5000, minFillSeconds: 3, fillTokenHours: 2 };
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);

describe("본문 가림 견본 (설계 2.8)", () => {
  test.each([
    ["답장은 hong@example.com 으로 주세요", "답장은 [이메일] 으로 주세요"],
    ["제 번호는 010-1234-5678 입니다", "제 번호는 [전화번호] 입니다"],
    ["계좌 110-123-456789", "계좌 [번호]"],
    ["2026-10-19 기사 오류", "2026-10-19 기사 오류"],
    ["지방세법 제111조", "지방세법 제111조"],
    ["주민번호 900101-1234567 입니다", "주민번호 [주민등록번호] 입니다"],
  ])("%s → %s", (raw, expected) => {
    expect(maskBody(raw).text).toBe(expected);
  });

  test("줄바꿈과 긴 글은 자르지 않고 그대로 둔다", () => {
    const long = `첫 줄\n둘째 줄 ${"가".repeat(300)}`;
    expect(maskBody(long).text).toBe(long);
  });
});

describe("폼 5종 정의", () => {
  test("문의 종류는 설계 7.1의 5개이고 '전문가 연락 요청'은 문의 종류에 없다", () => {
    expect(HELP_SLUGS.map((s) => HELP_FORMS[s].kind)).toEqual(["tip", "subscription", "advertising", "reader_submission", "correction"]);
    for (const s of HELP_SLUGS) expect(INQUIRY_KINDS).toContain(HELP_FORMS[s].kind);
    expect(INQUIRY_KINDS.join(",")).not.toMatch(/expert/);
  });
});

describe("입력 검사 parseHelpInput", () => {
  const ok = { body: "기사 본문에 오류가 있어 알려 드립니다.", contactEmail: "a@example.test", agreePrivacy: "on" };

  test("기사 제보는 이메일 없이 익명으로 낼 수 있고 본문의 이메일은 가려진다", () => {
    const r = parseHelpInput("report", { body: "제보합니다 연락은 x@y.kr 로 주세요 감사합니다" }, SETTINGS);
    expect(r.ok && r.value.body).toBe("제보합니다 연락은 [이메일] 로 주세요 감사합니다");
    expect(r.ok && r.value.contactEmail).toBeNull();
  });
  test("기사 제보라도 이메일을 적으면 개인정보 동의가 필요하다", () => {
    expect(parseHelpInput("report", { body: ok.body, contactEmail: "a@example.test" }, SETTINGS)).toMatchObject({ ok: false, code: "privacy" });
  });
  test("구독 문의는 이메일 필수 — 비면 거부, 잘못된 모양도 거부", () => {
    expect(parseHelpInput("subscribe", { body: ok.body, agreePrivacy: "on" }, SETTINGS)).toMatchObject({ ok: false, code: "email" });
    expect(parseHelpInput("subscribe", { ...ok, contactEmail: "x@y" }, SETTINGS)).toMatchObject({ ok: false, code: "email" });
  });
  test("내용 글자 수 경계 — 9글자는 거부, 10글자는 통과, 5001글자는 거부", () => {
    expect(parseHelpInput("subscribe", { ...ok, body: "가나다라마바사아자" }, SETTINGS)).toMatchObject({ ok: false, code: "body" });
    expect(parseHelpInput("subscribe", { ...ok, body: "가나다라마바사아자차" }, SETTINGS).ok).toBe(true);
    expect(parseHelpInput("subscribe", { ...ok, body: "가".repeat(5001) }, SETTINGS)).toMatchObject({ ok: false, code: "body" });
    expect(parseHelpInput("subscribe", { ...ok, body: "가".repeat(5000) }, SETTINGS).ok).toBe(true);
  });
  test("독자 투고는 제목 필수", () => {
    expect(parseHelpInput("contribute", ok, SETTINGS)).toMatchObject({ ok: false, code: "title" });
    const r = parseHelpInput("contribute", { ...ok, title: "투고 제목", contactName: "필명" }, SETTINGS);
    expect(r.ok && [r.value.title, r.value.contactName]).toEqual(["투고 제목", "필명"]);
  });
  test("정정·반론은 구분과 기사 주소가 필수이고 구분 값은 둘 중 하나", () => {
    const base = { ...ok, articleUrl: "/news/a-b" };
    expect(parseHelpInput("corrections", base, SETTINGS)).toMatchObject({ ok: false, code: "request_type" });
    expect(parseHelpInput("corrections", { ...base, requestType: "delete" }, SETTINGS)).toMatchObject({ ok: false, code: "request_type" });
    expect(parseHelpInput("corrections", { ...ok, requestType: "rebuttal" }, SETTINGS)).toMatchObject({ ok: false, code: "article_url" });
    const r = parseHelpInput("corrections", { ...base, requestType: "rebuttal" }, SETTINGS);
    expect(r.ok && [r.value.kind, r.value.requestType]).toEqual(["correction", "rebuttal"]);
  });
  test("정정 폼이 아니면 구분·기사 주소·회사 이름을 받지 않는다", () => {
    const r = parseHelpInput("subscribe", { ...ok, requestType: "rebuttal", articleUrl: "/news/x", organization: "회사" }, SETTINGS);
    expect(r.ok && [r.value.requestType, r.value.articleUrl, r.value.organization]).toEqual([null, null, null]);
  });
});

describe("기사 주소 연결", () => {
  const hosts = ["site.example"];
  test.each([
    ["/news/abc-1", "abc-1"],
    ["https://site.example/news/%EA%B0%80", "가"],
    ["https://other.example/news/abc", null],
    ["https://site.example/tax/abc", null],
    ["javascript:alert(1)", null],
    [null, null],
  ])("%s → %s", (url, slug) => {
    expect(articleSlugOf(url, hosts)).toBe(slug);
  });
});

describe("첨부 검사 (설계 7.4)", () => {
  test("허용 형식과 시그니처가 맞으면 통과하고 원래 이름은 경로 문자를 지운다", () => {
    const r = checkAttachments([{ name: "C:\\fake\\보고서.PDF", size: 100, head: PDF }, { name: "표.xlsx", size: 100, head: ZIP }], SETTINGS);
    expect(r).toEqual({ ok: true, files: [{ ext: "pdf", name: "보고서.PDF", bytes: 100 }, { ext: "xlsx", name: "표.xlsx", bytes: 100 }] });
  });
  test(".exe 파일은 확장자로 거부", () => {
    expect(checkAttachments([{ name: "a.exe", size: 10, head: EXE }], SETTINGS)).toEqual({ ok: false, code: "attachment_type" });
  });
  test("이름만 .pdf로 바꾼 실행 파일도 시그니처로 거부", () => {
    expect(checkAttachments([{ name: "a.pdf", size: 10, head: EXE }], SETTINGS)).toEqual({ ok: false, code: "attachment_type" });
  });
  test("빈 파일·확장자 없는 파일은 거부", () => {
    expect(checkAttachments([{ name: "a.pdf", size: 0, head: PDF }], SETTINGS)).toEqual({ ok: false, code: "attachment_type" });
    expect(checkAttachments([{ name: "noext", size: 5, head: PDF }], SETTINGS)).toEqual({ ok: false, code: "attachment_type" });
  });
  test("개수 상한 3개 통과, 4개는 거부", () => {
    const f = { name: "a.pdf", size: 10, head: PDF };
    expect(checkAttachments([f, f, f], SETTINGS).ok).toBe(true);
    expect(checkAttachments([f, f, f, f], SETTINGS)).toEqual({ ok: false, code: "attachment_count" });
  });
  test("합계 크기 경계 — 4,000,000바이트 통과, 4,000,001바이트 거부", () => {
    expect(checkAttachments([{ name: "a.pdf", size: 4_000_000, head: PDF }], SETTINGS).ok).toBe(true);
    expect(checkAttachments([{ name: "a.pdf", size: 2_000_000, head: PDF }, { name: "b.pdf", size: 2_000_001, head: PDF }], SETTINGS)).toEqual({ ok: false, code: "attachment_size" });
  });
  test("파일 이름 정리 — 경로·제어 문자 제거, 점으로 시작하지 않음", () => {
    expect(cleanFileName("../../etc/pass\u0000wd.pdf")).toBe("passwd.pdf");
    expect(cleanFileName("")).toBe("file");
  });
});

describe("폼 열림 토큰", () => {
  const secret = "test-secret";
  const rules = { minFillSeconds: 3, fillTokenHours: 2 };
  const opened = 1_700_000_000_000;
  const token = signHelpToken(secret, opened);
  test.each([
    [2_999, "too_fast"],
    [3_000, "ok"],
    [2 * 3600 * 1000, "ok"],
    [2 * 3600 * 1000 + 1_000, "expired"],
  ])("열린 뒤 %sms → %s", (after, expected) => {
    expect(checkHelpToken(secret, token, opened + after, rules)).toBe(expected);
  });
  test("다른 열쇠·다른 종류(가입) 토큰·형식 오류는 bad", () => {
    expect(checkHelpToken("other", token, opened + 5_000, rules)).toBe("bad");
    expect(checkHelpToken(secret, "x.y", opened, rules)).toBe("bad");
    expect(checkHelpToken(secret, undefined, opened, rules)).toBe("bad");
  });
});

describe("설정 help 읽기", () => {
  const seed = { version: "v", attachments: { max_files: 3, max_total_bytes: 4000000, allowed_extensions: ["pdf"] }, body_chars: { min: 10, max: 5000 }, min_fill_seconds: 3, fill_token_hours: 2 };
  test("정상 값", () => expect(parseHelpSettings(seed)).toMatchObject({ maxFiles: 3, bodyMax: 5000, allowedExtensions: ["pdf"] }));
  test.each([null, {}, { ...seed, body_chars: { min: 10, max: 5 } }, { ...seed, attachments: { ...seed.attachments, allowed_extensions: ["../x"] } }])("모양이 틀리면 null %#", (v) => expect(parseHelpSettings(v)).toBeNull());
});
