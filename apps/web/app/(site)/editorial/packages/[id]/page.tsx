import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Eyebrow } from "@ltr/ui";
import { DraftFromPackage } from "@/components/editorial/DraftFromPackage";
import { can } from "@/lib/access";
import { formatBytes, isPreviewImage, packageFileGroups } from "@/lib/editorial/package-files";
import { getViewer } from "@/lib/server/dal";
import { existingArticle } from "@/lib/server/editorial/article-draft";
import { getPackage } from "@/lib/server/editorial/desk";
import { serviceDb } from "@/lib/server/articles/service";
import { HttpError } from "@/lib/server/http";

// 편집위원 데스크 결과물 묶음 (/editorial/packages/[id], PO 2026-11-18) — New_Article 날짜 폴더 하나.
// 파일은 /api/editorial/files가 비공개 버킷의 5분 서명 주소로 연다(그림·PDF는 열기, 나머지는 내려받기). 편집위원·관리자만.
export const metadata: Metadata = { title: "편집위원 데스크 결과물", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function PackagePage({ params }: Props) {
  const { id } = await params;
  const viewer = await getViewer().catch(() => null);
  if (!viewer) redirect(`/login?next=${encodeURIComponent(`/editorial/packages/${id}`)}`);
  if (!can(viewer, "editorial_desk.read")) redirect("/editorial");
  const pkg = await getPackage(serviceDb(), id).catch((err) => {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  });
  const canDraft = can(viewer, "article.create") && packageFileGroups(pkg.files).some((g) => g.key === "article");
  const draft = canDraft ? await existingArticle(serviceDb(), pkg) : null;
  const fileHref = (path: string) => `/api/editorial/files?package=${pkg.id}&path=${encodeURIComponent(path)}`;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <Link href="/editorial?tab=packages" className="inline-flex min-h-11 items-center text-[15px] font-bold text-navy-700 underline">
        결과물 보관함으로
      </Link>
      <Eyebrow>{`${pkg.folder} · ${pkg.source === "web" ? "웹 요청" : "코워크"}`}</Eyebrow>
      <h1 className="mt-3 text-[26px] leading-tight font-black text-navy-900 [overflow-wrap:anywhere]">{pkg.title}</h1>
      {canDraft && (
        <section aria-labelledby="draft-title" className="mt-6 rounded-2xl border border-navy-100 bg-white p-5">
          <h2 id="draft-title" className="mb-3 text-[17px] font-black text-navy-900">사이트 기사로 옮기기</h2>
          <DraftFromPackage packageId={pkg.id} existingArticleId={draft?.id ?? null} />
        </section>
      )}
      {pkg.report && (
        <section aria-labelledby="report-title" className="mt-6 rounded-2xl border border-navy-100 bg-navy-50 p-5">
          <h2 id="report-title" className="text-[17px] font-black text-navy-900">완료 보고</h2>
          <pre data-testid="package-report" className="mt-2 font-sans text-[14px] whitespace-pre-wrap text-navy-800">{pkg.report}</pre>
        </section>
      )}
      {packageFileGroups(pkg.files).map((g) => (
        <section key={g.key} aria-labelledby={`g-${g.key}`} className="mt-6 rounded-2xl border border-navy-100 bg-white p-5">
          <h2 id={`g-${g.key}`} className="text-[18px] font-black text-navy-900">
            {g.label} <span className="text-[14px] font-bold text-navy-500">{g.files.length}개</span>
          </h2>
          {g.files.some(isPreviewImage) && (
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {g.files.filter(isPreviewImage).map((f) => (
                <li key={f.path}>
                  <a href={fileHref(f.path)} target="_blank" rel="noopener noreferrer" className="block">
                    {/* 서명 주소로 넘어가는 그림이라 최적화 컴포넌트(next/image)를 쓰지 않는다 */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={fileHref(f.path)} alt={f.path.split("/").pop()} loading="lazy" className="aspect-square w-full rounded-xl border border-navy-100 object-cover" />
                  </a>
                </li>
              ))}
            </ul>
          )}
          <ul className="mt-3 divide-y divide-navy-100">
            {g.files.map((f) => (
              <li key={f.path} data-testid="package-file" className="flex flex-wrap items-center gap-2 py-2">
                <a href={fileHref(f.path)} className="min-w-0 flex-1 text-[15px] font-bold text-navy-900 underline [overflow-wrap:anywhere]">
                  {f.path}
                </a>
                <span className="text-[13px] text-navy-500">{formatBytes(f.size)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
