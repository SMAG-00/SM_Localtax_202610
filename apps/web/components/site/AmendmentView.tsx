import { ProgressStageBadge, UiLink } from "@ltr/ui";
import type { AmendmentCard, AmendmentDetailView, AmendmentListView } from "@/lib/server/public";

// 개정 트래커 화면 (TX-07·08 — docs/dev/W3_설계.md 5장). 단계 배지(ProgressStageBadge)가 6단계·날짜·원문 링크·해당 없음 사유·
// `시행 예정`과 `확정 아님` 칩(확정 기준 단계 settings.amendment_confirmed_stage 앞)을 한 컴포넌트로 그린다. 칩을 손으로 켜는 자리는 없다.

function Stage({ card, today }: { card: AmendmentCard; today: string }) {
  return card.state.events.length === 0 ? (
    <p data-part="no-stage" className="text-[15px] text-navy-500">
      아직 기록된 단계가 없습니다.
    </p>
  ) : (
    <ProgressStageBadge events={card.state.events} today={today} confirmStage={card.state.confirmStage} />
  );
}

export function AmendmentList({ view }: { view: AmendmentListView }) {
  return (
    <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-10">
      <h1 className="text-[28px] font-black text-navy-900">개정 트래커</h1>
      <p className="mt-2 text-[15px] text-navy-700">지방세 개정안이 어느 단계에 있는지 단계별 날짜와 원문으로 확인합니다. 공포 전 단계는 확정된 내용이 아닙니다.</p>
      {view.items.length === 0 ? (
        <p data-part="empty" className="mt-8 text-[15px] text-navy-500">
          공개된 개정안이 아직 없습니다.
        </p>
      ) : (
        <ul data-part="amendment-list" className="mt-8 space-y-4">
          {view.items.map((c) => (
            <li key={c.id} data-amendment={c.slug} className="rounded-2xl border border-navy-100 bg-white p-6">
              <h2 className="text-[19px] font-black text-navy-900">
                <UiLink href={c.href} className="underline-offset-4 hover:underline">
                  {c.title}
                </UiLink>
              </h2>
              {c.lawNames.length > 0 && <p className="mt-1 text-[14px] text-navy-500">{c.lawNames.join(" · ")}</p>}
              <div className="mt-3">
                <Stage card={c} today={view.today} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export function AmendmentDetail({ view }: { view: AmendmentDetailView }) {
  const c = view.item;
  return (
    <main id="main" className="mx-auto w-full max-w-[860px] px-4 py-10">
      <p className="text-[13px] font-bold text-hermes-800">개정 트래커</p>
      <h1 className="mt-1 text-[28px] font-black text-navy-900">{c.title}</h1>
      {c.lawNames.length > 0 && <p className="mt-1 text-[14px] text-navy-500">{c.lawNames.join(" · ")}</p>}
      {c.summary && <p className="mt-4 text-[16px] leading-7 text-navy-800">{c.summary}</p>}
      <section aria-label="진행 단계" data-part="timeline" className="mt-8">
        <Stage card={c} today={view.today} />
      </section>
      <section aria-labelledby="amendment-articles" data-part="linked-articles" className="mt-10">
        <h2 id="amendment-articles" className="text-[17px] font-black text-navy-900">
          이 개정안을 다룬 기사
        </h2>
        {view.articles.length === 0 ? (
          <p className="mt-2 text-[15px] text-navy-500">연결된 기사가 아직 없습니다.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-[15px]">
            {view.articles.map((a) => (
              <li key={a.id}>
                <UiLink href={a.href} className="underline underline-offset-4">
                  {a.title}
                </UiLink>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
