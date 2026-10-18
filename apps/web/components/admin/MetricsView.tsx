import Link from "next/link";
import type { ReactNode } from "react";
import { Callout, TextField } from "@ltr/ui";
import { isoToKstDateTime } from "@/lib/admin/form-utils";
import {
  DEFINITIONS,
  METRICS_PATH,
  OTHER_METRICS,
  SECTION_ROWS,
  SEGMENT_LABELS,
  formatCount,
  formatRate,
  funnelRows,
  periodLinks,
  periodText,
  type MetricDefinition,
} from "@/lib/admin/metrics-view";
import type { Ratio, SegmentMetrics } from "@/lib/analytics/metrics";
import type { MetricsDashboard } from "@/lib/server/analytics/metrics";
import { MONO, OUTLINE_BUTTON, Panel, TEXT_LINK, ToneChip } from "./ui";

// 측정 지표 대시보드 화면 (/admin/metrics — GROW-01). 숫자마다 아래에 정의(분모·분자·제외 조건)와 소유 요구사항 ID를 쉬운 말로 보인다.
// 차트 컴포넌트가 packages/ui에 없어 표로 보인다(화면 읽기 프로그램이 표 머리로 읽는다). 360px — 표는 칸이 적고 좁게, 넘치면 표만 가로로.
// 전환일이 있으면 기간을 '시험 기간'과 '운영'으로 나눠 따로 보인다. 다른 문서가 정하는 지표는 '수집 전'(숫자 0).

const TH = "border-b border-navy-100 px-2 py-2 align-bottom text-[13px] font-bold text-navy-600 sm:px-3";
const TD = "border-b border-navy-100 px-2 py-2 align-top text-[15px] text-navy-900 sm:px-3";
const NUM = `${TD} text-right font-mono tabular-nums`;

