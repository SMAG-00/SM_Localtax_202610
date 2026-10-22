// 공개 출처(article_sources)·비공개 취재 근거(article_evidence + 재현 정보·인터뷰 기록) 폼 → API 본문. 순수 함수 (시험: records-form.test.ts)
//  · 공식 문서·공공 데이터 출처는 URL·발표기관·확인일·이용 조건이 모두 있어야 한다 (FND-04 — DB도 거부한다)
//  · W4 5단계 — 공식 자료·보도자료·사진은 공공누리 유형 필수(PR-07). 공식 자료는 발표일·기준일·지역 단위·수집일도 적는다(REG1-09 — 비면 발행 거부),
//    자료 종류는 허용 목록(settings.official_source_types)에서 고른다(REG1-07). 원자료 고치기는 새 버전 + 수정 사유(sourceRevisionPayload)
//  · 인터뷰 기록은 연락처·녹취 원문을 받지 않는다 — 보존 위치만 (NAV-12)
import { LICENSE_REQUIRED_KINDS, LICENSE_TYPES, SOURCE_KINDS } from "@ltr/editorial";
import { blank, isValidDate, isoToKstDate, kstDateToIso, textOrNull, type FieldErrors } from "./form-utils";

const OFFICIAL = new Set(["official_doc", "dataset"]);
const LICENSED = new Set<string>(LICENSE_REQUIRED_KINDS);
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
  /** 공공누리 유형 (PR-07) — LICENSE_TYPES 값 */
  licenseType: string;
  /** 공식 자료 종류 (REG1-07) — 허용 목록 값, 비우면 없음(법령 출처 등) */
  sourceType: string;
  /** 발표일 · 기준일 · 수집일 (한국 날짜), 지역 단위 (REG1-09) */
  publishedOn: string;
  referenceDate: string;
  regionUnit: string;
  collectedDate: string;
  /** 비교 원문 — 보도자료·원자료 원본 글 (유사도 비교, OPT-06) */
  snapshotText: string;
}

export const EMPTY_SOURCE_FORM: SourceForm = {
  kind: "official_doc",
  title: "",
  url: "",
  sourceName: "",
  lastVerifiedDate: "",
  licenseStatus: "",
  licenseType: "",
  sourceType: "",
  publishedOn: "",
  referenceDate: "",
  regionUnit: "",
  collectedDate: "",
  snapshotText: "",
};

/** 날짜 칸 — [폼 칸, 화면 칸 id, 이름] */
const DATE_FIELDS = [
  ["lastVerifiedDate", "src-verified", "확인일"],
  ["publishedOn", "src-published", "발표일"],
  ["referenceDate", "src-reference", "기준일"],
  ["collectedDate", "src-collected", "수집일"],
] as const;

export function validateSource(f: SourceForm, allowedTypes: readonly string[] = []): FieldErrors {
  const e: FieldErrors = {};
  if (!(SOURCE_KINDS as readonly string[]).includes(f.kind)) e["src-kind"] = "출처 종류를 골라 주세요";
  if (blank(f.title)) e["src-title"] = "출처 이름을 적어 주세요";
  if (!blank(f.url) && !HTTP.test(f.url.trim())) e["src-url"] = "주소는 http:// 또는 https://로 시작해야 합니다";
  for (const [key, id, name] of DATE_FIELDS) if (!blank(f[key]) && !isValidDate(f[key].trim())) e[id] = `${name}은 YYYY-MM-DD 날짜로 적어 주세요`;
  if (!blank(f.licenseType) && !(LICENSE_TYPES as readonly string[]).includes(f.licenseType)) e["src-license-type"] = "공공누리 유형을 목록에서 골라 주세요";
  if (LICENSED.has(f.kind) && blank(f.licenseType)) e["src-license-type"] = "공공누리 유형을 골라 주세요 — 공식 자료·보도자료·사진에 필요합니다 (PR-07)";
  if (!blank(f.sourceType)) {
    if (!OFFICIAL.has(f.kind)) e["src-source-type"] = "자료 종류는 공식 문서·공공 데이터 출처에만 고릅니다 (REG1-07)";
    else if (!allowedTypes.includes(f.sourceType)) e["src-source-type"] = "자료 종류는 허용 목록에서 골라 주세요 (REG1-07)";
  }
  if (OFFICIAL.has(f.kind)) {
    const why = "공식 문서·공공 데이터 출처에 필요합니다 (FND-04)";
    if (blank(f.url)) e["src-url"] = `원문 URL이 ${why}`;
    if (blank(f.sourceName)) e["src-source-name"] = `발표기관이 ${why}`;
    if (blank(f.lastVerifiedDate)) e["src-verified"] = `확인일이 ${why}`;
    if (blank(f.licenseStatus)) e["src-license"] = `이용 조건이 ${why}`;
    const pub = "공식 자료에 필요합니다 — 비면 이 자료를 쓴 기사를 발행할 수 없습니다 (REG1-09)";
    if (blank(f.publishedOn)) e["src-published"] ??= `발표일이 ${pub}`;
    if (blank(f.referenceDate)) e["src-reference"] ??= `기준일이 ${pub}`;
    if (blank(f.regionUnit)) e["src-region-unit"] = `지역 단위가 ${pub}`;
    if (blank(f.collectedDate)) e["src-collected"] ??= `수집일이 ${pub}`;
  }
  if (!blank(f.snapshotText) && blank(f.url)) e["src-url"] ??= "원문을 붙이려면 원문 주소가 필요합니다";
  return e;
}

