// 출처(article_sources)·취재 근거(article_evidence + article_datasets·article_interviews) 입력 검사 — 순수 함수
// 칸 이름은 camelCase → DB snake_case. 모르는 칸은 거부한다.
import { ANONYMITIES, EVIDENCE_TYPES, QUOTE_CONSENTS, SOURCE_KINDS } from "@ltr/editorial";
import type { Result } from "./content";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const EVIDENCE_RIGHTS = ["unconfirmed", "confirmed", "restricted"] as const;
const VERIFICATION = ["pending", "verified", "rejected"] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

/** 칸 정의 — [API 이름, DB 이름, 종류] */
export type FieldKind = "text" | "date" | "instant" | "id" | "texts" | readonly string[];
export type FieldSpec = readonly (readonly [string, string, FieldKind])[];
type Spec = FieldSpec;

/** 칸 정의대로 검사해 DB 칸 이름으로 옮긴다 — 오류는 errors에 쌓는다 */
export function parseFields(raw: Obj, spec: Spec, path: string, errors: string[], required: readonly string[] = []): Obj {
  const out: Obj = {};
  const known = new Set(spec.map(([k]) => k));
  for (const key of Object.keys(raw)) if (!known.has(key)) errors.push(`${path}.${key}: 모르는 칸입니다`);
  for (const [key, column, kind] of spec) {
    const v = raw[key];
    if (v === undefined) {
      if (required.includes(key)) errors.push(`${path}.${key}: 필요합니다`);
      continue;
    }
    if (v === null) {
      if (required.includes(key)) errors.push(`${path}.${key}: 비울 수 없습니다`);
      else out[column] = null;
      continue;
    }
    if (Array.isArray(kind)) {
      if (typeof v !== "string" || !kind.includes(v)) errors.push(`${path}.${key}: ${kind.join("·")} 중 하나여야 합니다`);
      else out[column] = v;
      continue;
    }
    switch (kind) {
      case "text":
        if (typeof v !== "string" || v.length > 5000) errors.push(`${path}.${key}: 5000자 이하 글자여야 합니다`);
        else out[column] = v;
        break;
      case "date":
        if (typeof v !== "string" || !DATE.test(v) || Number.isNaN(Date.parse(v))) errors.push(`${path}.${key}: YYYY-MM-DD 날짜여야 합니다`);
        else out[column] = v;
        break;
      case "instant":
        if (typeof v !== "string" || !INSTANT.test(v) || Number.isNaN(Date.parse(v))) errors.push(`${path}.${key}: ISO 8601 날짜·시각이어야 합니다`);
        else out[column] = v;
        break;
      case "id":
        if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) errors.push(`${path}.${key}: 번호여야 합니다`);
        else out[column] = v;
        break;
      case "texts":
        if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && x.length <= 200)) errors.push(`${path}.${key}: 글자 목록이어야 합니다`);
        else out[column] = v;
        break;
    }
  }
  return out;
}

const SOURCE_SPEC: Spec = [
  ["kind", "kind", SOURCE_KINDS],
  ["title", "title", "text"],
  ["url", "source_url", "text"],
  ["sourceName", "source_name", "text"],
  ["provider", "provider", "text"],
  ["lastVerifiedAt", "last_verified_at", "instant"],
  ["licenseStatus", "license_status", "text"],
  ["sourceType", "source_type", "text"],
  ["publishedOn", "published_on", "date"],
  ["referenceDate", "reference_date", "date"],
  ["regionCode", "region_code", "text"],
  ["regionUnit", "region_unit", "text"],
  ["collectedAt", "collected_at", "instant"],
  ["supersedesId", "supersedes_id", "id"],
  ["revisionReason", "revision_reason", "text"],
];

export interface SourceInput {
  columns: Obj;
  /** 비교 원문 — 보도자료·원자료 원본 글 (raw_snapshots에 저장, OPT-06 유사도 비교 원문) */
  snapshot: { text: string; url: string | null; source: string | null } | null;
}

