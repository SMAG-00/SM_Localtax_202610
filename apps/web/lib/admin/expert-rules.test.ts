import { describe, expect, test } from "vitest";
import { expertEnableErrors, parseCategory, parseNotice, parsePolicy, parseProfile, parsePublish, parseRequestStatus, parseWithdraw } from "./expert-rules";

const profile = { slug: "zz-gasang", name: "가상 시험인", category_codes: "tax-accountant, cpa", office_name: "시험 사무소", house_relation: "employed" };

describe("프로필 입력 (EXPL-02 · 07)", () => {
  test("분류 여러 개·전문 분야·연락 링크를 읽는다", () => {
    const r = parseProfile({ ...profile, specialties: "분야 A, 분야 B", contact_links: "홈|https://office.example.test/\n블로그|http://x.example.test", regions: "가상 지역" });
    expect(r).toMatchObject({ ok: true, value: { id: null, row: { category_codes: ["tax-accountant", "cpa"], specialties: ["분야 A", "분야 B"], regions: ["가상 지역"], contact_links: [{ label: "홈", url: "https://office.example.test/" }, { label: "블로그", url: "http://x.example.test" }], house_relation: "employed" } } });
  });
  test.each([
    [{ house_relation: "external_partner" }, "house_relation"],
    [{ house_relation: "" }, "house_relation"],
    [{ category_codes: "" }, "category_codes"],
    [{ category_codes: "a,b,c,d,e,f" }, "category_codes"],
    [{ category_codes: "Bad Code" }, "category_codes"],
    [{ slug: "Bad Slug" }, "slug"],
    [{ name: "" }, "name"],
    [{ office_name: "" }, "office_name"],
    [{ contact_links: "홈|javascript:alert(1)" }, "contact_links"],
    [{ contact_links: "a|https://a.test\nb|https://b.test\nc|https://c.test\nd|https://d.test" }, "contact_links"],
    [{ intro: "가".repeat(401) }, "intro"],
    [{ photo_media_id: "abc" }, "photo_media_id"],
  ])("거부 %j", (patch, field) => {
    const r = parseProfile({ ...profile, ...patch });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.some((e) => e.startsWith(`${field}:`))).toBe(true);
  });
  test("자격 검증·등록번호·재검증 칸은 입력에 없다 (PO 결정)", () => {
    const r = parseProfile({ ...profile, license_no: "TEST-1", verified_on: "2026-10-01", reverify_at: "2027-10-01" });
    expect(r.ok && Object.keys(r.value.row)).not.toContain("license_no");
    expect(r.ok && Object.keys(r.value.row).join(",")).not.toMatch(/verif|license/);
  });
});

describe("공개 - 본인 동의서 기록 (EXPL-07)", () => {
  test("버전·받은 날·보관 위치가 모두 있어야 한다", () => {
    expect(parsePublish({ id: 3, consent_version: "v1", consent_on: "2026-10-24", consent_doc_ref: "시험 보관함" })).toEqual({ ok: true, value: { id: 3, consent_version: "v1", consent_on: "2026-10-24", consent_doc_ref: "시험 보관함" } });
    for (const key of ["consent_version", "consent_on", "consent_doc_ref"]) {
      const body: Record<string, unknown> = { id: 3, consent_version: "v1", consent_on: "2026-10-24", consent_doc_ref: "x" };
      body[key] = "";
      const r = parsePublish(body);
      expect(r.ok).toBe(false);
    }
    expect(parsePublish({ id: 3, consent_version: "v1", consent_on: "2026-13-45x", consent_doc_ref: "x" }).ok).toBe(false);
  });
  test("철회는 사유가 있어야 한다", () => {
    expect(parseWithdraw({ id: 1, reason: "" }).ok).toBe(false);
    expect(parseWithdraw({ id: 1, reason: "본인 요청" })).toEqual({ ok: true, value: { id: 1, reason: "본인 요청" } });
  });
});

describe("분류·고지문·정책", () => {
  test("분류", () => {
    expect(parseCategory({ code: "tax-accountant", name: "세무사" })).toEqual({ ok: true, value: { code: "tax-accountant", name: "세무사", sort_order: 100, active: true } });
    expect(parseCategory({ code: "Bad", name: "x" }).ok).toBe(false);
    expect(parseCategory({ code: "ok", name: "x", sort_order: "-1" }).ok).toBe(false);
  });
  test("고지문 승인에는 버전·문구·검토자·검토일", () => {
    expect(parseNotice({ approved: true, version: "v1", text: "t", reviewed_by: "a", reviewed_on: "2026-10-24" }).ok).toBe(true);
    expect(parseNotice({ approved: true, version: "v1", text: "t", reviewed_by: "", reviewed_on: "2026-10-24" }).ok).toBe(false);
    expect(parseNotice({ approved: false, version: "", text: "" }).ok).toBe(true);
  });
  test("정책 승인에는 실사·감수 번호", () => {
    const base = { retention_days: "365", target_business_days: "1", summary_max_chars: "1000", consent_version: "c1", intro: "문단", consent_items: "항목", reviewed_by: "a", reviewed_on: "2026-10-24", due_diligence_ref: "DD-1", legal_review_ref: "LR-1", approved: true };
    expect(parsePolicy(base).ok).toBe(true);
    expect(parsePolicy({ ...base, legal_review_ref: "" }).ok).toBe(false);
    expect(parsePolicy({ ...base, retention_days: "10" }).ok).toBe(false);
    expect(parsePolicy({ ...base, approved: false, intro: "", consent_items: "" }).ok).toBe(true);
  });
});

describe("요청 상태 (EXPL-17 · 21)", () => {
  test("첫 연락은 수행 주체와 안내 완료 확인", () => {
    expect(parseRequestStatus({ id: 1, status: "contacted", performing_entity: "가상 사무소", scope_noted: true }).ok).toBe(true);
    expect(parseRequestStatus({ id: 1, status: "contacted", performing_entity: "", scope_noted: true }).ok).toBe(false);
    expect(parseRequestStatus({ id: 1, status: "contacted", performing_entity: "가상 사무소", scope_noted: false }).ok).toBe(false);
  });
  test("종결은 사유 세 값 중 하나 (이용자 철회는 이용자만)", () => {
    expect(parseRequestStatus({ id: 1, status: "closed", close_reason: "contract" }).ok).toBe(true);
    expect(parseRequestStatus({ id: 1, status: "closed", close_reason: "withdrawn" }).ok).toBe(false);
    expect(parseRequestStatus({ id: 1, status: "closed" }).ok).toBe(false);
  });
});

describe("켜기 사전 검사", () => {
  const ok = { approved: true };
  test("고지문 미승인이면 experts 거부, 정책 미승인이면 expert_requests 거부", () => {
    expect(expertEnableErrors({ experts: true, expert_requests: false }, { experts: true }, { approved: false }, undefined)).toHaveLength(1);
    expect(expertEnableErrors({ experts: true, expert_requests: false }, { experts: true }, ok, undefined)).toEqual([]);
    expect(expertEnableErrors({ experts: false, expert_requests: true }, { experts: true }, ok, { approved: false })).toHaveLength(1);
    expect(expertEnableErrors({ experts: false, expert_requests: true }, { experts: false }, ok, ok)).toHaveLength(1);
    expect(expertEnableErrors({ experts: true, expert_requests: true }, { experts: true }, ok, ok)).toEqual([]);
  });
});
