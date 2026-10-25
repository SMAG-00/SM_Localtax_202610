import "server-only";
import { absolute } from "../articles/mapping";
import { siteUrl } from "../env";
import { applyLinkOf, seminarScreenStatus, type CourseScreen, type EduMode, type SeminarRowStatus, type SeminarScreen, type SeminarTopic } from "@/lib/education/rules";
import { publicDb, rowsOf } from "./db";
import { readPublicSettings } from "./reads";

// 교육원 강좌·세미나·위탁교육 견적 양식 공개 읽기 (W10-g - EDU-01·BIZ-06, 연결 방식 - docs/dev/W10-g_설계.md).
// 공개 뷰 public_courses · public_course_sessions · public_seminars · public_training_quote_notice · public_quote_course_options 만 anon 키로 읽는다.
// 공개 조건(기능 키·게시 상태·출처 확인일·승인된 정책)은 뷰 한 곳에 있다. 결제·수강 등록·수료증은 이 사이트에 없다 - 신청은 교육원 사이트 링크로 나간다.

interface CourseRow {
  id: number | string;
  slug: string;
  title: string;
  summary: string;
  audience: string;
  provider_name: string;
  verified_on: string;
  apply_url: string | null;
  apply_status: string | null;
}
interface SessionRow {
  id: number | string;
  course_id: number | string;
  starts_on: string;
  ends_on: string | null;
  mode: EduMode;
  location_name: string | null;
  status: "scheduled" | "cancelled";
  verified_on: string;
}
const COURSE_COLUMNS = "id, slug, title, summary, audience, provider_name, verified_on, apply_url, apply_status";
const SESSION_COLUMNS = "id, course_id, starts_on, ends_on, mode, location_name, status, verified_on";

export interface CourseCardView extends CourseScreen {
  id: number;
  verifiedOn: string;
  applyHref: string | null;
  /** 가장 이른 진행 회차의 확인일 (회차가 없으면 강좌 확인일) */
  sessionsVerifiedOn: string;
}

function courseView(r: CourseRow, sessions: SessionRow[]): CourseCardView {
  const mine = sessions.filter((s) => Number(s.course_id) === Number(r.id)).sort((a, b) => a.starts_on.localeCompare(b.starts_on));
  return {
    id: Number(r.id),
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    audience: r.audience,
    provider_name: r.provider_name,
    verifiedOn: r.verified_on,
    applyHref: applyLinkOf(r.apply_url, r.apply_status)?.href ?? null,
    sessionsVerifiedOn: mine.map((s) => s.verified_on).sort().at(-1) ?? r.verified_on,
    sessions: mine.map((s) => ({ starts_on: s.starts_on, ends_on: s.ends_on, mode: s.mode, location_name: s.location_name, status: s.status })),
  };
}

export interface EduListView {
  open: boolean;
  courses: CourseCardView[];
  /** 견적 요청 양식 링크를 낼 수 있나 (기능 키 education_billing + 승인된 정책) */
  quoteOpen: boolean;
  seminarsOpen: boolean;
}

export async function getEduList(): Promise<EduListView> {
  const { features } = await readPublicSettings();
  if (!features.edu) return { open: false, courses: [], quoteOpen: false, seminarsOpen: false };
  const [courses, sessions, notice] = await Promise.all([
    rowsOf<CourseRow>(publicDb().from("public_courses").select(COURSE_COLUMNS).order("id").limit(200), "교육원 강좌"),
    rowsOf<SessionRow>(publicDb().from("public_course_sessions").select(SESSION_COLUMNS).order("starts_on").limit(1000), "교육원 강좌 회차"),
    features.education_billing ? rowsOf<{ consent_version: string }>(publicDb().from("public_training_quote_notice").select("consent_version"), "견적 요청 안내") : Promise.resolve([]),
  ]);
  return { open: true, courses: courses.map((c) => courseView(c, sessions)), quoteOpen: notice.length > 0, seminarsOpen: features.seminars };
}

export interface CourseDetailView {
  open: boolean;
  course: CourseCardView | null;
  origin: string | null;
  quoteOpen: boolean;
}

export async function getCourseDetail(slug: string): Promise<CourseDetailView> {
  const { features } = await readPublicSettings();
  const closed: CourseDetailView = { open: false, course: null, origin: null, quoteOpen: false };
  if (!features.edu) return closed;
  const rows = await rowsOf<CourseRow>(publicDb().from("public_courses").select(COURSE_COLUMNS).eq("slug", slug).limit(1), "교육원 강좌 상세");
  const row = rows[0];
  if (!row) return { ...closed, open: true };
  const [sessions, notice] = await Promise.all([
    rowsOf<SessionRow>(publicDb().from("public_course_sessions").select(SESSION_COLUMNS).eq("course_id", Number(row.id)).order("starts_on"), "교육원 강좌 회차"),
    features.education_billing ? rowsOf<{ consent_version: string }>(publicDb().from("public_training_quote_notice").select("consent_version"), "견적 요청 안내") : Promise.resolve([]),
  ]);
  const base = siteUrl();
  return { open: true, course: courseView(row, sessions), origin: base ? absolute(base, "").replace(/\/+$/, "") : null, quoteOpen: notice.length > 0 };
}

