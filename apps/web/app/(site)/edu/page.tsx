import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { EduListPage } from "@/components/site/EducationViews";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getEduList } from "@/lib/server/public/education";
import { pageTitle } from "@/lib/site/hub-view";

// 교육 (/edu - W10-g EDU-01·BIZ-06, 연결 방식). 기능 키 edu 꺼짐은 404. 공개 조건은 뷰 public_courses · public_course_sessions.
// 신청·결제는 교육원 사이트 링크로 나간다 - 이 사이트에는 결제·수료증 요소가 없다.
export const metadata: Metadata = { title: pageTitle("교육") };

export default async function EduPage() {
  await connection();
  const view = await readPublic("교육 강좌 목록", () => getEduList(), () => UNAVAILABLE);
  if (isUnavailable(view)) return <UnavailablePage />;
  if (!view.open) notFound();
  return <EduListPage view={view} />;
}
