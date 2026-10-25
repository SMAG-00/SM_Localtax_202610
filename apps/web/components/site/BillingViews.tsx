import { UiLink } from "@ltr/ui";
import type { PublicPlan } from "@/lib/server/billing/plans";
import { paragraphsOf, type PaywallPreview } from "@/lib/server/billing/paywall-logic";
import type { MyBilling } from "@/lib/server/billing/service";
import { SiteSection, TEXT_LINK } from "./SiteSection";
import { SubscribeForm } from "./SubscribeForm";

// 디지털 구독·페이월 공개 화면 (W10-f BIZ-04). 정책·약관 문구는 이 파일에 없다 - 데이터(요금제·기간·금액)와 상태만 보여 준다.
// 시험 모드에서는 시험 결제 배너가 항상 보인다 (실결제가 아님을 알리는 표시).

export function TestModeBanner({ mode }: { mode: "test" | "live" }) {
  if (mode !== "test") return null;
  return (
    <p role="note" data-part="test-mode-banner" className="rounded-xl border border-navy-200 bg-white px-4 py-3 text-[15px] font-bold text-navy-900">
      시험 결제 모드입니다. 실제 결제는 일어나지 않습니다.
    </p>
  );
}

export function SubscriptionPage({ plans, loggedIn, mode }: { plans: PublicPlan[]; loggedIn: boolean; mode: "test" | "live" }) {
  const first = plans[0];
  return (
    <div data-ui="subscription-page">
      <SiteSection id="subscription-head" tone="ivory" first heading={{ eyebrow: "SUBSCRIPTION", title: first?.productTitle ?? "디지털 구독" }} data={{ "data-store-part": "subscription" }}>
        <TestModeBanner mode={mode} />
        {first?.productSummary && (
          <p data-part="subscription-summary" className="mt-4 text-[17px] text-navy-800">
            {first.productSummary}
          </p>
        )}
        <SubscribeForm plans={plans.map((p) => ({ planId: p.planId, title: p.planTitle, periodMonths: p.periodMonths, amount: p.amount }))} loggedIn={loggedIn} />
        <p className="mt-6">
          <UiLink href="/my/billing" className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
            내 구독·결제 내역
          </UiLink>
        </p>
      </SiteSection>
    </div>
  );
}

export function SubscriptionCompletePage({ orderStatus }: { orderStatus: string }) {
  const paid = orderStatus === "paid";
  return (
    <div data-ui="subscription-complete">
      <SiteSection id="subscription-complete" tone="ivory" first heading={{ eyebrow: "SUBSCRIPTION", title: paid ? "구독이 시작됐습니다" : "결제가 완료되지 않았습니다" }} data={{ "data-store-part": "complete" }}>
        <p data-part="complete-status" data-order-status={orderStatus} className="mt-4 text-[17px] text-navy-800">
          {paid ? "결제 회사에서 결제를 확인했습니다." : "결제 회사에서 결제 완료를 확인하지 못했습니다. 내 구독 화면에서 상태를 확인해 주세요."}
        </p>
        <p className="mt-6">
          <UiLink href="/my/billing" className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
            내 구독·결제 내역
          </UiLink>
        </p>
      </SiteSection>
    </div>
  );
}

/** 유료 기사 - 본문이 없으면 미리보기 + 구독 안내, 있으면 본문. 본문 글자는 문단 텍스트로만 그린다 */
export function PaywallArticle({ preview, body, loggedIn }: { preview: PaywallPreview; body: string | null; loggedIn: boolean }) {
  return (
    <article data-ui="paywall-article" data-paywall={body ? "open" : "locked"} className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-[32px] leading-tight font-black tracking-tight text-navy-900">{preview.title}</h1>
      {body ? (
        <div data-part="paywall-body" className="mt-8 space-y-5 text-[18px] leading-relaxed text-navy-800">
          {paragraphsOf(body).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      ) : (
        <>
          <p data-part="paywall-preview" className="mt-8 text-[18px] leading-relaxed text-navy-800">
            {preview.preview}
          </p>
          <section data-part="paywall-gate" aria-label="구독 안내" className="mt-10 rounded-2xl border border-navy-100 bg-white p-6">
            <h2 className="text-[19px] font-black text-navy-900">이어지는 내용은 디지털 구독자에게 열립니다</h2>
            <p className="mt-2 text-[16px] text-navy-800">{loggedIn ? "구독 중이 아닙니다." : "로그인한 구독자에게 열립니다."}</p>
            <p className="mt-4">
              <UiLink href="/store/subscription" className={`${TEXT_LINK} inline-flex min-h-11 items-center`}>
                구독 안내 보기
              </UiLink>
            </p>
          </section>
        </>
      )}
    </article>
  );
}

const STATUS_LABEL: Record<string, string> = { active: "이용 중", past_due: "결제 확인 중(유예)", canceled: "해지됨", expired: "종료" };
const ORDER_LABEL: Record<string, string> = { created: "결제 대기", paid: "결제 완료", failed: "결제 실패", canceled: "취소", refunded: "환불" };
const kst = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export function MyBillingPanel({ data, cancelSlot }: { data: MyBilling; cancelSlot: React.ReactNode }) {
  const s = data.subscription;
  return (
    <div data-ui="my-billing">
      {s ? (
        <section data-part="my-subscription" data-status={s.status} aria-label="구독 상태" className="rounded-2xl border border-navy-100 bg-white p-6">
          <h2 className="text-[19px] font-black text-navy-900">{s.planTitle}</h2>
          <dl className="mt-3 space-y-1 text-[16px] text-navy-800">
            <div>
              <dt className="inline font-bold">상태 </dt>
              <dd className="inline">{STATUS_LABEL[s.status] ?? s.status}</dd>
            </div>
            <div>
              <dt className="inline font-bold">이용 기간 끝 </dt>
              <dd className="inline" data-part="period-end">{kst(s.periodEnd)}</dd>
            </div>
            <div>
              <dt className="inline font-bold">자동갱신 </dt>
              <dd className="inline" data-part="auto-renew">{s.autoRenew ? `다음 결제 ${won(s.amount)}` : "꺼짐"}</dd>
            </div>
            {s.nextNotice && (
              <div data-part="renewal-notice">
                <dt className="inline font-bold">갱신 안내 기록 </dt>
                <dd className="inline">
                  {kst(s.nextNotice.notifiedAt)} · {won(s.nextNotice.amount)}
                </dd>
              </div>
            )}
          </dl>
          {s.autoRenew ? cancelSlot : null}
        </section>
      ) : (
        <p data-part="no-subscription" className="text-[17px] text-navy-800">
          이용 중인 구독이 없습니다.
        </p>
      )}
      <section data-part="my-orders" aria-label="결제 내역" className="mt-10">
        <h2 className="text-[19px] font-black text-navy-900">결제 내역</h2>
        {data.orders.length === 0 ? (
          <p className="mt-2 text-[16px] text-navy-700">결제 내역이 없습니다.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-[16px] text-navy-800">
            {data.orders.map((o) => (
              <li key={o.orderNo} data-order-no={o.orderNo}>
                {o.paidAt ? kst(o.paidAt) : "-"} · {won(o.amount)} · {ORDER_LABEL[o.status] ?? o.status}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
