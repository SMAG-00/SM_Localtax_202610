// 바로가기 열림 판정 (HOME-12·13·14, W10-i 설계 1장 i1 · 4장 결정 12) - 순수 함수 (시험 shortcuts-logic.test.ts)
//  · 바로가기는 메뉴입니다 (PO 2026-10-26): 키 shortcuts가 꺼지면 0개 (1단계 헤더·홈과 같다), 켜지면 도착 키·발행된 호와 상관없이 항상 4개.
//    도착 화면이 아직 닫혀 있으면 그 화면이 404가 아니라 '준비 중' 안내를 보여준다 (각 도착 page)
//  · 주소: 이번 주 법령·해석은 공개 호가 있으면 최신 호(/brief/yyyy-mm-dd), 없으면 /brief
//  · 도착 열림(openDestinations)은 바로가기와 별개로, 캠페인 랜딩(/go)이 '실제로 열린 도착'만 쓰려고 따로 계산한다:
//    calc = 키 calc / expert_request = 키 expert_requests / brief_weekly = 키 brief_regular + 공개 호 1건 이상(주소는 최신 호) / realestate_weekly = 키 realestate_weekly + 발행된 호 1건 이상
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

/** 바로가기 이름 글자 - 도착 화면 제목도 이 글자를 쓴다(이름은 HEADER_SHORTCUTS 한 곳에만) */
export const shortcutLabel = (key: ShortcutKey): string => defOf(key).label;

const SHORTCUT_KEYS: readonly ShortcutKey[] = HEADER_SHORTCUTS.map((s) => s.key);

/** 메뉴 바로가기 - 키 shortcuts가 켜지면 항상 4개(순서 설정·관심 분야·상담 요청 마지막 적용), 꺼지면 0개 */
export function buildShortcuts(features: Features, inputs: ShortcutInputs, orderSetting?: unknown, interests: readonly string[] = []): ShortcutLink[] {
  if (!features.shortcuts) return [];
  const hrefOf = (key: ShortcutKey) => (key === "brief_weekly" ? (inputs.briefHref ?? defOf("brief_weekly").href) : defOf(key).href);
  return orderShortcuts(SHORTCUT_KEYS, orderSetting, interests).map((key) => ({ key, label: defOf(key).label, href: hrefOf(key) }));
}

/** 실제로 열린 도착만 (캠페인 랜딩 /go용) - 메뉴 바로가기와 달리 도착 키·공개 호가 닫혀 있으면 뺀다. 키 shortcuts는 보지 않는다 */
export function openDestinations(features: Features, inputs: ShortcutInputs): ShortcutLink[] {
  const hrefs: Partial<Record<ShortcutKey, string>> = {};
  if (features.calc) hrefs.calc = defOf("calc").href;
  if (features.expert_requests) hrefs.expert_request = defOf("expert_request").href;
  if (features.brief_regular && inputs.briefHref) hrefs.brief_weekly = inputs.briefHref;
  if (features.realestate_weekly && inputs.weeklyOpen) hrefs.realestate_weekly = defOf("realestate_weekly").href;
  const open = Object.keys(hrefs) as ShortcutKey[];
  return orderShortcuts(open, undefined, []).map((key) => ({ key, label: defOf(key).label, href: hrefs[key]! }));
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
