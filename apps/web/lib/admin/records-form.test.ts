// 출처·취재 근거 폼 시험 (FND-04 · NAV-10 · NAV-11 · NAV-12) — 실제 API 입력 검사(parseSourceInput · parseEvidenceInput)를 통과하는지 본다
import { describe, expect, test } from "vitest";
import { parseEvidenceInput, parseSourceInput, parseSourceRevision } from "@/lib/server/articles/records-input";
import { OFFICIAL_SOURCE_TYPES } from "@ltr/editorial";
import {
  EMPTY_EVIDENCE_FORM,
  EMPTY_SOURCE_FORM,
  evidenceFormFrom,
  evidencePayload,
  sourceFormOf,
  sourcePayload,
  sourceRevisionPayload,
  validateEvidence,
  validateSource,
  validateSourceRevision,
  type EvidenceForm,
  type SourceForm,
} from "./records-form";

const ALLOWED = [...OFFICIAL_SOURCE_TYPES];

/** 시험용 가상 도시 가온시의 공공 데이터 출처 — 공식 자료 필수 칸(W4 5단계 REG1-09 · PR-07)까지 모두 찬 모양 */
const dataset: SourceForm = {
  ...EMPTY_SOURCE_FORM,
  kind: "dataset",
  title: "가온시 지방세 세목별 징수 실적(2026년 6월 말)",
  url: "https://www.gaon-si.example/open-data/local-tax-collection-2026-06",
  sourceName: "가온시 세정과",
  lastVerifiedDate: "2026-10-07",
  licenseStatus: "공공누리 제1유형",
  licenseType: "kogl_1",
  sourceType: "local_tax_revenue",
  publishedOn: "2026-07-15",
  referenceDate: "2026-06-30",
  regionUnit: "시·구",
  collectedDate: "2026-10-06",
};

describe("출처 (FND-04 · W4 5단계 REG1-07 · REG1-09 · PR-07)", () => {
  test("공공 데이터 출처 — 통과, 확인일·수집일은 한국 날짜 시각", () => {
    expect(validateSource(dataset, ALLOWED)).toEqual({});
    const p = sourcePayload(dataset);
    expect(parseSourceInput(p).ok).toBe(true);
    expect(p).toEqual({
      kind: "dataset",
      title: dataset.title,
      url: dataset.url,
      sourceName: "가온시 세정과",
      lastVerifiedAt: "2026-10-07T00:00:00+09:00",
      licenseStatus: "공공누리 제1유형",
      licenseType: "kogl_1",
      sourceType: "local_tax_revenue",
      publishedOn: "2026-07-15",
      referenceDate: "2026-06-30",
      regionUnit: "시·구",
      collectedAt: "2026-10-06T00:00:00+09:00",
    });
  });

  test("공식 문서·공공 데이터는 URL·발표기관·확인일·이용 조건(FND-04) + 공공누리 유형(PR-07) + 발표일·기준일·지역 단위·수집일(REG1-09)이 모두 필요 — 칸마다 오류", () => {
    const e = validateSource({ ...EMPTY_SOURCE_FORM, kind: "official_doc", title: "URL 없는 공식 문서" }, ALLOWED);
    expect(Object.keys(e).sort()).toEqual([
      "src-collected",
      "src-license",
      "src-license-type",
      "src-published",
      "src-reference",
      "src-region-unit",
      "src-source-name",
      "src-url",
      "src-verified",
    ]);
    expect(e["src-url"]).toMatch(/FND-04/);
    expect(e["src-license-type"]).toMatch(/PR-07/);
    for (const id of ["src-published", "src-reference", "src-region-unit", "src-collected"]) expect(e[id]).toMatch(/REG1-09/);
    // 하나만 비면 그 칸 하나만
    expect(validateSource({ ...dataset, publishedOn: "" }, ALLOWED)).toEqual({ "src-published": expect.stringMatching(/^발표일이/) });
    expect(validateSource({ ...dataset, regionUnit: "   " }, ALLOWED)).toEqual({ "src-region-unit": expect.stringMatching(/^지역 단위가/) });
    expect(validateSource({ ...dataset, referenceDate: "2026-02-30" }, ALLOWED)).toEqual({ "src-reference": "기준일은 YYYY-MM-DD 날짜로 적어 주세요" });
  });

  test("보도자료는 URL 없이도 되지만 공공누리 유형은 필요하고, 원문을 붙이면 URL이 필요하다 (유사도 비교 원문)", () => {
    expect(validateSource({ ...EMPTY_SOURCE_FORM, kind: "press_release", title: "보도자료" })).toEqual({ "src-license-type": expect.stringMatching(/PR-07/) });
    expect(validateSource({ ...EMPTY_SOURCE_FORM, kind: "press_release", title: "보도자료", licenseType: "kogl_2" })).toEqual({});
    expect(validateSource({ ...EMPTY_SOURCE_FORM, kind: "press_release", title: "보도자료", licenseType: "kogl_2", snapshotText: "원문" })["src-url"]).toBeTruthy();
    const p = sourcePayload({ ...EMPTY_SOURCE_FORM, kind: "press_release", title: "보도자료", licenseType: "kogl_2", url: "https://example.test/press", snapshotText: " 원문 글 " });
    expect(p.snapshot).toEqual({ text: "원문 글" });
    expect(p.licenseType).toBe("kogl_2");
    expect(parseSourceInput(p).ok).toBe(true);
  });

  test("인터뷰·현장·기타 출처는 공공누리 유형 없이도 된다, 사진 출처는 필요 (PR-07)", () => {
    for (const kind of ["interview", "field", "other"]) expect(validateSource({ ...EMPTY_SOURCE_FORM, kind, title: "자료" })).toEqual({});
    expect(Object.keys(validateSource({ ...EMPTY_SOURCE_FORM, kind: "photo", title: "사진" }))).toEqual(["src-license-type"]);
    expect(validateSource({ ...EMPTY_SOURCE_FORM, kind: "photo", title: "사진", licenseType: "kogl_9" })["src-license-type"]).toBe("공공누리 유형을 목록에서 골라 주세요");
  });

  test("자료 종류 — 공식 자료에만, 허용 목록 값만 (차단 4종·목록 밖 → 칸 오류, REG1-07)", () => {
    for (const t of ["tourism", "restaurant", "transport", "living_guide", "festival"]) {
      expect(validateSource({ ...dataset, sourceType: t }, ALLOWED)).toEqual({ "src-source-type": "자료 종류는 허용 목록에서 골라 주세요 (REG1-07)" });
    }
    expect(validateSource({ ...EMPTY_SOURCE_FORM, kind: "press_release", title: "보도자료", licenseType: "kogl_1", sourceType: "notice" }, ALLOWED)).toEqual({
      "src-source-type": "자료 종류는 공식 문서·공공 데이터 출처에만 고릅니다 (REG1-07)",
    });
    // 비우면 검사하지 않는다 (국세·지방세 법령 출처는 6종 밖)
    expect(validateSource({ ...dataset, sourceType: "" }, ALLOWED)).toEqual({});
    // 편집국이 설정에 더한 종류는 그 목록으로 판정
    expect(validateSource({ ...dataset, sourceType: "public_property" }, [...ALLOWED, "public_property"])).toEqual({});
  });

  test("주소는 http(s)만, 제목은 필수", () => {
    const e = validateSource({ ...dataset, url: "ftp://x", title: "" }, ALLOWED);
    expect(e["src-url"]).toBeTruthy();
    expect(e["src-title"]).toBeTruthy();
  });
});

