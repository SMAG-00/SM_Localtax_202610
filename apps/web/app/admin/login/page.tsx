import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Eyebrow, brand } from "@ltr/ui";
import { LoginForm } from "@/components/admin/LoginForm";
import { safeNextPath } from "@/lib/admin/next-path";
import { getViewer } from "@/lib/server/dal";

// 편집국 로그인 (/admin/login) — 돌아갈 주소(next)는 같은 사이트의 /admin 아래만 받는다. 이미 로그인했으면 바로 보낸다.
export const metadata: Metadata = { title: "로그인" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function LoginPage({ searchParams }: Props) {
  const next = safeNextPath((await searchParams).next);
  const viewer = await getViewer().catch(() => null);
  if (viewer) redirect(next);
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <p className="text-[17px] font-extrabold tracking-tight text-navy-900">
        {brand.wordmark.lead} <span className="text-hermes-500">·</span> 편집국
      </p>
      <div className="mt-8 rounded-2xl border border-navy-100 bg-white p-6">
        <Eyebrow>NEWSROOM</Eyebrow>
        <h1 className="mt-3 text-[28px] leading-tight font-black text-navy-900">편집국 로그인</h1>
        <p className="mt-1 text-[15px] text-navy-600">편집국 계정의 이메일과 비밀번호를 넣어 주세요.</p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
