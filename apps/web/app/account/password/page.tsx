import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eyebrow, brand } from "@ltr/ui";
import { PasswordForm } from "@/components/account/PasswordForm";
import { getViewer } from "@/lib/server/dal";
import { readMemberSettings } from "@/lib/server/auth-guard";
import { adminClient } from "@/lib/server/supabase";

// 로그인한 상태의 비밀번호 바꾸기 (W2-e 4.2) — 기능 키에 묶지 않는다(편집국·관리자도 쓰고, 공개 메뉴에 없고, 로그인이 필요하다).
// 로그인하지 않았으면 로그인 화면으로 보낸다(지금 있는 로그인 화면은 편집국 로그인 하나 — 회원 /login은 2단계).
export const metadata: Metadata = { title: "비밀번호 바꾸기" };
export const dynamic = "force-dynamic";

export default async function PasswordPage() {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) redirect(`/admin/login?next=${encodeURIComponent("/account/password")}`);
  const db = adminClient();
  // 규칙 숫자는 설정(member)에서 읽는다 — 읽지 못하면 입력 중 안내만 빠지고 서버가 규칙을 판정한다
  const rules = db ? await readMemberSettings(db).then((m) => ({ minChars: m.passwordMinChars, maxBytes: m.passwordMaxBytes })).catch(() => null) : null;
  const isStaff = viewer.isAdmin || viewer.roles.length > 0;
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <p className="text-[17px] font-extrabold tracking-tight text-navy-900">
        {brand.productName} <span className="text-hermes-500">·</span> 내 계정
      </p>
      <div className="mt-8 rounded-2xl border border-navy-100 bg-white p-6">
        <Eyebrow>ACCOUNT</Eyebrow>
        <h1 className="mt-3 text-[28px] leading-tight font-black text-navy-900">비밀번호 바꾸기</h1>
        <p className="mt-1 text-[15px] text-navy-600">
          <span data-testid="account-email" className="[overflow-wrap:anywhere]">
            {viewer.email ?? "이메일 없음"}
          </span>{" "}
          계정의 비밀번호를 바꿉니다. 바꾸면 다른 기기에서는 로그아웃됩니다.
        </p>
        <PasswordForm email={viewer.email ?? ""} rules={rules} />
      </div>
      <p className="mt-6 text-[15px]">
        <Link
          href={isStaff ? "/admin" : "/"}
          prefetch={false}
          className="inline-flex min-h-11 items-center font-bold text-navy-700 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-400"
        >
          {isStaff ? "편집국으로 돌아가기" : "홈으로 돌아가기"}
        </Link>
      </p>
    </main>
  );
}
