import { pageJsonLd, toJsonLdScriptContent } from "@ltr/structured-data";
import { Chip, DarkButton, UiLink } from "@ltr/ui";
import { REQUEST_CODES, type RequestCode } from "@/lib/experts/logic";
import type { ExpertCardView, ExpertListView, ExpertProfileView, ExpertRequestFormView } from "@/lib/server/public/experts";
import { SiteSection, TEXT_LINK } from "./SiteSection";

// SM 전문가 소개·연락 요청 W7c 공개 화면 (EXPL-01·02·04·05·07·09·12·13·15·20). 규칙은 lib/experts/logic.ts · lib/server/public/experts.ts.
// 모든 카드·프로필 머리에 'SM(선명) 소속' 표시, 네 화면 모두 고지 1개(법률 검토본 - 승인 전에는 화면 자체가 열리지 않는다). 별점·후기·순위·상담 건수·예약·결제 요소 0.
// 연락은 이용자가 사무소로 직접 한다(링크 새 창, 식별 쿼리 0). 등재 신청·가입 링크 0 (EXPL-07).

const MONO = "font-mono text-[13px] tracking-wide";
const INPUT = "mt-1 block w-full rounded-xl border border-navy-200 bg-white px-3 py-2 text-[16px] text-navy-900";
const LABEL = "block text-[15px] font-bold text-navy-900";

export const SM_BADGE = "SM(선명) 소속";

function Notice({ notice }: { notice: { version: string; text: string } }) {
  return (
    <aside data-part="expert-notice" data-notice-version={notice.version} aria-label="전문가 소개 고지" className="rounded-2xl border border-navy-100 bg-white p-5 text-[15px] text-navy-800">
      <p className="[overflow-wrap:anywhere]">{notice.text}</p>
    </aside>
  );
}

function External({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" data-part="expert-contact" className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
      {children}
    </a>
  );
}

export function ExpertCard({ card }: { card: ExpertCardView }) {
  return (
    <article data-expert-card="true" data-expert-slug={card.slug} className="flex h-full flex-col rounded-2xl border border-navy-100 bg-white p-5">
      <p className="flex flex-wrap items-center gap-2">
        <span data-part="sm-badge" className="inline-flex items-center rounded-full bg-navy-900 px-2.5 py-0.5 text-[13px] font-bold text-white">
          {SM_BADGE}
        </span>
        {card.categories.map((c) => (
          <Chip key={c.code}>{c.name}</Chip>
        ))}
      </p>
      <h3 className="mt-3 text-[19px] font-black text-navy-900">
        <UiLink href={card.href} className={TEXT_LINK}>
          {card.name}
        </UiLink>
      </h3>
      <p className="mt-1 text-[15px] text-navy-700">{card.officeName}</p>
      {card.specialties.length > 0 && (
        <p className="mt-2 flex flex-wrap gap-1.5">
          {card.specialties.map((s) => (
            <Chip key={s}>{s}</Chip>
          ))}
        </p>
      )}
    </article>
  );
}

export function ExpertsListView({ view }: { view: ExpertListView }) {
  return (
    <div data-ui="experts-page">
      <SiteSection id="experts-head" tone="ivory" first heading={{ eyebrow: "EXPERTS", title: "SM(선명) 소속 전문가" }} data={{ "data-experts-part": "head" }}>
        <div className="mt-4 space-y-4">
          {view.notice && <Notice notice={view.notice} />}
          {view.requestsOpen && (
            <p>
              <UiLink href="/experts/request" data-part="request-entry" className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
                SM 전문가에게 연락 요청하기
              </UiLink>
            </p>
          )}
          <nav aria-label="분류" data-part="category-filter" className="flex flex-wrap gap-2">
            <UiLink href="/experts" data-active={view.selected ? "false" : "true"} className={TEXT_LINK}>
              전체
            </UiLink>
            {view.categories.map((c) => (
              <UiLink key={c.code} href={`/experts?category=${encodeURIComponent(c.code)}`} data-category={c.code} data-active={view.selected?.code === c.code ? "true" : "false"} className={TEXT_LINK}>
                {c.name} ({c.count})
              </UiLink>
            ))}
          </nav>
          {view.badCategory && (
            <p data-part="filter-notice" className="text-[15px] text-navy-700">
              알 수 없는 분류라 전체를 보여 드립니다.
            </p>
          )}
        </div>
      </SiteSection>
      <SiteSection id="experts-list" tone="ivory-dark" heading={{ eyebrow: "LIST", title: view.selected ? `${view.selected.name} ${view.profiles.length}명` : `전문가 ${view.profiles.length}명` }} data={{ "data-experts-part": "list" }}>
        {view.profiles.length === 0 ? (
          <p data-part="empty" className="mt-6 text-[16px] text-navy-700">
            조건에 맞는 전문가가 아직 없습니다. {view.selected && <UiLink href="/experts" className={TEXT_LINK}>필터 해제</UiLink>}
          </p>
        ) : (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2" data-testid="expert-list">
            {view.profiles.map((p) => (
              <li key={p.slug}>
                <ExpertCard card={p} />
              </li>
            ))}
          </ul>
        )}
      </SiteSection>
    </div>
  );
}

