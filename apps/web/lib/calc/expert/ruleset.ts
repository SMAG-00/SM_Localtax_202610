import type { ExpertNotices } from "./view";
import { parseExpertRuleset, type ExpertRuleset } from "@ltr/tax-engine/expert";

// 전문가 룰셋 자리 (W13-f). 감수된 룰셋은 PO가 줄 때만 여기에 들어온다(5단계 설계 5장 #21·#22) - 개발은 값을 지어 넣지 않는다.
// null이면 CALC-17·19는 닫힌다. 시험용 룰셋(test_only)은 어떤 경우에도 공개 경로가 읽지 않는다.
export const PRODUCTION_EXPERT_RULESET_RAW: unknown = null;

/** 공개 경로가 읽는 전문가 룰셋 - 없거나 형식이 틀리거나 시험용이면 null */
export function loadExpertRuleset(raw: unknown = PRODUCTION_EXPERT_RULESET_RAW): ExpertRuleset | null {
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = parseExpertRuleset(raw);
    return parsed.test_only === true ? null : parsed;
  } catch {
    return null;
  }
}

// 화면 고정 안내 두 줄 자리 (세무 안내 문구 - AI가 쓰지 않는다). 초안 문구는 설계 문서 PO 입력 목록에 있고 PO 감수 뒤에만 채운다.
// 비어 있으면 세 계산기 모두 닫힌다(게이트 조건).
export const PRODUCTION_EXPERT_NOTICES_RAW: unknown = null;

export function loadExpertNotices(raw: unknown = PRODUCTION_EXPERT_NOTICES_RAW): ExpertNotices | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const ok = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
  return ok(r.entityNational) && ok(r.corporateBase) ? { entityNational: r.entityNational, corporateBase: r.corporateBase } : null;
}
