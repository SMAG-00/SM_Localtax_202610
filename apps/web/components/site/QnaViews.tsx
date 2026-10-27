import { Chip, UiLink } from "@ltr/ui";
import type { QnaCriteriaView, QnaExpertView, QnaLinks, QnaListView, QnaNotice, QnaQuestionView } from "@/lib/server/public/qna";
import { AcceptButton, AnswerForm, QuestionForm, ReportButton, StripLink } from "./QnaForms";
import { SiteSection, TEXT_LINK } from "./SiteSection";

// 지방세 고민 해결 라운지 W13-g 공개 화면 (QNA-01·02·04·06·08). 규칙은 lib/qna/logic.ts · lib/server/public/qna.ts.
//  · 중립성 고지는 목록·작성·상세 3개 화면에 PO·법률 검토본 그대로 (개발이 문구를 쓰지 않는다), 답변 하단 고지도 설정값
//  · 상담 신청·매칭·결제 버튼 0, 연락처·사무소 렌더 0. 전문가 연결은 1단계 두 링크(SM 전문가 보기 · 연락 요청)뿐이고 질문 원문·작성자는 넘기지 않는다
//  · 배지: '전문가 답변'은 유효한 SM 소속 연결만, '공무원 인증'은 별도 표시, 일반 회원 의견은 구분 표시. 별점·후기 0

const PII_WARNING = "이름·연락처·주소·계좌번호 등 개인정보를 적지 않았음을 확인합니다.";

function Notice({ notice }: { notice: QnaNotice }) {
  return (
    <aside data-part="qna-notice" data-notice-version={notice.version} aria-label="라운지 고지" className="rounded-2xl border border-navy-100 bg-white p-5 text-[15px] text-navy-800">
      <p className="[overflow-wrap:anywhere]">{notice.text}</p>
    </aside>
  );
}

function ExpertLinks({ links }: { links: QnaLinks }) {
  return (
    <p data-part="expert-links" className="flex flex-wrap gap-4">
      <UiLink href={links.expertsHref} className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
        SM 전문가 보기
      </UiLink>
      {links.requestHref && (
        <UiLink href={links.requestHref} className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
          SM 전문가에게 연락 받기
        </UiLink>
      )}
    </p>
  );
}

const dateOf = (iso: string) => iso.slice(0, 10);

export function QnaListPageView({ view }: { view: QnaListView }) {
  if (!view.notice) return null;
  return (
    <div data-ui="qna-page">
      <SiteSection id="qna-head" tone="ivory" first heading={{ eyebrow: "LOUNGE", title: "지방세 고민 해결 라운지" }} data={{ "data-qna-part": "head" }}>
        <div className="mt-4 space-y-4">
          <Notice notice={view.notice} />
          <ExpertLinks links={view.links} />
          <p>
            <UiLink href="/qna/new" data-part="qna-new" className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
              질문하기
            </UiLink>
          </p>
        </div>
      </SiteSection>
      {view.strip.length > 0 && (
        <SiteSection id="qna-strip" tone="ivory-dark" heading={{ eyebrow: "ACTIVE", title: "활동 전문가" }} data={{ "data-qna-part": "strip" }}>
          <p className="mt-2 text-[14px] text-navy-700">
            활동 기준 노출입니다(최근 활동 기록만 반영).{" "}
            <UiLink href="/qna/criteria" className={TEXT_LINK}>
              기준 보기
            </UiLink>
          </p>
          <ul data-testid="qna-strip" className="mt-4 grid gap-3 sm:grid-cols-3">
            {view.strip.map((s, i) => (
              <li key={s.expertProfileId} data-expert-id={s.expertProfileId} className="rounded-2xl border border-navy-100 bg-white p-4">
                <StripLink href={`/qna/experts/${s.expertProfileId}`} rank={i + 1}>
                  {s.name}
                </StripLink>
                <p className="mt-1 text-[14px] text-navy-700">
                  채택 {s.acceptedCount}건 · 답변 {s.answeredCount}건
                </p>
              </li>
            ))}
          </ul>
        </SiteSection>
      )}
      <SiteSection id="qna-list" tone="ivory" heading={{ eyebrow: "QUESTIONS", title: `질문 ${view.questions.length}건` }} data={{ "data-qna-part": "list" }}>
        {view.questions.length === 0 ? (
          <p data-part="empty" className="mt-6 text-[16px] text-navy-700">
            아직 공개된 질문이 없습니다.
          </p>
        ) : (
          <ul data-testid="qna-list" className="mt-6 space-y-3">
            {view.questions.map((q) => (
              <li key={q.id} className="rounded-2xl border border-navy-100 bg-white p-4">
                <p className="flex flex-wrap items-center gap-2">
                  <Chip>{q.taxType}</Chip>
                  {q.resolved && <Chip>채택 완료</Chip>}
                </p>
                <h3 className="mt-2 text-[18px] font-black text-navy-900">
                  <UiLink href={`/qna/${q.id}`} className={TEXT_LINK}>
                    {q.title}
                  </UiLink>
                </h3>
                <p className="mt-1 text-[14px] text-navy-700">
                  {dateOf(q.createdAt)} · 답변 {q.answerCount}건
                </p>
              </li>
            ))}
          </ul>
        )}
      </SiteSection>
    </div>
  );
}

