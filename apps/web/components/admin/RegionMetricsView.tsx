"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { isoToKstDateTime } from "@/lib/admin/form-utils";
import { periodLinks, periodText, type MetricDefinition } from "@/lib/admin/metrics-view";
import {
  COST_API_PATH,
  COST_MISSING,
  DEFINITIONS,
  REGION_TAB_PATH,
  costRows,
  formatKrw,
  formatPerArticle,
  formatRatio,
  monthLinkTarget,
  regionRows,
  shiftMonth,
} from "@/lib/admin/region-metrics-view";
import type { RegionDashboard } from "@/lib/server/analytics/region-metrics";
import { ErrorSummary, StatusNote } from "./fields";
import { useHydrated } from "./useHydrated";
import { MONO, Panel } from "./ui";

// 지역 성과 대시보드 (/admin/metrics?tab=region — REG1-15). 지역마다 자체 취재·근거 충족률·지역 재방문·문제해결 이동률을 보이고, 비율은 분자 / 분모를 함께 쓴다.
// 편집비는 달마다 지역별로 관리자가 입력한다 — 입력하지 않은 달은 '편집비 미입력'(추정값 0 아님). 360px — 표만 가로로 넘친다.

const TH = "border-b border-navy-100 px-2 py-2 align-bottom text-[13px] font-bold text-navy-600 sm:px-3";
const TD = "border-b border-navy-100 px-2 py-2 align-top text-[15px] text-navy-900 sm:px-3";
const NUM = `${TD} font-mono tabular-nums`;

