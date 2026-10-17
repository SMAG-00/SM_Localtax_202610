import type { Metadata } from "next";
import { Callout, LinkCard } from "@ltr/ui";
import { PageTitle } from "@/components/admin/ui";
import { allowedActions, can } from "@/lib/access";
import { adminMenu } from "@/lib/admin/menu";
import { pageViewer } from "@/lib/server/admin/pages";
import { dashboardCounts } from "@/lib/server/admin/queries";
import { personForUser } from "@/lib/server/articles/repository";
import { serviceDb } from "@/lib/server/articles/service";

// 백오피스 첫 화면 (/admin) — 역할에 맞는 할 일 수: 내 초안 · 편집 승인 대기 · 발행 대기 · 세무 감수 대기 · 내 기획
export const metadata: Metadata = { title: "첫 화면" };

type Card = { id: string; label: string; count: number; href: string; note: string };

export default async function DashboardPage() {
  const viewer = await pageViewer();
  const db = serviceDb();
  const person = await personForUser(db, viewer.userId);
  const newsroom = can(viewer, "article.read");
  const counts = newsroom ? await dashboardCounts(db, person?.id ?? null) : null;

  const cards: Card[] = [];
  if (counts && can(viewer, "article.create") && person) {
    cards.push({ id: "my-drafts", label: "내 초안·보류", count: counts.myDrafts, href: "/admin/articles?mine=1", note: "아직 검토를 요청하지 않은 기사" });
  }
  if (counts && can(viewer, "assignment.read") && person) {
    cards.push({ id: "my-assignments", label: "내가 맡은 기획", count: counts.myAssignments, href: "/admin/stories", note: "발행·보류 전 기획" });
  }
  if (counts && can(viewer, "review.desk_edit")) {
    cards.push({ id: "desk-waiting", label: "편집 승인 대기", count: counts.deskWaiting, href: "/admin/reviews", note: "검토를 요청받은 기사" });
    cards.push({ id: "publish-waiting", label: "발행 대기", count: counts.publishWaiting, href: "/admin/reviews#approved", note: "편집 승인을 마친 기사" });
  }
  if (counts && can(viewer, "review.tax_review")) {
    cards.push({ id: "tax-waiting", label: "세무 감수 대기", count: counts.taxWaiting, href: "/admin/reviews#tax", note: "세무 감수 서명이 필요한 기사" });
  }
  const menu = adminMenu(viewer).filter((m) => m.id !== "dashboard");
  const hasRoles = allowedActions(viewer).length > 0;

  return (
    <>
      <PageTitle title="편집국 첫 화면" description="오늘 할 일을 확인하세요." />
      {!hasRoles && <Callout>이 계정에는 편집국 역할이 없습니다. 관리자에게 역할 부여를 요청하세요.</Callout>}
      {hasRoles && newsroom && !person && (
        <Callout>이 계정에 연결된 편집국 인물(기자 등록)이 없습니다. 기사를 쓰려면 관리자에게 인물 등록을 요청하세요.</Callout>
      )}
      {cards.length > 0 && (
        <ul aria-label="할 일" className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <li key={c.id}>
              <LinkCard href={c.href} aria-label={`${c.label} ${c.count}건`}>
                <span className="block text-[15px] font-bold text-navy-600">{c.label}</span>
                <span data-testid={`count-${c.id}`} className="mt-1 block font-mono text-[32px] font-bold text-navy-900">
                  {c.count}
                </span>
                <span className="mt-1 block text-[14px] text-navy-600">{c.note}</span>
              </LinkCard>
            </li>
          ))}
        </ul>
      )}
      {menu.length > 0 && (
        <section aria-labelledby="shortcuts" className="mt-10">
          <h2 id="shortcuts" className="text-[19px] font-black text-navy-900">
            바로 가기
          </h2>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {menu.map((m) => (
              <li key={m.id}>
                <LinkCard href={m.href}>
                  <span className="text-[17px] font-black text-navy-900">{m.label}</span>
                </LinkCard>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
