import { Eyebrow } from "@ltr/ui";
import type { AccuracyRow } from "@/lib/calc/accuracy-view";

// 계산 정확도 검증 (CALC-14 · FAM-07) - 숫자는 마지막 대조 실행 결과(공개 게이트 뷰)에서만 온다. 이 파일에 건수·날짜 리터럴 0.
export function AccuracyTable({ rows }: { rows: AccuracyRow[] }) {
  return (
    <main id="main" className="mx-auto w-full max-w-[900px] px-4 py-8" data-ui="accuracy">
      <Eyebrow>ACCURACY · 계산 정확도 검증</Eyebrow>
      <h1 className="mt-2 text-[28px] font-black text-navy-900">계산 정확도 검증</h1>
      <p className="mt-3 text-[16px] text-navy-800" data-part="method">
        방법 — 세무 감수위원이 개인정보를 지워 제공한 실제 결과와 이 사이트 계산을 원 단위로 맞춰 봐요. 대조는 정해진 때마다 다시 돌아가고, 하나라도 어긋나면 그 세목(원인)의 계산은 공개하지 않아요. 어긋난 곳은 원인(단수 처리·룰셋 값·입력 해석)을 적고 고친 뒤 다시 맞춰 봐요.
      </p>
      <table className="mt-6 w-full text-[15px]" data-part="accuracy-table">
        <thead className="text-left text-navy-600">
          <tr>
            <th scope="col" className="py-2 font-bold">세목</th>
            <th scope="col" className="py-2 text-right font-bold">공식 결과 일치</th>
            <th scope="col" className="py-2 text-right font-bold">감수 표본 일치</th>
            <th scope="col" className="py-2 text-right font-bold">마지막 확인일</th>
            <th scope="col" className="py-2 text-right font-bold">공개 상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-row={r.id} data-open={r.open} className="border-t border-navy-100">
              <th scope="row" className="py-3 text-left font-bold">{r.label}</th>
              <td className="py-3 text-right font-mono tabular-nums">{r.officialMatched}/{r.officialCases}</td>
              <td className="py-3 text-right font-mono tabular-nums">{r.sampleMatched}/{r.sampleCases}</td>
              <td className="py-3 text-right font-mono tabular-nums">{r.checkedOn ?? "—"}</td>
              <td className="py-3 text-right font-bold">{r.open ? "공개" : "아직 공개하지 않음"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-[13px] text-navy-500">아직 공개하지 않은 세목은 SM 부동산 세금 플랫폼 계산기 연결로 안내해요. 입력값은 어느 사이트로도 넘어가지 않아요.</p>
    </main>
  );
}
