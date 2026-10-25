// AI 도우미 런처를 그리지 않는 화면 (PRD_최종 4.1 - 관리자·결제 화면 제외). 경로 접두어 하나라도 맞으면 숨긴다. 순수 함수.
export const ASSISTANT_HIDDEN_PREFIXES = ["/store/subscription", "/my/billing", "/admin"] as const;

export function assistantHiddenOn(pathname: string | null): boolean {
  if (!pathname) return false;
  return ASSISTANT_HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
