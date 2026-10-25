import { isoToKstDate } from "@/lib/admin/form-utils";

// 위택스 바로가기 (WETAX-01) - 주소는 wetax_links(설정값)에서만 온다. 코드에 주소 리터럴 0, 입력값·식별자를 주소에 붙이지 않는다.
// 화면별 메뉴: 취득세 결과 -> 신고, 재산세·종부세·자동차세 결과 -> 납부, 환급 진단 -> 환급금 조회.
// 메뉴 주소가 비었거나 broken이면 위택스 첫 화면 주소로 대체하고, 첫 화면도 못 쓰면 링크 없이 안내 문장만 보인다(깨진 링크 렌더 0).

export type WetaxKind = "home" | "filing" | "payment" | "refund" | "app";
export type WetaxTax = "all" | "acquisition" | "property" | "comprehensive" | "vehicle" | "refund";
export type WetaxStatus = "ok" | "broken" | "unchecked";
export type WetaxScreen = "acquisition" | "property" | "comprehensive" | "vehicle" | "refund";

export interface WetaxLinkRow {
  key: string;
  kind: WetaxKind;
  tax_kind: WetaxTax;
  label: string;
  url: string | null;
  status: WetaxStatus;
  fail_count: number;
  fallback_key: string | null;
  checked_at: string | null;
}

/** 오류·시간 초과가 이 횟수만큼 연속되면 broken (WETAX-01 · FAM-04) */
export const WETAX_BROKEN_AFTER = 2;

export const WETAX_MENU: Record<WetaxScreen, { kind: "filing" | "payment" | "refund"; tax: WetaxTax }> = {
  acquisition: { kind: "filing", tax: "acquisition" },
  property: { kind: "payment", tax: "property" },
  comprehensive: { kind: "payment", tax: "comprehensive" },
  vehicle: { kind: "payment", tax: "vehicle" },
  refund: { kind: "refund", tax: "refund" },
};

/** 쿼리·조각·사용자 정보가 없는 http(s) 주소만 - 입력값이 실릴 틈을 막는다 */
export const isCleanWetaxUrl = (url: string): boolean => /^https?:\/\/[^\s?#@]+$/i.test(url);

const usable = (r: WetaxLinkRow | undefined): r is WetaxLinkRow & { url: string } => !!r && r.status !== "broken" && r.url !== null && isCleanWetaxUrl(r.url);
const checkedOn = (r: WetaxLinkRow) => (r.checked_at ? isoToKstDate(r.checked_at) : null);

export type WetaxCard =
  | { mode: "link" | "fallback"; url: string; label: string; checkedOn: string | null }
  | { mode: "text" };

export function wetaxCardFor(screen: WetaxScreen, rows: readonly WetaxLinkRow[]): WetaxCard {
  const menu = WETAX_MENU[screen];
  const primary = rows.find((r) => r.kind === menu.kind && r.tax_kind === menu.tax);
  if (usable(primary)) return { mode: "link", url: primary.url, label: primary.label, checkedOn: checkedOn(primary) };
  const home = rows.find((r) => r.key === primary?.fallback_key) ?? rows.find((r) => r.kind === "home");
  if (usable(home)) return { mode: "fallback", url: home.url, label: home.label, checkedOn: checkedOn(home) };
  return { mode: "text" };
}

/** 스마트 위택스 앱 안내 링크 - 폭 640px 미만 화면에서만 보인다. 쓸 수 있는 주소가 없으면 null */
export function wetaxAppLink(rows: readonly WetaxLinkRow[]): { url: string; label: string } | null {
  const app = rows.find((r) => r.kind === "app");
  return usable(app) ? { url: app.url, label: app.label } : null;
}

/** 점검 결과 -> 다음 상태. 성공하면 실패 횟수를 0으로, 실패는 연속 횟수를 올리고 기준에 닿으면 broken. 기준 전의 첫 실패는 이전 상태를 유지한다 */
export function nextWetaxState(prev: { status: WetaxStatus; fail_count: number }, result: "ok" | "broken"): { status: WetaxStatus; fail_count: number } {
  if (result === "ok") return { status: "ok", fail_count: 0 };
  const fail_count = Math.min(prev.fail_count + 1, 99);
  return { status: fail_count >= WETAX_BROKEN_AFTER ? "broken" : prev.status, fail_count };
}
