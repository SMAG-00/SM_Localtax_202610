// 브리핑 검사기 8종 (W10-e - BRIEF-03 · BRIEF-04 · BRIEF-02 광고 표기). 순수 함수 - 입출력·AI 없음.
// 차단(block)이 하나라도 있으면 승인할 수 없고, 경고(warn)는 검수자 확인 표시 뒤 발행된다.
//   1 source_match   번호·일자·링크가 원문(발췌·항목에 붙은 근거 값)과 같다 - 근거 없는 번호·일자·주소는 차단
//   2 credential     인증키 모양 노출 0 - 차단
//   3 forbidden_word 금지어 + "감수"(감수 체계 확정 전) - 차단
//   4 disclaimer     면책·무단수집 거부 안내·광고 안내 주소 칸이 채워져 있고, 광고성 호의 제목에 "(광고)" - 차단
//   5 link_alive     본문 링크가 모두 열림으로 확인됨 - 안 열리거나 확인 전이면 차단
//   6 stage_label    개정 항목에 진행 단계 이름, 확정 전이면 "확정 아님" - 차단
//   7 verbatim_run   원문과 15단어 이상 이어서 같음 - 경고
//   8 empty_corner   빈 코너에 빈 코너 표기 - 경고
import { findCredentials } from "../pipelines/credentials.ts";

export const CHECK_IDS = ["source_match", "credential", "forbidden_word", "disclaimer", "link_alive", "stage_label", "verbatim_run", "empty_corner"] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export const CHECK_LABELS: Record<CheckId, string> = {
  source_match: "번호·일자·링크 원문 일치",
  credential: "인증키 노출",
  forbidden_word: "금지어",
  disclaimer: "면책·표기",
  link_alive: "링크 동작",
  stage_label: "진행 단계 표기",
  verbatim_run: "원문 15단어 이상 일치",
  empty_corner: "빈 코너 표기",
};

export const BLOCKING_CHECKS: readonly CheckId[] = ["source_match", "credential", "forbidden_word", "disclaimer", "link_alive", "stage_label"];
/** 원문과 이만큼 이어서 같으면 경고 (BRIEF-03) */
export const VERBATIM_WORDS = 15;
const MAX_EXCERPT_WORDS = 30_000;
/** 감수 체계 확정 전에는 문서 어디에도 쓰지 않는 낱말 (BRIEF-04) */
export const REVIEW_WORD = "감수";
/** 조세심판 결정례 주문이 기각일 때 시작하는 글 - 결론 표지(기각/취소·경정)와 주문의 일치 검사에 쓴다 */
export const REJECT_PREFIX = "심판청구를 기각";

export type ItemBadge = "live" | "plan" | "expc" | "win" | "lose";

export interface BriefItem {
  id: string;
  text: string;
  origin: "human" | "ai" | "system";
  reviewed: boolean;
  sourceUrl?: string;
  /** 원문에 있는 번호 (공포번호 등) */
  sourceNo?: string;
  /** 원문 일자 YYYY-MM-DD */
  sourceDate?: string;
  links?: string[];
  amendment?: { stageLabel: string; confirmed: boolean };
  /** 항목 표지 - 시행(live)·시행 전(plan)·해석(expc)·결정례 취소·경정(win)·기각(lose). win·lose는 excerpts["<id>#order"] 주문과 대조 */
  badge?: ItemBadge;
  badgeLabel?: string;
  tags?: string[];
  /** 출처 줄 조각(번호·공포·시행·해석일·청구번호 등) - 검사기 1번이 원문과 대조 */
  meta?: string[];
}

export interface BriefCorner {
  key: string;
  title: string;
  items: BriefItem[];
  emptyNote?: string;
}

export interface BriefDoc {
  title: string;
  /** 메일 제목 - 광고성 호는 "(광고)"로 시작해야 한다 */
  subject: string;
  hasAd: boolean;
  corners: BriefCorner[];
  footer: { disclaimer: string; noHarvestNotice: string; adInfoUrl: string };
  /** 항목 번호 -> 원문 발췌 (비공개 칸) */
  excerpts: Record<string, string>;
  /** 주소 -> 확인 결과 */
  linkStatus: Record<string, "ok" | "broken" | "unchecked">;
  forbiddenWords: readonly string[];
  /** 감수 체계 확정 뒤에만 true (settings.brief_publish_policy.review_label_allowed) */
  reviewLabelAllowed: boolean;
  /** 없으면 경고할 코너 키 (SM 필수 섹션 검사) - 생략하면 검사 안 함 */
  requiredCorners?: readonly string[];
}

export interface Finding {
  check: CheckId;
  level: "block" | "warn";
  where: string;
  message: string;
}

export interface CheckReport {
  findings: Finding[];
  blocking: number;
  warnings: number;
  byCheck: Record<CheckId, number>;
}

export const AD_PREFIX = "(광고)";

