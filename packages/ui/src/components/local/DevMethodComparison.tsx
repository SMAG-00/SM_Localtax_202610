import { useId, type ReactNode } from "react";
import { Callout, Chip, Tabs, cx } from "../base";
import { MONO } from "./shared";
import { filled, isIsoDate, type IsoDate } from "./dates";

/** 7개 방법 — 고정 편집 순서. 신속통합기획은 사업 유형이 아니라 계획 지원 절차다 (PR-09) */
export const DEV_METHODS = [
  { id: "redevelopment", label: "재개발" },
  { id: "reconstruction", label: "재건축" },
  { id: "small_scale", label: "소규모정비" },
  { id: "public", label: "공공 방식" },
  { id: "trust", label: "신탁방식" },
  { id: "renewal", label: "재정비" },
  { id: "speed_integrated", label: "신속통합기획", chip: "계획 지원 절차" },
] as const;
export type DevMethodId = (typeof DEV_METHODS)[number]["id"];

/** 숫자 요건 한 행 — `dev_method_facts`에서만 온다. 기준일·감수자가 없으면 그리지 않는다 (PR-10) */
export type DevMethodFact = {
  label: string;
  value: string;
  /** 단위 — 값에 단위가 없으면 빈 글자 */
  unit: string;
  /** 근거 조문 */
  article: string;
  basisDate: IsoDate;
  reviewer: string;
};

export type DevMethodEntry = {
  /** 근거 법령 */
  law: string;
  /** 사업 주체 */
  operator: string;
  /** 대상 */
  target: string;
  /** 주요 절차 */
  procedure: string;
  /** 숫자 요건 비교 칸의 서명된 글 (있으면 숫자 요건 행에서 값 목록 위에 보인다) */
  factsNote?: string;
  /** 숫자 요건 */
  facts: DevMethodFact[];
  /** 지방세 쟁점 (감수본) */
  taxIssue: string;
  /** 방법 상세 /realestate/development-methods/[method] */
  href?: string;
};

export type DevMethodComparisonProps = {
  /** 방법별 내용 — 넘기는 순서와 상관없이 화면은 고정 편집 순서다 */
  methods: Partial<Record<DevMethodId, DevMethodEntry>>;
};

type RowKey = "law" | "operator" | "target" | "procedure" | "facts" | "taxIssue";
const ROWS: ReadonlyArray<{ key: RowKey; label: string }> = [
  { key: "law", label: "근거 법령" },
  { key: "operator", label: "사업 주체" },
  { key: "target", label: "대상" },
  { key: "procedure", label: "주요 절차" },
  { key: "facts", label: "숫자 요건" },
  { key: "taxIssue", label: "지방세 쟁점" },
];

function validFact(f: DevMethodFact): boolean {
  return filled(f.label) && filled(f.value) && filled(f.article) && isIsoDate(f.basisDate) && filled(f.reviewer);
}

type Column = (typeof DEV_METHODS)[number] & { entry: DevMethodEntry; facts: DevMethodFact[] };

/** 필수 비교 항목이 하나라도 빈 방법은 공개하지 않는다 — '확인 중' 칸으로 채우지 않는다 (PR-09) */
function columns(methods: DevMethodComparisonProps["methods"]): Column[] {
  return DEV_METHODS.flatMap((m) => {
    const entry = methods[m.id];
    if (!entry) return [];
    const facts = entry.facts.filter(validFact);
    const complete = filled(entry.law) && filled(entry.operator) && filled(entry.target) && filled(entry.procedure) && filled(entry.taxIssue) && facts.length > 0;
    return complete ? [{ ...m, entry, facts }] : [];
  });
}

function Facts({ facts, note }: { facts: DevMethodFact[]; note?: string | undefined }) {
  return (
    <div className="space-y-3">
      {filled(note) && <p>{note}</p>}
      <ul className="space-y-2">
        {facts.map((f, i) => (
          <li key={i}>
            <span className="block text-navy-800">{f.label}</span>
            <span className="block font-mono text-[15px] font-bold tracking-wide text-navy-900">
              {f.value}
              {f.unit}
            </span>
            <span className={cx("block text-navy-600", MONO)}>{`${f.article} · 기준일 ${f.basisDate} · 감수 ${f.reviewer}`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function cell(col: Column, key: RowKey): ReactNode {
  return key === "facts" ? <Facts facts={col.facts} note={col.entry.factsNote} /> : col.entry[key];
}

function MethodName({ col }: { col: Column }) {
  return col.entry.href ? (
    <a href={col.entry.href} className="underline decoration-hermes-500 decoration-2 underline-offset-4 hover:text-hermes-900">
      {col.label}
    </a>
  ) : (
    <>{col.label}</>
  );
}

/**
 * 개발방법 비교표 — 7개 방법을 같은 비교 항목으로 나란히. 추천·적합도 점수·'나에게 맞는 방법' 요소 없음 (PR-11).
 * 1024px 이상은 표, 그보다 좁으면 방법별 탭(가로 스크롤 없음)
 */
export function DevMethodComparison({ methods }: DevMethodComparisonProps) {
  const headingId = useId();
  const cols = columns(methods);
  if (cols.length === 0) return null;

  return (
    <section data-ui="dev-method-comparison" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-[28px] font-black tracking-tight text-navy-900 sm:text-[32px]">
        개발방법 비교
      </h2>
      <Callout className="mt-4">추천하거나 판정하지 않습니다. 같은 항목으로 나란히 보여 드립니다.</Callout>

      <div className="mt-8 hidden lg:block">
        <table className="w-full table-fixed border-collapse text-left text-[14px] leading-relaxed">
          <caption className="sr-only">개발방법 비교표</caption>
          <thead>
            <tr className="border-b-2 border-navy-900">
              <th scope="col" className="w-28 py-3 pr-3 text-[13px] font-bold text-navy-600">
                비교 항목
              </th>
              {cols.map((c) => (
                <th key={c.id} scope="col" className="py-3 pr-3 align-bottom text-[15px] font-black text-navy-900">
                  <span className="block">
                    <MethodName col={c} />
                  </span>
                  {"chip" in c && <Chip className="mt-1">{c.chip}</Chip>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.key} className="border-b border-navy-100 align-top">
                <th scope="row" className="py-3 pr-3 text-[13px] font-bold text-navy-600">
                  {r.label}
                </th>
                {cols.map((c) => (
                  <td key={c.id} className="py-3 pr-3 break-words text-navy-800">
                    {cell(c, r.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div data-dev-method-tabs className="mt-8 lg:hidden">
        <Tabs
          label="개발방법"
          items={cols.map((c) => ({
            id: c.id,
            label: c.label,
            panel: (
              <div>
                <p className="flex flex-wrap items-center gap-2 text-[19px] font-black text-navy-900">
                  <MethodName col={c} />
                  {"chip" in c && <Chip>{c.chip}</Chip>}
                </p>
                <dl className="mt-4 divide-y divide-navy-100 rounded-2xl border border-navy-100 bg-white">
                  {ROWS.map((r) => (
                    <div key={r.key} className="p-4">
                      <dt className="text-[13px] font-bold text-navy-600">{r.label}</dt>
                      <dd className="mt-1 text-[15px] break-words text-navy-800">{cell(c, r.key)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ),
          }))}
        />
      </div>
    </section>
  );
}
