import { UiLink } from "../link";
import { DateText, MONO, TEXT_LINK } from "./parts";
import { hasEmail, isBlank } from "./format";

export type PersonRef = { name: string };

type Common = {
  /** 기자·필자 — 인물 페이지 `/people/[slug]`로 잇는다. 이메일 칸은 없다 (평문 이메일 0) */
  author: { name: string; slug: string | null; beat: string; bio?: string };
  editor?: PersonRef;
  /** 최초 발행 시각 (ISO) */
  publishedAt: string;
  /** 실질 수정 시각 (ISO) — 오탈자 수정은 넣지 않는다 (OPT-07) */
  modifiedAt?: string;
  /** 정정·반론 창구 — 비우면 기본 경로, null이면 링크 0 (정책 페이지 공개 승인 전 — HELP-05) */
  correctionHref?: string | null;
  /** 편집 원칙 — 비우면 기본 경로, null이면 링크 0 */
  editorialPolicyHref?: string | null;
};

export type ReporterBlockProps = Common &
  (
    | { kind: "report" | "guide" }
    /** 해설 — 세무 감수자를 함께 보인다 */
    | { kind: "explainer"; taxReviewer?: PersonRef }
    /** 칼럼 — 이해관계 한 줄(TX-15)과 의견 고지(TX-16) */
    | { kind: "opinion"; interest: string }
  );

/** 칼럼 의견 고지 (TX-16, PRD-00 8.8) */
export const OPINION_NOTICE = "의견이며 개별 자문이 아닙니다";

/** 기자 소개 블록 — 기사 하단 흰 카드 (NAV-03 · TX-15 · TX-16) */
export function ReporterBlock(props: ReporterBlockProps) {
  const { author, editor, publishedAt, modifiedAt, correctionHref = "/about/corrections", editorialPolicyHref = "/about/editorial-policy" } = props;
  const role = props.kind === "opinion" ? "필자" : "기자";
  const reviewer = props.kind === "explainer" ? props.taxReviewer : undefined;
  // 소개 문장에 이메일이 섞여 들어오면 문단째 뺀다 — 연락은 인물 페이지·정정 창구로 (NAV-03)
  const bio = author.bio && !hasEmail(author.bio) ? author.bio : undefined;

  return (
    <section data-ui="reporter-block" aria-label={`${role} 소개`} className="rounded-2xl border border-navy-100 bg-white p-6">
      <p className="text-[13px] font-bold text-navy-600">{role}</p>
      <p className="mt-1">
        {/* slug가 없으면 인물 페이지가 없는 사람(동의서 없음·철회) — 이름만, 링크 0 (BR-07) */}
        {author.slug ? (
          <UiLink
            href={`/people/${encodeURIComponent(author.slug)}`}
            className="inline-flex min-h-11 items-center text-[19px] font-black text-navy-900 hover:text-hermes-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500"
          >
            {author.name}
          </UiLink>
        ) : (
          <span className="inline-flex min-h-11 items-center text-[19px] font-black text-navy-900">{author.name}</span>
        )}
      </p>
      <p className="mt-1 text-[15px] text-navy-600">담당 분야 · {author.beat}</p>
      {bio && <p className="mt-3 text-[15px] text-navy-800">{bio}</p>}

      {props.kind === "opinion" && (
        <div className="mt-3 space-y-1 text-[15px] text-navy-800">
          <p>이해관계: {isBlank(props.interest) ? "확인 필요" : props.interest.trim()}</p>
          <p className="font-bold">{OPINION_NOTICE}</p>
        </div>
      )}

      {(editor || reviewer) && (
        <p className="mt-3 text-[15px] text-navy-600">
          {editor && <span>편집 {editor.name}</span>}
          {editor && reviewer && <span aria-hidden="true"> · </span>}
          {reviewer && <span>세무 감수 {reviewer.name}</span>}
        </p>
      )}

      <p className={`mt-3 ${MONO}`}>
        최초 발행 <DateText value={publishedAt} withTime />
        {modifiedAt && (
          <>
            <span aria-hidden="true"> · </span>실질 수정 <DateText value={modifiedAt} withTime />
          </>
        )}
      </p>

      {(correctionHref || editorialPolicyHref) && (
        <ul className="mt-2 flex flex-wrap gap-x-5 text-[15px]">
          {correctionHref && (
            <li>
              <UiLink href={correctionHref} className={TEXT_LINK}>
                정정·반론 요청
              </UiLink>
            </li>
          )}
          {editorialPolicyHref && (
            <li>
              <UiLink href={editorialPolicyHref} className={TEXT_LINK}>
                편집 원칙
              </UiLink>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
