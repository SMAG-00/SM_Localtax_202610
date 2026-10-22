// 분양 정보 관리 규칙 (W4 17단계 — PRD-01B PR-04 · PR-05 · PR-07, docs/dev/W4_설계.md 1장 17단계 · 2.1 · 3장 · 6장 · 12장 #11·#12·#140~).
// 순수 모듈 — 관리 API(/api/admin/supply)·화면이 같은 규칙을 쓰고, DB(마이그레이션 …51 — 제약·supply_notices_guard)가 한 번 더 본다(설계 8장).
//  · 칸 이름 = DB 칸 이름(snake_case). 오류는 칸마다 "칸: 문장"(422) — 화면은 그 칸 옆에 보인다(errorsByField).
//  · 공식 공고 URL·공고 기관·모집공고일·청약 일정(시작·마감)·공공누리 유형은 늘 필수, 공개는 확인일·공급 규모까지(제약 supply_notices_public_record).
//  · 가격·분양가·분담금·수익률·시세 칸은 받지 않는다(칸 이름 422 — 14단계 priceKeyErrors). 사업명·공급 규모·공고 기관 글자의 금액(숫자 + 원)·가격 낱말도 422(DB supply_text_has_price와 같은 식).
//  · 분양가는 공식 공고 링크로만(12장 #11). 시행사·분양대행사 홍보 원고는 정보 목록이 아니라 광고·협찬(sponsored) 기사로만(PR-04 — DB …51 발행 검사).
import { LICENSE_TYPES, type LicenseType } from "@ltr/editorial";
import { isValidDate } from "./form-utils";
import { idOf, priceKeyErrors } from "./project-rules";

/** 2.1 supply_notice.status (DB check와 같은 값) */
export const SUPPLY_STATUSES = ["draft", "public", "hidden"] as const;
export type SupplyStatus = (typeof SUPPLY_STATUSES)[number];
export const SUPPLY_STATUS_LABELS: Readonly<Record<SupplyStatus, string>> = { draft: "초안", public: "공개", hidden: "내림" };

/** 관리 API op */
export const SUPPLY_OPS = ["create", "update", "publish"] as const;
export type SupplyOp = (typeof SUPPLY_OPS)[number];
/** 공개 전환 */
export const SUPPLY_PUBLISH_TARGETS = ["public", "hidden"] as const;
export type SupplyPublishTarget = (typeof SUPPLY_PUBLISH_TARGETS)[number];

/** 글자 한도 (DB check와 같은 숫자) */
export const SUPPLY_LIMITS = { name: 120, supplyScale: 200, issuer: 80, url: 500 } as const;

/** 받는 칸 — 이 밖의 칸은 422 (가격 칸 이름은 따로 가격 문장) */
export const SUPPLY_FIELDS = [
  "name",
  "region_code",
  "project_id",
  "supply_scale",
  "apply_start",
  "apply_end",
  "notice_date",
  "notice_issuer",
  "official_notice_url",
  "license_type",
] as const;
export type SupplyField = (typeof SUPPLY_FIELDS)[number];

/**
 * 글자의 금액·가격 표현 — 숫자(쉼표·소수점) + 큰 수 낱말(조·억·천·백·만) + 원('원문'·'원본'의 원은 금액이 아니다) 또는 가격 낱말.
 * DB public.supply_text_has_price와 같은 식 — 시험이 같은 견본으로 둘을 본다
 */
export const SUPPLY_PRICE_AMOUNT_RE = /[0-9][0-9,.]*(\s*(조|억|천|백|만))*\s*원(?!문|본)/u;
export const SUPPLY_PRICE_WORD_RE = /(분양가|분담금|시세|프리미엄|웃돈|수익|가격)/u;
export function supplyTextHasPrice(text: string | null | undefined): boolean {
  const t = text ?? "";
  return SUPPLY_PRICE_AMOUNT_RE.test(t) || SUPPLY_PRICE_WORD_RE.test(t);
}

export interface SupplyInput {
  name: string;
  region_code: string;
  project_id: number | null;
  supply_scale: string | null;
  apply_start: string;
  apply_end: string;
  notice_date: string;
  notice_issuer: string;
  official_notice_url: string;
  license_type: LicenseType;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const HTTP_URL = /^https?:\/\/\S+$/i;
const CODE_RE = /^\d{10}$/;
const PRICE_TEXT_LINE = "금액·가격 표현은 적지 않습니다 — 분양 정보에는 가격을 싣지 않고 공식 공고 링크로만 잇습니다 (PR-04 · PR-05)";

function text(body: Record<string, unknown>, field: SupplyField, errors: string[], o: { required: boolean; max: number; price?: boolean }): string | null {
  const v = body[field];
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
    if (o.required) errors.push(`${field}: 필수입니다`);
    return null;
  }
  if (typeof v !== "string") {
    errors.push(`${field}: 글자입니다`);
    return null;
  }
  const t = v.trim();
  if (t.length > o.max) errors.push(`${field}: ${o.max}자 이하입니다 (지금 ${t.length}자)`);
  if (o.price && supplyTextHasPrice(t)) errors.push(`${field}: ${PRICE_TEXT_LINE}`);
  return t;
}

function date(body: Record<string, unknown>, field: SupplyField, errors: string[]): string | null {
  const v = body[field];
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) {
    errors.push(`${field}: 필수입니다 (YYYY-MM-DD — 공식 공고에 적힌 날짜)`);
    return null;
  }
  if (typeof v !== "string" || !isValidDate(v.trim())) {
    errors.push(`${field}: 날짜 모양이 아닙니다 (YYYY-MM-DD)`);
    return null;
  }
  return v.trim();
}

