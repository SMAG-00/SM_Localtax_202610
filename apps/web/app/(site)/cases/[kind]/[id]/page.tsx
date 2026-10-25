import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CaseDetail } from "@/components/site/CaseView";
import { getCaseDetail, isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { pageTitle } from "@/lib/site/hub-view";

// 해석 문서 상세 (/cases/[kind]/[id] - CASE-02). kind = ruling·circular·interpretation·tribunal·case. 공개 조건 밖(스냅샷 없음·권리 미확인·공개 보류 등)은 404.
type Props = { params: Promise<{ kind: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export const metadata: Metadata = { title: pageTitle("판례·해석") };

export default async function CaseDetailPage({ params, searchParams }: Props) {
  await connection();
  const { kind, id } = await params;
  const sp = await searchParams;
  const view = await readPublic("해석 문서", () => getCaseDetail(kind, id), () => UNAVAILABLE);
  if (isUnavailable(view)) {
    return (
      <main id="main" className="mx-auto w-full max-w-[1100px] px-4 py-10">
        <p className="text-[15px] text-navy-500">지금은 문서를 불러오지 못했습니다. 잠시 뒤 다시 시도하세요.</p>
      </main>
    );
  }
  if (view === null) notFound();
  return <CaseDetail view={view} from={typeof sp.from === "string" ? sp.from : undefined} />;
}
