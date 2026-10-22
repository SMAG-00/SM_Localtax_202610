// 공식 자료·공공누리 운영 규칙 (W4 5단계 — docs/dev/W4_설계.md 1장 5단계 · 2.1 · 2.2 · 12장 #13, PRD-01B REG1-07 · PR-07) — 순수 함수
// 운영 설정 API(official_source_types · kogl_usage)·발행 판정 설정 읽기·편집 화면이 같은 검사를 쓴다. DB 트리거(마이그레이션 20261022000041
// official_source_settings_guard)와 같은 규칙 — 한쪽만 바꾸지 않는다.
import {
  BLOCKED_OFFICIAL_SOURCE_TYPES,
  KOGL_NEVER,
  LICENSE_TYPES,
  LICENSE_TYPE_LABELS,
  OFFICIAL_SOURCE_TYPES,
  type KoglUsage,
  type LicenseType,
} from "@ltr/editorial";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const TYPE_RE = /^[a-z][a-z0-9_]{1,39}$/;

/** 자료 종류 글자 — 편집 화면·공식 자료 카드 (허용 목록 씨앗 6종. 편집국이 더한 종류는 키 글자 그대로) */
export const SOURCE_TYPE_LABELS: Readonly<Record<string, string>> = {
  ordinance: "조례",
  notice: "고시",
  budget_settlement: "예산/결산",
  local_tax_revenue: "지방세 세수",
  realestate_transaction: "부동산 거래/공시",
  redevelopment: "정비/개발",
};
export const sourceTypeLabel = (t: string): string => SOURCE_TYPE_LABELS[t] ?? t;

/** 공공누리 유형 배지 글자 — 모르는 값·빈 값은 null (지어내지 않는다) */
export function licenseBadge(t: string | null | undefined): string | null {
  return t && (LICENSE_TYPES as readonly string[]).includes(t) ? LICENSE_TYPE_LABELS[t as LicenseType] : null;
}

/** official_source_types 값 검사 — 문장 목록 (빈 목록이면 통과) */
export function officialSourceTypesErrors(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) return ["자료 종류 1~50개의 목록이어야 합니다 — 예: " + JSON.stringify(OFFICIAL_SOURCE_TYPES)];
  const errors: string[] = [];
  value.forEach((t, i) => {
    if (typeof t !== "string" || !TYPE_RE.test(t)) errors.push(`[${i}]: 영문 소문자·숫자·_ 2~40자입니다`);
    else if ((BLOCKED_OFFICIAL_SOURCE_TYPES as readonly string[]).includes(t)) errors.push(`[${i}]: ${t}는 교통·관광·음식점·생활 안내라 지역정보(공식 자료)에 넣지 않습니다 — 허용 목록에도 넣을 수 없습니다 (REG1-07 코드 고정)`);
    else if (value.indexOf(t) !== i) errors.push(`[${i}]: ${t}가 앞에 이미 있습니다`);
  });
  return errors;
}

const PHOTO_TYPES: readonly LicenseType[] = ["kogl_1", "kogl_2", "kogl_3", "not_applicable"];
const FULL_TEXT_TYPES: readonly LicenseType[] = ["kogl_1", "kogl_2", "kogl_3"];

/** kogl_usage 값 검사 — { photoTypes, fullTextTypes } 두 칸, 제4유형·미표시는 어디에도 못 넣는다 */
export function koglUsageErrors(value: unknown): string[] {
  if (!isObj(value)) return ['{ "photoTypes": [...], "fullTextTypes": [...] } 모양이어야 합니다'];
  const errors: string[] = [];
  for (const k of Object.keys(value)) if (k !== "photoTypes" && k !== "fullTextTypes") errors.push(`${k}: 모르는 칸입니다 — photoTypes·fullTextTypes만 씁니다`);
  for (const [key, allowed] of [["photoTypes", PHOTO_TYPES], ["fullTextTypes", FULL_TEXT_TYPES]] as const) {
    const list = value[key];
    if (!Array.isArray(list)) {
      errors.push(`${key}: 유형 목록이어야 합니다`);
      continue;
    }
    list.forEach((t, i) => {
      if (typeof t === "string" && (KOGL_NEVER as readonly string[]).includes(t)) errors.push(`${key}[${i}]: 공공누리 제4유형·미표시(${t})는 설정으로도 열 수 없습니다 — 링크·요약만 씁니다 (PR-07 코드 고정)`);
      else if (typeof t !== "string" || !(allowed as readonly string[]).includes(t)) errors.push(`${key}[${i}]: ${allowed.join("·")} 중 하나여야 합니다`);
      else if (list.indexOf(t) !== i) errors.push(`${key}[${i}]: ${t}가 앞에 이미 있습니다`);
    });
  }
  return errors;
}

/** 저장된 official_source_types → 목록. 모양이 틀리면 null (부르는 쪽이 씨앗으로 닫힌다) */
export function parseOfficialSourceTypes(value: unknown): string[] | null {
  return value !== undefined && officialSourceTypesErrors(value).length === 0 ? [...(value as string[])] : null;
}

/** 저장된 kogl_usage → 이용 범위. 모양이 틀리면 null (부르는 쪽이 KOGL_USAGE_DEFAULT로 닫힌다) */
export function parseKoglUsage(value: unknown): KoglUsage | null {
  if (value === undefined || koglUsageErrors(value).length > 0) return null;
  const v = value as { photoTypes: LicenseType[]; fullTextTypes: LicenseType[] };
  return { photoTypes: [...v.photoTypes], fullTextTypes: [...v.fullTextTypes] };
}
