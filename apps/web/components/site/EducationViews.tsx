import { pageJsonLd, toJsonLdScriptContent } from "@ltr/structured-data";
import { Chip, DarkButton, UiLink } from "@ltr/ui";
import {
  courseHref,
  courseStructured,
  EDU_HREF,
  MODE_LABEL,
  ORG_TYPE_LABEL,
  ORG_TYPES,
  QUOTE_CODES,
  QUOTE_HREF,
  seminarHref,
  seminarStructured,
  SEMINARS_HREF,
  TOPIC_LABEL,
  type QuoteCode,
} from "@/lib/education/rules";
import type { CourseCardView, CourseDetailView, EduListView, QuoteFormView, SeminarCardView, SeminarDetailView, SeminarListView } from "@/lib/server/public/education";
import { JsonLd } from "./JsonLd";
import { QuoteSentMeasure } from "./QuoteMeasure";
import { SiteSection, TEXT_LINK } from "./SiteSection";

// 교육원 강좌·세미나·위탁교육 견적 공개 화면 (W10-g - EDU-01·BIZ-06). 연결 방식(결정 #27) - 결제·수강 등록·수료증 요소 0.
// 신청은 교육원 사이트로 나가는 바깥 링크(새 창)뿐이고, 링크 점검이 오류로 판정하면 링크만 숨긴다. 일정은 출처 확인일과 함께 보여 준다.
// 구조화 데이터(Course·Event)는 화면에 그리는 같은 값에서 만든다 (OPT-02).

const MONO = "font-mono text-[13px] tracking-wide";
const INPUT = "mt-1 block w-full rounded-xl border border-navy-200 bg-white px-3 py-2 text-[16px] text-navy-900";
const LABEL = "block text-[15px] font-bold text-navy-900";

function ApplyLink({ href, label }: { href: string | null; label: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" data-part="edu-apply" className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
      {label}
    </a>
  );
}

function SessionList({ course }: { course: CourseCardView }) {
  const live = course.sessions.filter((s) => s.status === "scheduled");
  if (live.length === 0) return <p className="text-[15px] text-navy-700">안내할 일정이 아직 없습니다.</p>;
  return (
    <ul data-part="course-sessions" className="space-y-1 text-[15px] text-navy-800">
      {live.map((s) => (
        <li key={`${s.starts_on}-${s.mode}`} className={MONO}>
          {s.starts_on}
          {s.ends_on ? ` ~ ${s.ends_on}` : ""} · {MODE_LABEL[s.mode]}
          {s.location_name ? ` · ${s.location_name}` : ""}
        </li>
      ))}
    </ul>
  );
}

function SourceLine({ source, verifiedOn }: { source: string; verifiedOn: string }) {
  return (
    <p data-part="data-source" className={`${MONO} text-navy-600`}>
      출처 {source} · 정보 확인일 {verifiedOn}
    </p>
  );
}

export function EduListPage({ view }: { view: EduListView }) {
  return (
    <div data-ui="edu-page">
      <SiteSection id="edu-head" tone="ivory" first heading={{ eyebrow: "EDUCATION", title: "교육" }} data={{ "data-edu-part": "head" }}>
        <p className="mt-4 text-[16px] text-navy-800" data-part="edu-linked">
          신청과 결제는 각 강좌의 교육원 안내에서 진행합니다. 이 사이트는 일정을 안내하고 위탁교육 견적 요청을 받습니다.
        </p>
        <p className="mt-3 flex flex-wrap gap-4">
          {view.quoteOpen && (
            <UiLink href={QUOTE_HREF} data-part="quote-entry" className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
              위탁교육 견적 요청
            </UiLink>
          )}
          {view.seminarsOpen && (
            <UiLink href={SEMINARS_HREF} data-part="seminars-entry" className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
              세미나·웨비나 보기
            </UiLink>
          )}
        </p>
      </SiteSection>
      <SiteSection id="edu-courses" tone="ivory-dark" heading={{ eyebrow: "COURSES", title: "강좌" }} data={{ "data-edu-part": "courses" }}>
        {view.courses.length === 0 ? (
          <p data-part="edu-empty" className="mt-6 text-[16px] text-navy-700">
            지금 안내할 강좌가 없습니다.
          </p>
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2" data-part="course-list">
            {view.courses.map((c) => (
              <li key={c.id} data-course-slug={c.slug} className="rounded-2xl border border-navy-100 bg-white p-5">
                <h3 className="text-[20px] font-black text-navy-900">
                  <UiLink href={courseHref(c.slug)} className={TEXT_LINK}>
                    {c.title}
                  </UiLink>
                </h3>
                {c.audience && <p className="mt-1 text-[15px] text-navy-700">대상 {c.audience}</p>}
                <div className="mt-3">
                  <SessionList course={c} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  <ApplyLink href={c.applyHref} label="교육원에서 신청하기 ↗" />
                </div>
                <SourceLine source={c.provider_name} verifiedOn={c.sessionsVerifiedOn} />
              </li>
            ))}
          </ul>
        )}
      </SiteSection>
    </div>
  );
}

