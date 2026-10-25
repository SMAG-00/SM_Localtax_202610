// 교육원 강좌·세미나·위탁교육 견적의 순수 규칙 (W10-g - PRD-02 BIZ-06, docs/dev/W10-g_설계.md). DB·네트워크·시계를 쓰지 않는다.
//  · 연결 방식(결정 #27) - 결제·수강 등록·수료증은 이 사이트에 없다. 이 모듈에도 그런 이름이 없다(경계 시험 boundary.test.ts가 지킨다)
//  · 견적 입력 검사 - DB 트리거 training_quotes_guard와 같은 규칙을 한 번 더 본다
//  · 세미나 화면 상태 - 시계는 인자로 받는다
//  · 구조화 데이터 입력 - 화면에 그리는 바로 그 값에서 만든다 (OPT-02)
import type { CourseView, EventScreenStatus, EventView } from "@ltr/structured-data";
import { sensitiveInput } from "@/lib/experts/logic";

export const EDU_HREF = "/edu";
export const QUOTE_HREF = "/edu/quote";
export const SEMINARS_HREF = "/edu/seminars";
export const courseHref = (slug: string) => `/edu/${slug}`;
export const seminarHref = (slug: string) => `/edu/seminars/${slug}`;

export const ORG_TYPES = ["public", "corporate", "association", "other"] as const;
export type OrgType = (typeof ORG_TYPES)[number];
export const ORG_TYPE_LABEL: Readonly<Record<OrgType, string>> = { public: "지자체·공공기관", corporate: "기업", association: "협회·단체", other: "그 밖" };

export const MODE_LABEL = { onsite: "현장", online: "온라인", blended: "혼합" } as const;
export type EduMode = keyof typeof MODE_LABEL;
export const TOPIC_LABEL = { amendment: "개정세법", dev_finance: "개발금융" } as const;
export type SeminarTopic = keyof typeof TOPIC_LABEL;

export const QUOTE_STATUSES = ["received", "contacted", "closed"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const QUOTE_STATUS_LABEL: Readonly<Record<QuoteStatus, string>> = { received: "접수", contacted: "회신함", closed: "종결" };
export const CLOSE_REASONS = ["quoted", "declined", "unreachable", "withdrawn"] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];
export const CLOSE_REASON_LABEL: Readonly<Record<CloseReason, string>> = { quoted: "견적 전달", declined: "진행 안 함", unreachable: "연락 불가", withdrawn: "이용자 철회" };

// ─── 견적 요청 입력 ─────────────────────────────────────

export const QUOTE_CODES = {
  sent: "접수했습니다",
  bot: "제출할 수 없습니다 - 페이지를 새로 열어 다시 시도해 주세요",
  too_many: "시도가 너무 많습니다. 잠시 뒤 다시 시도하세요",
  org_name: "기관명을 적어 주세요 (80자 이하)",
  org_type: "기관 종류를 골라 주세요",
  contact_name: "담당자 이름을 적어 주세요 (40자 이하)",
  contact: "이메일 또는 전화번호 중 하나 이상을 적어 주세요",
  email: "이메일 형식을 확인해 주세요",
  phone: "전화번호 형식을 확인해 주세요",
  course: "과정을 고르거나 과정 이름을 적어 주세요",
  headcount: "인원은 1명 이상의 정수로 적어 주세요",
  period_long: "희망 시기는 100자 이하로 적어 주세요",
  message_long: "문의 내용이 너무 깁니다 - 줄여 주세요",
  sensitive: "문의 내용·희망 시기·과정에 주민등록번호·계좌번호 같은 긴 숫자를 적을 수 없습니다 - 지워 주세요",
  consent: "필수 동의 항목에 모두 동의해 주세요",
  unavailable: "지금은 접수할 수 없습니다 - 잠시 뒤 다시 시도해 주세요",
} as const;
export type QuoteCode = keyof typeof QUOTE_CODES;

export interface QuoteInput {
  org_name: string;
  org_type: OrgType;
  contact_name: string;
  email: string | null;
  phone: string | null;
  course_id: number | null;
  course_text: string | null;
  headcount: number;
  preferred_period: string | null;
  message: string | null;
}

