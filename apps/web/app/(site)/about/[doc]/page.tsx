import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PolicyRoute, policyMetadata } from "@/components/site/policy-route";
import { isPolicyDocKey } from "@/lib/policy/docs";

// /about/[정책] — editorial-policy · ethics · corrections · ad-policy · privacy · terms · no-email-collection · advertise (설계 2.4). 그 밖의 이름은 404.
// (/about/measurement는 따로 있는 정적 경로가 먼저 잡힌다)
type Props = { params: Promise<{ doc: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const generateMetadata = async ({ params, searchParams }: Props): Promise<Metadata> => {
  const { doc } = await params;
  return isPolicyDocKey(doc) && doc !== "about" ? policyMetadata(doc, await searchParams) : {};
};

export default async function PolicyDocPage({ params, searchParams }: Props) {
  const { doc } = await params;
  if (!isPolicyDocKey(doc) || doc === "about") notFound();
  return <PolicyRoute docKey={doc} searchParams={searchParams} />;
}
