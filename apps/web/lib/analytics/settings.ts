// 수집·집계 설정의 모양 (docs/dev/W2-c_설계.md 2.5) — 수집 API(설정 읽기)와 관리자 설정 화면(lib/admin/settings-rules.ts)이 같은 검사를 쓴다. 순수 모듈.
//  · 검사를 지난 값만 수집 API가 쓴다. 키가 없거나 모양이 틀리면 수집 API는 503(분류할 수 없는 이벤트를 저장하지 않는다)
//  · 값마다 version — 내용을 바꾸면 버전도 바꿔야 한다 (W2-a 사전·유사도 기준과 같은 규칙)
//  · HOT 가중치·많이 본 기사 규칙은 2단계 집계 배치가 읽는다 — 코드 상수 0 (HOME-05 · ART-11)
import { CONTENT_TYPES } from "@ltr/editorial";
import { HUMAN_USER_AGENT_SAMPLES } from "./bots";
import type { ReferrerLists } from "./entry";

/** 수집·집계 설정 키 (설계 2.3 settings.analytics_keys) */
export const ANALYTICS_SETTING_KEYS = ["analytics", "bot_user_agents", "analytics_referrers", "hot_weights", "popular_rules"] as const;
export type AnalyticsSettingKey = (typeof ANALYTICS_SETTING_KEYS)[number];
/** 수집 API가 읽는 키 */
export const COLLECT_SETTING_KEYS = ["analytics", "bot_user_agents", "analytics_referrers"] as const;

export interface AnalyticsConfig {
  version: string;
  stage: number;
  session_idle_minutes: number;
  visitor_id_days: number;
  respect_dnt: boolean;
  retention_days: number;
  rate_limits: { visitor_per_minute: number; ip_per_minute: number };
}
export interface BotList {
  version: string;
  patterns: string[];
}
export interface ReferrerSettings extends ReferrerLists {
  version: string;
}
export interface HotWeights {
  version: string;
  window_days: number;
  view: number;
  share: number;
  engaged: number;
  max_pins: number;
}
export interface PopularRules {
  version: string;
  window_hours: number;
  dedupe_minutes: number;
  exclude_content_types: string[];
  sidebar_size: number;
  list_size: number;
}