/** 지역 — 오늘(KST) 유효한 행정구역만 (DB supply_notices_guard와 같다). region = 그 코드의 regions 행(없으면 null) */
export function supplyRegionErrors(code: string | null, region: { valid_from: string | null; valid_to: string | null } | null, today: string): string[] {
  if (code === null) return [];
  if (!region) return ["region_code: 없는 행정구역 코드입니다"];
  if ((region.valid_from !== null && region.valid_from > today) || (region.valid_to !== null && region.valid_to < today)) return ["region_code: 오늘 유효한 행정구역이 아닙니다 (폐지·아직 시작 전)"];
  return [];
}

/**
 * op create·update 본문 → 칸 값. update는 바꾸는 칸만 보내도 되도록 기존 값(base)을 먼저 깔고 본다.
 * ctx.region = region_code의 regions 행, ctx.projectExists = project_id 프로젝트가 있는가
 */
export function parseSupplyInput(
  body: Record<string, unknown>,
  ctx: { today: string; region: { valid_from: string | null; valid_to: string | null } | null; projectExists: boolean },
  base: Partial<SupplyInput> = {},
): Parsed<SupplyInput> {
  const errors: string[] = [...priceKeyErrors(body).map((e) => e.replace("프로젝트에 저장하지", "분양 정보에 저장하지"))];
  const known = new Set<string>([...SUPPLY_FIELDS, "op", "id", "verified"]);
  for (const k of Object.keys(body)) {
    if (!known.has(k) && !errors.some((e) => e.startsWith(`${k}:`))) errors.push(`${k}: 받지 않는 칸입니다`);
  }
  const merged: Record<string, unknown> = { ...base, ...Object.fromEntries(Object.entries(body).filter(([k]) => (SUPPLY_FIELDS as readonly string[]).includes(k))) };
  const name = text(merged, "name", errors, { required: true, max: SUPPLY_LIMITS.name, price: true });
  const supplyScale = text(merged, "supply_scale", errors, { required: false, max: SUPPLY_LIMITS.supplyScale, price: true });
  const issuer = text(merged, "notice_issuer", errors, { required: true, max: SUPPLY_LIMITS.issuer, price: true });
  const url = text(merged, "official_notice_url", errors, { required: true, max: SUPPLY_LIMITS.url });
  if (url !== null && !HTTP_URL.test(url)) errors.push("official_notice_url: http(s):// 로 시작하는 공식 공고 주소입니다");

  const code = typeof merged.region_code === "string" ? merged.region_code.trim() : merged.region_code === undefined || merged.region_code === null ? "" : String(merged.region_code);
  if (code === "") errors.push("region_code: 필수입니다 (행정구역 10자리)");
  else if (!CODE_RE.test(code)) errors.push("region_code: 행정구역 코드 10자리 숫자입니다");
  else errors.push(...supplyRegionErrors(code, ctx.region, ctx.today));

  let projectId: number | null = null;
  if (merged.project_id !== undefined && merged.project_id !== null && merged.project_id !== "") {
    projectId = idOf(merged.project_id);
    if (projectId === null) errors.push("project_id: 프로젝트 번호(1 이상 정수)입니다 — 잇지 않으려면 비워 두세요");
    else if (!ctx.projectExists) errors.push("project_id: 그런 프로젝트가 없습니다");
  }

  const start = date(merged, "apply_start", errors);
  const end = date(merged, "apply_end", errors);
  const noticeDate = date(merged, "notice_date", errors);
  if (start && end && end < start) errors.push("apply_end: 청약 마감일은 시작일과 같거나 뒤입니다");

  const license = merged.license_type;
  if (license === undefined || license === null || license === "") errors.push("license_type: 필수입니다 — 공고의 공공누리 유형(표시가 없으면 미표시)");
  else if (typeof license !== "string" || !(LICENSE_TYPES as readonly string[]).includes(license)) errors.push(`license_type: ${LICENSE_TYPES.join("·")} 중 하나입니다`);

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name: name!,
      region_code: code,
      project_id: projectId,
      supply_scale: supplyScale,
      apply_start: start!,
      apply_end: end!,
      notice_date: noticeDate!,
      notice_issuer: issuer!,
      official_notice_url: url!,
      license_type: license as LicenseType,
    },
  };
}

/** 공개 조건 — 확인일·공급 규모 (DB 제약 supply_notices_public_record와 같다). 칸마다 "칸: 문장" */
export function supplyPublishErrors(row: { supply_scale: string | null; verified_at: string | null }): string[] {
  const errors: string[] = [];
  if (!row.supply_scale || row.supply_scale.trim() === "") errors.push("supply_scale: 공개하려면 공급 규모(공고의 세대 수)가 있어야 합니다");
  if (!row.verified_at) errors.push("verified: 공개하려면 공식 공고와 대조해 확인했다고 표시해야 합니다(확인일)");
  return errors;
}

export function parseSupplyPublish(body: Record<string, unknown>): Parsed<{ id: number; status: SupplyPublishTarget; verified: boolean }> {
  const errors: string[] = [...priceKeyErrors(body)];
  const id = idOf(body.id);
  if (id === null) errors.push("id: 분양 정보 번호가 필요합니다");
  const status = body.status;
  if (typeof status !== "string" || !(SUPPLY_PUBLISH_TARGETS as readonly string[]).includes(status)) errors.push("status: public(공개) 또는 hidden(내리기)입니다");
  const verified = body.verified;
  if (verified !== undefined && typeof verified !== "boolean") errors.push("verified: 참·거짓입니다");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { id: id!, status: status as SupplyPublishTarget, verified: verified === true } };
}
