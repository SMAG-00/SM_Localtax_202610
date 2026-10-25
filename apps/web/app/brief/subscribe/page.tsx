import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Eyebrow, brand } from "@ltr/ui";
import { signFillToken } from "@/lib/auth/signup-input";
import { SUBSCRIBE_MESSAGES, type SubscribeCode } from "@/lib/brief/subscribe";
import { briefOpen } from "@/lib/server/auth-guard";
import { featureOn } from "@/lib/server/brief/policy";
import { guardSecret } from "@/lib/server/env";
import { publicDb, rowsOf } from "@/lib/server/public/db";
import { adminClient } from "@/lib/server/supabase";

// 브리핑·개정 알림 구독 (/brief/subscribe, W10-e - BRIEF-02 · TX-12) - 일반 HTML 폼(JS 없이 동작). 닫혀 있으면 404.
// 브리핑과 개정 알림은 따로 고른다(따로 구독·해지). 확인 메일의 링크를 눌러야 끝난다(이중 확인). 동의 문구는 사실만 적는다(정책 문구는 법률 검토 뒤 PO 입력).
export const metadata: Metadata = { title: "브리핑 구독", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const openFillToken = (secret: string) => signFillToken(secret, Date.now());
const input = "mt-1 block min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[16px] text-navy-900";
const isCode = (v: unknown): v is SubscribeCode => typeof v === "string" && Object.hasOwn(SUBSCRIBE_MESSAGES, v);
const check = "flex min-h-11 items-center gap-2 text-[15px] text-navy-900";

export default async function SubscribePage({ searchParams }: Props) {
  const db = adminClient();
  const secret = guardSecret();
  if (!db || !secret || !(await briefOpen(db).catch(() => false)) || !(await featureOn(db, "brief_regular").catch(() => false))) notFound();
  const alertsOn = await featureOn(db, "amendment_alerts").catch(() => false);
  const q = await searchParams;
  const done = q.done === "sent" || q.done === "already" ? q.done : null;
  const error = isCode(q.e) && q.e !== "sent" && q.e !== "already" ? q.e : null;
  const [cats, amendments] = alertsOn
    ? await Promise.all([
        rowsOf<{ slug: string; name: string }>(publicDb().from("categories").select("slug, name").eq("section", "tax").eq("visible", true).order("sort"), "세목 분야"),
        rowsOf<{ id: number; title: string }>(publicDb().from("amendments").select("id, title").order("id", { ascending: false }).limit(50), "개정안"),
      ])
    : [[], []];
  const fill = openFillToken(secret);
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <p className="text-[17px] font-extrabold tracking-tight text-navy-900">
        {brand.productName} <span className="text-hermes-500">·</span> 브리핑
      </p>
      <div className="mt-8 rounded-2xl border border-navy-100 bg-white p-6">
        <Eyebrow>SUBSCRIBE</Eyebrow>
        <h1 className="mt-3 text-[28px] leading-tight font-black text-navy-900">구독하기</h1>
        {done ? (
          <p role="status" data-testid="subscribe-done" data-code={done} className="mt-6 rounded-xl border border-navy-100 bg-navy-50 px-4 py-3 text-[15px] font-bold text-navy-900">
            {SUBSCRIBE_MESSAGES[done]}
          </p>
        ) : (
          <form method="post" action="/api/brief/subscribe" className="mt-6 space-y-4" data-testid="subscribe-form">
            {error && (
              <p role="alert" data-testid="subscribe-error" data-code={error} className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
                {SUBSCRIBE_MESSAGES[error]}
              </p>
            )}
            <div>
              <label htmlFor="sub-email" className="block text-[15px] font-bold text-navy-900">
                이메일
              </label>
              <input id="sub-email" name="email" type="email" autoComplete="email" required maxLength={254} className={input} />
            </div>
            <label className={check}>
              <input type="checkbox" name="agree_brief" className="size-5" /> 주간 브리핑 수신에 동의합니다
            </label>
            {alertsOn && (
              <fieldset className="space-y-1">
                <label className={check}>
                  <input type="checkbox" name="agree_alert" className="size-5" /> 관심 세목·개정안 알림 수신에 동의합니다
                </label>
                <legend className="pt-2 text-[14px] font-bold text-navy-900">관심 세목</legend>
                {cats.map((c) => (
                  <label key={c.slug} className={check}>
                    <input type="checkbox" name="tax_kinds" value={c.slug} className="size-5" /> {c.name}
                  </label>
                ))}
                <p className="pt-2 text-[14px] font-bold text-navy-900">관심 개정안</p>
                {amendments.map((a) => (
                  <label key={a.id} className={check}>
                    <input type="checkbox" name="amendment_ids" value={a.id} className="size-5" /> {a.title}
                  </label>
                ))}
                <label className={check}>
                  <input type="checkbox" name="include_docs" className="size-5" /> 새 해석 문서도 알림 받기
                </label>
              </fieldset>
            )}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label htmlFor="sub-website">웹사이트</label>
              <input id="sub-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
            </div>
            <input type="hidden" name="fill" value={fill} />
            <button type="submit" className="min-h-11 w-full rounded-xl bg-navy-900 px-4 text-[16px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400">
              구독 신청
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
