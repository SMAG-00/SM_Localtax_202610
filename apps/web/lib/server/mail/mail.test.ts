// 메일 설정·본문, 사이트 주소·돌아갈 주소 시험 (W2-e 설계 4.3 · 4.4 · 8.1)
import { describe, expect, test } from "vitest";
import { memberNextPath } from "@/lib/auth/member-next";
import { resolveSiteBase } from "@/lib/auth/site-url";
import { mailConfigured, readMailConfig } from "./config";
import { renderMail } from "./templates";

const ok = { MAIL_FROM: "선명 <noreply@example.test>", MAIL_SMTP_HOST: "smtp.example.test", MAIL_SMTP_PORT: "587" };

describe("mailConfigured / readMailConfig", () => {
  test("필수 셋이 있으면 설정됨 — 사용자 없이도, secure는 기본 false", () => {
    expect(readMailConfig(ok)).toEqual({ from: ok.MAIL_FROM, host: "smtp.example.test", port: 587, secure: false, auth: null });
    expect(mailConfigured(ok)).toBe(true);
  });
  test.each([["MAIL_FROM"], ["MAIL_SMTP_HOST"], ["MAIL_SMTP_PORT"]])("%s가 없으면 설정 없음", (key) => {
    expect(mailConfigured({ ...ok, [key]: undefined })).toBe(false);
    expect(mailConfigured({ ...ok, [key]: "  " })).toBe(false);
  });
  test("포트 경계 — 0·65536·글자 섞임은 거부, 1·65535는 통과", () => {
    for (const p of ["0", "65536", "25a", "-1", "1.5"]) expect(mailConfigured({ ...ok, MAIL_SMTP_PORT: p })).toBe(false);
    for (const p of ["1", "65535"]) expect(mailConfigured({ ...ok, MAIL_SMTP_PORT: p })).toBe(true);
  });
  test("사용자와 비밀번호는 함께 있어야 하고, MAIL_SMTP_SECURE=true면 TLS", () => {
    expect(mailConfigured({ ...ok, MAIL_SMTP_USER: "u" })).toBe(false);
    expect(readMailConfig({ ...ok, MAIL_SMTP_USER: "u", MAIL_SMTP_PASSWORD: "p", MAIL_SMTP_SECURE: "TRUE", MAIL_SMTP_PORT: "465" })).toMatchObject({ secure: true, auth: { user: "u", pass: "p" } });
  });
  test("발신자에 골뱅이가 없으면 설정 없음", () => {
    expect(mailConfigured({ ...ok, MAIL_FROM: "noreply" })).toBe(false);
  });
});

describe("renderMail", () => {
  test("가입 확인 메일 — 링크가 본문에 그대로 있고 무시 안내가 있다", () => {
    const m = renderMail("signup_confirm", { link: "http://localhost:3001/auth/confirm?token_hash=abc&type=signup" });
    expect(m.subject).toBe("[선명 지방세·부동산] 가입 확인");
    expect(m.text).toContain("http://localhost:3001/auth/confirm?token_hash=abc&type=signup");
    expect(m.text).toContain("본인이 요청하지 않았다면");
  });
  test("이미 가입 안내 메일 — 로그인 주소가 있다", () => {
    expect(renderMail("signup_exists_notice", { loginUrl: "https://x.example.test/login" }).text).toContain("https://x.example.test/login");
  });
  test("링크가 없거나 http(s)가 아니면 만들지 못한다 (javascript: 거부)", () => {
    expect(() => renderMail("signup_confirm", {})).toThrow();
    expect(() => renderMail("signup_confirm", { link: "javascript:alert(1)" })).toThrow();
    expect(() => renderMail("signup_exists_notice", {})).toThrow();
  });
});

describe("resolveSiteBase", () => {
  const base = { forwardedHost: null, forwardedProto: null, requestProtocol: "http:", envSiteUrl: "https://test.example.test/" };
  test("로컬 호스트는 요청 호스트를 그대로 쓴다 (포트 포함·요청 프로토콜)", () => {
    expect(resolveSiteBase({ ...base, host: "127.0.0.1:3001" })).toBe("http://127.0.0.1:3001");
    expect(resolveSiteBase({ ...base, host: "localhost:3001" })).toBe("http://localhost:3001");
  });
  test("환경변수 사이트 주소와 같은 호스트·vercel.app 호스트는 https", () => {
    expect(resolveSiteBase({ ...base, host: "test.example.test" })).toBe("https://test.example.test");
    expect(resolveSiteBase({ ...base, host: "sm-localtax-git-x.vercel.app" })).toBe("https://sm-localtax-git-x.vercel.app");
  });
  test("전달 호스트·프로토콜 머리글이 있으면 그것을 쓴다", () => {
    expect(resolveSiteBase({ ...base, host: "10.0.0.5:8080", forwardedHost: "test.example.test", forwardedProto: "https" })).toBe("https://test.example.test");
  });
  test("허용 호스트가 아니면 환경변수 주소 (끝 슬래시 제거), 그것도 없으면 null", () => {
    expect(resolveSiteBase({ ...base, host: "evil.example.org" })).toBe("https://test.example.test");
    expect(resolveSiteBase({ ...base, host: "evil.example.org", envSiteUrl: undefined })).toBeNull();
  });
  test("호스트 머리글에 경로·계정이 섞이면 거부하고 환경변수 주소", () => {
    expect(resolveSiteBase({ ...base, host: "localhost:3001/evil" })).toBe("https://test.example.test");
    expect(resolveSiteBase({ ...base, host: "user@localhost:3001" })).toBe("https://test.example.test");
  });
});

describe("memberNextPath", () => {
  test.each([["/my", "/my"], ["/my/settings?a=1", "/my/settings?a=1"], ["/help", "/help"], ["/news/abc", "/news/abc"], ["/account/password", "/account/password"]])("%s는 허용", (raw, out) => {
    expect(memberNextPath(raw)).toBe(out);
  });
  test.each([["//evil.test"], ["https://evil.test"], ["/admin"], ["/myx"], ["/\\evil"], ["/my/../admin"], [undefined], [""], ["/my\n/x"]])("%s는 /my로", (raw) => {
    expect(memberNextPath(raw)).toBe("/my");
  });
});