export interface CollectSettings {
  analytics: AnalyticsConfig;
  bots: BotList;
  referrers: ReferrerSettings;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function exactKeys(value: Obj, keys: readonly string[], errors: string[], prefix = "") {
  for (const k of keys) if (value[k] === undefined) errors.push(`${prefix}${k}: 필요합니다`);
  for (const k of Object.keys(value)) if (!keys.includes(k)) errors.push(`${prefix}${k}: 모르는 칸입니다`);
}

function int(value: Obj, key: string, min: number, max: number, errors: string[], prefix = "") {
  const v = value[key];
  if (v !== undefined && !(Number.isInteger(v) && (v as number) >= min && (v as number) <= max)) errors.push(`${prefix}${key}: ${min}~${max} 정수여야 합니다`);
}

function versionText(value: Obj, errors: string[]) {
  if (value.version !== undefined && (typeof value.version !== "string" || value.version.trim() === "" || value.version.length > 80)) errors.push("version: 버전 글자가 필요합니다");
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v;
}

/** 내용이 바뀌었는데 버전이 그대로면 오류 */
function versionBump(value: Obj, current: unknown, errors: string[]) {
  if (errors.length || !isObj(current) || value.version !== current.version) return;
  const strip = (o: Obj) => JSON.stringify(canonical({ ...o, version: null }));
  if (strip(value) !== strip(current)) errors.push(`version: 값을 바꾸면 버전도 바꿔야 합니다 (지금 ${String(current.version)})`);
}

const ANALYTICS_KEYS = ["version", "stage", "session_idle_minutes", "visitor_id_days", "respect_dnt", "retention_days", "rate_limits"] as const;

export function checkAnalytics(value: unknown, current?: unknown): string[] {
  if (!isObj(value)) return ["값은 JSON 객체여야 합니다"];
  const errors: string[] = [];
  exactKeys(value, ANALYTICS_KEYS, errors);
  versionText(value, errors);
  int(value, "stage", 1, 5, errors);
  int(value, "session_idle_minutes", 1, 1440, errors);
  int(value, "visitor_id_days", 1, 400, errors); // 브라우저 쿠키 상한 400일
  int(value, "retention_days", 31, 1825, errors); // 재방문 30일을 셀 수 있게
  if (value.respect_dnt !== undefined && typeof value.respect_dnt !== "boolean") errors.push("respect_dnt: true/false여야 합니다");
  const r = value.rate_limits;
  if (r !== undefined) {
    if (!isObj(r)) errors.push("rate_limits: JSON 객체여야 합니다");
    else {
      exactKeys(r, ["visitor_per_minute", "ip_per_minute"], errors, "rate_limits.");
      int(r, "visitor_per_minute", 10, 10_000, errors, "rate_limits.");
      int(r, "ip_per_minute", 10, 100_000, errors, "rate_limits.");
      if (Number.isInteger(r.visitor_per_minute) && Number.isInteger(r.ip_per_minute) && (r.ip_per_minute as number) < (r.visitor_per_minute as number)) {
        errors.push("rate_limits.ip_per_minute: 방문자 상한보다 작을 수 없습니다 (한 IP 뒤에 여러 방문자)");
      }
    }
  }
  versionBump(value, current, errors);
  return errors;
}

const PATTERN = /^[\x21-\x7e]{2,60}$/;

export function checkBotList(value: unknown, current?: unknown): string[] {
  if (!isObj(value)) return ["값은 JSON 객체여야 합니다"];
  const errors: string[] = [];
  exactKeys(value, ["version", "patterns"], errors);
  versionText(value, errors);
  const list = value.patterns;
  if (list !== undefined) {
    if (!Array.isArray(list) || list.length === 0 || list.length > 500) errors.push("patterns: 글자 조각 1~500개 목록이어야 합니다");
    else {
      const seen = new Set<string>();
      list.forEach((p, i) => {
        if (typeof p !== "string" || !PATTERN.test(p) || p !== p.toLowerCase()) return errors.push(`patterns[${i}]: 공백 없는 소문자 영문·숫자·기호 2~60자여야 합니다`);
        if (seen.has(p)) return errors.push(`patterns[${i}]: 같은 조각이 앞에 있습니다`);
        seen.add(p);
        const human = HUMAN_USER_AGENT_SAMPLES.find((ua) => ua.toLowerCase().includes(p));
        if (human) errors.push(`patterns[${i}]: 사람 브라우저 견본 User-Agent에 들어 있어 사람을 봇으로 셉니다`);
      });
    }
  }
  versionBump(value, current, errors);
  return errors;
}

const HOST = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const REFERRER_LISTS = ["ai_answer_engine", "naver", "search"] as const;

export function checkReferrers(value: unknown, current?: unknown): string[] {
  if (!isObj(value)) return ["값은 JSON 객체여야 합니다"];
  const errors: string[] = [];
  exactKeys(value, ["version", ...REFERRER_LISTS], errors);
  versionText(value, errors);
  const owner = new Map<string, string>();
  for (const k of REFERRER_LISTS) {
    const list = value[k];
    if (list === undefined) continue;
    if (!Array.isArray(list) || list.length > 200) {
      errors.push(`${k}: 호스트 이름 목록(200개 이하)이어야 합니다`);
      continue;
    }
    list.forEach((h, i) => {
      if (typeof h !== "string" || !HOST.test(h)) return errors.push(`${k}[${i}]: 소문자 호스트 이름이어야 합니다 (예: chatgpt.com — 경로·https:// 없음)`);
      if (owner.has(h)) return errors.push(`${k}[${i}]: 같은 호스트가 ${owner.get(h)}에 있습니다`);
      owner.set(h, k);
    });
  }
  versionBump(value, current, errors);
  return errors;
}

function weight(value: Obj, key: string, errors: string[]) {
  const v = value[key];
  if (v !== undefined && !(typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100)) errors.push(`${key}: 0~100 숫자여야 합니다`);
}

export function checkHotWeights(value: unknown, current?: unknown): string[] {
  if (!isObj(value)) return ["값은 JSON 객체여야 합니다"];
  const errors: string[] = [];
  exactKeys(value, ["version", "window_days", "view", "share", "engaged", "max_pins"], errors);
  versionText(value, errors);
  int(value, "window_days", 1, 90, errors);
  for (const k of ["view", "share", "engaged"]) weight(value, k, errors);
  int(value, "max_pins", 0, 10, errors);
  if (errors.length === 0 && [value.view, value.share, value.engaged].every((w) => w === 0)) errors.push("view·share·engaged: 하나는 0보다 커야 합니다");
  versionBump(value, current, errors);
  return errors;
}

export function checkPopularRules(value: unknown, current?: unknown): string[] {
  if (!isObj(value)) return ["값은 JSON 객체여야 합니다"];
  const errors: string[] = [];
  exactKeys(value, ["version", "window_hours", "dedupe_minutes", "exclude_content_types", "sidebar_size", "list_size"], errors);
  versionText(value, errors);
  int(value, "window_hours", 1, 2160, errors);
  int(value, "dedupe_minutes", 0, 1440, errors);
  int(value, "sidebar_size", 1, 20, errors);
  int(value, "list_size", 1, 100, errors);
  const ex = value.exclude_content_types;
  if (ex !== undefined) {
    if (!Array.isArray(ex)) errors.push("exclude_content_types: 기사 유형 목록이어야 합니다");
    else
      ex.forEach((t, i) => {
        if (!(CONTENT_TYPES as readonly unknown[]).includes(t)) errors.push(`exclude_content_types[${i}]: ${CONTENT_TYPES.join("·")} 중 하나여야 합니다`);
        else if (ex.indexOf(t) !== i) errors.push(`exclude_content_types[${i}]: 같은 유형이 앞에 있습니다`);
      });
  }
  versionBump(value, current, errors);
  return errors;
}

export const ANALYTICS_SETTING_CHECKS: Readonly<Record<AnalyticsSettingKey, (value: unknown, current?: unknown) => string[]>> = {
  analytics: checkAnalytics,
  bot_user_agents: checkBotList,
  analytics_referrers: checkReferrers,
  hot_weights: checkHotWeights,
  popular_rules: checkPopularRules,
};

export type CollectSettingsRead = { ok: true; settings: CollectSettings } | { ok: false; problems: string[] };

/** 수집 API의 설정 읽기 — 세 키가 모두 있고 검사를 지나야 한다. 문제는 "키: 문장" */
export function parseCollectSettings(rows: readonly { key: string; value: unknown }[]): CollectSettingsRead {
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const problems: string[] = [];
  for (const key of COLLECT_SETTING_KEYS) {
    if (!byKey.has(key)) {
      problems.push(`${key}: 설정 행이 없습니다`);
      continue;
    }
    for (const e of ANALYTICS_SETTING_CHECKS[key](byKey.get(key))) problems.push(`${key}: ${e}`);
  }
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    settings: {
      analytics: byKey.get("analytics") as AnalyticsConfig,
      bots: byKey.get("bot_user_agents") as BotList,
      referrers: byKey.get("analytics_referrers") as ReferrerSettings,
    },
  };
}