export function CourseDetailPage({ view }: { view: CourseDetailView }) {
  const c = view.course;
  if (!c) return null;
  const jsonLd = view.origin
    ? toJsonLdScriptContent(
        pageJsonLd({
          kind: "course",
          course: courseStructured(c, view.origin),
          breadcrumb: { items: [{ name: "홈", url: `${view.origin}/` }, { name: "교육", url: `${view.origin}${EDU_HREF}` }, { name: c.title, url: `${view.origin}${courseHref(c.slug)}` }] },
        }),
      )
    : null;
  return (
    <div data-ui="course-detail" data-course-slug={c.slug}>
      <JsonLd content={jsonLd} />
      <SiteSection id="course-head" tone="ivory" first heading={{ eyebrow: "COURSE", title: c.title }} data={{ "data-edu-part": "detail" }}>
        {c.summary && (
          <p data-part="course-summary" className="mt-4 text-[17px] text-navy-800">
            {c.summary}
          </p>
        )}
        {c.audience && (
          <p className="mt-2 text-[15px] text-navy-700" data-part="course-audience">
            대상 {c.audience}
          </p>
        )}
        <div className="mt-4">
          <SessionList course={c} />
        </div>
        <p className="mt-4 flex flex-wrap items-center gap-4">
          <ApplyLink href={c.applyHref} label="교육원에서 신청하기 ↗" />
          {view.quoteOpen && (
            <UiLink href={QUOTE_HREF} data-part="quote-entry" className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
              위탁교육 견적 요청
            </UiLink>
          )}
        </p>
        <p className="mt-2 text-[14px] text-navy-600" data-part="edu-linked">
          신청과 결제는 교육원 사이트에서 진행합니다.
        </p>
        <SourceLine source={c.provider_name} verifiedOn={c.sessionsVerifiedOn} />
      </SiteSection>
    </div>
  );
}

// ─── 세미나 ─────────────────────────────────────

function SeminarWhen({ s }: { s: SeminarCardView }) {
  const fmt = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });
  return (
    <p className={`${MONO} text-navy-700`}>
      {fmt(s.starts_at)} ~ {fmt(s.ends_at)} · {MODE_LABEL[s.mode]}
      {s.venue_name ? ` · ${s.venue_name}` : ""}
    </p>
  );
}

function SeminarBadges({ s }: { s: SeminarCardView }) {
  return (
    <p className="flex flex-wrap items-center gap-2">
      <Chip>{s.status}</Chip>
      <Chip>{TOPIC_LABEL[s.topic]}</Chip>
      {s.sponsored && <Chip>협찬</Chip>}
    </p>
  );
}

function SeminarItems({ items }: { items: SeminarCardView[] }) {
  return (
    <ul className="mt-6 grid gap-4 sm:grid-cols-2">
      {items.map((s) => (
        <li key={s.id} data-seminar-slug={s.slug} className="rounded-2xl border border-navy-100 bg-white p-5">
          <SeminarBadges s={s} />
          <h3 className="mt-2 text-[20px] font-black text-navy-900">
            <UiLink href={seminarHref(s.slug)} className={TEXT_LINK}>
              {s.title}
            </UiLink>
          </h3>
          <SeminarWhen s={s} />
        </li>
      ))}
    </ul>
  );
}

export function SeminarListPage({ view }: { view: SeminarListView }) {
  return (
    <div data-ui="seminar-list">
      <SiteSection id="seminar-head" tone="ivory" first heading={{ eyebrow: "SEMINAR", title: "세미나·웨비나" }} data={{ "data-edu-part": "seminars" }}>
        {view.upcoming.length === 0 ? (
          <p data-part="seminar-empty" className="mt-6 text-[16px] text-navy-700">
            지금 안내할 세미나가 없습니다.
          </p>
        ) : (
          <div data-part="seminar-upcoming">
            <SeminarItems items={view.upcoming} />
          </div>
        )}
      </SiteSection>
      {view.past.length > 0 && (
        <SiteSection id="seminar-past" tone="ivory-dark" heading={{ eyebrow: "PAST", title: "지난 세미나" }} data={{ "data-edu-part": "seminars-past" }}>
          <div data-part="seminar-past">
            <SeminarItems items={view.past} />
          </div>
        </SiteSection>
      )}
    </div>
  );
}

