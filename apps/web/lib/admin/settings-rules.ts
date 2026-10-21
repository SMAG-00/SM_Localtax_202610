// 운영 설정(settings) 값 검사 — 관리자 설정 화면(/admin/settings)과 설정 API가 같이 쓴다. 순수 모듈.
//  · 아는 키만 고친다. 검사 규칙이 없는 키는 화면에서 고칠 수 없다 (잘못된 모양이 발행 판정을 멈추지 않게 닫힌 쪽으로).
//  · 검사를 지난 값은 발행 판정 설정 읽기(lib/server/articles/gate.ts parseGateSettings)를 그대로 통과한다 — 같은 키·같은 모양.
//  · 버전이 있는 값(사전·유사도 기준)은 내용을 바꾸면 버전도 바꿔야 한다 — 점검 기록에 남는 버전이 값과 어긋나지 않게.
import { normalizeText } from "@ltr/editorial";
import { checkDomainCutover } from "@/lib/analytics/metrics";
import { checkQueryTermsSettings } from "@/lib/analytics/query-terms";
import { ANALYTICS_SETTING_CHECKS } from "@/lib/analytics/settings";
import { checkAuthLimitsSetting, checkMemberSetting, checkPrivacyRetentionSetting } from "@/lib/auth/settings";
import { checkWindowsSetting } from "@/lib/readiness/windows";
import { hasClaimToken } from "@/lib/brand/claim";
// 공개 설정의 키 목록 — 공개 데이터 함수와 같은 상수 (순수 모듈이라 화면에서도 불러온다)
import { FEATURE_KEYS, NEXT_ACTION_KEYS } from "@/lib/server/public/constants";
import { SEARCH_CHIPS_MAX, SEARCH_CHIPS_MIN } from "@/lib/server/public/settings";
import { phraseError } from "./dictionary-rules";

const SEARCH_CHIP_RANGE = [SEARCH_CHIPS_MIN, SEARCH_CHIPS_MAX] as const;

type Obj = Record<string, unknown>;
export type SettingCheck = { ok: true; value: unknown } | { ok: false; errors: string[] };

/** 개정 단계 6종 (01B TX-07, W2-a 설계 §2) */
export const AMENDMENT_STAGES = ["announced", "pre_notice", "submitted", "passed", "promulgated", "effective"] as const;
export const AMENDMENT_STAGE_LABELS = {
  announced: "발표",
  pre_notice: "입법예고",
  submitted: "국회 제출",
  passed: "의결",
  promulgated: "공포",
  effective: "시행",
} as const;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const COMPARATORS = ["gt", "gte"];

function exactKeys(value: Obj, keys: readonly string[], errors: string[]) {
  for (const k of keys) if (value[k] === undefined) errors.push(`${k}: 필요합니다`);
  for (const k of Object.keys(value)) if (!keys.includes(k)) errors.push(`${k}: 모르는 칸입니다`);
}

function versionText(value: Obj, errors: string[]) {
  if (value.version !== undefined && (typeof value.version !== "string" || value.version.trim() === "" || value.version.length > 80)) {
    errors.push("version: 버전 글자가 필요합니다");
  }
}

const SIMILARITY_KEYS = ["version", "sentenceSimilarity", "sentenceComparator", "articleRatio", "articleComparator", "quoteRatio", "quoteComparator"] as const;

function similarity(value: unknown, current: unknown): string[] {
  if (!isObj(value)) return ["값은 JSON 객체여야 합니다"];
  const errors: string[] = [];
  exactKeys(value, SIMILARITY_KEYS, errors);
  versionText(value, errors);
  for (const k of ["sentenceSimilarity", "articleRatio", "quoteRatio"]) {
    const v = value[k];
    if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1)) errors.push(`${k}: 0~1 사이 숫자여야 합니다`);
  }
  for (const k of ["sentenceComparator", "articleComparator", "quoteComparator"]) {
    const v = value[k];
    if (v !== undefined && !COMPARATORS.includes(v as string)) errors.push(`${k}: gt(초과)·gte(이상) 중 하나여야 합니다`);
  }
  if (errors.length === 0 && isObj(current) && value.version === current.version) {
    const changed = SIMILARITY_KEYS.some((k) => k !== "version" && value[k] !== current[k]);
    if (changed) errors.push(`version: 기준값을 바꾸면 버전도 바꿔야 합니다 (지금 ${String(current.version)})`);
  }
  return errors;
}

