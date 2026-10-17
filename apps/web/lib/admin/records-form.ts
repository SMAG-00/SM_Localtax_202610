// 공개 출처(article_sources)·비공개 취재 근거(article_evidence + 재현 정보·인터뷰 기록) 폼 → API 본문. 순수 함수 (시험: records-form.test.ts)
//  · 공식 문서·공공 데이터 출처는 URL·발표기관·확인일·이용 조건이 모두 있어야 한다 (FND-04 — DB도 거부한다)
//  · 인터뷰 기록은 연락처·녹취 원문을 받지 않는다 — 보존 위치만 (NAV-12)
import { SOURCE_KINDS } from "@ltr/editorial";
import { blank, isValidDate, isoToKstDate, kstDateToIso, textOrNull, type FieldErrors } from "./form-utils";

const OFFICIAL = new Set(["official_doc", "dataset"]);
const HTTP = /^https?:\/\/\S+$/i;

export interface SourceForm {
  kind: string;
  title: string;
  url: string;
  /** 발표기관 */
  sourceName: string;
  /** 확인일 (한국 날짜) */
  lastVerifiedDate: string;
  /** 이용 조건 (공공누리 유형 등) */
  licenseStatus: string;
  /** 비교 원문 — 보도자료·원자료 원본 글 (유사도 비교, OPT-06) */
  snapshotText: string;
}

export const EMPTY_SOURCE_FORM: SourceForm = { kind: "official_doc", title: "", url: "", sourceName: "", lastVerifiedDate: "", licenseStatus: "", snapshotText: "" };

export function validateSource(f: SourceForm): FieldErrors {
  const e: FieldErrors = {};
  if (!(SOURCE_KINDS as readonly string[]).includes(f.kind)) e["src-kind"] = "출처 종류를 골라 주세요";
  if (blank(f.title)) e["src-title"] = "출처 이름을 적어 주세요";
  if (!blank(f.url) && !HTTP.test(f.url.trim())) e["src-url"] = "주소는 http:// 또는 https://로 시작해야 합니다";
  if (!blank(f.lastVerifiedDate) && !isValidDate(f.lastVerifiedDate.trim())) e["src-verified"] = "확인일은 YYYY-MM-DD 날짜로 적어 주세요";
  if (OFFICIAL.has(f.kind)) {
    const why = "공식 문서·공공 데이터 출처에 필요합니다 (FND-04)";
    if (blank(f.url)) e["src-url"] = `원문 URL이 ${why}`;
    if (blank(f.sourceName)) e["src-source-name"] = `발표기관이 ${why}`;
    if (blank(f.lastVerifiedDate)) e["src-verified"] = `확인일이 ${why}`;
    if (blank(f.licenseStatus)) e["src-license"] = `이용 조건이 ${why}`;
  }
  if (!blank(f.snapshotText) && blank(f.url)) e["src-url"] ??= "원문을 붙이려면 원문 주소가 필요합니다";
  return e;
}

export function sourcePayload(f: SourceForm): Record<string, unknown> {
  const p: Record<string, unknown> = { kind: f.kind, title: f.title.trim() };
  if (!blank(f.url)) p.url = f.url.trim();
  if (!blank(f.sourceName)) p.sourceName = f.sourceName.trim();
  if (!blank(f.lastVerifiedDate)) p.lastVerifiedAt = kstDateToIso(f.lastVerifiedDate.trim());
  if (!blank(f.licenseStatus)) p.licenseStatus = f.licenseStatus.trim();
  if (!blank(f.snapshotText)) p.snapshot = { text: f.snapshotText.trim() };
  return p;
}

// ── 취재 근거 ───────────────────────────────────────────

export interface DatasetForm {
  definition: string;
  period: string;
  unit: string;
  regionUnit: string;
  denominator: string;
  exclusions: string;
  transform: string;
  reproFileHash: string;
  provider: string;
  sourceUrl: string;
  collectedDate: string;
  license: string;
}

export interface InterviewForm {
  subjectRole: string;
  contactedDate: string;
  recordLocation: string;
  quoteConsent: string;
  anonymity: string;
  anonymityReason: string;
}

