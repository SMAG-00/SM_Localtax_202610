"use client";

import { useState } from "react";
import { PrimaryButton } from "@ltr/ui";

// 디지털 구독 신청 (W10-f, PAY-01·02) - 요금제 선택 + 안내 확인 체크 -> 주문 만들기 -> PG 카드 인증.
//  · 카드 정보는 이 화면·우리 서버를 지나지 않는다. toss 공급자는 토스 결제창(SDK)이 카드 인증을 하고 authKey만 우리 완료 주소로 돌아온다.
//  · 요금제 이름·금액·기간은 서버가 DB 데이터에서 읽어 넘긴 값이다. 안내 문구(약관·환불)는 정책 문서가 정한다 - 이 화면은 확인 체크만 받는다.
//  · fake 공급자(로컬 시험)는 브라우저 인증 단계가 없어 주문 번호만 보여 준다 (시험은 API로 진행).

export interface PlanOption {
  planId: number;
  title: string;
  periodMonths: number;
  amount: number;
}

interface Checkout {
  orderNo: string;
  amount: number;
  provider: "fake" | "toss";
  mode: "test" | "live";
  clientKey: string;
  customerKey: string;
}

declare global {
  interface Window {
    TossPayments?: (clientKey: string) => {
      payment(o: { customerKey: string }): { requestBillingAuth(o: { method: "CARD"; successUrl: string; failUrl: string }): Promise<void> };
    };
  }
}

function loadToss(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.TossPayments) return resolve();
    const s = document.createElement("script");
    s.src = "https://js.tosspayments.com/v2/standard";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("결제창을 불러오지 못했습니다"));
    document.head.appendChild(s);
  });
}

export function SubscribeForm({ plans, loggedIn }: { plans: PlanOption[]; loggedIn: boolean }) {
  const [planId, setPlanId] = useState<number | null>(plans[0]?.planId ?? null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function start() {
    if (planId === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId, termsAck: ack, idempotencyKey: `web-${crypto.randomUUID()}` }),
      });
      const body = (await res.json()) as { checkout?: Checkout; error?: string };
      if (!res.ok || !body.checkout) {
        setMessage(body.error ?? "결제를 시작하지 못했습니다");
        return;
      }
      const c = body.checkout;
      if (c.provider === "fake") {
        setMessage(`시험 주문이 만들어졌습니다 (주문번호 ${c.orderNo}). 가짜 PG 모드라 카드 인증 창은 없습니다.`);
        return;
      }
      await loadToss();
      const origin = window.location.origin;
      await window.TossPayments!(c.clientKey)
        .payment({ customerKey: c.customerKey })
        .requestBillingAuth({
          method: "CARD",
          successUrl: `${origin}/store/subscription/complete?orderNo=${encodeURIComponent(c.orderNo)}`,
          failUrl: `${origin}/store/subscription?failed=1`,
        });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "결제를 시작하지 못했습니다");
    } finally {
      setBusy(false);
    }
  }

  if (!loggedIn) {
    // 요금표는 로그인 전에도 보인다(가격은 숨기지 않는다) - 구독 시작만 로그인 뒤
    return (
      <div className="mt-6">
        <ul data-part="plan-list" className="space-y-2 text-[16px] text-navy-800">
          {plans.map((p) => (
            <li key={p.planId} data-plan-id={p.planId}>
              {p.title} - {p.periodMonths}개월 - {p.amount.toLocaleString("ko-KR")}원
            </li>
          ))}
        </ul>
        <p data-part="subscribe-login" className="mt-4 text-[17px] text-navy-800">
          구독하려면 먼저{" "}
          <a className="font-bold underline underline-offset-4" href="/login?next=/store/subscription">
            로그인
          </a>
          해 주세요.
        </p>
      </div>
    );
  }
  return (
    <form
      data-part="subscribe-form"
      className="mt-6 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-[17px] font-black text-navy-900">요금제</legend>
        {plans.map((p) => (
          <label key={p.planId} className="flex min-h-11 items-center gap-3 text-[16px] text-navy-800">
            <input type="radio" name="plan" value={p.planId} checked={planId === p.planId} onChange={() => setPlanId(p.planId)} />
            <span>
              {p.title} - {p.periodMonths}개월 - {p.amount.toLocaleString("ko-KR")}원
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex min-h-11 items-center gap-3 text-[16px] text-navy-800">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>자동갱신과 해지 안내를 확인했습니다</span>
      </label>
      <PrimaryButton type="submit" disabled={busy || !ack || planId === null}>
        {busy ? "진행 중" : "카드 인증하고 구독하기"}
      </PrimaryButton>
      {message && (
        <p role="status" data-part="subscribe-message" className="text-[16px] text-navy-800">
          {message}
        </p>
      )}
    </form>
  );
}
