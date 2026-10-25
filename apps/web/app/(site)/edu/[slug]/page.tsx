import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CourseDetailPage } from "@/components/site/EducationViews";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getCourseDetail } from "@/lib/server/public/education";
import { pageTitle } from "@/lib/site/hub-view";

// 교육 강좌 상세 (/edu/[slug] - W10-g). 기능 키 edu 꺼짐·게시 전·출처 확인일 없는 강좌는 404. Course 구조화 데이터는 화면과 같은 값에서 나온다.
export const metadata: Metadata = { title: pageTitle("교육 강좌") };

export default async function CoursePage({ params }: { params: Promise<{ slug: string }> }) {
  await connection();
  const { slug } = await params;
  const view = await readPublic("교육 강좌 상세", () => getCourseDetail(slug), () => UNAVAILABLE);
  if (isUnavailable(view)) return <UnavailablePage />;
  if (!view.open || !view.course) notFound();
  return <CourseDetailPage view={view} />;
}
