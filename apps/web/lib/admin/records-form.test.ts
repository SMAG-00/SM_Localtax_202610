// 출처·취재 근거 폼 시험 (FND-04 · NAV-10 · NAV-11 · NAV-12) — 실제 API 입력 검사(parseSourceInput · parseEvidenceInput)를 통과하는지 본다
import { describe, expect, test } from "vitest";
import { parseEvidenceInput, parseSourceInput } from "@/lib/server/articles/records-input";
import { EMPTY_EVIDENCE_FORM, EMPTY_SOURCE_FORM, evidenceFormFrom, evidencePayload, sourcePayload, validateEvidence, validateSource, type EvidenceForm, type SourceForm } from "./records-form";

const dataset: SourceForm = {
  ...EMPTY_SOURCE_FORM,
  kind: "dataset",
  title: "가온시 지방세 세목별 징수 실적(2026년 6월 말)",
  url: "https://www.gaon-si.example/open-data/local-tax-collection-2026-06",
  sourceName: "가온시 세정과",
  lastVerifiedDate: "2026-10-07",
  licenseStatus: "공공누리 제1유형",
};

describe("출처 (FND-04)", () => {
  test("공공 데이터 출처 — 통과, 확인일은 한국 날짜 시각", () => {
    expect(validateSource(dataset)).toEqual({});
    const p = sourcePayload(dataset);
    expect(parseSourceInput(p).ok).toBe(true);
    expect(p).toEqual({
      kind: "dataset",
      title: dataset.title,
      url: dataset.url,
      sourceName: "가온시 세정과",
      lastVerifiedAt: "2026-10-07T00:00:00+09:00",
      licenseStatus: "공공누리 제1유형",
    });
  });

  test("공식 문서·공공 데이터는 URL·발표기관·확인일·이용 조건이 모두 필요 — 칸마다 오류", () => {
    const e = validateSource({ ...EMPTY_SOURCE_FORM, kind: "official_doc", title: "URL 없는 공식 문서" });
    expect(Object.keys(e).sort()).toEqual(["src-license", "src-source-name", "src-url", "src-verified"]);
    expect(e["src-url"]).toMatch(/FND-04/);
  });

  test("보도자료는 URL 없이도 되지만, 원문을 붙이면 URL이 필요하다 (유사도 비교 원문)", () => {
    expect(validateSource({ ...EMPTY_SOURCE_FORM, kind: "press_release", title: "보도자료" })).toEqual({});
    expect(validateSource({ ...EMPTY_SOURCE_FORM, kind: "press_release", title: "보도자료", snapshotText: "원문" })["src-url"]).toBeTruthy();
    const p = sourcePayload({ ...EMPTY_SOURCE_FORM, kind: "press_release", title: "보도자료", url: "https://example.test/press", snapshotText: " 원문 글 " });
    expect(p.snapshot).toEqual({ text: "원문 글" });
    expect(parseSourceInput(p).ok).toBe(true);
  });

  test("주소는 http(s)만, 제목은 필수", () => {
    const e = validateSource({ ...dataset, url: "ftp://x", title: "" });
    expect(e["src-url"]).toBeTruthy();
    expect(e["src-title"]).toBeTruthy();
  });
});

const datasetEvidence: EvidenceForm = {
  ...EMPTY_EVIDENCE_FORM,
  evidenceType: "dataset",
  location: "편집국 자료실/2026/징수실적_2026H1.xlsx",
  rightsStatus: "confirmed",
  verificationStatus: "verified",
  verifiedDate: "2026-10-09",
  retentionUntil: "2031-10-09",
  dataset: {
    ...EMPTY_EVIDENCE_FORM.dataset,
    definition: "취득세 징수액",
    period: "2026년 1~6월",
    unit: "억 원",
    regionUnit: "시·구",
    denominator: "2025년 같은 기간",
    exclusions: "지방교육세",
    transform: "구별 합산",
    reproFileHash: "sha256:3f6c",
    provider: "가온시 세정과",
    sourceUrl: "https://www.gaon-si.example/open-data/x",
    collectedDate: "2026-10-07",
    license: "공공누리 제1유형",
  },
};