describe("원자료 고치기 = 새 버전 + 수정 사유 (REG1-09)", () => {
  const stored = {
    kind: "dataset",
    title: dataset.title,
    source_url: dataset.url,
    source_name: "가온시 세정과",
    last_verified_at: "2026-10-06T15:00:00+00:00",
    license_status: "공공누리 제1유형",
    license_type: "kogl_1",
    source_type: "local_tax_revenue",
    published_on: "2026-07-15",
    reference_date: "2026-06-30",
    region_unit: "시·구",
    collected_at: "2026-10-05T15:00:00+00:00",
  };
  const before = sourceFormOf(stored);

  test("저장된 행 → 폼: 확인일·수집일은 한국 날짜", () => {
    expect(before).toEqual({ ...dataset, snapshotText: "" });
  });

  test("바꾼 칸만 + 사유 — 실제 API 검사(parseSourceRevision)를 지나 새 판 행이 된다", () => {
    const after = { ...before, title: "가온시 지방세 세목별 징수 실적(2026년 6월 말, 정정)", referenceDate: "2026-06-29" };
    const p = sourceRevisionPayload(after, before, "  발표기관이 기준일을 정정 공지함 ");
    expect(p).toEqual({ revisionReason: "발표기관이 기준일을 정정 공지함", title: after.title, referenceDate: "2026-06-29" });
    expect(validateSourceRevision(after, before, "정정 공지", "rev-1", ALLOWED)).toEqual({});
    const parsed = parseSourceRevision(p, { id: 7, ...stored, snapshot_id: 3 }, ALLOWED);
    expect(parsed.ok && parsed.value.changed.sort()).toEqual(["reference_date", "title"]);
    expect(parsed.ok && parsed.value.row).toMatchObject({ title: after.title, reference_date: "2026-06-29", snapshot_id: 3, supersedes_id: 7, revision_reason: "발표기관이 기준일을 정정 공지함" });
  });

  test("사유가 비면 사유 칸 오류, 바뀐 칸이 없으면 사유 칸에 '바뀐 칸 없음', 칸 오류는 앞머리를 붙인다", () => {
    const after = { ...before, title: "고친 제목" };
    expect(validateSourceRevision(after, before, "  ", "rev-1", ALLOWED)).toEqual({ "rev-1-reason": expect.stringMatching(/수정 사유/) });
    expect(validateSourceRevision(before, before, "사유", "rev-1", ALLOWED)).toEqual({ "rev-1-reason": expect.stringMatching(/바뀐 칸이 없습니다/) });
    expect(validateSourceRevision({ ...before, sourceType: "tourism" }, before, "사유", "rev-1", ALLOWED)).toEqual({ "rev-1-source-type": expect.stringMatching(/REG1-07/) });
    expect(validateSourceRevision({ ...before, regionUnit: "" }, before, "사유", "rev-1", ALLOWED)).toEqual({ "rev-1-region-unit": expect.stringMatching(/REG1-09/) });
  });

  test("지운 칸은 null로 보낸다 (새 판에서 비움)", () => {
    const p = sourceRevisionPayload({ ...before, sourceType: "" }, before, "자료 종류 잘못 고름");
    expect(p).toEqual({ revisionReason: "자료 종류 잘못 고름", sourceType: null });
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