export function ExpertProfilePageView({ view }: { view: ExpertProfileView }) {
  const p = view.profile;
  if (!p) return null;
  const photo = p.photo && /^(https?:\/\/|\/)/.test(p.photo.path) ? p.photo : null;
  const jsonLd = view.view ? toJsonLdScriptContent(pageJsonLd({ kind: "person", person: view.view })) : null;
  return (
    <div data-ui="expert-profile" data-expert-slug={p.slug}>
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />}
      <SiteSection id="expert-head" tone="ivory" first data={{ "data-expert-part": "head" }}>
        <p className="flex flex-wrap items-center gap-2">
          <span data-part="sm-badge" className="inline-flex items-center rounded-full bg-navy-900 px-2.5 py-0.5 text-[13px] font-bold text-white">
            {SM_BADGE}
          </span>
          {p.categories.map((c) => (
            <Chip key={c.code}>{c.name}</Chip>
          ))}
        </p>
        <h1 className="mt-3 text-[32px] leading-tight font-black tracking-tight text-navy-900">{p.name}</h1>
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element -- 권리 확인된 사진 (출처 표기 포함), 크기는 CSS로 고정
          <img src={photo.path} alt={photo.alt ?? `${p.name} 사진`} width={160} height={160} className="mt-4 h-40 w-40 rounded-2xl object-cover" />
        )}
        {photo?.credit && <p className={`${MONO} mt-1 text-navy-600`}>사진 출처 {photo.credit}</p>}
        <p className="mt-3 text-[17px] text-navy-800">{p.officeName}</p>
        {p.regions.length > 0 && <p className="mt-1 text-[15px] text-navy-700">활동 지역 {p.regions.join(", ")}</p>}
        {p.specialties.length > 0 && (
          <p className="mt-3 flex flex-wrap gap-1.5">
            {p.specialties.map((s) => (
              <Chip key={s}>{s}</Chip>
            ))}
          </p>
        )}
        {p.intro && <p className="mt-4 text-[16px] text-navy-800 [overflow-wrap:anywhere]">{p.intro}</p>}
        {p.interests && (
          <p data-part="interests" className="mt-3 text-[15px] text-navy-800 [overflow-wrap:anywhere]">
            이해관계: {p.interests}
          </p>
        )}
      </SiteSection>
      <SiteSection id="expert-contact" tone="ivory-dark" heading={{ eyebrow: "CONTACT", title: "연락" }} data={{ "data-expert-part": "contact" }}>
        <div className="mt-4 space-y-3">
          {p.contactLinks.length > 0 ? (
            <ul className="space-y-1">
              {p.contactLinks.map((l) => (
                <li key={l.url}>
                  <External href={l.url}>{`${l.label} (새 창)`}</External>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[15px] text-navy-700">공개된 연락 링크가 없습니다.</p>
          )}
          {view.requestsOpen && (
            <p>
              <UiLink href="/experts/request" data-part="request-entry" className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
                SM 전문가에게 연락 요청하기
              </UiLink>
            </p>
          )}
          {view.notice && <Notice notice={view.notice} />}
        </div>
      </SiteSection>
    </div>
  );
}

export interface RequestQuery {
  sent?: string;
  e?: string;
  field?: string;
  withdrawn?: string;
}

export function ExpertRequestPageView({ view, query, source }: { view: ExpertRequestFormView; query: RequestQuery; source: string }) {
  const p = view.policy;
  if (!p) return null;
  const err = query.e && query.e in REQUEST_CODES ? REQUEST_CODES[query.e as RequestCode] : null;
  return (
    <div data-ui="expert-request">
      <SiteSection id="request-head" tone="ivory" first heading={{ eyebrow: "REQUEST", title: "SM 전문가 연락 요청" }} data={{ "data-request-part": "head" }}>
        <div className="mt-4 space-y-4">
          {view.notice && <Notice notice={view.notice} />}
          <ul data-part="request-intro" className="list-disc space-y-1 pl-5 text-[15px] text-navy-800">
            {p.intro.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {query.sent && (
            <p data-part="request-sent" role="status" className="rounded-2xl border border-navy-100 bg-white p-4 text-[16px] font-bold text-navy-900">
              접수했습니다. 접수 번호 <span className={MONO}>{query.sent}</span> - 첫 연락 목표는 {p.targetBusinessDays}영업일입니다. 철회하려면 아래에서 접수 번호와 연락처로 요청하세요.
            </p>
          )}
          {query.withdrawn && (
            <p data-part="withdraw-result" role="status" className="text-[15px] font-bold text-navy-900">
              {query.withdrawn === "ok" ? "철회하고 입력하신 개인 정보를 지웠습니다." : "접수 번호나 연락처가 맞지 않아 철회하지 못했습니다."}
            </p>
          )}
        </div>
      </SiteSection>
      <SiteSection id="request-form-section" tone="ivory-dark" heading={{ eyebrow: "FORM", title: "요청 내용" }} data={{ "data-request-part": "form" }}>
        {view.options.length === 0 ? (
          <p data-part="no-options" className="mt-6 text-[16px] text-navy-700">
            지금 연락 요청을 받을 수 있는 분야가 없습니다.
          </p>
        ) : (
          <form method="post" action="/api/experts/requests" data-form="expert-request" className="mt-6 space-y-5">
            <input type="hidden" name="source" value={source} />
            <div className="hidden" aria-hidden="true">
              <label>
                웹사이트
                <input type="text" name="website" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            {err && (
              <p data-part="request-error" role="alert" className="text-[15px] font-bold text-navy-900">
                {err}
              </p>
            )}
            <div>
              <label htmlFor="rq-category" className={LABEL}>
                분야
              </label>
              <select id="rq-category" name="category_code" required className={INPUT}>
                <option value="">고르세요</option>
                {view.options.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="rq-summary" className={LABEL}>
                궁금한 점 요약 ({p.summaryMaxChars}자 이하)
              </label>
              <textarea id="rq-summary" name="summary" required rows={5} maxLength={p.summaryMaxChars} className={INPUT} aria-describedby="rq-summary-hint" />
              <p id="rq-summary-hint" className="mt-1 text-[14px] text-navy-600">
                주민등록번호·계좌번호 같은 긴 숫자는 적지 마세요. 세무 결론이나 금액은 전문가가 연락해서 안내합니다.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="rq-name" className={LABEL}>
                  이름
                </label>
                <input id="rq-name" name="name" type="text" required maxLength={40} autoComplete="name" className={INPUT} />
              </div>
              <div>
                <label htmlFor="rq-time" className={LABEL}>
                  희망 연락 시간 (선택)
                </label>
                <input id="rq-time" name="preferred_time" type="text" maxLength={100} className={INPUT} />
              </div>
              <div>
                <label htmlFor="rq-email" className={LABEL}>
                  이메일
                </label>
                <input id="rq-email" name="email" type="email" autoComplete="email" className={INPUT} />
              </div>
              <div>
                <label htmlFor="rq-phone" className={LABEL}>
                  전화번호
                </label>
                <input id="rq-phone" name="phone" type="tel" autoComplete="tel" className={INPUT} />
              </div>
            </div>
            <p className="text-[14px] text-navy-600">이메일과 전화번호 중 하나 이상을 적어 주세요.</p>
            <label className="flex items-start gap-2 text-[15px] text-navy-800">
              <input type="checkbox" name="deadline_urgent" value="on" className="mt-1 h-5 w-5" />
              <span>신고·납부·불복 기한이 임박했습니다 (연락을 기다리지 말고 공식 창구에 먼저 문의하세요)</span>
            </label>
            <fieldset className="space-y-2">
              <legend className={LABEL}>확인과 동의 (모두 필요합니다)</legend>
              <label className="flex items-start gap-2 text-[15px] text-navy-800">
                <input type="checkbox" name="summary_confirmed" value="on" required className="mt-1 h-5 w-5" />
                <span>위 요약 내용을 확인했습니다</span>
              </label>
              {p.consentItems.map((item, i) => (
                <label key={item} className="flex items-start gap-2 text-[15px] text-navy-800">
                  <input type="checkbox" name={`consent_${i}`} value="on" required className="mt-1 h-5 w-5" />
                  <span>{item}</span>
                </label>
              ))}
              <p className={`${MONO} text-navy-600`}>동의 문구 버전 {p.consentVersion} · 보관 기간 {p.retentionDays}일</p>
            </fieldset>
            <DarkButton type="submit">요청 보내기</DarkButton>
          </form>
        )}
      </SiteSection>
      <SiteSection id="request-withdraw" tone="ivory" heading={{ eyebrow: "WITHDRAW", title: "요청 철회" }} data={{ "data-request-part": "withdraw" }}>
        <form method="post" action="/api/experts/requests/withdraw" data-form="expert-withdraw" className="mt-6 grid gap-4 sm:grid-cols-2">
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