describe("취재 근거 — 정량형 재현 정보 (NAV-10)", () => {
  test("API 입력 검사(create) 통과, 재현 정보 12칸", () => {
    expect(validateEvidence(datasetEvidence)).toEqual({});
    const p = evidencePayload(datasetEvidence, "create");
    expect(parseEvidenceInput(p, "create").ok).toBe(true);
    expect(Object.keys(p.dataset as object)).toHaveLength(12);
    expect(p).toMatchObject({ evidenceType: "dataset", verifiedAt: "2026-10-09T00:00:00+09:00", retentionUntil: "2031-10-09" });
    expect("interview" in p).toBe(false);
  });

  test("고칠 때(patch) 지운 칸은 null로 보낸다 — 분모를 지우면 발행이 막혀야 하므로", () => {
    const p = evidencePayload({ ...datasetEvidence, dataset: { ...datasetEvidence.dataset, denominator: " " } }, "patch");
    expect((p.dataset as Record<string, unknown>).denominator).toBeNull();
    expect(parseEvidenceInput(p, "patch", "dataset").ok).toBe(true);
  });

  test("저장된 근거 → 폼 → 같은 본문 (왕복)", () => {
    const row = {
      id: 3,
      evidence_type: "dataset",
      location: datasetEvidence.location,
      rights_status: "confirmed",
      verification_status: "verified",
      verified_at: "2026-10-09T00:00:00+09:00",
      retention_until: "2031-10-09",
      dataset: {
        definition: "취득세 징수액",
        period: "2026년 1~6월",
        unit: "억 원",
        region_unit: "시·구",
        denominator: "2025년 같은 기간",
        exclusions: "지방교육세",
        transform: "구별 합산",
        repro_file_hash: "sha256:3f6c",
        provider: "가온시 세정과",
        source_url: "https://www.gaon-si.example/open-data/x",
        collected_at: "2026-10-07T00:00:00+09:00",
        license: "공공누리 제1유형",
      },
      interview: null,
    };
    expect(evidenceFormFrom(row)).toEqual(datasetEvidence);
  });
});

describe("취재 근거 — 인터뷰 기록 (NAV-11)", () => {
  const interview: EvidenceForm = {
    ...EMPTY_EVIDENCE_FORM,
    evidenceType: "interview",
    location: "편집국 취재 기록함 R-2026-1013-02",
    rightsStatus: "confirmed",
    verificationStatus: "verified",
    verifiedDate: "2026-10-13",
    interview: { subjectRole: "가온시 세정과 주무관", contactedDate: "2026-10-13", recordLocation: "편집국 취재 기록함 R-2026-1013-02", quoteConsent: "full", anonymity: "named", anonymityReason: "" },
  };

  test("통과 — 연락처·녹취 원문 칸은 없다(보존 위치만)", () => {
    expect(validateEvidence(interview)).toEqual({});
    const p = evidencePayload(interview, "create");
    expect(parseEvidenceInput(p, "create").ok).toBe(true);
    expect(p.interview).toEqual({ subjectRole: "가온시 세정과 주무관", contactedAt: "2026-10-13T00:00:00+09:00", recordLocation: "편집국 취재 기록함 R-2026-1013-02", quoteConsent: "full", anonymity: "named" });
    expect("dataset" in p).toBe(false);
  });

  test("대상 역할·인용 동의·익명 여부 필수, 익명이면 익명 사유 필수", () => {
    const e = validateEvidence({ ...interview, interview: { ...interview.interview, subjectRole: "", quoteConsent: "", anonymity: "anonymous" } });
    expect(Object.keys(e).sort()).toEqual(["ev-iv-anonymity-reason", "ev-iv-consent", "ev-iv-role"]);
  });

  test("근거 유형·보존 위치 필수, 확인됨은 확인일 필요", () => {
    const e = validateEvidence({ ...EMPTY_EVIDENCE_FORM, verificationStatus: "verified" });
    expect(Object.keys(e).sort()).toEqual(["ev-location", "ev-type", "ev-verified-date"]);
  });
});