export function parseSourceInput(raw: Obj): Result<SourceInput> {
  const errors: string[] = [];
  const { snapshot: snapRaw, ...rest } = raw;
  const columns = parseFields(rest, SOURCE_SPEC, "source", errors, ["kind"]);
  let snapshot: SourceInput["snapshot"] = null;
  if (snapRaw !== undefined && snapRaw !== null) {
    if (!isObj(snapRaw)) errors.push("source.snapshot: 객체여야 합니다");
    else {
      const s = parseFields(snapRaw, [["text", "text", "text"], ["url", "url", "text"], ["source", "source", "text"]], "source.snapshot", errors, ["text"]);
      if (typeof s.text === "string" && s.text.trim() === "") errors.push("source.snapshot.text: 비울 수 없습니다");
      snapshot = { text: String(s.text ?? ""), url: (s.url as string | undefined) ?? null, source: (s.source as string | undefined) ?? null };
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { columns, snapshot } };
}

const EVIDENCE_SPEC: Spec = [
  ["evidenceType", "evidence_type", EVIDENCE_TYPES],
  ["location", "location", "text"],
  ["rightsStatus", "rights_status", EVIDENCE_RIGHTS],
  ["verifiedAt", "verified_at", "instant"],
  ["retentionUntil", "retention_until", "date"],
  ["verificationStatus", "verification_status", VERIFICATION],
];

const DATASET_SPEC: Spec = [
  ["definition", "definition", "text"],
  ["period", "period", "text"],
  ["unit", "unit", "text"],
  ["regionUnit", "region_unit", "text"],
  ["denominator", "denominator", "text"],
  ["exclusions", "exclusions", "text"],
  ["transform", "transform", "text"],
  ["reproFileHash", "repro_file_hash", "text"],
  ["provider", "provider", "text"],
  ["sourceUrl", "source_url", "text"],
  ["collectedAt", "collected_at", "instant"],
  ["license", "license", "text"],
];

const INTERVIEW_SPEC: Spec = [
  ["subjectRole", "subject_role", "text"],
  ["contactedAt", "contacted_at", "instant"],
  ["recordLocation", "record_location", "text"],
  ["quoteConsent", "quote_consent", QUOTE_CONSENTS],
  ["anonymity", "anonymity", ANONYMITIES],
  ["anonymityReason", "anonymity_reason", "text"],
];

export interface EvidenceInput {
  evidence: Obj;
  dataset: Obj | null;
  interview: Obj | null;
}

/** 근거 입력. create = 근거 유형·보존 위치 필수, 인터뷰는 대상 역할·인용 동의·익명 여부 필수 */
export function parseEvidenceInput(raw: Obj, mode: "create" | "patch", currentType?: string): Result<EvidenceInput> {
  const errors: string[] = [];
  const { dataset: dsRaw, interview: ivRaw, ...rest } = raw;
  const evidence = parseFields(rest, EVIDENCE_SPEC, "evidence", errors, mode === "create" ? ["evidenceType", "location"] : []);
  if (typeof evidence.location === "string" && evidence.location.trim() === "") errors.push("evidence.location: 비울 수 없습니다");
  const type = (evidence.evidence_type as string | undefined) ?? currentType;
  let dataset: Obj | null = null;
  let interview: Obj | null = null;
  if (dsRaw !== undefined && dsRaw !== null) {
    if (!isObj(dsRaw)) errors.push("evidence.dataset: 객체여야 합니다");
    else if (type !== "dataset" && type !== "calculation") errors.push("evidence.dataset: 근거 유형이 dataset·calculation일 때만 씁니다");
    else dataset = parseFields(dsRaw, DATASET_SPEC, "evidence.dataset", errors);
  }
  if (ivRaw !== undefined && ivRaw !== null) {
    if (!isObj(ivRaw)) errors.push("evidence.interview: 객체여야 합니다");
    else if (type !== "interview") errors.push("evidence.interview: 근거 유형이 interview일 때만 씁니다");
    else interview = parseFields(ivRaw, INTERVIEW_SPEC, "evidence.interview", errors, mode === "create" ? ["subjectRole", "quoteConsent", "anonymity"] : []);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { evidence, dataset, interview } };
}
