import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eyebrow, brand } from "@ltr/ui";
import { MyNotifyLinks } from "@/components/account/MyNotifyLinks";
import { InterestFields } from "@/components/account/interest-fields";
import { SignupCompletedBeacon } from "@/components/account/signup-completed-beacon";
import { CONSENT_KINDS, loadMyProfile, loadPickerOptions, type ConsentKind } from "@/lib/server/accounts/my-data";
import { readMemberSettings } from "@/lib/server/auth-guard";
import { getViewer } from "@/lib/server/dal";
import { NEWS_TAB_LABELS, isSectionKey } from "@/lib/server/public/constants";
import { getMemberFeed } from "@/lib/server/public/member-feed";
import { adminClient } from "@/lib/server/supabase";

// 내 화면 (/my, W2-e 설계 5.1 · 5.2) — 로그인한 본인 것만. 새 글 블록 · 표시 이름 · 관심 분야/지역 · 수신 동의 · 비밀번호 · 탈퇴.
// 사용자별 화면이라 캐시하지 않고(force-dynamic) 검색에도 나오지 않는다(noindex). 시각은 서버 함수에서만 읽는다.
export const metadata: Metadata = { title: "내 화면", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const ERRORS: Record<string, string> = {
  interests: "관심 분야 값이 맞지 않거나 개수 한도를 넘었습니다 — 목록에서 다시 골라 주세요",
  regions: "관심 지역 값이 맞지 않거나 개수 한도를 넘었습니다 — 목록에서 다시 골라 주세요",
  codes: "없거나 폐지된 분야·지역이 있습니다 — 목록에서 다시 골라 주세요",
  display_name: "표시 이름은 제한 글자 수 이하로, 이메일 모양이 아니게 넣어 주세요",
  consent: "동의 종류가 맞지 않습니다",
  intent: "요청을 처리하지 못했습니다",
};
const CONSENT_LABELS: Record<ConsentKind, string> = {
  receive: "소식 수신 동의",
  marketing: "마케팅 정보 수신 동의",
  brief_prereg: "브리핑 사전 알림 동의",
};
const input = "mt-1 block min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-[16px] text-navy-900";
const button = "min-h-11 rounded-xl bg-navy-900 px-4 text-[16px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400";
const card = "mt-6 rounded-2xl border border-navy-100 bg-white p-6";

export default async function MyPage({ searchParams }: Props) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) redirect(`/login?next=${encodeURIComponent("/my")}`);
  const db = adminClient();
  if (!db) throw new Error("서버 설정이 끝나지 않았습니다");
  const q = await searchParams;
  const welcome = q.welcome === "1";
  const saved = typeof q.saved === "string" ? q.saved : null;
  const error = typeof q.e === "string" && Object.hasOwn(ERRORS, q.e) ? ERRORS[q.e]! : null;

  const [profile, options, member] = await Promise.all([loadMyProfile(db, viewer.userId), loadPickerOptions(db), readMemberSettings(db)]);
  const feed = await getMemberFeed(profile.interests, profile.regionCodes).catch(() => []);
  const hasInterest = profile.interests.length + profile.regionCodes.length > 0;

  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <p className="text-[17px] font-extrabold tracking-tight text-navy-900">
        {brand.productName} <span className="text-hermes-500">·</span> 내 화면
      </p>
      <div className="mt-8 rounded-2xl border border-navy-100 bg-white p-6">
        <Eyebrow>MY</Eyebrow>
        <h1 className="mt-3 text-[28px] leading-tight font-black text-navy-900">내 화면</h1>
        <MyNotifyLinks db={db} />
        {welcome && (
          <p role="status" data-testid="my-welcome" className="mt-4 rounded-xl border border-navy-100 bg-navy-50 px-4 py-3 text-[15px] font-bold text-navy-900">
            가입이 완료되었습니다
          </p>
        )}
        {welcome && <SignupCompletedBeacon interestCount={profile.interests.length} regionCount={profile.regionCodes.length} />}
        {saved && (
          <p role="status" data-testid="my-saved" className="mt-4 rounded-xl border border-navy-100 bg-navy-50 px-4 py-3 text-[15px] font-bold text-navy-900">
            저장했습니다
          </p>
        )}
        {error && (
          <p role="alert" data-testid="my-error" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
            {error}
          </p>
        )}
        <p className="mt-4 text-[15px] text-navy-600">
          로그인한 계정: <span data-testid="my-email" className="[overflow-wrap:anywhere]">{viewer.email ?? "이메일 없음"}</span>
        </p>
      </div>

      {!hasInterest ? (
        <p className={`${card} text-[15px] text-navy-900`} data-testid="my-feed-empty">
          관심 분야를 고르면 새 글을 모아 보여 드립니다.{" "}
          <a href="#my-interests" className="inline-flex min-h-11 items-center font-bold text-navy-700 underline underline-offset-4">관심 분야 고르기</a>
        </p>
      ) : (
        feed.length > 0 && (
          <section aria-labelledby="my-feed-title" data-testid="my-feed" className={card}>
            <h2 id="my-feed-title" className="text-[20px] font-black text-navy-900">내 관심 분야 새 글</h2>
            <ul className="mt-3 space-y-3">
              {feed.map((a) => (
                <li key={a.id}>
                  <Link href={a.href} className="block min-h-11 text-[16px] font-bold text-navy-900 underline-offset-4 hover:underline">{a.title}</Link>
                  <span className="text-[14px] text-navy-600">{isSectionKey(a.section) ? NEWS_TAB_LABELS[a.section] : a.section} · {a.publishedOn}</span>
                </li>
              ))}
            </ul>
          </section>
        )
      )}

      <form method="post" action="/api/my/profile" id="my-interests" className={`${card} space-y-4`}>
        <h2 className="text-[20px] font-black text-navy-900">프로필·관심 분야·관심 지역</h2>
        <input type="hidden" name="intent" value="profile" />
        <div>
          <label htmlFor="my-name" className="block text-[15px] font-bold text-navy-900">표시 이름 (선택)</label>
          <input id="my-name" name="displayName" type="text" autoComplete="nickname" maxLength={60} defaultValue={profile.displayName ?? ""} className={input} />
        </div>
        <InterestFields categories={options.categories} regions={options.regions} interests={profile.interests} regionCodes={profile.regionCodes} interestMax={member.interestMax} regionLimit={member.interestRegionLimit} idPrefix="my" />
        <p className="text-[14px] text-navy-600">관심 분야·지역을 저장해도 메일 수신 동의는 생기지 않습니다.</p>
        <button type="submit" className={button}>저장</button>
      </form>

      <section className={card} aria-labelledby="my-consent-title">
        <h2 id="my-consent-title" className="text-[20px] font-black text-navy-900">수신 동의</h2>
        <p className="mt-2 text-[14px] text-navy-600">지금은 보내는 메일이 없습니다. 발행이 시작되면 보내 드립니다.</p>
        <ul className="mt-3 space-y-3">
          {CONSENT_KINDS.map((kind) => {
            const on = profile.consents.includes(kind);
            return (
              <li key={kind}>
                <form method="post" action="/api/my/profile" className="flex items-center justify-between gap-3" data-testid={`consent-${kind}`}>
                  <input type="hidden" name="intent" value="consent" />
                  <input type="hidden" name="kind" value={kind} />
                  <input type="hidden" name="on" value={on ? "0" : "1"} />
                  <span className="text-[15px] text-navy-900">{CONSENT_LABELS[kind]} — <strong>{on ? "켜짐" : "꺼짐"}</strong></span>
                  <button type="submit" className={button}>{on ? "끄기" : "켜기"}</button>
                </form>
              </li>
            );
          })}
        </ul>
      </section>

      <p className="mt-6 text-[15px]">
        <Link href="/account/password" prefetch={false} className="inline-flex min-h-11 items-center font-bold text-navy-700 underline underline-offset-4">비밀번호 바꾸기</Link>
      </p>
      <p className="text-[15px]">
        <Link href="/my/withdraw" prefetch={false} className="inline-flex min-h-11 items-center font-bold text-navy-700 underline underline-offset-4">탈퇴</Link>
      </p>
    </main>
  );
}