export function QnaNewPageView({ notice, links, taxType }: { notice: QnaNotice; links: QnaLinks; taxType: string }) {
  return (
    <div data-ui="qna-new">
      <SiteSection id="qna-new" tone="ivory" first heading={{ eyebrow: "ASK", title: "질문하기" }} data={{ "data-qna-part": "new" }}>
        <div className="mt-4 space-y-4">
          <Notice notice={notice} />
          <ExpertLinks links={links} />
          <QuestionForm warning={PII_WARNING} defaultTax={taxType} />
        </div>
      </SiteSection>
    </div>
  );
}

function AnswerBadge({ a }: { a: QnaQuestionView["answers"][number] }) {
  if (a.kind === "expert")
    return (
      <span data-part="expert-badge" className="inline-flex items-center rounded-full bg-navy-900 px-2.5 py-0.5 text-[13px] font-bold text-white">
        전문가 답변
      </span>
    );
  if (a.kind === "gov")
    return (
      <span data-part="gov-badge" className="inline-flex items-center rounded-full border border-navy-300 px-2.5 py-0.5 text-[13px] font-bold text-navy-900">
        공무원 인증
      </span>
    );
  return (
    <span data-part="member-label" className="inline-flex items-center rounded-full bg-navy-50 px-2.5 py-0.5 text-[13px] text-navy-700">
      일반 회원 의견
    </span>
  );
}

export function QnaQuestionPageView({ view }: { view: QnaQuestionView }) {
  const q = view.question;
  if (!view.notice || !q) return null;
  return (
    <div data-ui="qna-question" data-question-id={q.id}>
      <SiteSection id="qna-question" tone="ivory" first data={{ "data-qna-part": "question" }}>
        <div className="space-y-4">
          <Notice notice={view.notice} />
          <p className="flex flex-wrap items-center gap-2">
            <Chip>{q.taxType}</Chip>
            {q.resolved && <Chip>채택 완료</Chip>}
          </p>
          <h1 className="text-[28px] leading-tight font-black tracking-tight text-navy-900 [overflow-wrap:anywhere]">{q.title}</h1>
          <p className="text-[14px] text-navy-700">{dateOf(q.createdAt)}</p>
          <p className="text-[16px] whitespace-pre-wrap text-navy-800 [overflow-wrap:anywhere]">{q.body}</p>
          <ReportButton targetType="question" targetId={q.id} />
          <ExpertLinks links={view.links} />
        </div>
      </SiteSection>
      <SiteSection id="qna-answers" tone="ivory-dark" heading={{ eyebrow: "ANSWERS", title: `답변 ${view.answers.length}건` }} data={{ "data-qna-part": "answers" }}>
        <ul data-testid="qna-answers" className="mt-6 space-y-4">
          {view.answers.map((a) => (
            <li key={a.id} data-answer-id={a.id} data-answer-kind={a.kind} className="rounded-2xl border border-navy-100 bg-white p-5">
              <p className="flex flex-wrap items-center gap-2">
                <AnswerBadge a={a} />
                {a.kind === "expert" && a.expertName && a.expertProfileId && (
                  <UiLink href={`/qna/experts/${a.expertProfileId}`} className={TEXT_LINK}>
                    {a.expertName}
                  </UiLink>
                )}
                {a.accepted && <Chip>채택된 답변</Chip>}
              </p>
              <p className="mt-3 text-[16px] whitespace-pre-wrap text-navy-800 [overflow-wrap:anywhere]">{a.body}</p>
              <p data-part="answer-footer" className="mt-3 text-[14px] text-navy-700">
                {view.notice?.answerFooter}
              </p>
              <p className="mt-2 flex flex-wrap items-center gap-3">
                <span className="text-[14px] text-navy-700">{dateOf(a.createdAt)}</span>
                {!q.resolved && <AcceptButton questionId={q.id} answerId={a.id} byExpert={a.kind === "expert"} />}
                <ReportButton targetType="answer" targetId={a.id} />
              </p>
            </li>
          ))}
        </ul>
        <AnswerForm questionId={q.id} />
      </SiteSection>
    </div>
  );
}

