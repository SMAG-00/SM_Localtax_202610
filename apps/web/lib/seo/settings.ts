// 색인·크롤러·사이트맵 설정 검사와 읽기 (W7 · OPT-01·08 · docs/dev/W7_설계.md 2장). 순수 모듈 — 설정 화면·설정 API·robots/사이트맵 경로가 같이 쓴다.
//  · 크롤러 이름은 코드에 두지 않는다 — settings.crawler_policy에서만 읽는다 (OPT-08)
//  · AI 학습 크롤러 정책을 정하지 않았으면(decided=false) 색인을 켤 수 없다 (전환 점검 실패, robots.txt는 전체 차단으로 닫힌다)
import { RULES_V1, applyRuleParams } from "@ltr/seo-lint";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

export const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
export const SEARCH_AGENTS_MAX = 20;
export const AI_AGENTS_MAX = 30;
export const NEWS_SITEMAP_HOURS = { min: 1, max: 168 } as const;

export interface CrawlerPolicy {
  /** 일반 검색 크롤러 이름 (허용) */
  search: string[];
  ai_training: { decided: boolean; agents: { name: string; allow: boolean }[] };
}

export function crawlerPolicyErrors(value: unknown): string[] {
  if (!isObj(value)) return ["값: { search: [...], ai_training: { decided, agents } } 객체여야 합니다"];
  const errors: string[] = [];
  const allowed = new Set(["search", "ai_training"]);
  for (const k of Object.keys(value)) if (!allowed.has(k)) errors.push(`모르는 칸 ${k}`);
  const search = value.search;
  if (!Array.isArray(search) || search.length > SEARCH_AGENTS_MAX || !search.every((n) => typeof n === "string" && AGENT_NAME.test(n))) {
    errors.push(`search: 크롤러 이름 목록(영문·숫자·.-_ 1~40자, ${SEARCH_AGENTS_MAX}개 이하)이어야 합니다`);
  } else if (new Set(search.map((n) => n.toLowerCase())).size !== search.length) errors.push("search: 같은 이름이 두 번 있습니다");
  const ai = value.ai_training;
  if (!isObj(ai) || typeof ai.decided !== "boolean" || !Array.isArray(ai.agents)) {
    errors.push("ai_training: { decided: true|false, agents: [{ name, allow }] } 이어야 합니다");
  } else {
    const agents = ai.agents;
    if (agents.length > AI_AGENTS_MAX || !agents.every((a) => isObj(a) && typeof a.name === "string" && AGENT_NAME.test(a.name) && typeof a.allow === "boolean")) {
      errors.push(`ai_training.agents: { name, allow } 목록(이름 영문·숫자·.-_ 1~40자, ${AI_AGENTS_MAX}개 이하)이어야 합니다`);
    } else if (new Set(agents.map((a) => String((a as Obj).name).toLowerCase())).size !== agents.length) errors.push("ai_training.agents: 같은 이름이 두 번 있습니다");
  }
  return errors;
}

/** 모양이 틀리면 null (호출하는 쪽이 닫힌 쪽으로 처리) */
export function parseCrawlerPolicy(value: unknown): CrawlerPolicy | null {
  if (crawlerPolicyErrors(value).length > 0) return null;
  const v = value as { search: string[]; ai_training: { decided: boolean; agents: { name: string; allow: boolean }[] } };
  return { search: [...v.search], ai_training: { decided: v.ai_training.decided, agents: v.ai_training.agents.map((a) => ({ name: a.name, allow: a.allow })) } };
}

export function newsSitemapHoursErrors(value: unknown): string[] {
  return typeof value === "number" && Number.isInteger(value) && value >= NEWS_SITEMAP_HOURS.min && value <= NEWS_SITEMAP_HOURS.max
    ? []
    : [`값: ${NEWS_SITEMAP_HOURS.min}~${NEWS_SITEMAP_HOURS.max} 정수(시간)여야 합니다`];
}
/** 없거나 틀리면 48시간 — 뉴스 사이트맵 기본 기간 [확인 필요: 검색 엔진 권장 기간] */
export function parseNewsSitemapHours(value: unknown): number {
  return newsSitemapHoursErrors(value).length === 0 ? (value as number) : 48;
}

export function indexnowErrors(value: unknown): string[] {
  return isObj(value) && typeof value.enabled === "boolean" && Object.keys(value).length === 1 ? [] : ["값: { \"enabled\": true|false } 이어야 합니다"];
}
/** 없거나 틀리면 꺼짐 (닫힌 쪽) */
export function indexnowEnabled(value: unknown): boolean {
  return indexnowErrors(value).length === 0 && (value as { enabled: boolean }).enabled === true;
}

export function seoLintParamsErrors(value: unknown): string[] {
  if (!isObj(value)) return ["값: { \"<규칙 ID>\": { \"<기준 이름>\": 값 } } 객체여야 합니다 (비우려면 {})"];
  return applyRuleParams(RULES_V1, value).problems;
}

/** 색인 켜기(SITE_INDEXING=on) 점검에서 막는 사유 — 비어 있으면 통과 (OPT-08 · SEO-04) */
export function indexingSwitchProblems(policyValue: unknown): string[] {
  const policy = parseCrawlerPolicy(policyValue);
  if (!policy) return ["settings.crawler_policy가 없거나 형식이 틀립니다"];
  const problems: string[] = [];
  if (!policy.ai_training.decided) problems.push("AI 학습 크롤러 허용 여부가 아직 정해지지 않았습니다 (crawler_policy.ai_training.decided = false)");
  if (policy.search.length === 0) problems.push("일반 검색 크롤러 목록(crawler_policy.search)이 비어 있습니다");
  return problems;
}