export function SeminarDetailPage({ view }: { view: SeminarDetailView }) {
  const s = view.seminar;
  if (!s) return null;
  // 변경 확인 중이면 생성기가 데이터를 내지 않는다 (LG-16) - 화면 배지와 같은 칸에서 나온다
  const jsonLd = view.origin
    ? toJsonLdScriptContent(
        pageJsonLd({
          kind: "event",
          event: seminarStructured(s, view.origin),
          breadcrumb: { items: [{ name: "홈", url: `${view.origin}/` }, { name: "교육", url: `${view.origin}${EDU_HREF}` }, { name: s.title, url: `${view.origin}${seminarHref(s.slug)}` }] },
        }),
      )
    : null;
  return (
    <div data-ui="seminar-detail" data-seminar-slug={s.slug}>
      <JsonLd content={jsonLd} />
      <SiteSection id="seminar-detail-head" tone="ivory" first heading={{ eyebrow: TOPIC_LABEL[s.topic], title: s.title }} data={{ "data-edu-part": "seminar" }}>
        <div className="mt-3">
          <SeminarBadges s={s} />
        </div>
        {s.summary && <p className="mt-4 text-[17px] text-navy-800">{s.summary}</p>}
        <div className="mt-3">
          <SeminarWhen s={s} />
        </div>
        <p className="mt-2 text-[15px] text-navy-800" data-part="seminar-organizer">
          주최 {s.organizer_name}
        </p>
        {s.sponsored && (
          <p className="mt-1 text-[15px] text-navy-800" data-part="seminar-sponsor">
            협찬 {s.sponsorName}
          </p>
        )}
        <p className="mt-3 text-[15px] text-navy-800 [overflow-wrap:anywhere]" data-part="speaker-disclosure">
          연사 이해관계 공개: {s.speakerDisclosure}
        </p>
        {s.status !== "종료" && s.status !== "취소" && (
          <p className="mt-4">
            <ApplyLink href={s.applyHref} label="신청 안내 보기 ↗" />
          </p>
        )}
        <SourceLine source={s.organizer_name} verifiedOn={s.verifiedOn} />
      </SiteSection>
    </div>
  );
}

// ─── 견적 요청 양식 ─────────────────────────────────────

export interface QuoteQuery {
  sent?: string;
  t?: string;
  e?: string;
  field?: string;
  withdrawn?: string;
}