const CRITERIA_LABEL: Record<string, string> = { window_days: "집계 기간(일)", min_accepted: "최소 채택 답변 수", min_rate: "최소 채택률", strip_size: "띠에 보이는 인원" };

export function QnaCriteriaPageView({ view }: { view: QnaCriteriaView }) {
  if (!view.notice) return null;
  const entries = Object.entries(view.criteria);
  return (
    <div data-ui="qna-criteria">
      <SiteSection id="qna-criteria" tone="ivory" first heading={{ eyebrow: "CRITERIA", title: "활동 전문가 노출 기준" }} data={{ "data-qna-part": "criteria" }}>
        <div className="mt-4 space-y-4">
          <Notice notice={view.notice} />
          {entries.length === 0 ? (
            <p data-part="empty" className="text-[16px] text-navy-700">
              기준이 아직 정해지지 않아 활동 전문가 띠는 표시되지 않습니다.
            </p>
          ) : (
            <dl data-testid="qna-criteria" className="grid gap-2">
              {entries.map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <dt className="font-bold text-navy-900">{CRITERIA_LABEL[k] ?? k}</dt>
                  <dd className="text-navy-800">{String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
          <p data-part="tie-rule" className="text-[15px] text-navy-800">
            순서: 기간 안 채택 답변 수 많은 순 → 채택률 높은 순 → 같으면 등록 번호 순. 제재 중이거나 기간 안에 제재가 시작된 전문가, 배지가 만료·해제된 전문가는 제외됩니다. 결제·구독·광고는 순서에 반영되지 않습니다.
          </p>
        </div>
      </SiteSection>
    </div>
  );
}

export function QnaExpertPageView({ view }: { view: QnaExpertView }) {
  const e = view.expert;
  if (!view.notice || !e) return null;
  return (
    <div data-ui="qna-expert" data-expert-id={e.id}>
      <SiteSection id="qna-expert" tone="ivory" first data={{ "data-qna-part": "expert" }}>
        <div className="space-y-4">
          <Notice notice={view.notice} />
          <p>
            <span data-part="expert-badge" className="inline-flex items-center rounded-full bg-navy-900 px-2.5 py-0.5 text-[13px] font-bold text-white">
              SM(선명) 소속 전문가
            </span>
          </p>
          <h1 className="text-[28px] font-black text-navy-900">{e.name}</h1>
          <p className="text-[16px] text-navy-800" data-part="stats">
            최근 기간 답변 {e.answeredCount}건 · 채택 {e.acceptedCount}건 · 채택률 {Math.round(e.acceptanceRate * 100)}%
          </p>
          {e.profileHref && (
            <p>
              <UiLink href={e.profileHref} data-part="profile-link" className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
                SM 전문가 소개 프로필 보기
              </UiLink>
            </p>
          )}
          <ExpertLinks links={view.links} />
        </div>
      </SiteSection>
    </div>
  );
}
