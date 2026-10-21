// 브랜드 관리 입력 검사 시험 (W3 7단계 — BR-01·07·10) — 설계 2.1 값만 받고, 증빙 없는 약력·미래 동의서·범위 밖 값은 거부
import { describe, expect, test } from "vitest";
import { brandReviewValue, careerClaimValue, parseBio, parseConsent, parseEvidence } from "./brand-rules";

const NOW = new Date("2026-10-21T03:00:00Z");

describe("parseEvidence", () => {
  test("인물 번호·설계 종류·문서 위치가 있으면 통과", () => {
    expect(parseEvidence({ personId: 7, kind: "official_record", docRef: " 시험용 증빙 위치 " })).toEqual({ ok: true, value: { personId: 7, kind: "official_record", docRef: "시험용 증빙 위치" } });
  });
  test("설계 밖 종류·빈 위치·번호 없음은 사유마다 한 줄", () => {
    const r = parseEvidence({ personId: 0, kind: "license", docRef: "  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(3);
  });
});

describe("parseConsent", () => {
  const base = { personId: 3, version: "시험용-1", docRef: "시험용 동의서 위치", scope: ["profile_page", "column", "column"] };
  test("범위는 중복을 지우고 설계 값만, 시작·끝을 비우면 null", () => {
    expect(parseConsent(base, NOW)).toEqual({ ok: true, value: { personId: 3, version: "시험용-1", scope: ["profile_page", "column"], docRef: "시험용 동의서 위치", validFrom: null, validTo: null } });
  });
  test("설계 밖 범위(person_page·newsletter)는 거부하고 그 값을 알려 준다", () => {
    const r = parseConsent({ ...base, scope: ["person_page", "newsletter"] }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("person_page, newsletter");
  });
  test("빈 범위 거부", () => {
    expect(parseConsent({ ...base, scope: [] }, NOW).ok).toBe(false);
  });
  test("시작 경계 — 지금은 통과, 지금 + 1초는 거부", () => {
    expect(parseConsent({ ...base, validFrom: NOW.toISOString() }, NOW).ok).toBe(true);
    expect(parseConsent({ ...base, validFrom: new Date(NOW.getTime() + 1000).toISOString() }, NOW).ok).toBe(false);
  });
  test("끝 경계 — 시작과 같으면 거부, 1초 뒤면 통과, 날짜가 아니면 거부", () => {
    const from = "2026-10-01T00:00:00.000Z";
    expect(parseConsent({ ...base, validFrom: from, validTo: from }, NOW).ok).toBe(false);
    expect(parseConsent({ ...base, validFrom: from, validTo: "2026-10-01T00:00:01.000Z" }, NOW).ok).toBe(true);
    expect(parseConsent({ ...base, validTo: "내년" }, NOW).ok).toBe(false);
  });
});

describe("parseBio — 증빙 없는 약력은 저장하지 않는다 (BR-10)", () => {
  const mine = new Set([11, 12]);
  test("항목마다 이 인물의 증빙 번호가 있으면 저장 값(evidence_id 글자)으로 바꾼다", () => {
    expect(parseBio({ personId: 5, items: [{ item: "시험용 약력 가", evidenceId: 11 }, { item: "시험용 약력 나", evidence_id: "12" }] }, mine)).toEqual({
      ok: true,
      value: { personId: 5, items: [{ item: "시험용 약력 가", evidence_id: "11" }, { item: "시험용 약력 나", evidence_id: "12" }] },
    });
  });
  test("증빙 번호 없음·남의 증빙·이메일 섞인 줄·빈 글자는 거부", () => {
    const r = parseBio({ personId: 5, items: [{ item: "번호 없음" }, { item: "남의 것", evidenceId: 99 }, { item: "연락 a@b.kr", evidenceId: 11 }, { item: " ", evidenceId: 12 }] }, mine);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(4);
  });
  test("빈 목록은 통과 — 약력을 모두 내리는 저장", () => {
    expect(parseBio({ personId: 5, items: [] }, mine)).toEqual({ ok: true, value: { personId: 5, items: [] } });
  });
});

describe("설정 값 모양 — 설계 2.2와 같은 칸", () => {
  test("경력 표시 승인·철회", () => {
    expect(careerClaimValue(true, 4, "user:u1", "2026-10-21T03:00:00.000Z")).toEqual({ approved: true, basis_evidence_id: 4, approved_by: "user:u1", approved_at: "2026-10-21T03:00:00.000Z" });
    expect(careerClaimValue(false, 4, "user:u1", "x")).toEqual({ approved: false, basis_evidence_id: null, approved_by: null, approved_at: null });
  });
  test("광고 규정 감수 기록·철회", () => {
    expect(brandReviewValue(true, "시험용 감수 기록")).toEqual({ reviewed: true, record_id: "시험용 감수 기록" });
    expect(brandReviewValue(false, "x")).toEqual({ reviewed: false, record_id: null });
  });
});
