// 바로가기 순서 (HOME-12·13, W10-i 설계 8장) - 순수 함수 (시험 shortcut-order.test.ts)
//  · 순서 설정 shortcut_order = calc · realestate_weekly · brief_weekly 세 키를 한 번씩 (관리자가 고침). 모양이 틀리면 기본 순서
//  · 상담 요청 바로가기(expert_request)은 순서에 넣지 않고 열려 있으면 항상 마지막 (강조 없이 같은 모양 - PO 2026-10-26)
//  · 로그인 회원의 저장된 관심 분야(기존 프로필)가 바로가기와 맞으면 그 바로가기를 맨 앞으로. 새 개인 정보 0 - 서버가 기존 프로필에서 읽는다
export const ORDERABLE_SHORTCUTS = ["calc", "realestate_weekly", "brief_weekly"] as const;
export type OrderableShortcut = (typeof ORDERABLE_SHORTCUTS)[number];
export type ShortcutKey = OrderableShortcut | "expert_request";

export const SHORTCUT_ORDER_DEFAULT: readonly OrderableShortcut[] = ORDERABLE_SHORTCUTS;

/** 관심 분야(4대 분야 키) → 바로가기. 세금은 계산기, 부동산재테크는 금주 부동산 재테크. 금융·지자체뉴스는 맞는 바로가기 없음 */
export const INTEREST_SHORTCUT: Readonly<Record<string, OrderableShortcut>> = { tax: "calc", realestate: "realestate_weekly" };

/** 설정 값 검사 - 관리 화면 저장 검사에 쓴다. 문제가 없으면 빈 목록 */
export function shortcutOrderErrors(value: unknown): string[] {
  if (!Array.isArray(value) || value.length !== ORDERABLE_SHORTCUTS.length) return [`shortcut_order는 ${ORDERABLE_SHORTCUTS.join("·")}를 한 번씩 담은 목록이어야 합니다`];
  const seen = new Set<unknown>(value);
  return seen.size === value.length && ORDERABLE_SHORTCUTS.every((k) => seen.has(k)) ? [] : [`shortcut_order는 ${ORDERABLE_SHORTCUTS.join("·")}를 한 번씩만 담아야 합니다 (상담 요청은 넣지 않습니다)`];
}

export function parseShortcutOrder(value: unknown): readonly OrderableShortcut[] {
  return shortcutOrderErrors(value).length === 0 ? (value as OrderableShortcut[]) : SHORTCUT_ORDER_DEFAULT;
}

/** 열린 바로가기를 화면 순서로 - 설정 순서 → 관심 분야 맞춤 앞당기기 → 상담 요청 마지막 */
export function orderShortcuts(open: readonly ShortcutKey[], orderSetting: unknown, interests: readonly string[] = []): ShortcutKey[] {
  const isOpen = new Set<ShortcutKey>(open);
  let ordered: ShortcutKey[] = parseShortcutOrder(orderSetting).filter((k) => isOpen.has(k));
  const first = interests.map((i) => INTEREST_SHORTCUT[i]).find((k): k is OrderableShortcut => k !== undefined && isOpen.has(k));
  if (first) ordered = [first, ...ordered.filter((k) => k !== first)];
  if (isOpen.has("expert_request")) ordered.push("expert_request");
  return ordered;
}

const SECTION_KEYS_FOR_INTEREST = ["tax", "realestate", "finance", "local"] as const;

/** profiles.interests(4대 분야 키 목록) -> 아는 분야 키만, 저장 순서 유지·중복 제거 (모양이 틀리면 빈 목록) */
export function parseInterests(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string" && (SECTION_KEYS_FOR_INTEREST as readonly string[]).includes(v)))];
}