function Table({ caption, metric, head, children }: { caption: string; metric: string; head: readonly string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-navy-100 bg-white">
      <table data-metric={metric} className="w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-ivory">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className={TH}>
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

function Definition({ d }: { d: MetricDefinition }) {
  return (
    <dl data-part="definition" className="grid gap-x-3 gap-y-1 text-[14px] text-navy-700 sm:grid-cols-[6rem_minmax(0,1fr)]">
      <dt className="font-bold text-navy-900">{d.title} 분모</dt>
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

function CostForm({ dash, canEdit }: { dash: RegionDashboard; canEdit: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [regionCode, setRegionCode] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (!canEdit) return <p data-part="cost-readonly" className="text-[14px] text-navy-700">편집비는 관리자만 입력합니다.</p>;

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    const r = await adminApi("POST", COST_API_PATH, { regionCode, month: dash.month, amountKrw: amount, reason });
    if (r.status === 200) {
      setDone(r.body.unchanged ? "이미 같은 금액입니다." : "편집비를 저장했습니다.");
      setAmount("");
      setReason("");
      router.refresh();
    } else setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }
  return (
    <form onSubmit={save} data-form="region-cost" aria-label={`${dash.month} 지역 편집비 입력`} className="space-y-3">
      <div>
        <label htmlFor="region-cost-region" className="mb-1 block text-[15px] font-bold text-navy-900">
          지역
        </label>
        <select
          id="region-cost-region"
          name="regionCode"
          value={regionCode}
          onChange={(e) => setRegionCode(e.target.value)}
          className="min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[16px] text-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500 sm:w-80"
        >
          <option value="">지역을 고르세요</option>
          {dash.regions.map((r) => (
            <option key={r.code} value={r.code}>
              {`${r.name} (${r.code})`}
            </option>
          ))}
        </select>
      </div>
      <TextField id="region-cost-amount" name="amountKrw" label={`${dash.month} 편집비 (원, 숫자만)`} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <TextField id="region-cost-reason" name="reason" label="입력·변경 사유 (감사 기록에 남습니다)" value={reason} onChange={(e) => setReason(e.target.value)} />
      {error && <ErrorSummary id="region-cost-error" title={error.title} messages={error.details} />}
      {done && <StatusNote>{done}</StatusNote>}
      <DarkButton type="submit" disabled={!hydrated}>
        편집비 저장
      </DarkButton>
    </form>
  );
}

export function RegionMetricsView({ dash, canEditCost }: { dash: RegionDashboard; canEditCost: boolean }) {
  const names = new Map(dash.regions.map((r) => [r.code, r.name]));
  const rows = regionRows(dash.rows, names);
  const costs = costRows(dash.monthRows, dash.costs, names);
  const p = dash.period;
  return (
    <div data-part="region-tab" className="space-y-8">
      <div className="space-y-4 rounded-2xl border border-navy-100 bg-white p-4">
        <nav aria-label="기간">
          <ul className="flex flex-wrap gap-2">
            {periodLinks(p, null).map((l) => (
              <li key={l.key}>
                <Link
                  href={`${REGION_TAB_PATH}&period=${l.key}&month=${dash.month}`}
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
        {dash.periodError && (
          <p role="alert" data-part="period-error" className="text-[15px] text-rose-700">
            {dash.periodError} — 최근 30일을 보입니다.
          </p>
        )}
      </div>
      <p data-part="period" className="text-[15px] text-navy-700">
        기간 <span className={`${MONO} text-navy-900`}>{periodText(p)}</span> · 계산 <span className={MONO}>{isoToKstDateTime(dash.computedAt)}</span> (한국 시간) — 봇·편집국·관리자 방문은 뺍니다. 모든 비율은 분자 / 분모를 함께 보입니다.
      </p>

      <Panel id="region-metrics" title="지역별 성과" description="지역 태그가 달린 기사와 지역 허브 측정 이벤트로 지역마다 셉니다. 숫자가 없는 지역은 줄이 없습니다.">
        {rows.length === 0 ? (
          <p data-part="region-empty" className="text-[15px] text-navy-700">
            이 기간에 지역 기사나 지역 허브 열람이 없습니다.
          </p>
        ) : (
          <Table
            caption="지역별 자체 취재(자체 취재 / 공개 중 지역 기사)·근거 충족률(근거 확인 / 자체 취재)·지역 재방문(재방문자 / 방문자)·문제해결 이동률(이동 세션 / 지역 열람 세션)"
            metric="region-metrics"
            head={["지역", "자체 취재", "근거 충족률", "지역 재방문", "문제해결 이동률"]}
          >
            {rows.map((r) => (
              <tr key={r.regionCode} data-row={r.regionCode}>
                <th scope="row" className={`${TD} font-bold`}>
                  {r.name}
                  <span className={`${MONO} block text-navy-500`}>{r.regionCode}</span>
                </th>
                <td data-cell="own" className={NUM}>
                  {formatRatio(r.own)}
                </td>
                <td data-cell="evidence" className={NUM}>
                  {formatRatio(r.evidence)}
                </td>
                <td data-cell="returned" className={NUM}>
                  {formatRatio(r.returned)}
                  <span data-cell="pending" className="block text-[13px] text-navy-600">
                    30일 안 지남 {r.pending}
                  </span>
                </td>
                <td data-cell="moved" className={NUM}>
                  {formatRatio(r.moved)}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <div className="space-y-4">
          <Definition d={DEFINITIONS.own} />
          <Definition d={DEFINITIONS.evidence} />
          <Definition d={DEFINITIONS.returned} />
          <Definition d={DEFINITIONS.moved} />
        </div>
      </Panel>

      <Panel id="region-costs" title={`지역 편집비 — ${dash.month}`} description="지역·달마다 관리자가 입력한 금액입니다. 입력하지 않은 달은 추정하지 않고 '편집비 미입력'으로 보입니다.">
        <nav aria-label="편집비 달" className="mb-3 flex flex-wrap gap-2">
          <Link href={monthLinkTarget(shiftMonth(dash.month, -1))} className="inline-flex min-h-11 items-center rounded-xl border border-navy-200 px-4 text-[15px] font-bold text-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500">
            앞 달
          </Link>
          <Link href={monthLinkTarget(shiftMonth(dash.month, 1))} className="inline-flex min-h-11 items-center rounded-xl border border-navy-200 px-4 text-[15px] font-bold text-navy-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500">
            다음 달
          </Link>
        </nav>
        {costs.length === 0 ? (
          <p data-part="cost-empty" className="text-[15px] text-navy-700">
            <span data-cell="cost-missing">{COST_MISSING}</span> — {dash.month}에 지역 기사가 있거나 편집비가 입력된 지역이 없습니다.
          </p>
        ) : (
          <Table caption={`${dash.month} 지역별 편집비·자체 취재 수·취재 1건당 편집비(편집비 ÷ 자체 취재)`} metric="region-costs" head={["지역", "편집비", "자체 취재", "취재 1건당 편집비"]}>
            {costs.map((c) => (
              <tr key={c.regionCode} data-row={c.regionCode} data-cost-state={c.amountKrw === null ? "missing" : "entered"}>
                <th scope="row" className={`${TD} font-bold`}>
                  {c.name}
                  <span className={`${MONO} block text-navy-500`}>{c.regionCode}</span>
                </th>
                <td data-cell="cost" className={NUM}>
                  {c.amountKrw === null ? COST_MISSING : formatKrw(c.amountKrw)}
                </td>
                <td data-cell="own" className={NUM}>
                  {`${c.own}건`}
                </td>
                <td data-cell="per-article" className={NUM}>
                  {formatPerArticle(c)}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <div className="mt-4">
          <CostForm dash={dash} canEdit={canEditCost} />
        </div>
      </Panel>
    </div>
  );
}
