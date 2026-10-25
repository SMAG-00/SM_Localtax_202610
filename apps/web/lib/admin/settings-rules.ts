// 운영 설정(settings) 값 검사 — 관리자 설정 화면(/admin/settings)과 설정 API가 같이 쓴다. 순수 모듈.
//  · 아는 키만 고친다. 검사 규칙이 없는 키는 화면에서 고칠 수 없다 (잘못된 모양이 발행 판정을 멈추지 않게 닫힌 쪽으로).
//  · 검사를 지난 값은 발행 판정 설정 읽기(lib/server/articles/gate.ts parseGateSettings)를 그대로 통과한다 — 같은 키·같은 모양.
//  · 버전이 있는 값(사전·유사도 기준)은 내용을 바꾸면 버전도 바꿔야 한다 — 점검 기록에 남는 버전이 값과 어긋나지 않게.
import { koglUsageErrors, officialSourceTypesErrors } from "./official-source-rules";
import { regionalJudgeFieldsErrors, staleStatisticsDaysErrors } from "./regional-rules";
import { STALE_STATISTICS_DAYS_DEFAULT, STALE_STATISTICS_DAYS_MAX, STALE_STATISTICS_DAYS_MIN, normalizeText } from "@ltr/editorial";
import { checkDomainCutover } from "@/lib/analytics/metrics";
import { checkQueryTermsSettings } from "@/lib/analytics/query-terms";
import { ANALYTICS_SETTING_CHECKS } from "@/lib/analytics/settings";
import { checkAuthLimitsSetting, checkMemberSetting, checkPrivacyRetentionSetting } from "@/lib/auth/settings";
import { checkWindowsSetting } from "@/lib/readiness/windows";
import { hasClaimToken } from "@/lib/brand/claim";
import { companyInfoErrors } from "@/lib/policy/docs";
// 공개 설정의 키 목록 — 공개 데이터 함수와 같은 상수 (순수 모듈이라 화면에서도 불러온다)
import { FEATURE_KEYS, NEXT_ACTION_KEYS } from "@/lib/server/public/constants";
import { heroMediaErrors } from "@/lib/site/hero-media";
import { CORE_HIGHLIGHTS_MAX, SEARCH_CHIPS_MAX, SEARCH_CHIPS_MIN } from "@/lib/server/public/settings";
import { localBlockFieldsErrors } from "@/lib/server/public/region-hub-logic";
import { searchTopicsErrors } from "@/lib/server/public/search-classify";
import { REGION_INDEX_LIMITS, pilotRegionsErrors, regionIndexThresholdErrors } from "@/lib/server/public/region-index-logic";
import { IG_LIMITS, inheritanceNoticeErrors, inheritanceSituationsErrors } from "@/lib/server/public/inheritance-gift-logic";
import { phraseError } from "./dictionary-rules";
import { blockedDomainsErrors, legalReviewSettingErrors, rebuttalWaitErrors } from "./finance-rules";
import { digestSidosErrors, digestSourcesErrors, digestSummaryMaxErrors, eventBlockedDomainsErrors, eventRecheckErrors } from "./local-news-rules";
import { PROJECT_LIMITS, projectStageListsErrors, projectTypesErrors } from "./project-rules";
import { shortcutCopyErrors, utmRegistryErrors } from "@/lib/campaigns/settings-check";
import { shortcutOrderErrors } from "@/lib/site/shortcut-order";
import { nextIntakeErrors, readinessWarnErrors } from "@/lib/readiness/monthly";
import { crawlerPolicyErrors, indexnowErrors, newsSitemapHoursErrors, seoLintParamsErrors } from "@/lib/seo/settings";
import { EXPIRY_DAYS_DEFAULT, EXPIRY_DAYS_MAX, EXPIRY_DAYS_MIN, expiryDaysErrors } from "@/lib/source-review/rules";

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

/** 강조 낱말 한 개의 글자 수 상한 (DB 트리거 core_highlights_guard와 같다) */
export const CORE_HIGHLIGHT_WORD_MAX = 30;