export interface QuoteContext {
  messageMaxChars: number;
  /** 견적을 받는 공개 과정 번호 */
  courseIds: readonly number[];
  consentItemCount: number;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const flag = (v: unknown): boolean => v === true || v === "on" || v === "true" || v === "1";

/** 폼·JSON 입력 -> 검사된 값. 첫 오류 하나를 돌려준다 (칸 이름 포함). 결제 칸을 읽지 않는다 - 알 수 없는 칸은 버린다 */
export function parseQuoteInput(raw: Record<string, unknown>, ctx: QuoteContext): { ok: true; value: QuoteInput } | { ok: false; code: QuoteCode; field: string } {
  const fail = (code: QuoteCode, field: string) => ({ ok: false as const, code, field });
  const orgName = str(raw.org_name);
  if (orgName === "" || orgName.length > 80) return fail("org_name", "org_name");
  const orgType = str(raw.org_type);
  if (!(ORG_TYPES as readonly string[]).includes(orgType)) return fail("org_type", "org_type");
  const contactName = str(raw.contact_name);
  if (contactName === "" || contactName.length > 40) return fail("contact_name", "contact_name");
  const email = str(raw.email) || null;
  const phone = str(raw.phone) || null;
  if (!email && !phone) return fail("contact", "email");
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("email", "email");
  if (phone && !/^\d{8,12}$/.test(phone.replace(/\D/g, ""))) return fail("phone", "phone");
  const courseRaw = str(raw.course_id);
  const courseId = /^\d+$/.test(courseRaw) ? Number(courseRaw) : null;
  if (courseRaw !== "" && (courseId === null || !ctx.courseIds.includes(courseId))) return fail("course", "course_id");
  const courseText = str(raw.course_text) || null;
  if (courseId === null && !courseText) return fail("course", "course_id");
  if (courseText && courseText.length > 100) return fail("course", "course_text");
  const headcountRaw = str(raw.headcount);
  const headcount = /^\d{1,6}$/.test(headcountRaw) ? Number(headcountRaw) : 0;
  if (headcount < 1 || headcount > 100000) return fail("headcount", "headcount");
  const period = str(raw.preferred_period);
  if (period.length > 100) return fail("period_long", "preferred_period");
  const message = str(raw.message) || null;
  if (message && message.length > ctx.messageMaxChars) return fail("message_long", "message");
  if (sensitiveInput(message) || sensitiveInput(period) || sensitiveInput(courseText)) return fail("sensitive", "message");
  for (let i = 0; i < ctx.consentItemCount; i++) if (!flag(raw[`consent_${i}`])) return fail("consent", `consent_${i}`);
  return {
    ok: true,
    value: {
      org_name: orgName,
      org_type: orgType as OrgType,
      contact_name: contactName,
      email,
      phone,
      course_id: courseId,
      course_text: courseId === null ? courseText : null,
      headcount,
      preferred_period: period || null,
      message,
    },
  };
}

// ─── 신청 링크 ─────────────────────────────────────

/** 교육원 신청 링크 - 점검에서 오류(broken)로 판정됐거나 주소가 없으면 숨긴다 (BIZ-06 링크 점검 대상). 숨겨도 화면의 일정·안내는 그대로 */
export function applyLinkOf(url: string | null, status: string | null): { href: string } | null {
  if (!url || status === "broken") return null;
  return /^https?:\/\/\S+$/i.test(url) ? { href: url } : null;
}

// ─── 세미나 화면 상태 ─────────────────────────────────────

export type SeminarRowStatus = "published" | "cancelled" | "changing";

/** 화면 배지 상태 - 취소·변경 확인 중은 저장된 상태가 먼저, 나머지는 시각으로 예정·진행·종료 */
export function seminarScreenStatus(row: { status: SeminarRowStatus; starts_at: string; ends_at: string }, now: Date): EventScreenStatus {
  if (row.status === "cancelled") return "취소";
  if (row.status === "changing") return "변경 확인 중";
  const t = now.getTime();
  if (t < new Date(row.starts_at).getTime()) return "예정";
  if (t <= new Date(row.ends_at).getTime()) return "진행";
  return "종료";
}

// ─── 구조화 데이터 입력 (화면에 그리는 값 그대로) ─────────────────────────────────────

export interface CourseScreen {
  slug: string;
  title: string;
  summary: string;
  audience: string;
  provider_name: string;
  sessions: { starts_on: string; ends_on: string | null; mode: EduMode; location_name: string | null; status: "scheduled" | "cancelled" }[];
}

/** 강좌 화면 -> Course 입력. 취소된 회차는 일정으로 내지 않는다. 수강료는 내지 않는다(결제는 교육원 사이트) */
export function courseStructured(c: CourseScreen, origin: string): CourseView {
  const sessions = c.sessions.filter((s) => s.status === "scheduled");
  return {
    url: `${origin}${courseHref(c.slug)}`,
    name: c.title,
    description: c.summary || c.title,
    provider: { name: c.provider_name },
    ...(c.audience ? { audience: c.audience } : {}),
    ...(sessions.length
      ? { sessions: sessions.map((s) => ({ startDate: s.starts_on, ...(s.ends_on ? { endDate: s.ends_on } : {}), mode: s.mode, ...(s.location_name ? { location: { name: s.location_name } } : {}) })) }
      : {}),
  };
}

export interface SeminarScreen {
  slug: string;
  title: string;
  summary: string;
  starts_at: string;
  ends_at: string;
  venue_name: string | null;
  organizer_name: string;
  sponsored: boolean;
  status: EventScreenStatus;
  apply_url: string | null;
}

/** 세미나 화면 -> Event 입력. 상태는 화면 배지와 같은 칸(status). 협찬이면 제목에 '광고' 표기가 붙는다(생성기). 온라인만이라 장소가 없으면 '온라인' */
export function seminarStructured(s: SeminarScreen, origin: string): EventView {
  return {
    url: `${origin}${seminarHref(s.slug)}`,
    name: s.title,
    status: s.status,
    sponsored: s.sponsored,
    startDate: s.starts_at,
    endDate: s.ends_at,
    venue: { name: s.venue_name ?? "온라인" },
    organizer: { name: s.organizer_name },
    officialUrl: s.apply_url ?? `${origin}${seminarHref(s.slug)}`,
    ...(s.summary ? { description: s.summary } : {}),
  };
}