export function QuotePageView({ view, query }: { view: QuoteFormView; query: QuoteQuery }) {
  const p = view.policy;
  if (!p) return null;
  const err = query.e && query.e in QUOTE_CODES ? QUOTE_CODES[query.e as QuoteCode] : null;
  return (
    <div data-ui="quote-request">
      {query.sent && <QuoteSentMeasure orgType={query.t ?? ""} />}
      <SiteSection id="quote-head" tone="ivory" first heading={{ eyebrow: "QUOTE", title: "위탁교육 견적 요청" }} data={{ "data-quote-part": "head" }}>
        <div className="mt-4 space-y-4">
          <ul data-part="quote-intro" className="list-disc space-y-1 pl-5 text-[15px] text-navy-800">
            {p.intro.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {query.sent && (
            <p data-part="quote-sent" role="status" className="rounded-2xl border border-navy-100 bg-white p-4 text-[16px] font-bold text-navy-900">
              접수했습니다. 접수 번호 <span className={MONO}>{query.sent}</span> - 첫 회신 목표는 {p.targetBusinessDays}영업일입니다. 철회하려면 아래에서 접수 번호와 연락처로 요청하세요.
            </p>
          )}
          {query.withdrawn && (
            <p data-part="withdraw-result" role="status" className="text-[15px] font-bold text-navy-900">
              {query.withdrawn === "ok" ? "철회하고 입력하신 개인 정보를 지웠습니다." : "접수 번호나 연락처가 맞지 않아 철회하지 못했습니다."}
            </p>
          )}
        </div>
      </SiteSection>
      <SiteSection id="quote-form-section" tone="ivory-dark" heading={{ eyebrow: "FORM", title: "요청 내용" }} data={{ "data-quote-part": "form" }}>
        <form method="post" action="/api/edu/quotes" data-form="training-quote" className="mt-6 space-y-5">
          <div className="hidden" aria-hidden="true">
            <label>
              웹사이트
              <input type="text" name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          {err && (
            <p data-part="quote-error" role="alert" className="text-[15px] font-bold text-navy-900">
              {err}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="tq-org" className={LABEL}>
                기관명
              </label>
              <input id="tq-org" name="org_name" type="text" required maxLength={80} autoComplete="organization" className={INPUT} />
            </div>
            <div>
              <label htmlFor="tq-type" className={LABEL}>
                기관 종류
              </label>
              <select id="tq-type" name="org_type" required className={INPUT}>
                <option value="">고르세요</option>
                {ORG_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ORG_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="tq-name" className={LABEL}>
                담당자 이름
              </label>
              <input id="tq-name" name="contact_name" type="text" required maxLength={40} autoComplete="name" className={INPUT} />
            </div>
            <div>
              <label htmlFor="tq-headcount" className={LABEL}>
                인원 (명)
              </label>
              <input id="tq-headcount" name="headcount" type="number" required min={1} max={100000} inputMode="numeric" className={INPUT} />
            </div>
            <div>
              <label htmlFor="tq-email" className={LABEL}>
                이메일
              </label>
              <input id="tq-email" name="email" type="email" autoComplete="email" className={INPUT} />
            </div>
            <div>
              <label htmlFor="tq-phone" className={LABEL}>
                전화번호
              </label>
              <input id="tq-phone" name="phone" type="tel" autoComplete="tel" className={INPUT} />
            </div>
          </div>
          <p className="text-[14px] text-navy-600">이메일과 전화번호 중 하나 이상을 적어 주세요.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="tq-course" className={LABEL}>
                과정
              </label>
              <select id="tq-course" name="course_id" className={INPUT}>
                <option value="">직접 적을게요</option>
                {view.courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="tq-course-text" className={LABEL}>
                과정 이름을 직접 적을 때
              </label>
              <input id="tq-course-text" name="course_text" type="text" maxLength={100} className={INPUT} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="tq-period" className={LABEL}>
                희망 시기 (선택)
              </label>
              <input id="tq-period" name="preferred_period" type="text" maxLength={100} className={INPUT} />
            </div>
          </div>
          <div>
            <label htmlFor="tq-message" className={LABEL}>
              문의 내용 (선택, {p.messageMaxChars}자 이하)
            </label>
            <textarea id="tq-message" name="message" rows={4} maxLength={p.messageMaxChars} className={INPUT} aria-describedby="tq-message-hint" />
            <p id="tq-message-hint" className="mt-1 text-[14px] text-navy-600">
              주민등록번호·계좌번호 같은 긴 숫자는 적지 마세요. 이 양식에는 결제 정보를 적는 칸이 없습니다.
            </p>
          </div>
          <fieldset className="space-y-2">
            <legend className={LABEL}>동의 (모두 필요합니다)</legend>
            {p.consentItems.map((item, i) => (
              <label key={item} className="flex items-start gap-2 text-[15px] text-navy-800">
                <input type="checkbox" name={`consent_${i}`} value="on" required className="mt-1 h-5 w-5" />
                <span>{item}</span>
              </label>
            ))}
            <p className={`${MONO} text-navy-600`}>동의 문구 버전 {p.consentVersion} · 보관 기간 {p.retentionDays}일</p>
          </fieldset>
          <DarkButton type="submit">견적 요청 보내기</DarkButton>
        </form>
      </SiteSection>
      <SiteSection id="quote-withdraw" tone="ivory" heading={{ eyebrow: "WITHDRAW", title: "요청 철회" }} data={{ "data-quote-part": "withdraw" }}>
        <form method="post" action="/api/edu/quotes/withdraw" data-form="training-quote-withdraw" className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="wd-receipt" className={LABEL}>
              접수 번호
            </label>
            <input id="wd-receipt" name="receipt" type="text" required maxLength={20} className={INPUT} />
          </div>
          <div>
            <label htmlFor="wd-contact" className={LABEL}>
              요청 때 적은 이메일 또는 전화번호
            </label>
            <input id="wd-contact" name="contact" type="text" required maxLength={120} className={INPUT} />
          </div>
          <div className="sm:col-span-2">
            <DarkButton type="submit">철회하고 개인 정보 지우기</DarkButton>
          </div>
        </form>
      </SiteSection>
    </div>
  );
}
