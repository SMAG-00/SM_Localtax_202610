import { ORDINANCE_KINDS, type OrdinanceKind } from "@ltr/workflows/ordinance";

// 조례 연결 관리 입력 검사 (W11-e e6 - PRD-03 RDV-06 · TX-13). 순수 함수 - 모양만 본다. 요약 숫자·공개 증거 검사는 DB가 한 번 더 한다.
export const ORDINANCE_OPS = ["register", "summary", "sign", "verify", "status"] as const;
export type OrdinanceOp = (typeof ORDINANCE_OPS)[number];

export const KIND_LABEL: Record<OrdinanceKind, string> = { urban_redevelopment: "시·도 도시정비 조례", tax_reduction: "시·군·구 지방세 감면 조례", tax_rate: "시·군·구 지방세 세율 조례" };
export const STATUS_LABEL = { draft: "초안", public: "공개", hidden: "숨김" } as const;
export type OrdinanceStatus = keyof typeof STATUS_LABEL;

type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const id = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : typeof v === "string" && /^[0-9]+$/.test(v) ? Number(v) : null);

export interface RegisterInput {
  name: string;
  regionCode: string;
  kind: OrdinanceKind;
  sourceUrl: string;
  effectiveFrom: string;
  verifiedAt: string;
  promulgationNo: string;
  promulgatedOn: string;
  articleNo: number;
  articleTitle: string | null;
  bodyText: string;
  summary: string | null;
}

export function parseRegister(body: Record<string, unknown>): Parsed<RegisterInput> {
  const errors: string[] = [];
  const kind = s(body.kind);
  if (!(ORDINANCE_KINDS as readonly string[]).includes(kind)) errors.push(`kind: ${ORDINANCE_KINDS.join("·")} 중 하나입니다`);
  const regionCode = s(body.region_code);
  if (!/^[0-9]{10}$/.test(regionCode)) errors.push("region_code: 10자리 행정구역 코드입니다");
  for (const [k, label] of [["name", "조례 이름"], ["source_url", "출처 주소"], ["promulgation_no", "공포번호"], ["body_text", "원문 글자"]] as const) if (!s(body[k])) errors.push(`${k}: ${label}가 필요합니다`);
  for (const k of ["effective_from", "promulgated_on"] as const) if (!DATE.test(s(body[k]))) errors.push(`${k}: YYYY-MM-DD 날짜입니다`);
  if (!DATE.test(s(body.verified_at).slice(0, 10))) errors.push("verified_at: 확인일 YYYY-MM-DD입니다");
  const articleNo = body.article_no === undefined || body.article_no === "" ? 1 : id(body.article_no);
  if (articleNo === null) errors.push("article_no: 1 이상의 정수입니다");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name: s(body.name),
      regionCode,
      kind: kind as OrdinanceKind,
      sourceUrl: s(body.source_url),
      effectiveFrom: s(body.effective_from),
      verifiedAt: s(body.verified_at),
      promulgationNo: s(body.promulgation_no),
      promulgatedOn: s(body.promulgated_on),
      articleNo: articleNo as number,
      articleTitle: s(body.article_title) || null,
      bodyText: s(body.body_text),
      summary: s(body.summary) || null,
    },
  };
}

export function parseLinkId(body: Record<string, unknown>): Parsed<{ id: number }> {
  const n = id(body.id);
  return n === null ? { ok: false, errors: ["id: 연결 번호가 필요합니다"] } : { ok: true, value: { id: n } };
}

export function parseSummary(body: Record<string, unknown>): Parsed<{ id: number; summary: string | null }> {
  const n = id(body.id);
  if (n === null) return { ok: false, errors: ["id: 연결 번호가 필요합니다"] };
  return { ok: true, value: { id: n, summary: s(body.summary) || null } };
}

export function parseStatus(body: Record<string, unknown>): Parsed<{ id: number; status: OrdinanceStatus }> {
  const n = id(body.id);
  const st = s(body.status);
  const errors: string[] = [];
  if (n === null) errors.push("id: 연결 번호가 필요합니다");
  if (!(st in STATUS_LABEL)) errors.push("status: draft·public·hidden 중 하나입니다");
  return errors.length ? { ok: false, errors } : { ok: true, value: { id: n as number, status: st as OrdinanceStatus } };
}
