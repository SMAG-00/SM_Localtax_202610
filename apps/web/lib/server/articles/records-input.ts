// 출처(article_sources)·취재 근거(article_evidence + article_datasets·article_interviews) 입력 검사 — 순수 함수
// 칸 이름은 camelCase → DB snake_case. 모르는 칸은 거부한다.
import { ANONYMITIES, EVIDENCE_TYPES, LICENSE_REQUIRED_KINDS, LICENSE_TYPES, OFFICIAL_SOURCE_TYPES, QUOTE_CONSENTS, SOURCE_KINDS, sourceTypeProblem, type SourceKind } from "@ltr/editorial";
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
  ["licenseType", "license_type", LICENSE_TYPES],
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

/**
 * 출처 칸 규칙 (W4 5단계 — DB 트리거·발행 판정과 같다): 공식 자료·보도자료·사진은 공공누리 유형 필수(PR-07),
 * 자료 종류는 공식 자료 행에만·허용 목록 값만·차단 4종 거부(REG1-07). 오류는 칸 이름(source.<API 칸>)으로
 */
export function sourceRuleErrors(columns: Obj, allowedTypes: readonly string[]): string[] {
  const errors: string[] = [];
  const kind = columns.kind as SourceKind | undefined;
  if (kind && (LICENSE_REQUIRED_KINDS as readonly string[]).includes(kind) && (columns.license_type === undefined || columns.license_type === null)) {
    errors.push("source.licenseType: 공식 자료·보도자료·사진은 공공누리 유형이 필요합니다 — 자체 자료는 '해당 없음'(not_applicable) (PR-07)");
  }
  if (kind && typeof columns.source_type === "string") {
    const problem = sourceTypeProblem(kind, columns.source_type, allowedTypes);
    if (problem) errors.push(`source.sourceType: ${problem}`);
  }
  return errors;
}

export function parseSourceInput(raw: Obj, allowedTypes: readonly string[] = OFFICIAL_SOURCE_TYPES): Result<SourceInput> {
  const errors: string[] = [];
  const { snapshot: snapRaw, ...rest } = raw;
  const columns = parseFields(rest, SOURCE_SPEC, "source", errors, ["kind"]);
  if (typeof columns.source_type === "string" && columns.source_type.trim() === "") columns.source_type = null;
  if (typeof columns.region_unit === "string" && columns.region_unit.trim() === "") columns.region_unit = null;
  errors.push(...sourceRuleErrors(columns, allowedTypes));
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

/** 원자료 새 버전으로 고칠 수 있는 칸 — 종류·대체·스냅샷은 그대로 잇는다 (REG1-09 '스냅샷 그대로') */
const REVISION_SPEC: Spec = SOURCE_SPEC.filter(([k]) => k !== "kind" && k !== "supersedesId" && k !== "revisionReason");

/** 새 버전 행에 옮겨 적는 칸 (DB 이름) */
export const SOURCE_COPY_COLUMNS = [
  "kind",
  "title",
  "source_url",
  "source_name",
  "provider",
  "last_verified_at",
  "license_status",
  "license_type",
  "source_type",
  "published_on",
  "reference_date",
  "region_code",
  "region_unit",
  "collected_at",
  "snapshot_id",
] as const;

export interface SourceRevisionInput {
  /** 새 버전 행 — 지금 행 칸 + 고친 칸 + supersedes_id + 수정 사유 (article_id·version은 부르는 쪽이 채운다) */
  row: Obj;
  /** 바뀐 칸 (DB 이름) — 감사 로그 */
  changed: string[];
}

/** 원자료 고치기 = 새 버전 행 (REG1-09) — 수정 사유 필수, 바뀐 칸 1개 이상, 같은 칸 규칙(공공누리·자료 종류) */
export function parseSourceRevision(raw: Obj, current: Obj, allowedTypes: readonly string[] = OFFICIAL_SOURCE_TYPES): Result<SourceRevisionInput> {
  const errors: string[] = [];
  const { revisionReason, ...rest } = raw;
  const changes = parseFields(rest, REVISION_SPEC, "source", errors);
  if (typeof changes.source_type === "string" && changes.source_type.trim() === "") changes.source_type = null;
  if (typeof revisionReason !== "string" || revisionReason.trim() === "") errors.push("source.revisionReason: 수정 사유가 필요합니다 — 원자료를 고치면 새 버전과 사유가 남습니다 (REG1-09)");
  else if (revisionReason.length > 500) errors.push("source.revisionReason: 500자 이하로 적습니다");
  const row: Obj = {};
  for (const c of SOURCE_COPY_COLUMNS) row[c] = current[c] ?? null;
  const changed = Object.keys(changes).filter((c) => JSON.stringify(changes[c] ?? null) !== JSON.stringify(current[c] ?? null));
  if (errors.length === 0 && changed.length === 0) errors.push("source: 바뀐 칸이 없습니다 — 고칠 칸을 적으세요");
  Object.assign(row, changes, { supersedes_id: current.id, revision_reason: typeof revisionReason === "string" ? revisionReason.trim() : null });
  errors.push(...sourceRuleErrors(row, allowedTypes));
  return errors.length ? { ok: false, errors } : { ok: true, value: { row, changed } };
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
