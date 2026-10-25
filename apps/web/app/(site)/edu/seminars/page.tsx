import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { SeminarListPage } from "@/components/site/EducationViews";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getSeminarList } from "@/lib/server/public/education";
import { pageTitle } from "@/lib/site/hub-view";

// 세미나·웨비나 목록 (/edu/seminars - W10-g). 기능 키 seminars 꺼짐은 404. 요청마다 그린다(예정·진행·종료 배지가 시각에 따라 바뀜).
export const metadata: Metadata = { title: pageTitle("세미나·웨비나") };

export default async function SeminarsPage() {
  await connection();
  const view = await readPublic("세미나 목록", () => getSeminarList(), () => UNAVAILABLE);
  if (isUnavailable(view)) return <UnavailablePage />;
  if (!view.open) notFound();
  return <SeminarListPage view={view} />;
}