const URL_RE = /https?:\/\/[^\s)>\]"']+/g;
const NO_RE = /제\s?\d[\d-]*\s?호/g;
const DATE_RE = /(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/g;

const trimUrl = (u: string) => u.replace(/[.,;:]+$/, "");
const compact = (s: string) => s.replace(/\s+/g, "");
const ymd = (m: RegExpMatchArray) => `${m[1]}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`;
const dates = (s: string): string[] => [...s.matchAll(DATE_RE)].map(ymd);

/** 글 속 주소·번호·일자가 근거 글(원문 발췌·근거 값)에 없으면 설명 목록을 돌려준다 - 검사기 1번과 AI 초안 검증이 같이 쓴다 */
export function unsupportedTokens(text: string, ground: string): string[] {
  const out: string[] = [];
  const groundCompact = compact(ground);
  const groundDates = new Set(dates(ground));
  const groundUrls = new Set([...ground.matchAll(URL_RE)].map((m) => trimUrl(m[0])));
  for (const m of text.matchAll(URL_RE)) {
    if (!groundUrls.has(trimUrl(m[0]))) out.push(`주소가 원문과 다릅니다: ${trimUrl(m[0])}`);
  }
  for (const m of text.matchAll(NO_RE)) {
    if (!groundCompact.includes(compact(m[0]))) out.push(`번호가 원문에 없습니다: ${m[0]}`);
  }
  for (const m of text.matchAll(DATE_RE)) {
    if (!groundDates.has(ymd(m))) out.push(`일자가 원문에 없습니다: ${m[0]}`);
  }
  return out;
}

function wordsOf(s: string): string[] {
  return s.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
}

/** 두 단어열에서 이어서 같은 가장 긴 길이 */
export function longestCommonRun(a: readonly string[], b: readonly string[]): number {
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = (prev[j - 1] as number) + 1;
        if ((cur[j] as number) > best) best = cur[j] as number;
      }
    }
    prev = cur;
  }
  return best;
}

function allTexts(doc: BriefDoc): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [
    { where: "제목", text: doc.title },
    { where: "메일 제목", text: doc.subject },
    { where: "하단 면책", text: doc.footer.disclaimer },
    { where: "하단 무단수집 거부 안내", text: doc.footer.noHarvestNotice },
  ];
  for (const c of doc.corners) {
    out.push({ where: `코너 ${c.key} 이름`, text: c.title });
    if (c.emptyNote) out.push({ where: `코너 ${c.key} 빈 코너 표기`, text: c.emptyNote });
    for (const it of c.items) out.push({ where: `코너 ${c.key} 항목 ${it.id}`, text: it.text });
  }
  return out;
}

