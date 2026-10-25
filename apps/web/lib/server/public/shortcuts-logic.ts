// 바로가기 열림 판정 (HOME-12·13·14, W10-i 설계 1장 i1) - 순수 함수 (시험 shortcuts-logic.test.ts)
//  · 키 shortcuts가 꺼지면 0개 (1단계 헤더·홈과 같다). 켜져도 도착이 닫혀 있으면 그 바로가기만 뺀다 - 빈 링크 0
//  · 도착 열림: calc = 키 calc / expert_request = 키 expert_requests / brief_weekly = 키 brief_regular + 공개 호 1건 이상(주소는 최신 호) / realestate_weekly = 키 realestate_weekly + 발행된 호 1건 이상
//  · 이름 글자는 @ltr/ui HEADER_SHORTCUTS에만 있다. 순서는 설정 shortcut_order · 회원 관심 분야 · 상담 요청 마지막 (lib/site/shortcut-order.ts)
import { HEADER_SHORTCUTS } from "@ltr/ui";
import { orderShortcuts, type ShortcutKey } from "@/lib/site/shortcut-order";
import type { Features } from "./constants";

export interface ShortcutInputs {
  /** 최신 브리핑 호 주소 (/brief/yyyy-mm-dd) - 공개 호가 없으면 null */
  briefHref: string | null;
  /** 발행된 이번 주 재테크 포인트 호가 있는가 */
  weeklyOpen: boolean;
}
export const NO_SHORTCUT_INPUTS: ShortcutInputs = { briefHref: null, weeklyOpen: false };

export interface ShortcutLink {
  key: ShortcutKey;
  label: string;
  href: string;
}

const defOf = (key: ShortcutKey) => HEADER_SHORTCUTS.find((s) => s.key === key)!;

export function buildShortcuts(features: Features, inputs: ShortcutInputs, orderSetting?: unknown, interests: readonly string[] = []): ShortcutLink[] {
  if (!features.shortcuts) return [];
  const hrefs: Partial<Record<ShortcutKey, string>> = {};
  if (features.calc) hrefs.calc = defOf("calc").href;
  if (features.expert_requests) hrefs.expert_request = defOf("expert_request").href;
  if (features.brief_regular && inputs.briefHref) hrefs.brief_weekly = inputs.briefHref;
  if (features.realestate_weekly && inputs.weeklyOpen) hrefs.realestate_weekly = defOf("realestate_weekly").href;
  const open = Object.keys(hrefs) as ShortcutKey[];
  return orderShortcuts(open, orderSetting, interests).map((key) => ({ key, label: defOf(key).label, href: hrefs[key]! }));
}

/** 설정 home_shortcut_copy -> 키별 한 줄 설명 (30자 이하 한 줄 글자만, 나머지는 버린다) */
export function parseShortcutCopy(value: unknown): Partial<Record<ShortcutKey, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Partial<Record<ShortcutKey, string>> = {};
  for (const s of HEADER_SHORTCUTS) {
    const v = (value as Record<string, unknown>)[s.key];
    if (typeof v === "string" && v.trim() !== "" && v.trim().length <= 30 && !/[\r\n]/.test(v)) out[s.key] = v.trim();
  }
  return out;
}
