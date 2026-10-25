import { describe, expect, test } from "vitest";
import { TOKEN_SHAPE, hashToken } from "./input";
import { MAX_AMENDMENTS, MAX_TAX_KINDS, deriveToken, parseSubscribeInput, selectPremiumRecipients } from "./subscribe";

const base = { email: " Test@Example.Test ", agree_brief: "on" };

describe("parseSubscribeInput", () => {
  test("이메일은 소문자·공백 제거, 브리핑만 고르면 관심 설정은 버린다", () => {
    const r = parseSubscribeInput({ ...base, tax_kinds: ["acquisition"], amendment_ids: ["3"] });
    expect(r).toEqual({ ok: true, value: { email: "test@example.test", brief: true, alert: false, taxKinds: [], amendmentIds: [], includeDocs: false } });
  });
  test("알림을 고르면 관심 세목·개정안 번호를 중복 없이 받는다", () => {
    const r = parseSubscribeInput({ email: "a@example.test", agree_alert: "true", tax_kinds: "acquisition,property,acquisition", amendment_ids: ["3", "3", "7"], include_docs: "on" });
    expect(r).toEqual({ ok: true, value: { email: "a@example.test", brief: false, alert: true, taxKinds: ["acquisition", "property"], amendmentIds: [3, 7], includeDocs: true } });
  });
  test("동의를 하나도 고르지 않으면 consent, 이메일 모양이 틀리면 email", () => {
    expect(parseSubscribeInput({ email: "a@example.test" })).toEqual({ ok: false, code: "consent" });
    expect(parseSubscribeInput({ email: "not-an-email", agree_brief: "on" })).toEqual({ ok: false, code: "email" });
  });
  test("관심 설정 경계 - 세목 12개는 통과, 13개는 prefs / 개정안 50개는 통과, 51개는 prefs / 잘못된 번호·slug는 prefs", () => {
    const kinds = (n: number) => Array.from({ length: n }, (_, i) => `kind-${i}`);
    const ids = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));
    expect(parseSubscribeInput({ email: "a@example.test", agree_alert: "on", tax_kinds: kinds(MAX_TAX_KINDS) }).ok).toBe(true);
    expect(parseSubscribeInput({ email: "a@example.test", agree_alert: "on", tax_kinds: kinds(MAX_TAX_KINDS + 1) })).toEqual({ ok: false, code: "prefs" });
    expect(parseSubscribeInput({ email: "a@example.test", agree_alert: "on", amendment_ids: ids(MAX_AMENDMENTS) }).ok).toBe(true);
    expect(parseSubscribeInput({ email: "a@example.test", agree_alert: "on", amendment_ids: ids(MAX_AMENDMENTS + 1) })).toEqual({ ok: false, code: "prefs" });
    for (const bad of [["0"], ["-2"], ["1.5"], ["abc"]]) expect(parseSubscribeInput({ email: "a@example.test", agree_alert: "on", amendment_ids: bad })).toEqual({ ok: false, code: "prefs" });
    expect(parseSubscribeInput({ email: "a@example.test", agree_alert: "on", tax_kinds: ["Bad Slug"] })).toEqual({ ok: false, code: "prefs" });
  });
});

describe("deriveToken", () => {
  test("같은 열쇠·번호면 같은 값이고 토큰 모양(43글자)이며, 번호나 열쇠가 다르면 다른 값", () => {
    const t = deriveToken("시험-열쇠", "revoke", 11);
    expect(t).toBe(deriveToken("시험-열쇠", "revoke", 11));
    expect(t).toMatch(TOKEN_SHAPE);
    expect(t).toHaveLength(43);
    expect(deriveToken("시험-열쇠", "revoke", 12)).not.toBe(t);
    expect(deriveToken("다른-열쇠", "revoke", 11)).not.toBe(t);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("selectPremiumRecipients (BRIEF-05)", () => {
  const rows = [
    { consentId: 1, userId: "u1", confirmed: true, revoked: false },
    { consentId: 2, userId: "u2", confirmed: true, revoked: false }, // 권한 없음
    { consentId: 3, userId: "u3", confirmed: false, revoked: false }, // 이중 확인 전
    { consentId: 4, userId: "u4", confirmed: true, revoked: true }, // 철회
  ];
  test("수신 동의와 권한이 둘 다 있는 사람만 - 둘 중 하나만 있으면 0", () => {
    const entitled = new Set(["u1", "u3", "u4"]);
    expect(selectPremiumRecipients(rows, entitled).map((r) => r.consentId)).toEqual([1]);
    expect(selectPremiumRecipients(rows, new Set()).length).toBe(0);
  });
});