function phrases(value: unknown, current: unknown): string[] {
  if (!isObj(value)) return ["값은 JSON 객체여야 합니다"];
  const errors: string[] = [];
  exactKeys(value, ["version", "phrases"], errors);
  versionText(value, errors);
  const list = value.phrases;
  if (list !== undefined) {
    if (!Array.isArray(list)) errors.push("phrases: 표현 글자 목록이어야 합니다");
    else if (list.length === 0) errors.push("phrases: 표현이 하나 이상 있어야 합니다");
    else {
      const seen = new Map<string, string>();
      list.forEach((p, i) => {
        if (typeof p !== "string") return errors.push(`phrases[${i}]: 글자여야 합니다`);
        const problem = phraseError(p);
        if (problem) return errors.push(`phrases[${i}]: ${problem}`);
        const n = normalizeText(p);
        if (seen.has(n)) return errors.push(`phrases[${i}]: 같은 표현이 앞에 있습니다 (${seen.get(n)})`);
        seen.set(n, p);
      });
    }
  }
  if (errors.length === 0 && isObj(current) && value.version === current.version) {
    const before = Array.isArray(current.phrases) ? current.phrases : [];
    const after = list as string[];
    if (before.length !== after.length || before.some((p, i) => p !== after[i])) errors.push(`version: 표현 목록을 바꾸면 버전도 바꿔야 합니다 (지금 ${String(current.version)})`);
  }
  return errors;
}

function confirmedStage(value: unknown): string[] {
  return typeof value === "string" && (AMENDMENT_STAGES as readonly string[]).includes(value) ? [] : [`값: ${AMENDMENT_STAGES.join("·")} 중 하나여야 합니다`];
}

// ── W2-b 공개 설정 (docs/dev/W2-b_설계.md 2.3·2.4) — 공개 데이터 함수(lib/server/public/settings.ts)가 같은 모양으로 읽는다 ──

const SECTIONS_4 = ["tax", "realestate", "finance", "local"] as const;
/** 화면 안내 문장 상한 (R8 — 60자, 공백 포함) */
const SCREEN_SENTENCE_MAX = 60;
const CHIP_MAX_CHARS = 20;
const HUB_LIMIT_MAX = 12;
const chars = (s: string) => [...s].length;

function screenSentence(value: unknown): string[] {
  if (typeof value !== "string" || value.trim() === "") return ["값: 따옴표로 감싼 문구 한 줄이어야 합니다"];
  return chars(value.trim()) > SCREEN_SENTENCE_MAX ? [`값: ${SCREEN_SENTENCE_MAX}자 이하여야 합니다 (R8 — 지금 ${chars(value.trim())}자)`] : [];
}

/**
 * 홈 핵심 메시지 (HOME-01 · CORE-02 · W3 9단계) — 화면 안내 문장(60자) + 경력 연수 표기('50년' 등) 늘 거부.
 * '50년'은 근거 링크를 붙일 수 있는 연재 제목에만 쓴다(설계 12장 #26) — 홈 히어로 제목에는 근거 링크 자리가 없다. DB 트리거(…37)도 같은 규칙
 */
export function coreMessageErrors(value: unknown): string[] {
  const errors = screenSentence(value);
  if (errors.length === 0 && hasClaimToken(value)) errors.push("값: 홈 핵심 메시지에는 경력 연수 표기('50년' 등)를 쓰지 않습니다 — 근거 링크를 붙일 수 있는 연재 제목에만 (설계 12장 #26)");
  return errors;
}

function searchChips(value: unknown): string[] {
  if (!Array.isArray(value)) return ["값: 글자 목록이어야 합니다 — 비우면 []"];
  const errors: string[] = [];
  if (value.length !== 0 && (value.length < SEARCH_CHIP_RANGE[0] || value.length > SEARCH_CHIP_RANGE[1])) {
    errors.push(`값: 추천 검색어는 ${SEARCH_CHIP_RANGE[0]}~${SEARCH_CHIP_RANGE[1]}개이거나 0개(칩 줄 숨김)여야 합니다 (HOME-01 — 지금 ${value.length}개)`);
  }
  const seen = new Set<string>();
  value.forEach((c, i) => {
    if (typeof c !== "string" || c.trim() === "") return errors.push(`[${i}]: 빈칸이 아닌 글자여야 합니다`);
    if (chars(c.trim()) > CHIP_MAX_CHARS) return errors.push(`[${i}]: ${CHIP_MAX_CHARS}자 이하여야 합니다`);
    const n = normalizeText(c);
    if (seen.has(n)) return errors.push(`[${i}]: 같은 검색어가 앞에 있습니다`);
    seen.add(n);
  });
  return errors;
}

