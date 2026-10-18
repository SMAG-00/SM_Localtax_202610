// 진입 경로 분류 (PRD-00 13장 진입 경로 값 · OPT-09 AI 답변 엔진 — docs/dev/W2-c_설계.md 2.5·5장). 순수 모듈.
// 브라우저가 보낸 리퍼러 호스트를 설정 analytics_referrers 목록으로 바꾼다 — 호스트는 저장하지 않는다.
//  · 목록 이름과 같거나 `.이름`으로 끝나면 그 진입 경로. AI 답변 엔진 → 네이버 → 검색 순서(gemini.google.com은 검색이 아니라 AI)
//  · 이 사이트 호스트·리퍼러 없음 → null (사이트 안 이동 — 세션 진입 경로를 그대로 쓴다) · 목록 밖 바깥 사이트 → referral
import type { Entry } from "./events";

export interface ReferrerLists {
  ai_answer_engine: readonly string[];
  naver: readonly string[];
  search: readonly string[];
}

const ORDER = ["ai_answer_engine", "naver", "search"] as const satisfies readonly (keyof ReferrerLists & Entry)[];

export const hostMatches = (host: string, name: string): boolean => host === name || host.endsWith(`.${name}`);

/** 사이트 호스트 — www. 앞붙임은 같은 사이트로 본다 */
const sameSite = (host: string, site: string) => host === site || host === `www.${site}` || `www.${host}` === site;

export function classifyReferrer(host: string | null, siteHosts: readonly string[], lists: ReferrerLists): Entry | null {
  if (!host) return null;
  const h = host.toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
  if (siteHosts.some((s) => s && sameSite(h, s.toLowerCase().replace(/:\d+$/, "")))) return null;
  for (const entry of ORDER) if (lists[entry].some((name) => hostMatches(h, name))) return entry;
  return "referral";
}