/**
 * 홈 핵심 메시지 강조 낱말 (home_core_highlights) — 글자 목록 1~5개, 낱말마다 비지 않고 30자 이하·서로 다름.
 * message를 주면(저장 때 현재 핵심 메시지) 낱말마다 그 메시지 안에 있어야 한다. DB 트리거(…71)도 같은 규칙
 */
export function coreHighlightsErrors(value: unknown, message?: unknown): string[] {
  if (!Array.isArray(value)) return ['값: 글자 목록이어야 합니다 — 예: ["지방세", "재테크"]'];
  if (value.length < 1 || value.length > CORE_HIGHLIGHTS_MAX) return [`값: 강조 낱말은 1~${CORE_HIGHLIGHTS_MAX}개여야 합니다 (지금 ${value.length}개)`];
  const errors: string[] = [];
  const seen = new Set<string>();
  value.forEach((w, i) => {
    if (typeof w !== "string" || w.trim() === "") return void errors.push(`[${i}]: 비지 않은 글자여야 합니다`);
    const word = w.trim();
    if (chars(word) > CORE_HIGHLIGHT_WORD_MAX) errors.push(`[${i}]: ${CORE_HIGHLIGHT_WORD_MAX}자 이하여야 합니다 (지금 ${chars(word)}자)`);
    if (seen.has(word)) errors.push(`[${i}]: 같은 낱말이 앞에 있습니다 ('${word}')`);
    seen.add(word);
    if (typeof message === "string" && !message.includes(word)) errors.push(`[${i}]: 홈 핵심 메시지 안에 없는 낱말입니다 ('${word}') — 메시지에 있는 글자 그대로 적으세요`);
  });
  return errors;
}

/** 칼럼 의견 고지 문구 상한 — 칼럼 상세 머리 아래 고지 한 줄 (W3 설계 2.2 · 12장 #8) */
export const OPINION_NOTICE_MAX = 300;

/**
 * 칼럼 의견 고지 문구 (TX-16 · W3 6단계) — PO 감수본을 운영 설정 화면에서 넣는다(12장 #8). 빈 글자 = 칼럼 발행 거부 상태(DB 발행 검사가 본다).
 * 글자 한 줄 · 300자 이하 · 경력 연수 표기('50년' 등) 0 — 모든 칼럼에 붙는 고지에는 근거 링크 자리가 없다(12장 #26)
 */