function hubIntros(value: unknown): string[] {
  if (!isObj(value)) return ["값은 JSON 객체여야 합니다 — { \"tax\": \"…\" }"];
  const errors: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (!(SECTIONS_4 as readonly string[]).includes(k)) errors.push(`${k}: 4대 분야(${SECTIONS_4.join("·")})만 씁니다`);
    else errors.push(...screenSentence(v).map((e) => e.replace(/^값: /, `${k}: `)));
  }
  return errors;
}

function hubLimit(value: unknown): string[] {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= HUB_LIMIT_MAX ? [] : [`값: 1~${HUB_LIMIT_MAX} 정수여야 합니다 (UX-05 초기값 4)`];
}

function featureFlags(value: unknown): string[] {
  if (!isObj(value)) return ["값은 JSON 객체여야 합니다 — { \"search\": true, … }"];
  const errors: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (!(FEATURE_KEYS as readonly string[]).includes(k)) errors.push(`${k}: 모르는 기능 키입니다`);
    else if (typeof v !== "boolean") errors.push(`${k}: true/false여야 합니다`);
  }
  return errors;
}

function priority(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return ["값: 버튼 키 목록이어야 합니다 (1개 이상)"];
  const errors: string[] = [];
  value.forEach((k, i) => {
    if (!(NEXT_ACTION_KEYS as readonly unknown[]).includes(k)) errors.push(`[${i}]: ${NEXT_ACTION_KEYS.join("·")} 중 하나여야 합니다`);
    else if (value.indexOf(k) !== i) errors.push(`[${i}]: 같은 버튼이 앞에 있습니다`);
  });
  return errors;
}

export interface SettingSpec {
  /** 화면 이름 */
  label: string;
  /** 고치는 법 (화면 안내) */
  guide: string;
  /** 사전 화면에서도 고친다 */
  dictionaryTab?: "forbidden" | "fear";
  check: (value: unknown, current: unknown) => string[];
}

