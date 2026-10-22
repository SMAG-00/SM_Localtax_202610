import { useId, type ReactNode } from "react";
import { cx } from "../base";
import { ExternalLink, Field, MONO, StateChip } from "./shared";
import { filled, isIsoDate, type IsoDate } from "./dates";

/** 단계 기록 — 고시 번호·고시일·고시 기관·원문 주소·확인일 (PR-03) */
export type ProjectStageRecord = {
  noticeNo: string;
  noticeDate: IsoDate;
  agency: string;
  sourceUrl: string;
  checkedAt: IsoDate;
  /** 원본을 다시 받아 내용이 달라져 검토하는 중 */
  underReview?: boolean;
  /** 공공누리 유형 글자 (PR-07 — 원문은 유형과 상관없이 링크만) */
  license?: string;
};

/**
 * 사업 유형별 표준 단계 하나 (목록은 settings — 구역지정 … 준공).
 * 가격·분양가·분담금·수익률 칸은 없다 (PR-05)
 */
export type ProjectStage = {
  name: string;
  record?: ProjectStageRecord;
  /** 단계별 「지방세로 읽기」 한 줄 — 감수된 문장이 있는 단계에만 (PR-08) */
  taxLens?: string;
  /** 이 프로젝트에 없는 단계(편집자 해당 없음 기록) — 상태 글자 대신 '해당 없음' */
  notApplicable?: boolean;
  /** 단계 카드 아래에 붙는 내용 — 단계별 「지방세로 읽기」 박스(CORE-01 형식)와 계산기 카드 (PR-08). 표에는 넣지 않는다 */
  after?: ReactNode;
};

type State = "past" | "current" | "upcoming";
const STATE_LABEL: Record<State, string> = { past: "지난 단계", current: "현재 단계", upcoming: "예정 단계" };
const NOT_APPLICABLE = "해당 없음";

function validRecord(r: ProjectStageRecord | undefined): r is ProjectStageRecord {
  return !!r && filled(r.noticeNo) && filled(r.sourceUrl) && filled(r.agency) && isIsoDate(r.noticeDate) && isIsoDate(r.checkedAt);
}

/**
 * 프로젝트 단계 타임라인 — SM 단계 타임라인 문법(원 + STEP + 세로선). 현재 단계는 단계 순서상 가장 늦은 기록(PR-02).
 * 공개 단계 기록이 하나도 없으면 그리지 않는다. 같은 내용의 표를 함께 둔다 (8.9)
 */
export function ProjectStageTimeline({ stages, title = "사업 단계" }: { stages: ProjectStage[]; title?: string }) {
  const headingId = useId();
  const rows = stages.map((s) => ({ name: s.name, record: validRecord(s.record) ? s.record : undefined, taxLens: filled(s.taxLens) ? s.taxLens : undefined, notApplicable: s.notApplicable === true, after: s.after }));
  const current = rows.reduce((last, r, i) => (r.record ? i : last), -1);
  if (current < 0) return null;
  const stateOf = (i: number): State => (i < current ? "past" : i === current ? "current" : "upcoming");
  const stateText = (i: number) => (rows[i]!.notApplicable && !rows[i]!.record ? NOT_APPLICABLE : STATE_LABEL[stateOf(i)]);

  return (
    <section data-ui="project-stage-timeline" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-[28px] font-black tracking-tight text-navy-900 sm:text-[32px]">
        {title}
      </h2>
      <ol className="mt-8 space-y-5">
        {rows.map((s, i) => {
          const state = stateOf(i);
          const filledCircle = state !== "upcoming";
          return (
            <li key={`${i}-${s.name}`} data-stage-state={state} {...(s.notApplicable && !s.record ? { "data-stage-na": "" } : {})} className="relative">
              {i < rows.length - 1 && <span aria-hidden="true" className="absolute top-16 left-[27px] h-[calc(100%+0.25rem)] w-px bg-navy-200" />}
              <div className={cx("relative flex gap-5 rounded-2xl border bg-white p-6", state === "current" ? "border-hermes-400" : "border-navy-100")}>
                <span
                  aria-hidden="true"
                  data-stage-circle
                  className={cx(
                    "z-10 flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full",
                    filledCircle ? "bg-navy-900 text-white" : "border-2 border-navy-200 bg-white text-navy-400",
                  )}
                >
                  <span className={cx("text-[10px] font-bold tracking-widest", filledCircle ? "text-navy-200" : "text-navy-400")}>STEP</span>
                  <span className="text-[17px] leading-none font-black">{i + 1}</span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className="text-[22px] font-black tracking-tight text-navy-900">{s.name}</span>
                    <span className={cx("text-[13px] font-bold", state === "current" ? "text-hermes-800" : "text-navy-600")}>{stateText(i)}</span>
                    {s.record?.underReview && <StateChip>검토 중</StateChip>}
                  </p>
                  {s.record && (
                    <>
                      <dl className="mt-3 space-y-1">
                        <Field term="고시 번호" mono>
                          {s.record.noticeNo}
                        </Field>
                        <Field term="고시일" mono>
                          {s.record.noticeDate}
                        </Field>
                        <Field term="고시 기관">{s.record.agency}</Field>
                        <Field term="확인일" mono>
                          {s.record.checkedAt}
                        </Field>
                        {filled(s.record.license) && <Field term="공공누리">{s.record.license}</Field>}
                      </dl>
                      <p className="mt-1">
                        <ExternalLink href={s.record.sourceUrl}>원문 보기</ExternalLink>
                      </p>
                    </>
                  )}
                  {s.taxLens && (
                    <p data-tax-lens className="mt-3 border-l-2 border-hermes-500 pl-3 text-[15px] leading-relaxed text-navy-600">
                      <strong className="font-bold text-navy-900">지방세로 읽기</strong> {s.taxLens}
                    </p>
                  )}
                </div>
              </div>
              {s.after && (
                <div data-stage-after className="relative mt-3">
                  {s.after}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <table className="mt-10 w-full table-fixed border-collapse text-left text-[14px]">
        <caption className="mb-2 text-left text-[15px] font-bold text-navy-900">단계 표 — 위 타임라인과 같은 내용</caption>
        <thead>
          <tr className="border-b border-navy-200">
            {["단계", "상태", "고시", "확인일"].map((h) => (
              <th key={h} scope="col" className="py-2 pr-2 text-[13px] font-bold text-navy-600">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => (
            <tr key={`${i}-${s.name}`} className="border-b border-navy-100 align-top">
              <td className="py-2 pr-2 font-bold break-words text-navy-900">{s.name}</td>
              <td className="py-2 pr-2 text-navy-800">{stateText(i)}</td>
              <td className={cx("py-2 pr-2 break-words text-navy-800", s.record && MONO)}>{s.record ? `${s.record.noticeNo} · ${s.record.noticeDate} · ${s.record.agency}` : "—"}</td>
              <td className={cx("py-2 break-words text-navy-800", s.record && MONO)}>{s.record ? s.record.checkedAt : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
