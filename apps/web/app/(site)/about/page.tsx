import type { Metadata } from "next";
import { PolicyRoute, policyMetadata } from "@/components/site/policy-route";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export const generateMetadata = async ({ searchParams }: Props): Promise<Metadata> => policyMetadata("about", await searchParams);

export default function AboutPage({ searchParams }: Props) {
  return <PolicyRoute docKey="about" searchParams={searchParams} />;
}