function Table({ caption, metric, head, children }: { caption: string; metric: string; head: readonly string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-navy-100 bg-white">
      <table data-metric={metric} className="w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-ivory">
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" className={i === 0 ? TH : `${TH} text-right`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** 정의 글자 — 분모·분자·제외 조건·소유 요구사항 */
function Definition({ d }: { d: MetricDefinition }) {
  return (
    <dl data-part="definition" className="grid gap-x-3 gap-y-1 text-[14px] text-navy-700 sm:grid-cols-[6rem_minmax(0,1fr)]">
      <dt className="font-bold text-navy-900">분모</dt>
      <dd>{d.denominator}</dd>
      <dt className="font-bold text-navy-900">분자</dt>
      <dd>{d.numerator}</dd>
      <dt className="font-bold text-navy-900">제외</dt>
      <dd>{d.exclusions}</dd>
      <dt className="font-bold text-navy-900">소유</dt>
      <dd className={MONO}>{d.owner}</dd>
      {d.note && (
        <>
          <dt className="font-bold text-navy-900">참고</dt>
          <dd>{d.note}</dd>
        </>
      )}
    </dl>
  );
}

const Rate = ({ r }: { r: Ratio }) => <>{formatRate(r)}</>;

function ValidVisits({ m }: { m: SegmentMetrics }) {
  const rows = [...SECTION_ROWS.map((s) => ({ key: s.key, label: s.label, r: m.validVisits.sections[s.key] })), { key: "total", label: "전체", r: m.validVisits.total }];
  return (
    <Panel id={`valid-${m.segment.kind}`} title={DEFINITIONS.validVisits.title}>
      <Table caption={`${DEFINITIONS.validVisits.title} — 분야별 허브 방문 세션(분모)·유효 방문 세션(분자)·비율`} metric="valid-visits" head={["분야", "허브 방문 세션", "유효 방문 세션", "비율"]}>
        {rows.map((row) => (
          <tr key={row.key} data-row={row.key}>
            <th scope="row" className={`${TD} font-bold`}>
              {row.label}
            </th>
            <td data-cell="denominator" className={NUM}>
              {formatCount(row.r.denominator)}
            </td>
            <td data-cell="numerator" className={NUM}>
              {formatCount(row.r.numerator)}
            </td>
            <td data-cell="rate" className={NUM}>
              <Rate r={row.r} />
            </td>
          </tr>
        ))}
      </Table>
      <Definition d={DEFINITIONS.validVisits} />
    </Panel>
  );
}

function Revisits({ m }: { m: SegmentMetrics }) {
  const rows = [...SECTION_ROWS.map((s) => ({ key: s.key, label: s.label, c: m.revisits.sections[s.key] })), { key: "total", label: "전체", c: m.revisits.total }];
  return (
    <Panel id={`revisit-${m.segment.kind}`} title={DEFINITIONS.revisits.title}>
      <Table caption={`${DEFINITIONS.revisits.title} — 분야별 방문자(분모)·재방문자(분자)·비율·30일 안 지남`} metric="revisits" head={["분야", "방문자", "재방문자", "비율", "30일 안 지남"]}>
        {rows.map((row) => (
          <tr key={row.key} data-row={row.key}>
            <th scope="row" className={`${TD} font-bold`}>
              {row.label}
            </th>
            <td data-cell="visitors" className={NUM}>
              {formatCount(row.c.visitors)}
            </td>
            <td data-cell="revisited" className={NUM}>
              {formatCount(row.c.revisited)}
            </td>
            <td data-cell="rate" className={NUM}>
              <Rate r={{ numerator: row.c.revisited, denominator: row.c.visitors }} />
            </td>
            <td data-cell="pending" className={NUM}>
              {formatCount(row.c.pending)}
            </td>
          </tr>
        ))}
      </Table>
      <p data-part="without-visitor" className="text-[14px] text-navy-700">
        방문자 ID가 없어 분모에서 뺀 세션 <span data-cell="without-visitor" className="font-mono font-bold text-navy-900">{formatCount(m.revisits.withoutVisitor)}</span>개
      </p>
      <Definition d={DEFINITIONS.revisits} />
    </Panel>
  );
}

function FunnelPanel({ m }: { m: SegmentMetrics }) {
  const f = m.funnel;
  const solved = { numerator: f.solved, denominator: f.firstVisits };
  return (
    <Panel id={`funnel-${m.segment.kind}`} title={DEFINITIONS.funnel.title}>
      <Table caption={`${DEFINITIONS.funnel.title} — 단계별 세션·앞 칸 대비·첫 방문 대비`} metric="funnel" head={["단계", "세션", "앞 칸 대비", "첫 방문 대비"]}>
        {funnelRows(f).map((row) => (
          <tr key={row.step} data-row={row.step}>
            <th scope="row" className={`${TD} font-bold`}>
              {`${row.step}. ${row.label}`}
            </th>
            <td data-cell="count" className={NUM}>
              {formatCount(row.count)}
            </td>
            <td data-cell="from-previous" className={NUM}>
              {row.fromPrevious ? <Rate r={row.fromPrevious} /> : "—"}
            </td>
            <td data-cell="from-first" className={NUM}>
              {row.fromFirst ? <Rate r={row.fromFirst} /> : "—"}
            </td>
          </tr>
        ))}
      </Table>
      <Definition d={DEFINITIONS.funnel} />
      <div data-metric="solved" className="rounded-xl border border-navy-100 bg-ivory p-4">
        <p className="text-[15px] font-bold text-navy-900">
          {DEFINITIONS.solved.title}{" "}
          <span data-cell="rate" className="font-mono">
            <Rate r={solved} />
          </span>
        </p>
        <p className="mt-1 text-[14px] text-navy-700">
          <span data-cell="numerator" className="font-mono font-bold text-navy-900">
            {formatCount(f.solved)}
          </span>{" "}
          / 첫 방문{" "}
          <span data-cell="denominator" className="font-mono font-bold text-navy-900">
            {formatCount(f.firstVisits)}
          </span>
          세션
        </p>
        <div className="mt-2">
          <Definition d={DEFINITIONS.solved} />
        </div>
      </div>
    </Panel>
  );
}

function SegmentBlock({ m }: { m: SegmentMetrics }) {
  const x = m.exclusions;
  return (
    <section data-segment={m.segment.kind} aria-labelledby={`segment-${m.segment.kind}`} className="space-y-6">
      <div>
        <h2 id={`segment-${m.segment.kind}`} className="text-[22px] font-black text-navy-900">
          {SEGMENT_LABELS[m.segment.kind]}
        </h2>
        <p className={`${MONO} mt-1 text-navy-600`}>{`${m.segment.from} ~ ${m.segment.to}`}</p>
        <p data-part="exclusions" className="mt-2 text-[14px] text-navy-700">
          이 구간에 시작한 세션 <span data-cell="sessions" className="font-mono font-bold text-navy-900">{formatCount(x.sessions)}</span>개 가운데 봇{" "}
          <span data-cell="bot" className="font-mono font-bold text-navy-900">{formatCount(x.bot)}</span>개 · 편집국·관리자{" "}
          <span data-cell="staff" className="font-mono font-bold text-navy-900">{formatCount(x.staff)}</span>개를 모든 지표에서 뺐습니다.
        </p>
      </div>
      <ValidVisits m={m} />
      <Revisits m={m} />
      <FunnelPanel m={m} />
    </section>
  );
}

function OtherMetrics() {
  return (
    <Panel id="other-metrics" title="다른 문서가 정하는 지표" description="같은 대시보드에 모으는 지표입니다. 소유 작업이 데이터를 모으기 전에는 숫자를 만들지 않습니다(추정값 0).">
      <ul data-metric="other" className="divide-y divide-navy-100">
        {OTHER_METRICS.map((o) => (
          <li key={o.id} data-row={o.id} className="py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[16px] font-bold text-navy-900">{o.name}</span>
              <ToneChip tone="plain">
                <span data-cell="status">{o.status}</span>
              </ToneChip>
              <span className={`${MONO} text-navy-600`}>{o.owner}</span>
            </div>
            <p className="mt-1 text-[14px] text-navy-700">{o.definition}</p>
            <p className="mt-1 text-[14px] text-navy-600">{o.note}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function PeriodPicker({ dash }: { dash: MetricsDashboard }) {
  const p = dash.period;
  return (
    <div className="space-y-4 rounded-2xl border border-navy-100 bg-white p-4">
      <nav aria-label="기간">
        <ul className="flex flex-wrap gap-2">
          {periodLinks(p, dash.cutover).map((l) => (
            <li key={l.key}>
              <Link
                href={l.href}
                aria-current={l.current ? "page" : undefined}
                className={`inline-flex min-h-11 items-center rounded-xl border px-4 text-[15px] font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500 ${
                  l.current ? "border-navy-900 bg-navy-900 text-white" : "border-navy-200 bg-white text-navy-800 hover:border-navy-900"
                }`}
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <form method="get" action={METRICS_PATH} aria-label="기간 직접 고르기" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="period" value="custom" />
        <div className="w-full sm:w-48">
          <TextField id="metrics-from" name="from" type="date" label="시작일" defaultValue={p.from} />
        </div>
        <div className="w-full sm:w-48">
          <TextField id="metrics-to" name="to" type="date" label="끝날" defaultValue={p.to} />
        </div>
        <button type="submit" className={OUTLINE_BUTTON}>
          이 기간 보기
        </button>
      </form>
      {dash.periodError && (
        <p role="alert" data-part="period-error" className="text-[15px] text-rose-700">
          {dash.periodError} — 최근 30일을 보입니다.
        </p>
      )}
    </div>
  );
}

export function MetricsView({ dash }: { dash: MetricsDashboard }) {
  return (
    <div className="space-y-8">
      <PeriodPicker dash={dash} />
      <div className="space-y-2 text-[15px] text-navy-700">
        <p data-part="period">
          기간 <span className={`${MONO} text-navy-900`}>{periodText(dash.period)}</span> · 계산 <span className={MONO}>{isoToKstDateTime(dash.computedAt)}</span> (한국 시간) — 화면을 열 때마다 원본
          이벤트에서 다시 셉니다.
        </p>
        <p data-part="cutover" data-cutover={dash.cutover ?? ""}>
          {dash.cutover ? (
            <>
              운영 도메인 전환일 <span className={`${MONO} text-navy-900`}>{dash.cutover}</span> — 이 날 앞은 &lsquo;시험 기간&rsquo;, 이 날부터 &lsquo;운영&rsquo;으로 나눠 봅니다.
            </>
          ) : (
            <>운영 도메인 전환일이 아직 없습니다 — 모든 수치가 &lsquo;시험 기간&rsquo;입니다. 목표 숫자는 전환 뒤 첫 4주 기준선을 모은 다음 정합니다.</>
          )}{" "}
          <Link href="/admin/settings#setting-domain-cutover" className={TEXT_LINK}>
            전환일 설정
          </Link>
        </p>
        {dash.cutoverProblem && (
          <p role="alert" className="text-rose-700">
            {dash.cutoverProblem}
          </p>
        )}
      </div>
      {dash.result.kind === "over" ? (
        <Callout>
          <span data-part="over-limit">
            이 기간에는 세션이 {formatCount(dash.result.count)}개라 한 번에 셀 수 있는 {formatCount(dash.result.limit)}개를 넘습니다. 기간을 줄여 주세요.
          </span>
        </Callout>
      ) : (
        dash.result.segments.map((m) => <SegmentBlock key={m.segment.kind} m={m} />)
      )}
      <OtherMetrics />
    </div>
  );
}
