// SM 전문가 소개·연락 요청의 순수 규칙 (W7c, docs/dev/W7c_설계.md) - DB·네트워크·시계를 쓰지 않는다.
//  · 민감 입력(EXPL-20) - DB 함수 expert_sensitive와 같은 규칙. 구분 문자를 지운 뒤 숫자 9개 이상 연속이면 막는다
//  · 영업일 계산(EXPL-18) - 평일만 센다(공휴일 달력은 MVP 이후, 설계 12장). 한국 시간 기준
//  · 정렬(EXPL-04) - 분류 순서 -> 이름 가나다. 결제·광고·조회수·지역은 입력에 없다
//  · 요청 입력 검사(EXPL-14 · 15) - 칸별 오류 코드

// W10-i - calc_result(계산 결과 6번 칸 보조 링크) · campaign(캠페인 랜딩) · shortcut(바로가기) 출발점 추가. DB 제약은 마이그레이션 105
export const REQUEST_SOURCES = ["assistant", "experts", "article", "calc_result", "campaign", "shortcut"] as const;
export type RequestSource = (typeof REQUEST_SOURCES)[number];

/** 구분 문자(공백·점·하이픈·밑줄·슬래시 등)를 지운 뒤 숫자 9개 이상 이어지면 true - 주민등록번호·계좌번호·전화번호 모양, 전각 숫자 포함 */
export function sensitiveInput(text: string | null | undefined): boolean {
  if (!text) return false;
  const flat = text.normalize("NFKC").replace(/(\d)[\s.\-–—·_/]+(?=\d)/g, "$1");
  return /\d{9,}/.test(flat);
}

const KST_MS = 9 * 3600 * 1000;

/** 접수 시각 + N영업일(평일만 센다), 시각은 그대로 - 금요일 17:00 + 1영업일 = 월요일 17:00 */
export function addBusinessDays(from: Date, days: number): Date {
  let t = from.getTime();
  let left = days;
  while (left > 0) {
    t += 86400000;
    const dow = new Date(t + KST_MS).getUTCDay();
    if (dow !== 0 && dow !== 6) left -= 1;
  }
  return new Date(t);
}

export interface SortableProfile {
  name: string;
  category_codes: readonly string[];
}
/** 공개 정렬 - 분류 순서(프로필의 첫 분류) -> 이름 가나다 (같은 데이터면 같은 순서. 결제·광고·조회수·지역은 입력에 없다) */
export function sortProfiles<T extends SortableProfile>(rows: readonly T[], categoryOrder: ReadonlyMap<string, number>): T[] {
  const rank = (r: T) => Math.min(...r.category_codes.map((c) => categoryOrder.get(c) ?? 1e9), 1e9);
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "ko"));
}

/** 연락 링크 객체 배열 읽기 (DB는 json) */
export function parseContactLinks(value: unknown): { label: string; url: string }[] {
  if (!Array.isArray(value)) return [];
  const out: { label: string; url: string }[] = [];
  for (const v of value) {
    if (typeof v === "object" && v !== null && typeof (v as { label?: unknown }).label === "string" && typeof (v as { url?: unknown }).url === "string") {
      const { label, url } = v as { label: string; url: string };
      if (/^https?:\/\//i.test(url)) out.push({ label, url });
    }
  }
  return out;
}

// ─── 연락 요청 입력 (EXPL-13 · 15 · 20) ───────────────────────────────

export const REQUEST_CODES = {
  sent: "접수했습니다",
  bot: "제출할 수 없습니다 - 페이지를 새로 열어 다시 시도해 주세요",
  too_many: "시도가 너무 많습니다. 잠시 뒤 다시 시도하세요",
  category: "분야를 골라 주세요",
  summary: "요약을 적어 주세요",
  summary_long: "요약이 너무 깁니다 - 줄여 주세요",
  confirm: "요약 내용을 확인했다는 표시가 필요합니다",
  name: "이름을 적어 주세요 (40자 이하)",
  contact: "이메일 또는 전화번호 중 하나 이상을 적어 주세요",
  email: "이메일 형식을 확인해 주세요",
  phone: "전화번호 형식을 확인해 주세요",
  sensitive: "요약·희망 시간에 주민등록번호·계좌번호 같은 긴 숫자를 적을 수 없습니다 - 지워 주세요",
  consent: "필수 동의 항목에 모두 동의해 주세요",
  time_long: "희망 연락 시간은 100자 이하로 적어 주세요",
  unavailable: "지금은 접수할 수 없습니다 - 잠시 뒤 다시 시도해 주세요",
} as const;
export type RequestCode = keyof typeof REQUEST_CODES;

export interface RequestInput {
  source: RequestSource;
  category_code: string;
  summary: string;
  name: string;
  email: string | null;
  phone: string | null;
  preferred_time: string | null;
  deadline_urgent: boolean;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const flag = (v: unknown): boolean => v === true || v === "on" || v === "true" || v === "1";

export interface RequestContext {
  summaryMaxChars: number;
  /** 분야 선택지 - 공개 중인 전문가가 있는 분류 코드 */
  categories: readonly string[];
  /** 동의 항목 수 - 모두 체크되어야 한다 */
  consentItemCount: number;
}

/** 폼·JSON 입력 -> 검사된 값. 첫 오류 하나를 돌려준다 (칸 이름 포함) */
export function parseRequestInput(raw: Record<string, unknown>, ctx: RequestContext): { ok: true; value: RequestInput } | { ok: false; code: RequestCode; field: string } {
  const fail = (code: RequestCode, field: string) => ({ ok: false as const, code, field });
  const category = str(raw.category_code);
  if (!ctx.categories.includes(category)) return fail("category", "category_code");
  const summary = str(raw.summary);
  if (summary === "") return fail("summary", "summary");
  if (summary.length > ctx.summaryMaxChars) return fail("summary_long", "summary");
  const preferred = str(raw.preferred_time);
  if (preferred.length > 100) return fail("time_long", "preferred_time");
  if (sensitiveInput(summary) || sensitiveInput(preferred)) return fail("sensitive", "summary");
  const name = str(raw.name);
  if (name === "" || name.length > 40) return fail("name", "name");
  const email = str(raw.email) || null;
  const phone = str(raw.phone) || null;
  if (!email && !phone) return fail("contact", "email");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("email", "email");
  if (phone && !/^\d{8,12}$/.test(phone.replace(/\D/g, ""))) return fail("phone", "phone");
  if (!flag(raw.summary_confirmed)) return fail("confirm", "summary_confirmed");
  for (let i = 0; i < ctx.consentItemCount; i++) if (!flag(raw[`consent_${i}`])) return fail("consent", `consent_${i}`);
  const source = (REQUEST_SOURCES as readonly string[]).includes(str(raw.source)) ? (str(raw.source) as RequestSource) : "experts";
  return { ok: true, value: { source, category_code: category, summary, name, email, phone, preferred_time: preferred || null, deadline_urgent: flag(raw.deadline_urgent) } };
}
