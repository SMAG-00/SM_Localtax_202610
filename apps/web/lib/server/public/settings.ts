// 공개 설정 읽기 — anon이 읽는 settings 행(설계 2.3 settings.public_keys) → 화면이 쓰는 값. 순수 함수.
// 모양이 틀린 값은 닫힌 쪽으로 읽는다: 기능은 꺼짐, 추천 검색어는 숨김(3~6개가 아니면), 숫자는 기본값 (설계 2.4).
import { PROGRESS_STAGE_ORDER, type ProgressStageKey } from "@ltr/ui";
import { checkPopularRules, type PopularRules } from "@/lib/analytics/settings";
import { FEATURE_KEYS, NEXT_ACTION_KEYS, SECTION_KEYS, type Features, type NextActionKey, type SectionKey } from "./constants";

export interface PublicSettings {
  /** 홈 핵심 메시지 (HOME-01 · CORE-02) — 비었으면 null */
  coreMessage: string | null;
  /** 추천 검색어 칩 — 3~6개일 때만, 아니면 빈 목록(칩 줄 숨김) */
  searchChips: string[];
  /** 허브 한 줄 소개 (CAT-02) */
  hubIntros: Partial<Record<SectionKey, string>>;
  /** 개정 '확정' 기준 단계 (TX-08 초기값 공포) */
  confirmStage: ProgressStageKey;
  /** 허브 상황 카드 상한 (UX-05 초기값 4) */
  hubSituationLimit: number;
  features: Features;
  /** 다음 행동 버튼 우선순위 (ART-06) — 모르는 키·중복은 뺀다 */
  nextActionPriority: NextActionKey[];
  /** 많이 본 기사 건수·창 (popular_rules — ART-11, W2-c 설계 2.5). 없거나 모양이 틀리면 0 — 목록을 숨긴다(닫힌 쪽) */
  popular: { sidebarSize: number; listSize: number; windowHours: number };
}

export const SEARCH_CHIPS_MIN = 3;
export const SEARCH_CHIPS_MAX = 6;
const DEFAULT_HUB_LIMIT = 4;
const DEFAULT_CONFIRM_STAGE: ProgressStageKey = "promulgated";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export const CLOSED_FEATURES: Features = Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as Record<(typeof FEATURE_KEYS)[number], boolean>;

export function parseFeatures(value: unknown): Features {
  const out = { ...CLOSED_FEATURES } as Record<(typeof FEATURE_KEYS)[number], boolean>;
  if (!isObj(value)) return out;
  for (const k of FEATURE_KEYS) out[k] = value[k] === true;
  return out;
}

export function parseSearchChips(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const chips = value.map(text);
  if (chips.some((c) => c === null)) return [];
  const unique = [...new Set(chips as string[])];
  return unique.length >= SEARCH_CHIPS_MIN && unique.length <= SEARCH_CHIPS_MAX && unique.length === chips.length ? unique : [];
}

export function parsePriority(value: unknown): NextActionKey[] {
  if (!Array.isArray(value)) return [...NEXT_ACTION_KEYS];
  const out: NextActionKey[] = [];
  for (const v of value) if ((NEXT_ACTION_KEYS as readonly unknown[]).includes(v) && !out.includes(v as NextActionKey)) out.push(v as NextActionKey);
  return out;
}

/** 많이 본 기사 규칙 — 수집·집계 설정과 같은 검사(lib/analytics/settings.ts)를 지난 값만 */
export function parsePopularSizes(value: unknown): PublicSettings["popular"] {
  if (checkPopularRules(value).length) return { sidebarSize: 0, listSize: 0, windowHours: 0 };
  const v = value as PopularRules;
  return { sidebarSize: v.sidebar_size, listSize: v.list_size, windowHours: v.window_hours };
}

export function parsePublicSettings(rows: readonly { key: string; value: unknown }[]): PublicSettings {
  const v = new Map(rows.map((r) => [r.key, r.value]));
  const intros: Partial<Record<SectionKey, string>> = {};
  const rawIntros = v.get("hub_intros");
  if (isObj(rawIntros)) for (const s of SECTION_KEYS) if (text(rawIntros[s])) intros[s] = text(rawIntros[s])!;
  const stage = v.get("amendment_confirmed_stage");
  const limit = v.get("hub_situation_limit");
  return {
    coreMessage: text(v.get("home_core_message")),
    searchChips: parseSearchChips(v.get("home_search_chips")),
    hubIntros: intros,
    confirmStage: (PROGRESS_STAGE_ORDER as readonly unknown[]).includes(stage) ? (stage as ProgressStageKey) : DEFAULT_CONFIRM_STAGE,
    hubSituationLimit: typeof limit === "number" && Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : DEFAULT_HUB_LIMIT,
    features: parseFeatures(v.get("feature_flags")),
    nextActionPriority: parsePriority(v.get("next_action_priority")),
    popular: parsePopularSizes(v.get("popular_rules")),
  };
}
