import { MeasureSecurity } from "./SecurityMeasure";
import { SECURITY_ITEM_TITLES, type SecurityEntry } from "@/lib/security/items";
import type { SecurityPageView } from "@/lib/server/public/security";

// 보안 정책 페이지 (SEC-01). 본문은 PO가 입력해 게시한 DB 값이고 이 파일에 보안 정책 문구는 없다. 항목마다 마지막 확인일을 보인다.
// "인증" 문구는 두지 않는다 - 인증 추진은 5단계(SEC-02). 통제 목록은 ISO/IEC 27001 부속서 A를 본뜬 내부 목록이라는 사실만 안내한다.
export function SecurityPage({ view, entry }: { view: SecurityPageView; entry: SecurityEntry }) {
  return (
    <main id="main" className="mx-auto w-full max-w-[860px] px-4 py-10" data-part="security">
      <MeasureSecurity entry={entry} />
      <h1 className="text-[28px] font-black text-navy-900">보안 정책</h1>
      <p className="mt-2 text-[15px] text-navy-700">7개 항목을 항목별 마지막 확인일과 함께 공개합니다.</p>
      {view.lastCheckOn && (
        <p className="mt-2 text-[14px] text-navy-500" data-part="self-check">
          마지막 자가 점검 완료일 <time dateTime={view.lastCheckOn} className="font-mono">{view.lastCheckOn}</time>
          {view.controls !== null ? ` · 점검한 통제 ${view.controls}개` : ""}
        </p>
      )}
      <ol className="mt-8 space-y-6" data-part="security-items">
        {view.items.map((i) => (
          <li key={i.item_key} data-item={i.item_key} className="rounded-2xl border border-navy-100 p-5">
            <h2 className="text-[20px] font-bold text-navy-900">{SECURITY_ITEM_TITLES[i.item_key]}</h2>
            <p className="mt-2 whitespace-pre-line text-[15px] text-navy-700">{i.body}</p>
            <p className="mt-3 text-[13px] text-navy-500">
              마지막 확인일 <time dateTime={i.confirmed_on} className="font-mono" data-part="confirmed-on">{i.confirmed_on}</time>
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-8 text-[14px] text-navy-500" data-part="controls-note">내부 통제 목록은 ISO/IEC 27001 부속서 A를 본뜬 것이며 정기적으로 자가 점검합니다.</p>
    </main>
  );
}
