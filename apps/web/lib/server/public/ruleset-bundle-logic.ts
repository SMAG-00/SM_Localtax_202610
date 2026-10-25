// 번들 룰셋 폴백 선택 (CALC-08) - 순수 함수. DB에서 활성 룰셋을 읽지 못했을 때만 번들(rules/bundle.json, 감수 서명된 버전만)의 가장 새 버전을 쓴다.
// 번들에 서명 기록이 없는 항목은 이 함수가 한 번 더 걸러낸다(CI의 check-rules R4와 같은 기준).
export interface BundleEntry {
  version: string;
  signedBy: string;
  signedAt: string;
  sha256: string;
}

const text = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

export function validBundleEntries(raw: unknown): BundleEntry[] {
  const list = (raw as { versions?: unknown } | null)?.versions;
  if (!Array.isArray(list)) return [];
  return list.filter((e): e is BundleEntry => !!e && /^\d{4}\.\d{2}$/.test((e as BundleEntry).version) && text(e.signedBy) && text(e.signedAt) && text(e.sha256));
}

/** 가장 새 서명 버전 (YYYY.NN은 글자 순서가 시간 순서). 없으면 null - 그 계산기는 닫힌 채 */
export function newestBundled(raw: unknown): BundleEntry | null {
  const sorted = validBundleEntries(raw).sort((a, b) => (a.version < b.version ? 1 : a.version > b.version ? -1 : 0));
  return sorted[0] ?? null;
}

export type RulesetSource = "db" | "bundle" | "none";
export const BUNDLE_NOTICE = "저장된 룰셋을 불러오지 못해 내장 룰셋으로 계산했어요";
