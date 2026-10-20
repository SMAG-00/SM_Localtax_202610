import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { queryValue } from "@/lib/site/hub-view";
import { policyDoc, type PolicyDocKey } from "@/lib/policy/docs";
import { getPolicyView } from "@/lib/server/public/policy";
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
  return <PolicyPage view={view} />;
}
