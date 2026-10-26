import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CERT_CLAIM_PATTERNS, SECURITY_ITEM_KEYS, findCertClaims, parseCheck, parseItemDraft, parseSecurityEntry, securityPageReady } from "./items";

describe("인증 단정 표현 문구 검사", () => {
  it.each(["ISO 인증 획득", "인증을 받은 보안 체계", "보안 인증 완료", "인증된 보안", "27001 준수", "완벽하게 안전합니다", "100% 안전"])("걸린다: %s", (t) => {
    expect(findCertClaims(t).length).toBeGreaterThan(0);
  });
  it.each(["내부 통제 목록으로 자가 점검합니다", "시험용 문장입니다", "인증 추진은 5단계 과제입니다"])("통과한다: %s", (t) => {
    expect(findCertClaims(t)).toEqual([]);
  });
  it("DB 함수 security_text_violations의 패턴 목록과 같다", () => {
    const sql = readFileSync(new URL("../../../../packages/db/supabase/migrations/20261026000177_w12g_security_policy.sql", import.meta.url), "utf8");
    const body = sql.slice(sql.indexOf("unnest(array["), sql.indexOf("]) as p"));
    const sqlPatterns = [...body.matchAll(/^\s*'(.*)',?\s*$/gm)].map((m) => m[1]);
    expect(sqlPatterns).toEqual([...CERT_CLAIM_PATTERNS]);
  });
});

describe("보안 정책 항목 입력", () => {
  const ok = { item_key: "encryption", body: "시험용 본문", confirmed_on: "2026-10-01" };
  it("올바른 입력 통과 + 계약 확인 체크는 기본 false", () => {
    const r = parseItemDraft(ok);
    expect(r.ok && r.value.contract_verified).toBe(false);
    const c = parseItemDraft({ ...ok, contract_verified: "on" });
    expect(c.ok && c.value.contract_verified).toBe(true);
  });
  it("항목 키 밖·빈 본문·없는 날짜·단정 표현을 거부", () => {
    expect(parseItemDraft({ ...ok, item_key: "other" }).ok).toBe(false);
    expect(parseItemDraft({ ...ok, body: "  " }).ok).toBe(false);
    expect(parseItemDraft({ ...ok, confirmed_on: "2026-02-30" }).ok).toBe(false);
    expect(parseItemDraft({ ...ok, body: "인증 획득 완료" }).ok).toBe(false);
  });
  it("주민등록번호 모양 글자는 거부", () => {
    expect(parseItemDraft({ ...ok, body: "번호 900101-1234567" }).ok).toBe(false);
  });
  it("7개 항목 키", () => {
    expect(SECURITY_ITEM_KEYS).toHaveLength(7);
  });
});

describe("통제 점검 입력", () => {
  const ok = { round_no: 1, control_key: "ctl_one", control_title: "시험용 통제", result: "met", checked_on: "2026-10-01" };
  it("met 통과, gap은 조치 계획·기한 없으면 거부", () => {
    expect(parseCheck(ok).ok).toBe(true);
    expect(parseCheck({ ...ok, result: "gap" }).ok).toBe(false);
    expect(parseCheck({ ...ok, result: "gap", gap_plan: "시험용 계획", due_on: "2026-12-31" }).ok).toBe(true);
    expect(parseCheck({ ...ok, result: "bad" }).ok).toBe(false);
    expect(parseCheck({ ...ok, round_no: 0 }).ok).toBe(false);
  });
});

describe("화면 열림 판정과 진입 경로", () => {
  const all = SECURITY_ITEM_KEYS.map((k) => ({ item_key: k, body: "시험용 본문", confirmed_on: "2026-10-01" }));
  it("7개 모두 있을 때만 열림, 하나 빠지거나 확인일 빈 값이면 닫힘", () => {
    expect(securityPageReady(all)).toBe(true);
    expect(securityPageReady(all.slice(1))).toBe(false);
    expect(securityPageReady(all.map((i, n) => (n === 0 ? { ...i, confirmed_on: "" } : i)))).toBe(false);
  });
  it("위반 표현이 든 항목이 있으면 닫힘 (이중 방어)", () => {
    expect(securityPageReady(all.map((i, n) => (n === 2 ? { ...i, body: "인증 획득" } : i)))).toBe(false);
  });
  it("진입 경로는 허용 목록 밖이면 direct", () => {
    expect(parseSecurityEntry("footer")).toBe("footer");
    expect(parseSecurityEntry("x")).toBe("direct");
  });
});
