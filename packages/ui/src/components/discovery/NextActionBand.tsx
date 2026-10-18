import { useId } from "react";
import { DarkButton } from "../base";
import { UiLink } from "../link";

export type SimilarCaseItem = {
  href: string;
  title: string;
  /** 유형 글자 (해결 사례 · 상담 사례 · 기사) */
  kind?: string;
};

export type NextActionItem = {
  /** 행동 종류 — 분석 이벤트 next_action_clicked(버튼 종류) 값 */
  key: string;
  /** 하는 일을 쓴다 ([이 상황 모아 보기], [SM 계산기로 계산하기]) */
  label: string;
  href: string;
  /** 이 단계에 열린 기능인가 (`settings` 기능 공개 목록). 닫힌 기능은 렌더하지 않고 자리도 차지하지 않는다 */
  enabled: boolean;
  /** 별도 사이트 — 새 창 (SM 계산기 등) */
  external?: boolean;
};

export type NextActionBandProps = {
  /** 비슷한 사례 후보 (상담·해결 사례 먼저 → 같은 태그 수 → 같은 분야 → 최신 순으로 정렬된 것). 3건까지 보인다 */
  similarCases: SimilarCaseItem[];
  /** 버튼 후보 — `settings` 우선순위 순서. 열린 것 중 앞의 2개만 보인다 */
  actions: NextActionItem[];
};

const MAX_CASES = 3;
const MAX_ACTIONS = 2;

function NewWindowMark() {
  // 새 창 표시 — 글자 "(새 창)"과 함께 쓰는 보조 표시
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 stroke-current">
      <path d="M6 3.5 H12.5 V10 M12.5 3.5 L4 12" />
    </svg>
  );
}

/**
 * 다음 행동 띠 — 기사 하단 흰 카드: 비슷한 사례 3건 + 어두운 버튼 2개 이하 (PRD-00 8.6, ART-06 · BM-L5)
 * 그 단계에 열린 기능의 버튼만 렌더한다 — '준비 중' 링크·비활성 버튼 없음. 띠 안에 주 버튼 0 (R2)
 * 640px 미만에서는 위아래 선만 있는 띠(안쪽 좌우 16px — 루트 글자가 17px이라 rem 대신 px)다 — 화면 폭으로 펼쳐 두면(바깥이 좌우 여백을 상쇄) 버튼 너비가 화면 폭 − 32px (UX-06: 360px에서 328px)
 */
export function NextActionBand({ similarCases, actions }: NextActionBandProps) {
  const casesHeadingId = useId();
  const cases = similarCases.slice(0, MAX_CASES);
  const buttons = actions.filter((a) => a.enabled).slice(0, MAX_ACTIONS);
  if (cases.length === 0 && buttons.length === 0) return null;

  return (
    <section data-ui="next-action-band" aria-label="다음 행동" className="border-y border-navy-100 bg-white px-[16px] py-6 sm:rounded-2xl sm:border sm:p-6">
      {cases.length > 0 && (
        <>
          <h2 id={casesHeadingId} className="text-[17px] font-black text-navy-900">
            비슷한 사례
          </h2>
          <ul aria-labelledby={casesHeadingId} className="mt-2 divide-y divide-navy-100">
            {cases.map((c, i) => (
              <li key={`${i}-${c.href}`}>
                <UiLink
                  href={c.href}
                  className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[16px] font-semibold text-navy-900 transition hover:text-hermes-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500"
                >
                  {c.kind && <span className="text-[13px] font-bold text-hermes-800">{c.kind}</span>}
                  <span className="min-w-0 [overflow-wrap:anywhere]">{c.title}</span>
                </UiLink>
              </li>
            ))}
          </ul>
        </>
      )}
      {buttons.length > 0 && (
        <ul className={cases.length > 0 ? "mt-5 flex flex-col gap-3 sm:flex-row" : "flex flex-col gap-3 sm:flex-row"}>
          {buttons.map((a) => (
            <li key={a.key} data-next-action={a.key}>
              <DarkButton href={a.href} external={a.external} className="w-full sm:w-auto">
                {a.label}
                {a.external && (
                  <>
                    <NewWindowMark />
                    <span className="sr-only">(새 창)</span>
                  </>
                )}
              </DarkButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
