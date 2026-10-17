// 기사 작성·수정 요청 본문 검사 — 순수 함수 (시험: input.test.ts). 칸 이름은 camelCase, DB 칸은 snake_case.
// 모르는 칸은 거부한다(오타가 조용히 무시되지 않게). 값 목록은 W2-a 설계 §2 = DB check 제약과 같다.
import { CONTENT_TYPES, FORMATS, LABELS, REPORTING_METHODS, SECTIONS, SUBTYPES, UPDATE_KINDS, type SolvedCase } from "@ltr/editorial";
import { parseBodyInput, parseSolvedCaseInput, parseTaxLensInput, type Result, type StoredBody, type TaxLensInput } from "./content";

export const EDITORIAL_FIELDS = ["local_tax", "realestate", "local_finance", "urban_policy"] as const;

/** 정규화한 입력 — undefined = 보내지 않은 칸(수정 때 그대로 둔다) */
export interface ArticleInput {
  slug?: string;
  title?: string;
  summary?: string | null;
  body?: StoredBody;
  format?: string;
  section?: string;
  contentType?: string;
  reportingMethod?: string | null;
  categoryId?: number | null;
  subtype?: string;
  solvedCase?: SolvedCase | null;
  label?: string;
  partnerId?: number | null;
  storyAssignmentId?: number | null;
  leadMediaId?: number | null;
  legalBasisDate?: string | null;
  taxLens?: TaxLensInput | null;
  digestId?: number | null;
  amendmentId?: number | null;
  regionCodes?: string[];
  editorialField?: string | null;
  publicQuestion?: string | null;
  /** 칼럼 연재 이름·회차 (ART-04) — 칼럼(opinion)만, 둘 다 있거나 둘 다 null */
  seriesTitle?: string | null;
  seriesEpisode?: number | null;
  /** check_log.checklists에 덮어쓸 원본 (content.parseChecklistsInput이 검사한다) */
  checklists?: unknown;
  /** 발행 뒤 수정 (ART-05) */
  updateKind?: string | null;
  reason?: string | null;
  /** 낙관적 잠금 — 편집 화면이 읽은 버전 */
  expectedVersion?: number;
}