export interface EvidenceForm {
  evidenceType: string;
  /** 원본 보존 위치 (파일 경로·기록함 번호) */
  location: string;
  rightsStatus: string;
  verificationStatus: string;
  verifiedDate: string;
  retentionUntil: string;
  dataset: DatasetForm;
  interview: InterviewForm;
}

export const EMPTY_EVIDENCE_FORM: EvidenceForm = {
  evidenceType: "",
  location: "",
  rightsStatus: "unconfirmed",
  verificationStatus: "pending",
  verifiedDate: "",
  retentionUntil: "",
  dataset: {
    definition: "",
    period: "",
    unit: "",
    regionUnit: "",
    denominator: "",
    exclusions: "",
    transform: "",
    reproFileHash: "",
    provider: "",
    sourceUrl: "",
    collectedDate: "",
    license: "",
  },
  interview: { subjectRole: "", contactedDate: "", recordLocation: "", quoteConsent: "", anonymity: "named", anonymityReason: "" },
};

/** 재현 정보 칸 — [폼 칸, API 칸, 날짜 여부]. 화면 이름은 NAV-10 7묶음 이름을 쓴다 */
export const DATASET_FIELDS: readonly { key: keyof DatasetForm; api: string; label: string; date?: boolean; group: string }[] = [
  { key: "sourceUrl", api: "sourceUrl", label: "원자료 파일/공식 URL", group: "원자료" },
  { key: "provider", api: "provider", label: "제공기관", group: "원자료" },
  { key: "collectedDate", api: "collectedAt", label: "수집일", date: true, group: "원자료" },
  { key: "license", api: "license", label: "이용권리", group: "원자료" },
  { key: "definition", api: "definition", label: "지표 정의", group: "지표 정의" },
  { key: "period", api: "period", label: "기간", group: "지표 정의" },
  { key: "unit", api: "unit", label: "단위", group: "지표 정의" },
  { key: "regionUnit", api: "regionUnit", label: "지역 단위", group: "지표 정의" },
  { key: "denominator", api: "denominator", label: "분모", group: "지표 정의" },
  { key: "exclusions", api: "exclusions", label: "제외값", group: "지표 정의" },
  { key: "transform", api: "transform", label: "계산 과정·수식", group: "계산 과정" },
  { key: "reproFileHash", api: "reproFileHash", label: "재현 파일 해시", group: "계산 과정" },
];

const isDatasetType = (t: string) => t === "dataset" || t === "calculation";

export function validateEvidence(f: EvidenceForm): FieldErrors {
  const e: FieldErrors = {};
  if (blank(f.evidenceType)) e["ev-type"] = "근거 유형을 골라 주세요";
  if (blank(f.location)) e["ev-location"] = "원본을 보관한 위치를 적어 주세요 (파일 경로·기록함 번호)";
  if (f.verificationStatus === "verified" && blank(f.verifiedDate)) e["ev-verified-date"] = "확인됨으로 두려면 확인일이 필요합니다";
  if (!blank(f.verifiedDate) && !isValidDate(f.verifiedDate.trim())) e["ev-verified-date"] = "확인일은 YYYY-MM-DD 날짜로 적어 주세요";
  if (!blank(f.retentionUntil) && !isValidDate(f.retentionUntil.trim())) e["ev-retention"] = "보존 기한은 YYYY-MM-DD 날짜로 적어 주세요";
  if (isDatasetType(f.evidenceType)) {
    if (!blank(f.dataset.collectedDate) && !isValidDate(f.dataset.collectedDate.trim())) e["ev-ds-collectedDate"] = "수집일은 YYYY-MM-DD 날짜로 적어 주세요";
    if (!blank(f.dataset.sourceUrl) && !HTTP.test(f.dataset.sourceUrl.trim())) e["ev-ds-sourceUrl"] = "주소는 http:// 또는 https://로 시작해야 합니다";
  }
  if (f.evidenceType === "interview") {
    const iv = f.interview;
    if (blank(iv.subjectRole)) e["ev-iv-role"] = "취재원의 역할을 적어 주세요 (이름·연락처는 적지 않습니다)";
    if (!["full", "partial", "none"].includes(iv.quoteConsent)) e["ev-iv-consent"] = "인용 동의 여부를 골라 주세요";
    if (!["named", "anonymous"].includes(iv.anonymity)) e["ev-iv-anonymity"] = "실명·익명을 골라 주세요";
    if (iv.anonymity === "anonymous" && blank(iv.anonymityReason)) e["ev-iv-anonymity-reason"] = "익명으로 쓰는 이유를 적어 주세요 (NAV-11)";
    if (!blank(iv.contactedDate) && !isValidDate(iv.contactedDate.trim())) e["ev-iv-contacted"] = "접촉일은 YYYY-MM-DD 날짜로 적어 주세요";
  }
  return e;
}

