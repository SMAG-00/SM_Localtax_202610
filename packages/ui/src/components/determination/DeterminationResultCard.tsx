import { Chip } from "../Chip";
import { RulesetLabel } from "../RulesetLabel";
import { cx } from "../cx";

// 판정 도우미 결과 카드 (W11-a a5 - PRD-03 PR-12 · FAM-05 · 6장). 판정표 평가기(@ltr/tax-engine determination)의 결과를 그대로 보인다 - 이 부품은 판정을 만들지 않는다.
//  · 결론은 status가 '결론'일 때만 그린다. '요건 확인 필요'이면 결론 대신 빠진 항목을 보인다 (기본 가정으로 채우지 않는다 - FAM-05).
//  · 금액·유리/불리·추천 표현은 이 부품에 없다. 결론 글자는 감수된 판정표가 정한 그대로 받는다.
//  · 판정표 버전과 "판정은 참고용" 고지는 항상 보인다 (CALC-07).
export type DeterminationStatus = "결론" | "요건 확인 필요" | "표에 없는 경우";
export type CheckState = "입력으로 확인" | "입력으로 확인 안 됨" | "직접 확인 필요";

export interface DeterminationResultCardProps {
  /** 판정 종류 이름 (예: 감수된 판정표 label) */
  title: string;
  /** 판정표 버전 (YYYY.NN) */
  tableVersion: string;
  status: DeterminationStatus;
  conclusion?: { text: string; basis?: string } | null;
  /** 결론을 못 낸 이유가 입력 부족일 때 빠진 항목 */
  missing?: readonly { id: string; label: string }[];
  /** 근거 체크 (요건마다 상태) */
  checks?: readonly { id: string; label: string; state: CheckState }[];
  /** 근거 조문 칩 - 감수 입력 */
  lawChips?: readonly string[];
  className?: string;
}

export const DETERMINATION_NOTICE = "판정은 참고용입니다.";

const STATE_MARK: Record<CheckState, string> = { "입력으로 확인": "확인", "입력으로 확인 안 됨": "확인 안 됨", "직접 확인 필요": "직접 확인 필요" };

export function DeterminationResultCard({ title, tableVersion, status, conclusion, missing = [], checks = [], lawChips = [], className }: DeterminationResultCardProps) {
  const showConclusion = status === "결론" && conclusion != null;
  return (
    <section data-ui="determination-result" data-status={status} aria-label={`${title} 판정 결과`} className={cx("rounded-lg border border-navy-100 bg-white p-5", className)}>
      <h3 className="text-[18px] font-bold text-navy-900">{title}</h3>
      <p data-part="status" className="mt-1 text-[13px] font-bold text-navy-700">
        {status}
      </p>
      {showConclusion && (
        <div data-part="conclusion" className="mt-3 border-l-2 border-hermes-500 pl-3">
          <p className="text-[16px] font-bold text-navy-900">{conclusion.text}</p>
          {conclusion.basis && <p className="mt-1 text-[13px] text-navy-600">{conclusion.basis}</p>}
        </div>
      )}
      {status === "요건 확인 필요" && (
        <div data-part="missing" className="mt-3">
          <p className="text-[15px] text-navy-900">요건 확인 필요 - 아래 항목을 알면 판정할 수 있습니다.</p>
          <ul className="mt-1 list-disc pl-5 text-[15px] text-navy-700">
            {missing.map((m) => (
              <li key={m.id}>{m.label}</li>
            ))}
          </ul>
        </div>
      )}
      {status === "표에 없는 경우" && (
        <p data-part="no-row" className="mt-3 text-[15px] text-navy-700">
          감수된 판정표에 없는 경우입니다. 전문가 확인이 필요합니다.
        </p>
      )}
      {checks.length > 0 && (
        <ul data-part="checks" className="mt-3 space-y-1 text-[14px] text-navy-700">
          {checks.map((c) => (
            <li key={c.id} data-state={c.state}>
              <span className="font-bold">{STATE_MARK[c.state]}</span> {c.label}
            </li>
          ))}
        </ul>
      )}
      {lawChips.length > 0 && (
        <div data-part="law-chips" className="mt-3 flex flex-wrap gap-2">
          {lawChips.map((l) => (
            <Chip key={l}>{l}</Chip>
          ))}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
        <RulesetLabel version={tableVersion} />
        <p data-part="notice" className="text-[13px] text-navy-600">
          {DETERMINATION_NOTICE}
        </p>
      </div>
    </section>
  );
}
