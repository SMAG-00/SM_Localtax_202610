import { useId } from "react";
import { Chip } from "../base";
import { DateText, MONO, TEXT_LINK } from "./parts";
import { toTime } from "./format";

export type CorrectionKind = "correction" | "rebuttal" | "follow-up" | "title-change";

export type CorrectionEntry = {
  id: string;
  kind: CorrectionKind;
  /** 날짜 (YYYY-MM-DD 또는 ISO) */
  date: string;
  /** 무엇을 고쳤는지 */
  what: string;
  /** 왜 고쳤는지 */
  why: string;
  /** 전후 비교 페이지 — 없으면 링크를 만들지 않는다 */
  compareHref?: string;
};

const KIND_LABEL: Record<CorrectionKind, string> = {
  correction: "정정",
  rebuttal: "반론",
  "follow-up": "추후보도",
  "title-change": "제목 변경",
};

/** 날짜 순(오래된 것부터). 읽을 수 없는 날짜는 뒤로, 같으면 입력 순서 */
function byDate(entries: readonly CorrectionEntry[]): CorrectionEntry[] {
  return entries
    .map((e, i) => ({ e, i, t: toTime(e.date) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.e);
}

/** 정정 이력 블록 — 기사 본문 위, 있을 때만 (NAV-03 · NAV-05 · NAV-06). 업데이트 표시(ART-05)와 다른 라벨 */
export function CorrectionHistory({ entries }: { entries: readonly CorrectionEntry[] }) {
  const headingId = useId();
  if (entries.length === 0) return null;
  const sorted = byDate(entries);

  return (
    <section data-ui="correction-history" aria-labelledby={headingId} className="rounded-2xl border border-navy-100 bg-white p-6">
      <h2 id={headingId} className="text-[17px] font-black text-navy-900">
        정정 이력 {sorted.length}건
      </h2>
      <ol className="mt-3 space-y-4">
        {sorted.map((e) => (
          <li key={e.id} className="border-t border-navy-100 pt-4 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-2">
              <Chip>{KIND_LABEL[e.kind]}</Chip>
              <DateText value={e.date} className={MONO} />
            </div>
            <dl className="mt-2 space-y-1 text-[15px] text-navy-800">
              <div className="flex gap-2">
                <dt className="shrink-0 font-bold text-navy-600">무엇을</dt>
                <dd>{e.what}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="shrink-0 font-bold text-navy-600">왜</dt>
                <dd>{e.why}</dd>
              </div>
            </dl>
            {e.compareHref && (
              <a href={e.compareHref} className={`${TEXT_LINK} text-[15px]`}>
                전후 비교 보기
              </a>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
