// 정보보호 인증 추진 계획(SEC-02, W13-j) 순수 규칙. 이 모듈에 인증 종류 선택·범위·일정 값은 없다 - 종류 이름(표준 명칭), 입력 모양 검사, 화면 고정 문구만 있다.
// 고정 문구는 '추진 중'만 말하고, 인증을 취득했다고 읽히는 표현은 없다 (cert-plan.test.ts가 W12-g 문구 검사 목록으로 확인).
import { detectPii } from "@ltr/editorial";
import { findCertClaims, type Parsed } from "./items";

export const CERT_KINDS = ["iso27001", "ismsp", "other"] as const;
export type CertKind = (typeof CERT_KINDS)[number];
export const CERT_KIND_LABELS: Record<Exclude<CertKind, "other">, string> = { iso27001: "ISO/IEC 27001", ismsp: "ISMS-P" };
export const isCertKind = (v: unknown): v is CertKind => typeof v === "string" && (CERT_KINDS as readonly string[]).includes(v);

/** 화면에 보이는 종류 이름 - 기타는 PO가 적은 이름 */
export const certKindLabel = (kind: CertKind, other: string | null): string => (kind === "other" ? (other ?? "").trim() : CERT_KIND_LABELS[kind]);

/** /security에 찍는 고정 문구. '추진 중'만 말한다 */
export const CERT_PLAN_STATUS_LABEL = "추진 중";
export const certPlanPublicLine = (label: string, approvedOn: string): string => `정보보호 인증 ${label} ${CERT_PLAN_STATUS_LABEL} (추진 계획 승인일 ${approvedOn})`;

export const CERT_OPS = ["draft", "approve", "withdraw"] as const;
export type CertOp = (typeof CERT_OPS)[number];

const fail = (errors: string[]): { ok: false; errors: string[] } => ({ ok: false, errors });
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const posInt = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
};
const money = (v: unknown): number | null => {
  const s = typeof v === "string" ? v.trim().replace(/,/g, "") : v;
  const n = typeof s === "string" && /^\d+$/.test(s) ? Number(s) : s;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
};

export interface CertPlanInput {
  cert_kind: CertKind;
  other_kind_name: string | null;
  scope: string;
  target_start_on: string;
  target_end_on: string;
  cost_estimate_krw: number;
  owner_name: string;
  entity_name: string | null;
  risk_assessed_on: string | null;
  note: string | null;
}

/** 계획 초안 입력 검사 - 종류·범위·일정·비용·담당 필수. 인증 단정 표현·개인정보(전화·이메일 제외)는 거부 */
export function parseCertPlanDraft(body: Record<string, unknown>): Parsed<CertPlanInput> {
  const errors: string[] = [];
  const kind = str(body.cert_kind);
  if (!isCertKind(kind)) errors.push(`cert_kind: ${CERT_KINDS.join("·")} 중 하나입니다`);
  const other = str(body.other_kind_name);
  if (kind === "other" && (other.length < 1 || other.length > 80)) errors.push("other_kind_name: 기타 종류는 이름 1~80자가 필요합니다");
  if (kind !== "other" && other !== "") errors.push("other_kind_name: 기타 종류에서만 적습니다");
  const scope = str(body.scope);
  if (scope.length < 1 || scope.length > 2000) errors.push("scope: 인증 범위 1~2000자입니다");
  const start = str(body.target_start_on);
  const end = str(body.target_end_on);
  if (!isDate(start)) errors.push("target_start_on: 실제 있는 날짜(YYYY-MM-DD)입니다");
  if (!isDate(end)) errors.push("target_end_on: 실제 있는 날짜(YYYY-MM-DD)입니다");
  if (isDate(start) && isDate(end) && end < start) errors.push("target_end_on: 시작일보다 빠를 수 없습니다");
  const cost = money(body.cost_estimate_krw);
  if (cost === null) errors.push("cost_estimate_krw: 비용 추정(0 이상 정수, 원)입니다");
  const owner = str(body.owner_name);
  if (owner.length < 1 || owner.length > 80) errors.push("owner_name: 담당 1~80자입니다");
  const entity = str(body.entity_name);
  if (entity.length > 120) errors.push("entity_name: 120자 이하입니다");
  const risk = str(body.risk_assessed_on);
  if (risk !== "" && !isDate(risk)) errors.push("risk_assessed_on: 실제 있는 날짜(YYYY-MM-DD)입니다");
  const note = str(body.note);
  if (note.length > 1000) errors.push("note: 1000자 이하입니다");
  const joined = [scope, other, owner, entity, note].join(" ");
  if (findCertClaims(joined).length > 0) errors.push("scope·note 등: 인증을 받은 것으로 읽히는 표현이 있습니다 (인증 취득 전에는 쓸 수 없습니다)");
  if (detectPii(joined).some((m) => m.kind !== "phone" && m.kind !== "email")) errors.push("scope·note 등: 개인정보로 보이는 글자가 있습니다");
  return errors.length
    ? fail(errors)
    : {
        ok: true,
        value: {
          cert_kind: kind as CertKind,
          other_kind_name: other || null,
          scope,
          target_start_on: start,
          target_end_on: end,
          cost_estimate_krw: cost as number,
          owner_name: owner,
          entity_name: entity || null,
          risk_assessed_on: risk || null,
          note: note || null,
        },
      };
}

export function parseCertPlanId(body: Record<string, unknown>): Parsed<{ id: number }> {
  const id = posInt(body.id);
  return id === null ? fail(["id: 인증 추진 계획 번호(1 이상 정수)입니다"]) : { ok: true, value: { id } };
}
