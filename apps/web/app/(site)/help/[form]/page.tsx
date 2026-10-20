import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HelpForm, HelpTabs, openHelpToken } from "@/components/help/HelpForm";
import { HELP_FORMS, isHelpSlug, parseHelpSettings } from "@/lib/help/forms";
import { guardSecret } from "@/lib/server/env";
import { readPublicSettings } from "@/lib/server/public/reads";
import { adminClient } from "@/lib/server/supabase";

// 고객센터 (/help/report · /help/subscribe · /help/ad · /help/contribute, W2-e 설계 7.1) — 기능 키 page_help(+처리방침 게시본)가 꺼져 있으면 404.
// 정정·반론 폼은 /about/corrections 정책 페이지 아래에 붙는다.
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ form: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const generateMetadata = async ({ params }: Props): Promise<Metadata> => {
  const { form } = await params;
  return isHelpSlug(form) && form !== "corrections" ? { title: HELP_FORMS[form].label, robots: { index: false, follow: false } } : {};
};

export default async function HelpPage({ params, searchParams }: Props) {
  const { form } = await params;
  if (!isHelpSlug(form) || form === "corrections") notFound();
  const settings = await readPublicSettings();
  const db = adminClient();
  const secret = guardSecret();
  if (!settings.features.page_help || !db || !secret) notFound();
  const row = await db.from("settings").select("value").eq("key", "help").maybeSingle();
  const help = parseHelpSettings(row.data?.value);
  if (!help) notFound();
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);
  const sent = one(q.sent);
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="text-[28px] leading-tight font-black text-navy-900">고객센터</h1>
      <div className="mt-6">
        <HelpTabs current={form} />
        <h2 className="mb-4 text-[20px] font-extrabold text-navy-900">{HELP_FORMS[form].label}</h2>
        <HelpForm slug={form} fill={openHelpToken(secret)} sent={sent && /^[A-HJ-NP-Z2-9]{8}$/.test(sent) ? sent : null} errorCode={one(q.e)} maxFiles={help.maxFiles} extensions={help.allowedExtensions} />
      </div>
    </main>
  );
}