export function opinionNoticeErrors(value: unknown): string[] {
  if (typeof value !== "string") return ['값: 따옴표로 감싼 글자 한 줄이어야 합니다 — 비우면 "" (칼럼 발행이 막힌다)'];
  if (/[\r\n]/.test(value)) return ["값: 한 줄이어야 합니다"];
  if (chars(value.trim()) > OPINION_NOTICE_MAX) return [`값: ${OPINION_NOTICE_MAX}자 이하여야 합니다 (지금 ${chars(value.trim())}자)`];
  if (hasClaimToken(value)) return ["값: 의견 고지 문구에는 경력 연수 표기('50년' 등)를 쓰지 않습니다 — 근거 링크를 붙일 수 있는 연재 제목에만 (설계 12장 #26)"];
  return [];
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
  // ── W7 최적화 (docs/dev/W7_설계.md 2장) — 점검 엔진(gate.ts)·robots.txt·사이트맵이 같은 검사로 읽는다 ──
  seo_lint_params: {
    label: "최적화 점검 기준값 (OPT-03·10)",
    guide:
      '{ "seo.keyword-density": { "maxPercent": 8 }, "aeo.lead-answer": { "maxSentences": 2 } } — 규칙 파일 기본값을 덮어씁니다. 규칙 ID와 기준 이름은 규칙 파일(packages/seo-lint/rules)에 있는 것만, 정수·글자 형식이 맞는 값만 적용됩니다(틀린 항목은 무시). 차단 항목의 등급·가중치는 바꿀 수 없습니다. 비우려면 {}. 바꾸면 배포 없이 다음 점검부터',
    check: (value) => seoLintParamsErrors(value),
  },
  readiness_warn: {
    label: "제휴 준비 경고 기준 (NAV-17)",
    guide: '{ "columnShareMax": 0.3 } — 월 마감 때 칼럼(opinion) 비중이 이 비율(0~1)을 넘으면 경고 알림 1건을 냅니다. 비어 있으면({}) 칼럼 비중 경고 기준이 없습니다. 기준 숫자는 규정 원문을 보고 정합니다',
    check: (value) => readinessWarnErrors(value),
  },
  news_next_intake: {
    label: "다음 접수 목표 (NAV-16)",
    guide: '{ "label": "공고 이름", "target_month": "2027-03" } — 다음 접수 공고를 확인한 뒤 적습니다. 비어 있으면({}) 제휴 준비 화면 머리에 ‘목표 접수 미정’이 보입니다. 선정은 외부 결정이라 ‘선정 예정’·‘제휴 확정’ 같은 표현은 쓸 수 없습니다',
    check: (value) => nextIntakeErrors(value),
  },
  crawler_policy: {
    label: "크롤러 정책 (OPT-08)",
    guide:
      '{ "search": ["<검색 크롤러 이름>"], "ai_training": { "decided": false, "agents": [{ "name": "<AI 학습 크롤러 이름>", "allow": false }] } } — robots.txt가 이 값으로 만들어집니다. AI 학습 크롤러 허용 여부를 PO가 정하기 전(decided=false)에는 색인을 켤 수 없고 robots.txt는 전체 차단입니다(PRD_최종 §13 #3). 크롤러 이름은 공식 문서에서 확인해 적습니다',
    check: (value) => crawlerPolicyErrors(value),
  },
  news_sitemap_hours: {
    label: "뉴스 사이트맵 기간 (OPT-01)",
    guide: "1~168 정수(시간) — 이 시간 안에 발행된 기사만 뉴스 사이트맵에 담깁니다 (초기값 48 [확인 필요: 검색 엔진 권장 기간]). 바꾸면 배포 없이 다음 요청부터",
    check: (value) => newsSitemapHoursErrors(value),
  },
  indexnow: {
    label: "IndexNow 전송 (OPT-01)",
    guide: '{ "enabled": false } — 지원 범위 실사(PRD_최종 §13 #18) 뒤에만 true. 꺼져 있거나 SITE_INDEXING=off이면 전송 요청이 0건입니다',
    check: (value) => indexnowErrors(value),
  },
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
  home_core_highlights: {
    label: "홈 핵심 메시지 강조 낱말 (HOME-01 · CORE-02)",
    guide: `["지방세", "부동산 세금", "재테크"] — 핵심 메시지 안의 낱말 1~${CORE_HIGHLIGHTS_MAX}개(글자 그대로), 나온 곳마다 오렌지로 칠합니다. 핵심 메시지를 먼저 바꾼 뒤 이 값을 맞추세요`,
    check: (value) => coreHighlightsErrors(value),
  },
  shortcut_order: {
    label: "바로가기 순서 (HOME-12 · 13)",
    guide: '["calc", "realestate_weekly", "brief_weekly"] — 세 키를 한 번씩, 순서만 바꿉니다. 상담 요청 바로가기은 순서에 넣지 않고 항상 마지막 강조 버튼입니다. 바꾸면 다음 요청부터',
    check: (value) => shortcutOrderErrors(value),
  },
  home_shortcut_copy: {
    label: "홈 바로가기 카드 한 줄 설명 (HOME-13)",
    guide: '{ "calc": "…", "expert_request": "…", "brief_weekly": "…", "realestate_weekly": "…" } — 칸마다 30자 이하 한 줄, 비워 두면 이름만 보입니다. 문구는 직접 쓰세요',
    check: (value) => shortcutCopyErrors(value),
  },
  campaign_utm_values: {
    label: "캠페인 태그 등록 값 (GROW-05)",
    guide: '{ "source": ["naver"], "medium": ["cpc"], "content": [] } — 소문자·숫자·-·_ 20자 이하, 칸마다 20개까지, other는 쓰지 않습니다. 목록 밖 태그 값은 other로 저장됩니다',
    check: (value) => utmRegistryErrors(value),
  },
  hero_media: {
    label: "히어로 배경 영상·그림 (홈 전체 화면 · 분야 허브 머리)",
    guide: '{ "home": { "video": "/media/hero/home.mp4", "videoMobile": "/media/hero/home-m.mp4", "poster": "/media/hero/home.avif", "posterMobile": "/media/hero/home-m.avif", "card": "/media/hero/home-card.avif" }, "tax": { … }, "realestate": { … }, "finance": { … }, "local": { … }, "aiLabel": true } — 파일은 /media/hero/ 안의 것만(바깥 주소 불가). 영상이 없으면 포스터 정지 그림, 둘 다 없으면 어두운 그라데이션. aiLabel은 화면 구석 "AI 생성 영상" 표시(기본 켜짐). 변환: node scripts/media/build-hero.mjs',
    check: (value) => heroMediaErrors(value),
  },
  company_info: {
    label: "바닥글 매체 정보·연락처·안내 문구 (HELP-05)",
    guide:
      '{ "registered_on": "2009-04-06", "registration_no": "…", "publisher_editor": "…", "youth_officer": "…", "corporation": "…", "address": "…", "phone": "…", "fax": "…", "copyright_notice": "{제호} 모든 콘텐츠…", "open_reporting_notice": "…" } - 바닥글에 이 순서로 나옵니다(제호는 코드의 명칭 설정에서 자동). 칸을 "" 로 비우면 그 줄이 숨습니다. 문구 안의 {제호}는 제호로 바뀝니다. 그 밖의 칸: name 상호 · representative 대표 · publisher 발행인 · editor 편집인 · directions 오시는 길. 칸마다 한 줄, 상한 이내. 바꾸면 다음 요청부터',
    check: (value) => companyInfoErrors(value),
  },
  column_opinion_notice: {
    label: "칼럼 의견 고지 문구 (TX-16)",
    guide: `따옴표로 감싼 문구 한 줄 — PO 감수본, ${OPINION_NOTICE_MAX}자 이하, 경력 연수 표기('50년' 등) 0. 비우면("") 새 칼럼 발행이 막힙니다. 바꾸면 배포 없이 다음 요청부터 칼럼 상세에 보입니다`,
    check: (value) => opinionNoticeErrors(value),
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
  // ── W4 4단계 지자체 허브 블록 대응 (docs/dev/W4_설계.md 2.2 · 2.8) — 공개 화면(region-hub-logic.ts parseLocalBlockFields)·DB 트리거(…40)와 같은 검사 ──
  local_block_fields: {
    label: "지자체 허브 블록과 편집 분야 대응 (REG1-02 · LG-08)",
    guide:
      '{ "local_tax": ["local_tax", "local_finance"], "realestate": ["realestate", "urban_policy"] } — ② 지방세·지방재정(local_tax)·③ 부동산·개발(realestate) 블록마다 담는 편집 분야(local_tax·local_finance·realestate·urban_policy) 1개 이상, 한 편집 분야는 한 블록에만. 블록 순서는 바꾸지 못합니다(코드 고정). 바꾸면 배포 없이 다음 요청부터',
    check: (value) => localBlockFieldsErrors(value),
  },
  // ── W4 5단계 공식 자료·공공누리 (docs/dev/W4_설계.md 2.1 · 2.2 · 12장 #13) — 발행 판정(gate.ts parseGateSettings)·출처 저장 API·DB 트리거(…41)와 같은 검사 ──
  official_source_types: {
    label: "공식 자료 종류 허용 목록 (REG1-07)",
    guide:
      '["ordinance", "notice", "budget_settlement", "local_tax_revenue", "realestate_transaction", "redevelopment"] — 조례·고시·예산/결산·지방세 세수·부동산 거래/공시·정비/개발. 영문 소문자·숫자·_ 2~40자, 1~50개. 교통·관광·음식점·생활 안내(transport·tourism·restaurant·living_guide)는 넣을 수 없습니다(코드 고정). 바꾸면 배포 없이 다음 저장·발행 판정부터',
    check: (value) => officialSourceTypesErrors(value),
  },
  kogl_usage: {
    label: "공공누리 이용 범위 (PR-07)",
    guide:
      '{ "photoTypes": ["kogl_1", "not_applicable"], "fullTextTypes": [] } — photoTypes 게시하는 사진 유형(kogl_1~3·not_applicable), fullTextTypes 원문 본문을 옮겨도 되는 유형(kogl_1~3). 1단계 권고는 사진 제1유형·자체 촬영만, 전재 0 — 제2·3유형은 법률 검토 기록 뒤에 엽니다. 제4유형·미표시(kogl_4·unmarked)는 넣을 수 없습니다(코드 고정)',
    check: (value) => koglUsageErrors(value),
  },
  // ── W4 6단계 시점 만료 기준 (docs/dev/W4_설계.md 2.2 · 12장 #23) — 만료 배치(DB source_expiry_scan)·DB 트리거(…42)와 같은 검사 ──
  official_source_expiry_days: {
    label: "공식 자료 시점 만료 기준 (REG1-13)",
    guide: `${EXPIRY_DAYS_MIN}~${EXPIRY_DAYS_MAX} 정수 하나 (초기값 ${EXPIRY_DAYS_DEFAULT}) — 공식 자료의 확인일(한국 날짜)부터 이 일수를 넘기면 다음 만료 배치가 검수 큐에 1건씩 올립니다. 기준 당일은 0건, 하루 넘긴 날 1건`,
    check: (value) => expiryDaysErrors(value),
  },
  // ── W4 8단계 오래된 통계 경고 기준 (docs/dev/W4_설계.md 2.2 · 2.3) — 발행 판정(gate.ts)·DB 트리거(…44 stale_statistics_settings_guard)와 같은 검사 ──
  stale_statistics_days: {
    label: "오래된 통계 경고 기준 (REG1-14)",
    guide: `${STALE_STATISTICS_DAYS_MIN}~${STALE_STATISTICS_DAYS_MAX} 정수 하나 (초기값 ${STALE_STATISTICS_DAYS_DEFAULT}) — 지역 기사에 쓴 통계 자료의 기준일이 오늘보다 이 일수를 넘겨 앞서면 편집 화면에 '오래된 통계' 경고가 뜹니다(발행은 막지 않음). 기준 당일은 경고 0, 하루 넘긴 날부터 경고`,
    check: (value) => staleStatisticsDaysErrors(value),
  },
  // ── W4 7단계 지역 기사 판정 책임자 (docs/dev/W4_설계.md 2.2 · 12장 #7) — 발행 판정(gate.ts)·DB 트리거(…43 regional_settings_guard)와 같은 검사 ──
  regional_judge_fields: {
    label: "지역 기사 판정 책임자가 있는 편집 분야 (REG1-17)",
    guide:
      '["local_tax", "realestate", "local_finance", "urban_policy"] — 판정 책임자(편집 책임자 역할)가 있는 편집 분야. 목록에서 뺀 분야의 지역 기사는 보류(held)이고 발행되지 않습니다. 0~4개, 같은 분야 두 번 0. 바꾸면 배포 없이 다음 발행 판정부터',
    check: (value) => regionalJudgeFieldsErrors(value),
  },
  // ── W4 10단계 검색 주제 사전 (docs/dev/W4_설계.md 2.2 · 2.9.1) — 검색 분류(search-classify.ts parseSearchTopics)·DB 트리거(…45 search_topics_guard)와 같은 검사 ──
  search_topics: {
    label: "검색 주제 사전 (REG-08 · REG1-11)",
    guide:
      '{ "acquisition_tax": { "label": "취득세", "aliases": [] }, …, "redevelopment": { "label": "재개발·재건축", "aliases": ["재개발", "재건축"] } } — 주제 6개(acquisition_tax·property_tax·inheritance_gift·realestate_transaction·redevelopment·local_finance)는 고정, 주제마다 화면 글자(1~20자)와 별칭(0~20개·1~20자). 띄어쓰기·기호를 뺀 글자가 2글자 이상이고, 한 낱말은 한 주제에만. 지역명과 함께 찾으면 그 지역 허브를 첫 결과로 그 지역 기사에서 주제를 찾습니다. 바꾸면 배포 없이 다음 검색부터',
    check: (value) => searchTopicsErrors(value),
  },
  // ── W4 11단계 지역 색인 임계값·시범 지역 (docs/dev/W4_설계.md 2.2 · PRD-01B 9.2) — DB 트리거(…46 region_index_settings_guard)와 같은 검사 ──
  region_index_threshold: {
    label: "지역 허브 색인 임계값 (REG-09 · REG1-12)",
    guide: `{ "reported_news": 1, "official_sources": 1 } — 자체 취재 기사 수·공식 원문/자료 수가 모두 이 값 이상인 지역 허브만 색인·사이트맵 원본(초기값 9.2 최소선). 정수 ${REGION_INDEX_LIMITS.min}~${REGION_INDEX_LIMITS.max}(0은 빈 지역이 색인되어 넣을 수 없습니다). 바꾸면 배포 없이 다음 렌더부터`,
    check: (value) => regionIndexThresholdErrors(value),
  },
  pilot_regions: {
    label: "시범 취재 지역 (PRD-01B 9.2)",
    guide: `["1100000000", "2600000000"] — 법정동코드 0~${REGION_INDEX_LIMITS.pilots}개(새로 넣는 코드는 오늘 유효한 행정구역). 최소선 판정 리포트(/admin/regions/report)가 지역마다 수와 최소선, 서로 다른 시·도 2곳 이상인지를 보입니다. /local 시·도 카드에 '시범 지역' 표시`,
    check: (value) => pilotRegionsErrors(value),
  },
  // ── W4 12단계 프로젝트 사업 유형·표준 단계 목록 (docs/dev/W4_설계.md 2.2 · 12장 #10) — DB 트리거(…47 project_settings_guard)와 같은 검사.
  //    두 키 사이(단계 목록의 유형은 project_types에 있어야)는 설정 API가 다른 키를 읽어 projectSettingsCrossErrors로, 쓰는 유형·단계 빼기는 DB가 거부(409) ──
  project_types: {
    label: "프로젝트 사업 유형 (PR-02)",
    guide: `{ "유형 키": { "label": "화면 글자" } } — 편집국 초안 + 세무·법률 감수 뒤 넣습니다. 유형 키는 영문 소문자·숫자·_ 2~40자, 글자 1~${PROJECT_LIMITS.label}자, ${PROJECT_LIMITS.types}개까지. 단계 목록(project_stage_lists)이 있는 유형·프로젝트가 쓰는 유형은 뺄 수 없습니다. 비면({}) 프로젝트를 만들 수 없습니다`,
    check: (value) => projectTypesErrors(value),
  },
  project_stage_lists: {
    label: "사업 유형별 표준 단계 목록 (PR-02)",
    guide: `{ "유형 키": [{ "key": "단계 키", "label": "화면 글자" }, …] } — 배열 순서 = 단계 순서(첫 단계 … 마지막 단계), 유형마다 ${PROJECT_LIMITS.stagesMin}~${PROJECT_LIMITS.stagesMax}단계, 키·글자 중복 0. 유형은 project_types에 먼저 넣습니다. 단계 기록이 쓰는 단계는 뺄 수 없고 글자·순서는 바꿀 수 있습니다(현재 단계는 다음 읽기부터 새 순서로)`,
    check: (value) => projectStageListsErrors(value),
  },
  // -- W4 23단계 상속·증여 안내 (docs/dev/W4_설계.md 2.2) - DB 트리거(...56 inheritance_gift_settings_guard)와 같은 검사. 목록 상황의 연결·고지는 설정 API가 상황 표를 읽어 한 번 더 본다 --
  inheritance_gift_notice: {
    label: "상속·증여 고지 문구 (FAM-01)",
    guide: `글자 한 줄(1~${IG_LIMITS.noticeMax}자, 숫자 0) - 세 경로(/realestate/inheritance-gift·/inheritance·/gift)에 한 번씩 나오는 감수본 고지. 바꾸면 배포 없이 다음 요청부터`,
    check: (value) => inheritanceNoticeErrors(value),
  },
  inheritance_gift_situations: {
    label: "상속·증여 상황 목록 (FAM-02)",
    guide: `["상황-slug", ...] - 상황 ${IG_LIMITS.situations}종까지. 목록의 상황은 부동산재테크 분야이고 외부 계산기 연결(안심 상속증여계산기)과 체크리스트 고지가 있어야 합니다. 빈 목록([])이면 상황 카드 줄이 없습니다`,
    check: (value) => inheritanceSituationsErrors(value),
  },
  // -- W5 개발금융 (docs/dev/W5_설계.md 2장) - DB 트리거(...60 finance_settings_guard)와 같은 검사 --
  finance_legal_review: {
    label: "부동산금융 법률 검토 기록 (DF-05)",
    guide: '{ "reviewer": "검토자", "reviewed_on": "YYYY-MM-DD", "conclusion": "approved" } - approved여야 기능 키 finance를 켤 수 있습니다. 비우려면 {}',
    check: (value) => legalReviewSettingErrors(value),
  },
  finance_blocked_domains: {
    label: "금융상품 차단 도메인 (DF-05)",
    guide: '["example.test", ...] - 금융상품 판매·가입 페이지 도메인(하위 도메인 포함). 개발금융 원문 주소가 여기에 있으면 저장되지 않습니다',
    check: (value) => blockedDomainsErrors(value),
  },
  finance_rebuttal_wait_days: {
    label: "반론 무응답 인정 기간 (DF-03)",
    guide: "숫자(일, 1~365) - 반론 요청일부터 이 기간이 지나야 답변 상태 무응답을 고를 수 있습니다. 법률 검토로 정합니다",
    check: (value) => rebuttalWaitErrors(value),
  },
  // -- W6 지자체뉴스 (docs/dev/W6_설계.md 2장) - DB 트리거(...63 digest_settings_guard · ...64 event_settings_guard)와 같은 모양 검사 --
  digest_sidos: {
    label: "금주 핫뉴스 시·도 (LG-01)",
    guide: '["1100000000", "2600000000"] - 금주 핫뉴스를 내는 시·도 법정동코드. 이 시·도만 주간 페이지를 발행할 수 있고 2곳 이상이어야 기능 키 weekly_digest를 켤 수 있습니다 (PRD_최종 13장 7번)',
    check: (value) => digestSidosErrors(value),
  },
  digest_summary_max_chars: {
    label: "핫뉴스 요약 길이 상한 (LG-02)",
    guide: "숫자(글자, 50~2000) - 이 길이를 넘는 요약은 저장되지 않습니다. 바꾸면 다음 저장부터 적용됩니다",
    check: (value) => digestSummaryMaxErrors(value),
  },
  digest_sources: {
    label: "핫뉴스 후보 출처 (LG-05)",
    guide: '[{ "id": "출처id", "name": "이름", "host": "도메인", "kind": "rss 또는 board", "basis": "허용 근거(약관·robots 확인 내용)", "checked_on": "YYYY-MM-DD" }] - 허용 근거와 확인일이 있는 출처의 후보만 받습니다',
    check: (value) => digestSourcesErrors(value),
  },
  event_url_blocked_domains: {
    label: "행사 공식 주소 차단 도메인 (LG-11)",
    guide: '["bit.ly", ...] - 단축 주소·개인 블로그·카페 서비스 도메인(하위 도메인 포함). 이 도메인의 주소는 행사 공식 URL로 저장되지 않습니다',
    check: (value) => eventBlockedDomainsErrors(value),
  },
  event_recheck: {
    label: "행사 재확인 기준 (REG1-05)",
    guide: '{ "days": 7, "hide_stale": false } - 마지막 확인일로부터 days일이 지나면 "일정 재확인 필요"를 표시하고, hide_stale이 true면 예정 목록에서도 숨깁니다. 바꾸면 다음 조회부터 적용됩니다',
    check: (value) => eventRecheckErrors(value),
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