/** create — 빈 칸은 뺀다. patch — 빈 칸은 null(지운다) */
export function evidencePayload(f: EvidenceForm, mode: "create" | "patch"): Record<string, unknown> {
  const put = (o: Record<string, unknown>, key: string, value: unknown) => {
    if (value === null || value === undefined || value === "") {
      if (mode === "patch") o[key] = null;
    } else o[key] = value;
  };
  const p: Record<string, unknown> = { evidenceType: f.evidenceType, location: f.location.trim(), rightsStatus: f.rightsStatus, verificationStatus: f.verificationStatus };
  put(p, "verifiedAt", blank(f.verifiedDate) ? null : kstDateToIso(f.verifiedDate.trim()));
  put(p, "retentionUntil", textOrNull(f.retentionUntil));
  if (isDatasetType(f.evidenceType)) {
    const d: Record<string, unknown> = {};
    for (const field of DATASET_FIELDS) {
      const raw = f.dataset[field.key];
      put(d, field.api, blank(raw) ? null : field.date ? kstDateToIso(raw.trim()) : raw.trim());
    }
    p.dataset = d;
  }
  if (f.evidenceType === "interview") {
    const iv = f.interview;
    const o: Record<string, unknown> = {};
    put(o, "subjectRole", textOrNull(iv.subjectRole));
    put(o, "contactedAt", blank(iv.contactedDate) ? null : kstDateToIso(iv.contactedDate.trim()));
    put(o, "recordLocation", textOrNull(iv.recordLocation));
    put(o, "quoteConsent", iv.quoteConsent || null);
    put(o, "anonymity", iv.anonymity || null);
    put(o, "anonymityReason", textOrNull(iv.anonymityReason));
    p.interview = o;
  }
  return p;
}

/** 저장된 근거 행(GET 기사 응답의 evidence 한 줄) */
export interface EvidenceRowView {
  id: number;
  evidence_type: string;
  location: string;
  rights_status: string;
  verification_status: string;
  verified_at: string | null;
  retention_until: string | null;
  dataset: Record<string, string | null> | null;
  interview: Record<string, string | null> | null;
}

const str = (v: string | null | undefined) => v ?? "";

export function evidenceFormFrom(row: EvidenceRowView): EvidenceForm {
  const d = row.dataset;
  const iv = row.interview;
  return {
    evidenceType: row.evidence_type,
    location: row.location,
    rightsStatus: row.rights_status,
    verificationStatus: row.verification_status,
    verifiedDate: isoToKstDate(row.verified_at),
    retentionUntil: str(row.retention_until).slice(0, 10),
    dataset: d
      ? {
          definition: str(d.definition),
          period: str(d.period),
          unit: str(d.unit),
          regionUnit: str(d.region_unit),
          denominator: str(d.denominator),
          exclusions: str(d.exclusions),
          transform: str(d.transform),
          reproFileHash: str(d.repro_file_hash),
          provider: str(d.provider),
          sourceUrl: str(d.source_url),
          collectedDate: isoToKstDate(d.collected_at),
          license: str(d.license),
        }
      : { ...EMPTY_EVIDENCE_FORM.dataset },
    interview: iv
      ? {
          subjectRole: str(iv.subject_role),
          contactedDate: isoToKstDate(iv.contacted_at),
          recordLocation: str(iv.record_location),
          quoteConsent: str(iv.quote_consent),
          anonymity: str(iv.anonymity) || "named",
          anonymityReason: str(iv.anonymity_reason),
        }
      : { ...EMPTY_EVIDENCE_FORM.interview },
  };
}
