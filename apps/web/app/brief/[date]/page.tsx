import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Eyebrow, brand } from "@ltr/ui";
import { issueSlug } from "@ltr/workflows/ops";
import { IssueView, type ViewCorner } from "@/components/brief/IssueView";
import { briefOpen } from "@/lib/server/auth-guard";
import { featureOn, readBriefPolicy } from "@/lib/server/brief/policy";
import { publicDb, rowsOf } from "@/lib/server/public/db";
import { adminClient } from "@/lib/server/supabase";

// 브리핑 호별 쪽 (/brief/[date], W10-e - BRIEF-01) - 발행된 일반 호만(공개 뷰). 아카이브는 비회원 공개.
// 하단에 광고·제휴 안내 링크와 이메일 무단수집 거부 안내(settings.brief_publish_policy 칸 - 문구는 PO 입력)가 모든 호에 붙는다. 기사 목록·취재 집계에는 들어가지 않는다.
export const metadata: Metadata = { title: "브리핑", robots: { index: true, follow: true } };
export const dynamic = "force-dynamic";

interface Row {
  issue_no: number;
  title: string;
  publish_at: string;
  corners: ViewCorner[];
  has_ad: boolean;
}

export default async function BriefIssuePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const admin = adminClient();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !admin || !(await briefOpen(admin).catch(() => false)) || !(await featureOn(admin, "brief_regular").catch(() => false))) notFound();
  const rows = await rowsOf<Row>(publicDb().from("public_brief_issues").select("issue_no, title, publish_at, corners, has_ad").order("publish_at", { ascending: false }).limit(200), "브리핑 호");
  const issue = rows.find((r) => issueSlug(new Date(r.publish_at)) === date);
  if (!issue) notFound();
  const policy = await readBriefPolicy(admin);
  return (
    <main className="mx-auto w-full max-w-[780px] px-4 py-8" data-testid="brief-issue" data-issue-no={issue.issue_no}>
      <IssueView
        corners={issue.corners}
        masthead={
          <>
          <p className="text-[17px] font-extrabold tracking-tight text-navy-900">
            {brand.productName} <span className="text-hermes-500">·</span> 브리핑
          </p>
          <Eyebrow>{date}</Eyebrow>
          <h1 className="mt-3 text-[28px] leading-tight font-black text-navy-900">{issue.title}</h1>
          {issue.has_ad && (
            <p className="mt-2 text-[14px] font-bold text-navy-700" data-testid="brief-ad-mark">
              (광고) 광고성 정보가 포함된 호입니다
            </p>
          )}
          </>
        }
      />
      <footer className="mt-12 space-y-2 border-t border-navy-100 pt-4 text-[14px] text-navy-700" data-testid="brief-footer">
        {policy.footer.disclaimer && <p>{policy.footer.disclaimer}</p>}
        {policy.footer.noHarvestNotice && <p>{policy.footer.noHarvestNotice}</p>}
        {policy.publisherNotice && <p>{policy.publisherNotice}</p>}
        {policy.footer.adInfoUrl && (
          <p>
            <a href={policy.footer.adInfoUrl} className="underline">
              광고·제휴 안내
            </a>
          </p>
        )}
        <p>
          <Link href="/brief/subscribe" className="underline">
            구독하기
          </Link>{" "}
          ·{" "}
          <Link href="/brief" className="underline">
            지난 호 보기
          </Link>
        </p>
      </footer>
    </main>
  );
}
