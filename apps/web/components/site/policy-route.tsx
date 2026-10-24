import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { queryValue } from "@/lib/site/hub-view";
import { POLICY_DOCS, policyDoc, type PolicyDocKey } from "@/lib/policy/docs";
import { siteUrl } from "@/lib/server/env";
import { aboutOrganizationJsonLd } from "@/lib/site/org-jsonld";
import { JsonLd } from "./JsonLd";
import { getPolicyView } from "@/lib/server/public/policy";
import { HelpForm, openHelpToken } from "@/components/help/HelpForm";
import { parseHelpSettings } from "@/lib/help/forms";
import { guardSecret } from "@/lib/server/env";
import { adminClient } from "@/lib/server/supabase";
import { PolicyPage } from "./PolicyPage";

// 정책 주소 공통 처리 — 기능 키가 닫혔거나 게시본이 없으면 404 (준비 중 쪽 0, W2-e 6.1). ?v=번호는 이전 판(noindex)
type Sp = Record<string, string | string[] | undefined>;

const versionOf = (sp: Sp): number | null => {
  const raw = (queryValue(sp.v) ?? "").trim();
  return /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : raw === "" ? null : -1;
};

export const policyMetadata = async (docKey: PolicyDocKey, sp: Sp): Promise<Metadata> => ({
  title: policyDoc(docKey).label,
  ...(versionOf(sp) !== null ? { robots: { index: false, follow: true } } : {}),
});

export async function PolicyRoute({ docKey, searchParams }: { docKey: PolicyDocKey; searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const v = versionOf(sp);
  if (v === -1) notFound();
  const view = await getPolicyView(docKey, policyDoc(docKey).feature, v);
  if (!view) notFound();
  const form = docKey === "corrections" && v === null && view.features.page_help ? await correctionForm(sp) : null;
  // 매체 소개의 NewsMediaOrganization (OPT-02) — 열려 있는 정책 페이지 주소만 단다. 이전 판(?v=)에는 내지 않는다
  const orgJsonLd = docKey === "about" && v === null ? aboutOrganizationJsonLd(siteUrl(), POLICY_DOCS.filter((d) => view.features[d.feature]).map((d) => d.href)) : null;
  return (
    <>
      <JsonLd content={orgJsonLd} />
      <PolicyPage view={view} />
      {form}
    </>
  );
}

/** 정정·반론 요청 폼 (W2-e 7.1) — 정책 페이지 아래. page_help가 꺼지면 폼 0 */
async function correctionForm(sp: Sp) {
  const db = adminClient();
  const secret = guardSecret();
  if (!db || !secret) return null;
  const row = await db.from("settings").select("value").eq("key", "help").maybeSingle();
  const help = parseHelpSettings(row.data?.value);
  if (!help) return null;
  const one = (x: string | string[] | undefined) => (typeof x === "string" ? x : null);
  const sent = one(sp.sent);
  return (
    <section id="correction-form" className="mx-auto w-full max-w-2xl px-4 pb-12">
      <h2 className="mb-4 text-[20px] font-extrabold text-navy-900">정정·반론 요청하기</h2>
      <HelpForm slug="corrections" fill={openHelpToken(secret)} sent={sent && /^[A-HJ-NP-Z2-9]{8}$/.test(sent) ? sent : null} errorCode={one(sp.e)} maxFiles={help.maxFiles} extensions={help.allowedExtensions} />
    </section>
  );
}