export function runBriefChecks(doc: BriefDoc): CheckReport {
  const findings: Finding[] = [];
  const add = (check: CheckId, where: string, message: string) =>
    findings.push({ check, level: BLOCKING_CHECKS.includes(check) ? "block" : "warn", where, message });

  // 1 번호·일자·링크 원문 일치
  for (const c of doc.corners) {
    for (const it of c.items) {
      const ground = [doc.excerpts[it.id] ?? "", it.sourceNo ?? "", it.sourceDate ?? "", it.sourceUrl ?? ""].join("\n");
      for (const message of unsupportedTokens([it.text, ...(it.meta ?? [])].join("\n"), ground)) add("source_match", `코너 ${c.key} 항목 ${it.id}`, message);
    }
  }

  // 2 인증키 노출
  for (const t of allTexts(doc)) {
    if (findCredentials(t.text).length > 0) add("credential", t.where, "인증키 모양의 값이 들어 있습니다");
  }
  for (const c of doc.corners) for (const it of c.items) for (const l of [it.sourceUrl ?? "", ...(it.links ?? [])]) {
    if (l && findCredentials(l).length > 0) add("credential", `코너 ${c.key} 항목 ${it.id}`, "링크에 인증키 모양의 값이 들어 있습니다");
  }

  // 2-1 API 상세 링크(DRF)·인증키 파라미터(OC=) 노출 (SM 검사)
  const API_LEAK = /\/DRF\/|[?&]OC=/;
  for (const c of doc.corners) for (const it of c.items) {
    for (const l of [it.sourceUrl ?? "", ...(it.links ?? []), it.text]) {
      if (API_LEAK.test(l) && findCredentials(l).length === 0) add("credential", `코너 ${c.key} 항목 ${it.id}`, "API 상세 링크(DRF)나 인증키 파라미터(OC=)가 들어 있습니다");
    }
  }

  // 3 금지어 + 감수
  const words = [...doc.forbiddenWords.filter((w) => w.trim() !== ""), ...(doc.reviewLabelAllowed ? [] : [REVIEW_WORD])];
  for (const t of allTexts(doc)) {
    for (const w of words) if (t.text.toLowerCase().includes(w.toLowerCase())) add("forbidden_word", t.where, `금지어 "${w}"`);
  }

  // 4 면책·표기
  if (doc.footer.disclaimer.trim() === "") add("disclaimer", "하단", "면책 문구 칸이 비어 있습니다");
  if (doc.footer.noHarvestNotice.trim() === "") add("disclaimer", "하단", "이메일 무단수집 거부 안내 문구 칸이 비어 있습니다");
  if (!/^https?:\/\/\S+$|^\/\S*$/.test(doc.footer.adInfoUrl.trim())) add("disclaimer", "하단", "광고·제휴 안내 링크 주소가 비어 있거나 잘못되었습니다");
  if (doc.hasAd && !doc.subject.trimStart().startsWith(AD_PREFIX)) add("disclaimer", "메일 제목", `광고성 정보가 있는 호의 제목은 "${AD_PREFIX}"로 시작해야 합니다`);

  // 5 링크 동작
  for (const c of doc.corners) for (const it of c.items) {
    for (const l of [it.sourceUrl, ...(it.links ?? [])]) {
      if (l !== undefined && (l.trim() === "" || l.trim() === "#")) add("link_alive", `코너 ${c.key} 항목 ${it.id}`, "빈 링크입니다");
    }
  }
  const seen = new Set<string>();
  for (const c of doc.corners) for (const it of c.items) {
    const urls = [it.sourceUrl, ...(it.links ?? []), ...[...it.text.matchAll(URL_RE)].map((m) => trimUrl(m[0]))].filter((u): u is string => !!u);
    for (const u of urls) {
      if (seen.has(u)) continue;
      seen.add(u);
      const st = doc.linkStatus[u] ?? "unchecked";
      if (st === "broken") add("link_alive", `코너 ${c.key} 항목 ${it.id}`, `링크가 열리지 않습니다: ${u}`);
      else if (st === "unchecked") add("link_alive", `코너 ${c.key} 항목 ${it.id}`, `링크를 아직 확인하지 않았습니다: ${u}`);
    }
  }

  // 6 진행 단계 표기
  for (const c of doc.corners) for (const it of c.items) {
    if (!it.amendment) continue;
    const where = `코너 ${c.key} 항목 ${it.id}`;
    if (!it.text.includes(it.amendment.stageLabel)) add("stage_label", where, `진행 단계 이름 "${it.amendment.stageLabel}"이 없습니다`);
    if (!it.amendment.confirmed && !it.text.includes("확정 아님")) add("stage_label", where, "확정 전 개정안인데 '확정 아님' 표기가 없습니다");
  }

  // 6-1 결정례 결론 표지와 주문 일치 (SM: 기각 표기인데 주문이 기각이 아니면 차단)
  for (const c of doc.corners) for (const it of c.items) {
    if (it.badge !== "win" && it.badge !== "lose") continue;
    const where = `코너 ${c.key} 항목 ${it.id}`;
    const order = (doc.excerpts[`${it.id}#order`] ?? "").trim();
    if (order === "") add("stage_label", where, "결정례 주문 원문이 없어 결론 표지를 대조할 수 없습니다");
    else if (it.badge === "lose" && !order.startsWith(REJECT_PREFIX)) add("stage_label", where, "기각 표기인데 주문이 기각이 아닙니다");
    else if (it.badge === "win" && order.startsWith(REJECT_PREFIX)) add("stage_label", where, "취소·경정 표기인데 주문이 기각입니다");
  }

  // 7 원문 15단어 이상 일치 (경고)
  for (const c of doc.corners) for (const it of c.items) {
    const ex = doc.excerpts[it.id];
    if (!ex) continue;
    const run = longestCommonRun(wordsOf(it.text), wordsOf(ex).slice(0, MAX_EXCERPT_WORDS));
    if (run >= VERBATIM_WORDS) add("verbatim_run", `코너 ${c.key} 항목 ${it.id}`, `원문과 ${run}단어가 이어서 같습니다`);
  }

  // 8 빈 코너 표기 (경고)
  for (const c of doc.corners) {
    if (c.items.length === 0 && (c.emptyNote ?? "").trim() === "") add("empty_corner", `코너 ${c.key}`, "비어 있는 코너에 빈 코너 표기가 없습니다");
  }

  for (const key of doc.requiredCorners ?? []) {
    if (!doc.corners.some((c) => c.key === key)) add("empty_corner", `코너 ${key}`, "필수 코너가 없습니다");
  }

  const byCheck = Object.fromEntries(CHECK_IDS.map((id) => [id, findings.filter((f) => f.check === id).length])) as Record<CheckId, number>;
  return { findings, blocking: findings.filter((f) => f.level === "block").length, warnings: findings.filter((f) => f.level === "warn").length, byCheck };
}

/** 메일 제목 - 광고성 호는 "(광고)"를 앞에 붙인다 (이미 붙어 있으면 그대로) */
export function issueSubject(title: string, hasAd: boolean): string {
  const t = title.trim();
  return hasAd && !t.startsWith(AD_PREFIX) ? `${AD_PREFIX} ${t}` : t;
}
