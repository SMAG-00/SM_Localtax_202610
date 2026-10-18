import Link from "next/link";
import { Callout, TextField } from "@ltr/ui";
import { isoToKstDateTime } from "@/lib/admin/form-utils";
import { QUERY_TERMS_PATH, hiddenNote, moreNote, synonymAddHref, synonymLineHref, termsPeriodLinks, termsPeriodText } from "@/lib/admin/query-terms-view";
import type { QueryTermsReport } from "@/lib/server/analytics/query-terms";
import { DataTable, EmptyNote, MONO, OUTLINE_BUTTON, TD, TEXT_LINK, ToneChip } from "./ui";

// 검색어 집계 화면 (/admin/query-terms — SRCH-03, docs/dev/W2-d_설계.md 8.3). 서버 컴포넌트 — 기간 단추·기간 폼은 링크와 GET 폼(JS 없이).
// 보이는 것은 서버가 가린 값·정규형·합계뿐이다. 최소 횟수보다 적게 찾은 검색어는 수만 보인다. 표는 넘치면 표만 가로로(360px 페이지 가로 스크롤 0).

function PeriodPicker({ report }: { report: QueryTermsReport }) {
  const p = report.period;
  return (
    <div className="space-y-4 rounded-2xl border border-navy-100 bg-white p-4">
      <nav aria-label="기간">
        <ul className="flex flex-wrap gap-2">
          {termsPeriodLinks(p).map((l) => (
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
      <form method="get" action={QUERY_TERMS_PATH} aria-label="기간 직접 고르기" className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-48">
          <TextField id="query-terms-from" name="from" type="date" label="시작일" defaultValue={p.from} />
        </div>
        <div className="w-full sm:w-48">
          <TextField id="query-terms-to" name="to" type="date" label="끝날" defaultValue={p.to} />
        </div>
        <button type="submit" className={OUTLINE_BUTTON}>
          이 기간 보기
        </button>
      </form>
      {report.periodError && (
        <p role="alert" data-part="period-error" className="text-[15px] text-rose-700">
          {report.periodError} — 최근 7일을 보입니다.
        </p>
      )}
    </div>
  );
}

export function QueryTermsView({ report }: { report: QueryTermsReport }) {
  const hidden = hiddenNote(report);
  const more = moreNote(report);
  return (
    <div className="space-y-6">
      <PeriodPicker report={report} />
      <div className="space-y-2 text-[15px] text-navy-700">
        <p data-part="summary" data-terms={report.terms} data-shown={report.shown} data-searches={report.searches}>
          기간 <span className={`${MONO} text-navy-900`}>{termsPeriodText(report.period)}</span> · 검색 {report.searches.toLocaleString("ko-KR")}번 · 검색어 {report.terms.toLocaleString("ko-KR")}개 · 계산{" "}
          <span className={MONO}>{isoToKstDateTime(report.computedAt)}</span> (한국 시간)
        </p>
        <p>
          사람이 사이트 검색창에 찾은 말을 정규형(띄어쓰기·기호를 정리한 낱말)마다 하루 단위로 더했습니다. 전화번호·이메일·주민등록번호·9자리 이상 숫자는 저장하기 전에 가렸고, 봇·편집국·측정
          거부·30분 안에 다시 찾은 것은 세지 않았습니다. 날 행은 {report.retentionDays}일 동안 둡니다.
        </p>
        {hidden && <p data-part="hidden-note">{hidden}</p>}
        {more && <p data-part="more-note">{more}</p>}
      </div>
      {report.rows.length === 0 ? (
        <EmptyNote>이 기간에 목록에 보일 검색어가 없습니다.</EmptyNote>
      ) : (
        <DataTable caption={`많이 찾은 검색어 — ${termsPeriodText(report.period)}`} head={["순위", "검색어 (가린 값)", "정규형", "찾은 횟수", "찾은 날", "마지막으로 찾은 때", "동의어 사전"]}>
          {report.rows.map((r, i) => (
            <tr key={r.normalized} data-part="query-term" data-normalized={r.normalized} data-count={r.count}>
              <td className={`${TD} font-mono tabular-nums`}>{i + 1}</td>
              <td className={`${TD} font-bold text-navy-900 [overflow-wrap:anywhere]`}>{r.termMasked}</td>
              <td className={`${TD} [overflow-wrap:anywhere]`}>
                <span className={MONO}>{r.normalized}</span>
              </td>
              <td className={`${TD} text-right font-mono tabular-nums`}>{r.count.toLocaleString("ko-KR")}</td>
              <td className={`${TD} text-right font-mono tabular-nums`}>{r.days}일</td>
              <td className={`${TD} ${MONO}`}>{isoToKstDateTime(r.lastSeen)}</td>
              <td className={TD}>
                {r.synonym ? (
                  <Link href={synonymLineHref(r.synonym.id)} className={TEXT_LINK} data-part="synonym-line">
                    <ToneChip tone={r.synonym.enabled ? "emerald" : "plain"}>{r.synonym.enabled ? "동의어 있음" : "동의어 쉬는 중"}</ToneChip>
                  </Link>
                ) : (
                  <Link href={synonymAddHref(r.normalized)} className={TEXT_LINK} data-part="synonym-add">
                    동의어 더하기
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}

export function QueryTermsLoadError({ message }: { message: string }) {
  return (
    <Callout>
      <span data-part="load-error">{message}</span>
    </Callout>
  );
}
