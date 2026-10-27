import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CERT_PLAN_STATUS_LABEL, certKindLabel, certPlanPublicLine, parseCertPlanDraft, parseCertPlanId } from "./cert-plan";
import { CERT_CLAIM_PATTERNS, findCertClaims } from "./items";

const ok = { cert_kind: "iso27001", scope: "시험용 범위", target_start_on: "2026-11-01", target_end_on: "2027-03-31", cost_estimate_krw: "5,000,000", owner_name: "시험용 담당" };

describe("인증 추진 계획 입력", () => {
  it("올바른 입력 통과 - 비용 쉼표 제거, 선택 칸은 null", () => {
    const r = parseCertPlanDraft(ok);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.cost_estimate_krw).toBe(5000000);
      expect(r.value.entity_name).toBeNull();
      expect(r.value.risk_assessed_on).toBeNull();
      expect(r.value.other_kind_name).toBeNull();
    }
  });
  it.each(["scope", "target_start_on", "target_end_on", "cost_estimate_krw", "owner_name", "cert_kind"])("필수 칸 %s가 비면 거부", (k) => {
    const r = parseCertPlanDraft({ ...ok, [k]: "" });
    expect(r.ok).toBe(false);
  });
  it("종료일이 시작일보다 빠르면 거부, 같은 날은 통과(경계)", () => {
    expect(parseCertPlanDraft({ ...ok, target_end_on: "2026-10-31" }).ok).toBe(false);
    expect(parseCertPlanDraft({ ...ok, target_end_on: "2026-11-01" }).ok).toBe(true);
  });
  it("없는 날짜·음수 비용·소수 비용 거부, 0원은 통과(경계)", () => {
    expect(parseCertPlanDraft({ ...ok, target_start_on: "2026-02-30" }).ok).toBe(false);
    expect(parseCertPlanDraft({ ...ok, cost_estimate_krw: "-1" }).ok).toBe(false);
    expect(parseCertPlanDraft({ ...ok, cost_estimate_krw: "1.5" }).ok).toBe(false);
    expect(parseCertPlanDraft({ ...ok, cost_estimate_krw: 0 }).ok).toBe(true);
  });
  it("기타 종류는 이름이 필요하고 다른 종류에는 이름을 못 쓴다", () => {
    expect(parseCertPlanDraft({ ...ok, cert_kind: "other" }).ok).toBe(false);
    expect(parseCertPlanDraft({ ...ok, cert_kind: "other", other_kind_name: "시험용 기타 인증" }).ok).toBe(true);
    expect(parseCertPlanDraft({ ...ok, other_kind_name: "시험용" }).ok).toBe(false);
    expect(parseCertPlanDraft({ ...ok, cert_kind: "x" }).ok).toBe(false);
  });
  it("인증 단정 표현은 범위·메모·담당·기타 이름 어디에 있어도 거부", () => {
    expect(parseCertPlanDraft({ ...ok, scope: "ISO 인증 획득 범위" }).ok).toBe(false);
    expect(parseCertPlanDraft({ ...ok, note: "인증을 받은 상태" }).ok).toBe(false);
    expect(parseCertPlanDraft({ ...ok, cert_kind: "other", other_kind_name: "인증된 보안 체계" }).ok).toBe(false);
    expect(parseCertPlanDraft({ ...ok, scope: "인증 추진 범위" }).ok).toBe(true);
  });
  it("범위 길이 경계 2000자 통과, 2001자 거부", () => {
    expect(parseCertPlanDraft({ ...ok, scope: "가".repeat(2000) }).ok).toBe(true);
    expect(parseCertPlanDraft({ ...ok, scope: "가".repeat(2001) }).ok).toBe(false);
  });
  it("계획 번호 검사", () => {
    expect(parseCertPlanId({ id: "7" })).toEqual({ ok: true, value: { id: 7 } });
    expect(parseCertPlanId({ id: 0 }).ok).toBe(false);
    expect(parseCertPlanId({}).ok).toBe(false);
  });
});

describe("화면 고정 문구는 인증 취득을 말하지 않는다", () => {
  it("종류 이름과 승인일을 넣은 문구가 단정 표현 검사를 통과하고 '추진 중'을 담는다", () => {
    for (const label of [certKindLabel("iso27001", null), certKindLabel("ismsp", null), certKindLabel("other", " 시험용 기타 ")]) {
      const line = certPlanPublicLine(label, "2026-10-27");
      expect(findCertClaims(line)).toEqual([]);
      expect(line).toContain(CERT_PLAN_STATUS_LABEL);
    }
    expect(certKindLabel("other", " 시험용 기타 ")).toBe("시험용 기타");
  });
  it("공개 화면 컴포넌트·공개 서버 모듈에 취득 단정 낱말이 없다 (입력 거부 안내문이 있는 cert-plan.ts는 제외)", () => {
    const files = ["../../components/site/SecurityView.tsx", "../server/public/security.ts"];
    for (const f of files) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
      expect(findCertClaims(src), f).toEqual([]);
    }
  });
});

describe("DB 승인 함수의 문구 검사와 앱 목록", () => {
  it("232 마이그레이션이 W12-g 단일 문구 검사 함수를 쓰고 자체 패턴 목록을 두지 않는다", () => {
    const sql = readFileSync(new URL("../../../../packages/db/supabase/migrations/20261027000232_w13j_cert_functions.sql", import.meta.url), "utf8");
    expect(sql).toContain("public.security_text_violations(");
    expect(CERT_CLAIM_PATTERNS.length).toBeGreaterThan(0);
    expect(sql).not.toContain("unnest(array[");
  });
});