export const SETTING_SPECS: Readonly<Record<string, SettingSpec>> = {
  forbidden_phrases: {
    label: "금지 표현 사전 (UX-01)",
    guide: '{ "version": "새 버전", "phrases": ["표현", …] } — 표현 하나씩 고치기는 사전 화면이 편합니다',
    dictionaryTab: "forbidden",
    check: phrases,
  },
  fear_phrases: {
    label: "공포 표현 사전 (UX-03)",
    guide: '{ "version": "새 버전", "phrases": ["표현", …] } — 표현 하나씩 고치기는 사전 화면이 편합니다',
    dictionaryTab: "fear",
    check: phrases,
  },
  similarity_internal: {
    label: "유사도 내부 기준 (OPT-06)",
    guide: "비율 3개는 0~1 숫자, 비교 연산은 gt(초과)·gte(이상). 기준값을 바꾸면 version도 바꿉니다",
    check: similarity,
  },
  amendment_confirmed_stage: {
    label: "개정 '확정' 기준 단계 (TX-08)",
    guide: `따옴표로 감싼 단계 이름 하나 — ${AMENDMENT_STAGES.map((s) => `${s}(${AMENDMENT_STAGE_LABELS[s]})`).join(" · ")}`,
    check: (value) => confirmedStage(value),
  },
  home_core_message: {
    label: "홈 핵심 메시지 (HOME-01 · CORE-02)",
    guide: `따옴표로 감싼 문구 한 줄 — ${SCREEN_SENTENCE_MAX}자 이하, 경력 연수 표기('50년' 등) 0. 바꾸면 배포 없이 다음 요청부터 홈 히어로에 보입니다`,
    check: (value) => coreMessageErrors(value),
  },
  home_search_chips: {
    label: "홈 추천 검색어 칩 (HOME-01)",
    guide: `["취득세", "개편안", "책임준공"] — ${SEARCH_CHIP_RANGE[0]}~${SEARCH_CHIP_RANGE[1]}개, 비우면 [] (칩 줄 숨김)`,
    check: (value) => searchChips(value),
  },
  hub_intros: {
    label: "4대 분야 허브 한 줄 소개 (CAT-02)",
    guide: '{ "tax": "…", "realestate": "…", "finance": "…", "local": "…" } — 분야마다 60자 이하, 없는 분야는 소개 줄 없음',
    check: (value) => hubIntros(value),
  },
  hub_situation_limit: {
    label: "허브 상황 카드 상한 (UX-05)",
    guide: `1~${HUB_LIMIT_MAX} 숫자 하나 — 분야 허브 상황 카드 줄에 보이는 최대 장 수. DB가 이 값을 넘는 허브 자리를 거부합니다`,
    check: (value) => hubLimit(value),
  },
  feature_flags: {
    label: "기능 공개 목록 (HOME-02 · ART-06 · HELP-05)",
    guide: `{ "기능 키": true/false } — 켠 기능만 메뉴·링크·버튼이 나옵니다. 키: ${FEATURE_KEYS.join(" · ")}`,
    check: (value) => featureFlags(value),
  },
  next_action_priority: {
    label: "다음 행동 버튼 우선순위 (ART-06)",
    guide: `버튼 키 목록 — 열린 버튼 중 앞의 2개만 보입니다. 키: ${NEXT_ACTION_KEYS.join(" · ")}`,
    check: (value) => priority(value),
  },
  // ── W2-c 수집·집계 설정 (docs/dev/W2-c_설계.md 2.5) — 수집 API(lib/analytics/settings.ts parseCollectSettings)와 같은 검사 ──
  analytics: {
    label: "측정 수집 설정 (GROW-01)",
    guide:
      "stage 단계 1~5 · session_idle_minutes 세션 경계(무활동 분) · visitor_id_days 방문자 ID 쿠키 수명(일, 400 이하) · respect_dnt DNT를 측정 거부로 볼지 · retention_days 원본 보존(일) · rate_limits 방문자·IP 1분 상한. 값을 바꾸면 version도 바꿉니다 — 늦어도 1분 뒤 적용",
    check: (value, current) => ANALYTICS_SETTING_CHECKS.analytics(value, current),
  },
  bot_user_agents: {
    label: "봇 User-Agent 목록 (ART-11 · HOME-05)",
    guide: '{ "version": "새 버전", "patterns": ["bot", "crawl", …] } — 소문자 글자 조각, 하나라도 들어 있으면 봇. 사람 브라우저에도 들어 있는 조각(mozilla·chrome·kakaotalk 등)은 거부됩니다',
    check: (value, current) => ANALYTICS_SETTING_CHECKS.bot_user_agents(value, current),
  },
  analytics_referrers: {
    label: "진입 경로 리퍼러 목록 (PRD-00 13장 · OPT-09)",
    guide: '{ "version": "새 버전", "ai_answer_engine": ["chatgpt.com", …], "naver": [...], "search": [...] } — 호스트 이름만, 한 호스트는 한 목록에만. AI → 네이버 → 검색 순서로 봅니다',
    check: (value, current) => ANALYTICS_SETTING_CHECKS.analytics_referrers(value, current),
  },
  hot_weights: {
    label: "상담 사례 HOT 가중치 (HOME-05)",
    guide: '{ "version": "새 버전", "window_days": 7, "view": 1, "share": 5, "engaged": 2, "max_pins": 2 } — 바꾸면 다음 집계부터 순위가 바뀝니다',
    check: (value, current) => ANALYTICS_SETTING_CHECKS.hot_weights(value, current),
  },
  popular_rules: {
    label: "많이 본 기사 규칙 (ART-11)",
    guide: '{ "version": "새 버전", "window_hours": 168, "dedupe_minutes": 30, "exclude_content_types": ["digest", "sponsored"], "sidebar_size": 5, "list_size": 20 }',
    check: (value, current) => ANALYTICS_SETTING_CHECKS.popular_rules(value, current),
  },
  // ── W2-d 검색어 집계 (docs/dev/W2-d_설계.md 2.7) — 편집국 화면·보존 기한 정리 배치(lib/server/analytics/query-terms.ts)와 같은 검사 ──
  query_terms: {
    label: "검색어 집계 (SRCH-03)",
    guide:
      '{ "version": "새 버전", "retention_days": 395, "display_min_count": 2 } — retention_days 기간(한국 날짜) 행 보존 일수(31~1825, 매일 정리) · display_min_count 편집국 검색어 화면에 보이는 최소 합계 횟수(1~100 — 그보다 적게 찾은 검색어는 수만 보입니다). 값을 바꾸면 version도 바꿉니다',
    check: (value, current) => checkQueryTermsSettings(value, current),
  },
  // ── W2-e 회원·시도 제한·보존 기한 (docs/dev/W2-e_설계.md 2.2) — 로그인·비밀번호 바꾸기(lib/server/auth-guard.ts)와 프로필 트리거가 같은 값을 읽는다 ──
  member: {
    label: "회원 한도 (ACC-01 · ACC-02)",
    guide:
      '{ "version": "새 버전", "interest_region_limit": 3, "interest_max": 20, "display_name_chars": 30, "signup_confirm_hours": 24, "password_min_chars": 10, "password_max_bytes": 72 } — 관심 지역 상한(1~20)·관심 분야 상한(1~50)·표시 이름 글자(1~30)·가입 확인 링크 시간(1~168)·비밀번호 최소 글자(8~72)·최대 바이트(10~72, bcrypt 72). 값을 바꾸면 version도 바꿉니다',
    check: (value, current) => checkMemberSetting(value, current),
  },
  auth_limits: {
    label: "로그인·가입·재설정 시도 제한 (W2-e 4.1)",
    guide:
      '{ "version": "새 버전", "login_pair": { "window": 900, "limit": 5 }, … } — 범위마다 window(초, 1~86400) 동안 limit(1~100000)번까지 허용하고 다음 번부터 막습니다. 범위 12개: login_pair 이메일+IP · login_account 이메일 · login_ip IP · password_change · signup_ip · signup_email · reset_ip · reset_email · form_ip · brief_ip · brief_email · confirm_resend. 값을 바꾸면 version도 바꿉니다 — 다음 요청부터 적용',
    check: (value, current) => checkAuthLimitsSetting(value, current),
  },
  privacy_retention: {
    label: "개인정보 보존 기한 (W2-e 9.3)",
    guide:
      '{ "version": "새 버전", "unconfirmed_signup_days": 7, "unconfirmed_consent_days": 7, "revoked_consent_days": 30, "inquiry_contact_days": 365, "inquiry_attachment_days": 365, "throttle_hours": 24 } — 일수(1~365, 문의는 1~3650)·시도 횟수 해시 시간(1~8760). 법률 확인 전 초기값입니다. 값을 바꾸면 version도 바꿉니다',
    check: (value, current) => checkPrivacyRetentionSetting(value, current),
  },
  // ── W2-c 지표 대시보드 (docs/dev/W2-c_설계.md 2.6) — 대시보드(lib/analytics/metrics.ts readCutover)와 같은 검사 ──
  domain_cutover: {
    label: "운영 도메인 전환일 (GROW-01 — 측정의 시험 기간 끝)",
    guide:
      '{ "version": "새 버전", "date": "2026-11-02" } — 한국 날짜, 전환 전이면 null. 이 날 0시부터 운영, 앞날까지 시험 기간으로 지표 대시보드가 나눠 보입니다. 날짜를 바꾸면 version도 바꿉니다',
    check: (value, current) => checkDomainCutover(value, current),
  },
  // ── W2-c 기사 생산 대시보드 (docs/dev/W2-c_설계.md 2.8) — 대시보드(lib/readiness/windows.ts readWindowsSetting)와 같은 검사 ──
  news_readiness_windows: {
    label: "기사 생산 대시보드 기간 (NAV-14 — 내부 집계 기간 정의)",
    guide:
      '{ "version": "새 버전", "months": [3, 6, 12], "basis": "closed_months" } — months 기간 길이(개월, 작은 것부터 1~4개), basis closed_months(지난달까지 완결된 달)·including_current(이번 달 오늘까지). 기준 숫자는 여기 적지 않고 규정 버전에만 적습니다. 값을 바꾸면 version도 바꿉니다',
    check: (value, current) => checkWindowsSetting(value, current),
  },
};

export const isEditableSetting = (key: string): boolean => Object.hasOwn(SETTING_SPECS, key);

/** 새 값 검사 — current는 지금 저장된 값(버전 규칙에 쓴다) */
export function validateSettingValue(key: string, value: unknown, current: unknown): SettingCheck {
  const spec = SETTING_SPECS[key];
  if (!spec || !Object.hasOwn(SETTING_SPECS, key)) return { ok: false, errors: ["이 설정은 검사 규칙이 아직 없어 화면에서 고칠 수 없습니다"] };
  const errors = spec.check(value, current);
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

/** 편집 칸의 JSON 글 → 값 */
export function parseJsonText(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (text.trim() === "") return { ok: false, error: "값을 적어 주세요" };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: "JSON 형식이 아닙니다 — 따옴표·쉼표·괄호를 확인하세요" };
  }
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v;
}

/** 같은 JSON 값인가 — 객체 칸 순서는 보지 않는다 (DB jsonb는 칸 순서를 다시 정한다) */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