// ─── 세미나 ─────────────────────────────────────

interface SeminarRow {
  id: number | string;
  slug: string;
  title: string;
  summary: string;
  topic: SeminarTopic;
  starts_at: string;
  ends_at: string;
  mode: EduMode;
  venue_name: string | null;
  organizer_name: string;
  sponsored: boolean;
  sponsor_name: string | null;
  speaker_disclosure: string;
  status: SeminarRowStatus;
  verified_on: string;
  apply_url: string | null;
  apply_status: string | null;
}
const SEMINAR_COLUMNS = "id, slug, title, summary, topic, starts_at, ends_at, mode, venue_name, organizer_name, sponsored, sponsor_name, speaker_disclosure, status, verified_on, apply_url, apply_status";

export interface SeminarCardView extends SeminarScreen {
  id: number;
  topic: SeminarTopic;
  mode: EduMode;
  sponsorName: string | null;
  speakerDisclosure: string;
  verifiedOn: string;
  applyHref: string | null;
}

function seminarView(r: SeminarRow, now: Date): SeminarCardView {
  const apply = applyLinkOf(r.apply_url, r.apply_status);
  return {
    id: Number(r.id),
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    topic: r.topic,
    mode: r.mode,
    starts_at: r.starts_at,
    ends_at: r.ends_at,
    venue_name: r.venue_name,
    organizer_name: r.organizer_name,
    sponsored: r.sponsored,
    sponsorName: r.sponsor_name,
    speakerDisclosure: r.speaker_disclosure,
    status: seminarScreenStatus(r, now),
    verifiedOn: r.verified_on,
    apply_url: apply?.href ?? null,
    applyHref: apply?.href ?? null,
  };
}

export interface SeminarListView {
  open: boolean;
  upcoming: SeminarCardView[];
  past: SeminarCardView[];
}

export async function getSeminarList(now: Date = new Date()): Promise<SeminarListView> {
  const { features } = await readPublicSettings();
  if (!features.edu || !features.seminars) return { open: false, upcoming: [], past: [] };
  const rows = await rowsOf<SeminarRow>(publicDb().from("public_seminars").select(SEMINAR_COLUMNS).order("starts_at").limit(300), "세미나");
  const all = rows.map((r) => seminarView(r, now));
  return { open: true, upcoming: all.filter((s) => s.status !== "종료"), past: all.filter((s) => s.status === "종료").reverse() };
}

export interface SeminarDetailView {
  open: boolean;
  seminar: SeminarCardView | null;
  origin: string | null;
}

export async function getSeminarDetail(slug: string, now: Date = new Date()): Promise<SeminarDetailView> {
  const { features } = await readPublicSettings();
  const closed: SeminarDetailView = { open: false, seminar: null, origin: null };
  if (!features.edu || !features.seminars) return closed;
  const rows = await rowsOf<SeminarRow>(publicDb().from("public_seminars").select(SEMINAR_COLUMNS).eq("slug", slug).limit(1), "세미나 상세");
  const row = rows[0];
  if (!row) return { ...closed, open: true };
  const base = siteUrl();
  return { open: true, seminar: seminarView(row, now), origin: base ? absolute(base, "").replace(/\/+$/, "") : null };
}

// ─── 견적 요청 양식 ─────────────────────────────────────

export interface QuoteFormView {
  open: boolean;
  policy: { consentVersion: string; intro: string[]; consentItems: string[]; retentionDays: number; targetBusinessDays: number; messageMaxChars: number } | null;
  courses: { id: number; title: string }[];
}

export async function getQuoteForm(): Promise<QuoteFormView> {
  const closed: QuoteFormView = { open: false, policy: null, courses: [] };
  const { features } = await readPublicSettings();
  if (!features.edu || !features.education_billing) return closed;
  const [notice, courses] = await Promise.all([
    rowsOf<{ consent_version: string; intro: string[]; consent_items: string[]; retention_days: number; target_business_days: number; message_max_chars: number }>(
      publicDb().from("public_training_quote_notice").select("consent_version, intro, consent_items, retention_days, target_business_days, message_max_chars"),
      "견적 요청 안내",
    ),
    rowsOf<{ id: number | string; title: string }>(publicDb().from("public_quote_course_options").select("id, title").order("id"), "견적 과정 선택지"),
  ]);
  const p = notice[0];
  if (!p) return closed;
  return {
    open: true,
    policy: { consentVersion: p.consent_version, intro: p.intro, consentItems: p.consent_items, retentionDays: p.retention_days, targetBusinessDays: p.target_business_days, messageMaxChars: p.message_max_chars },
    courses: courses.map((c) => ({ id: Number(c.id), title: c.title })),
  };
}