/** 폼 칸 → API 칸 (빈 칸은 보내지 않는다) */
function sourceFields(f: Omit<SourceForm, "kind" | "snapshotText">): Record<string, unknown> {
  const p: Record<string, unknown> = { title: f.title.trim() };
  if (!blank(f.url)) p.url = f.url.trim();
  if (!blank(f.sourceName)) p.sourceName = f.sourceName.trim();
  if (!blank(f.lastVerifiedDate)) p.lastVerifiedAt = kstDateToIso(f.lastVerifiedDate.trim());
  if (!blank(f.licenseStatus)) p.licenseStatus = f.licenseStatus.trim();
  if (!blank(f.licenseType)) p.licenseType = f.licenseType;
  if (!blank(f.sourceType)) p.sourceType = f.sourceType;
  if (!blank(f.publishedOn)) p.publishedOn = f.publishedOn.trim();
  if (!blank(f.referenceDate)) p.referenceDate = f.referenceDate.trim();
  if (!blank(f.regionUnit)) p.regionUnit = f.regionUnit.trim();
  if (!blank(f.collectedDate)) p.collectedAt = kstDateToIso(f.collectedDate.trim());
  return p;
}

export function sourcePayload(f: SourceForm): Record<string, unknown> {
  const p: Record<string, unknown> = { kind: f.kind, ...sourceFields(f) };
  if (!blank(f.snapshotText)) p.snapshot = { text: f.snapshotText.trim() };
  return p;
}

/** 저장된 출처 행 → 고치기 폼 (새 버전의 시작 값) */
export interface StoredSource {
  kind: string;
  title: string | null;
  source_url: string | null;
  source_name: string | null;
  last_verified_at: string | null;
  license_status: string | null;
  license_type?: string | null;
  source_type?: string | null;
  published_on?: string | null;
  reference_date?: string | null;
  region_unit?: string | null;
  collected_at?: string | null;
}

export function sourceFormOf(s: StoredSource): SourceForm {
  return {
    kind: s.kind,
    title: s.title ?? "",
    url: s.source_url ?? "",
    sourceName: s.source_name ?? "",
    lastVerifiedDate: isoToKstDate(s.last_verified_at),
    licenseStatus: s.license_status ?? "",
    licenseType: s.license_type ?? "",
    sourceType: s.source_type ?? "",
    publishedOn: s.published_on ?? "",
    referenceDate: s.reference_date ?? "",
    regionUnit: s.region_unit ?? "",
    collectedDate: isoToKstDate(s.collected_at),
    snapshotText: "",
  };
}

/** 원자료 고치기(새 버전) 폼 검사 — 출처 폼 검사 + 수정 사유 필수 + 바뀐 칸 1개 이상. 오류 칸 id는 앞머리(prefix)를 붙인다 */
export function validateSourceRevision(f: SourceForm, before: SourceForm, reason: string, prefix: string, allowedTypes: readonly string[] = []): FieldErrors {
  const e: FieldErrors = {};
  for (const [id, msg] of Object.entries(validateSource(f, allowedTypes))) e[id.replace(/^src-/, `${prefix}-`)] = msg;
  if (blank(reason)) e[`${prefix}-reason`] = "수정 사유를 적어 주세요 — 원자료를 고치면 새 버전과 사유가 남습니다 (REG1-09)";
  else if (Object.keys(sourceRevisionPayload(f, before, reason)).length === 1) e[`${prefix}-reason`] = "바뀐 칸이 없습니다 — 고칠 칸을 바꾼 뒤 저장하세요";
  return e;
}

/** 고치기 API 본문 — 바뀐 칸만 + 수정 사유 (PATCH /api/admin/articles/{id}/sources/{번호}) */
export function sourceRevisionPayload(f: SourceForm, before: SourceForm, reason: string): Record<string, unknown> {
  const now = sourceFields(f);
  const old = sourceFields(before);
  const p: Record<string, unknown> = { revisionReason: reason.trim() };
  for (const [k, v] of Object.entries(now)) if (JSON.stringify(v) !== JSON.stringify(old[k])) p[k] = v;
  for (const k of Object.keys(old)) if (!(k in now)) p[k] = null;
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
