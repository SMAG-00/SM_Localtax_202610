import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { TIMELINE_LABELS, TIMELINE_ORIGIN_LABELS } from "@/lib/law/timeline";
import { getTimeline } from "@/lib/server/public/law-v2";
import { readPublicSettings } from "@/lib/server/public/reads";
import { pageTitle } from "@/lib/site/hub-view";

// 쟁점 타임라인 (/law/timeline/[issue] - LAW-08). 승인된 쟁점 태그만. 날짜는 DB 원문 값, 같은 내용을 목록 마크업(ol)으로 그린다.
export const metadata: Metadata = { title: pageTitle("쟁점 타임라인") };

export default async function TimelinePage({ params }: { params: Promise<{ issue: string }> }) {
  await connection();
  const { issue } = await params;
  const splitOn = (await readPublicSettings()).features.law_split;
  const view = await getTimeline(issue);
  if (!view) notFound();
  return (
    <main id="main" className="mx-auto w-full max-w-[860px] px-4 py-10">
      <h1 className="text-[28px] font-black text-navy-900">{view.label} 타임라인</h1>
      {view.items.length === 0 ? (
        <p data-part="timeline-empty" className="mt-6 text-[15px] text-navy-700">
          이 쟁점에 묶인 항목이 아직 없습니다 ·{" "}
          <Link href={`/search?q=${encodeURIComponent(view.label)}`} className="font-bold underline underline-offset-4">
            원문 검색
          </Link>
        </p>
      ) : (
        <ol data-part="timeline" className="mt-6 space-y-3">
          {view.items.map((i) => (
            <li key={i.key} data-kind={i.kind} data-date={i.date} className="rounded-xl border border-navy-100 p-3">
              <p className="flex flex-wrap items-center gap-2 text-[13px]">
                <time dateTime={i.date} className="font-mono font-bold">{i.date}</time>
                <span className="rounded-full border border-navy-200 px-2 py-0.5">{TIMELINE_LABELS[i.kind]}</span>
                {i.conclusion && <span data-part="conclusion" className="rounded-full bg-navy-900 px-2 py-0.5 font-bold text-white">{i.conclusion}</span>}
                <span className="rounded-full border border-navy-200 px-2 py-0.5">{TIMELINE_ORIGIN_LABELS[i.origin]}</span>
              </p>
              <p className="mt-1 text-[15px] font-bold text-navy-900">{i.title}</p>
              <p className="mt-1 flex gap-3 text-[13px]">
                <Link href={i.href} className="underline underline-offset-4">
                  원문 보기
                </Link>
                {splitOn && (
                  <Link href={`/workspace/split?p=${i.splitSpec}`} className="underline underline-offset-4">
                    분할 화면에 열기
                  </Link>
                )}
              </p>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