const COMMON_KEYS = [
  "slug",
  "title",
  "summary",
  "body",
  "format",
  "section",
  "contentType",
  "reportingMethod",
  "categoryId",
  "subtype",
  "solvedCase",
  "label",
  "partnerId",
  "storyAssignmentId",
  "leadMediaId",
  "legalBasisDate",
  "taxLens",
  "digestId",
  "amendmentId",
  "regionCodes",
  "editorialField",
  "publicQuestion",
  "seriesTitle",
  "seriesEpisode",
  "checklists",
] as const;
const PATCH_ONLY = ["updateKind", "reason", "expectedVersion"] as const;
const SLUG = /^[^\s/]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function parseArticleInput(raw: Record<string, unknown>, mode: "create" | "patch"): Result<ArticleInput> {
  const errors: string[] = [];
  const allowed = new Set<string>([...COMMON_KEYS, ...(mode === "patch" ? PATCH_ONLY : [])]);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) errors.push(`${key}: 모르는 칸입니다`);
  const out: ArticleInput = {};
  const has = (k: string) => raw[k] !== undefined;

  const text = (k: keyof ArticleInput & string, { nullable = false, max = 2000, required = false } = {}) => {
    if (!has(k)) {
      if (required) errors.push(`${k}: 필요합니다`);
      return;
    }
    const v = raw[k];
    if (v === null && nullable) return void ((out as Record<string, unknown>)[k] = null);
    if (typeof v !== "string") return void errors.push(`${k}: 글자여야 합니다`);
    if (v.length > max) return void errors.push(`${k}: ${max}자 이하여야 합니다`);
    (out as Record<string, unknown>)[k] = nullable && v.trim() === "" ? null : v;
  };
  const oneOf = (k: keyof ArticleInput & string, values: readonly string[], { nullable = false, required = false } = {}) => {
    if (!has(k)) {
      if (required) errors.push(`${k}: 필요합니다 (${values.join("·")})`);
      return;
    }
    const v = raw[k];
    if (v === null && nullable) return void ((out as Record<string, unknown>)[k] = null);
    if (typeof v !== "string" || !values.includes(v)) return void errors.push(`${k}: ${values.join("·")} 중 하나여야 합니다`);
    (out as Record<string, unknown>)[k] = v;
  };
  const id = (k: keyof ArticleInput & string) => {
    if (!has(k)) return;
    const v = raw[k];
    if (v === null) return void ((out as Record<string, unknown>)[k] = null);
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) return void errors.push(`${k}: 1 이상의 번호여야 합니다`);
    (out as Record<string, unknown>)[k] = v;
  };

  text("slug", { required: mode === "create", max: 200 });
  if (out.slug !== undefined && !SLUG.test(out.slug)) errors.push("slug: 공백·'/' 없이 써야 합니다");
  text("title", { required: mode === "create", max: 300 });
  if (out.title !== undefined && out.title.trim() === "") errors.push("title: 비울 수 없습니다");
  text("summary", { nullable: true, max: 1000 });
  oneOf("format", FORMATS);
  oneOf("section", SECTIONS, { required: mode === "create" });
  oneOf("contentType", CONTENT_TYPES, { required: mode === "create" });
  oneOf("reportingMethod", REPORTING_METHODS, { nullable: true });
  oneOf("subtype", SUBTYPES);
  oneOf("label", LABELS);
  oneOf("editorialField", EDITORIAL_FIELDS, { nullable: true });
  text("publicQuestion", { nullable: true, max: 1000 });
  for (const k of ["categoryId", "partnerId", "storyAssignmentId", "leadMediaId", "digestId", "amendmentId"] as const) id(k);
  // 칼럼 연재 (ART-04) — 이름·회차는 함께 보낸다. 칼럼이 아닌 기사·한쪽만 있는 값은 DB도 거부한다(articles_series_*)
  text("seriesTitle", { nullable: true, max: 100 });
  if (has("seriesEpisode")) {
    const v = raw.seriesEpisode;
    if (v === null) out.seriesEpisode = null;
    else if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1 || v > 9999) errors.push("seriesEpisode: 1 이상의 회차 번호여야 합니다");
    else out.seriesEpisode = v;
  }
  if (has("seriesTitle") !== has("seriesEpisode")) errors.push("seriesTitle: 연재 이름과 회차는 함께 보냅니다");
  else if (out.seriesTitle !== undefined && (out.seriesTitle === null) !== (out.seriesEpisode === null)) errors.push("seriesTitle: 연재 이름과 회차는 둘 다 적거나 둘 다 비웁니다");

  if (has("legalBasisDate")) {
    const v = raw.legalBasisDate;
    if (v === null) out.legalBasisDate = null;
    else if (typeof v !== "string" || !validDate(v)) errors.push("legalBasisDate: YYYY-MM-DD 날짜여야 합니다");
    else out.legalBasisDate = v;
  }
  if (has("regionCodes")) {
    const v = raw.regionCodes;
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && x.trim() !== "" && x.length <= 20)) errors.push("regionCodes: 지역 코드 목록이어야 합니다");
    else out.regionCodes = v as string[];
  }
  if (has("body")) {
    const r = parseBodyInput(raw.body);
    if (r.ok) out.body = r.value;
    else errors.push(...r.errors);
  }
  if (has("taxLens")) {
    const r = parseTaxLensInput(raw.taxLens);
    if (r.ok) out.taxLens = r.value;
    else errors.push(...r.errors);
  }
  if (has("solvedCase")) {
    const r = parseSolvedCaseInput(raw.solvedCase);
    if (r.ok) out.solvedCase = r.value;
    else errors.push(...r.errors);
  }
  if (has("checklists")) out.checklists = raw.checklists;

  if (mode === "patch") {
    oneOf("updateKind", UPDATE_KINDS, { nullable: true });
    text("reason", { nullable: true, max: 2000 });
    if (has("expectedVersion")) {
      const v = raw.expectedVersion;
      if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) errors.push("expectedVersion: 1 이상의 정수여야 합니다");
      else out.expectedVersion = v;
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}
