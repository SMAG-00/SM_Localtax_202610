import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eyebrow } from "@ltr/ui";
import { can } from "@/lib/access";
import { ARTICLE_TYPES, DERIVATIVES, REQUEST_STATUS_LABELS } from "@/lib/editorial/request-input";
import { formatBytes } from "@/lib/editorial/package-files";
import { getViewer } from "@/lib/server/dal";
import { listPackages, listRequests, workerStatus } from "@/lib/server/editorial/desk";
import { serviceDb } from "@/lib/server/articles/service";
import { RequestForm } from "@/components/editorial/RequestForm";
import { CancelRequestButton } from "@/components/editorial/CancelRequestButton";

// 편집위원 데스크 (/editorial, PO 2026-11-18) — 헤더 '편집위원' 메뉴의 도착 화면. 편집위원(editorial_board)·관리자만.
//  · 새 요청: 프로젝트 지침 통합본 v4 2장 접수 인터뷰를 양식으로 — 제출하면 작업기가 기사·이미지·카드뉴스·쓰레드·유튜브를 끝까지 만든다
//  · 요청 현황: 대기·제작 중·완료·실패 (작업기가 꺼져 있으면 요청은 대기로 남는다고 알린다)
//  · 결과물 보관함: New_Article 날짜 폴더 단위 — 웹 요청분과 코워크로 만든 지난 결과물
// 사람마다 다른 화면이라 캐시하지 않고(force-dynamic) 검색에 나오지 않는다(noindex).
export const metadata: Metadata = { title: "편집위원 데스크", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const TABS = { new: "새 요청", requests: "요청 현황", packages: "결과물 보관함" } as const;
type Tab = keyof typeof TABS;

const card = "rounded-2xl border border-navy-100 bg-white p-5";
const STATUS_TONE: Record<string, string> = {
  queued: "border-navy-200 bg-navy-50 text-navy-800",
  running: "border-hermes-500 bg-hermes-50 text-navy-900",
  done: "border-emerald-200 bg-emerald-50 text-emerald-800",
  failed: "border-rose-200 bg-rose-50 text-rose-800",
  canceled: "border-navy-100 bg-white text-navy-500",
};

const kst = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)) : "-";

export default async function EditorialDeskPage({ searchParams }: Props) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) redirect(`/login?next=${encodeURIComponent("/editorial")}`);
  const q = await searchParams;

  if (!can(viewer, "editorial_desk.read")) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <Eyebrow>EDITORIAL BOARD</Eyebrow>
        <h1 className="mt-3 text-[28px] leading-tight font-black text-navy-900">편집위원 데스크</h1>
        <p role="alert" data-testid="desk-denied" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] font-bold text-rose-800">
          편집위원 역할을 받은 계정과 관리자만 쓸 수 있습니다 — 관리자에게 편집위원 역할을 요청하세요.
        </p>
      </div>
    );
  }

  const tab: Tab = typeof q.tab === "string" && Object.hasOwn(TABS, q.tab) ? (q.tab as Tab) : "requests";
  const db = serviceDb();
  const [worker, requests, packages] = await Promise.all([
    workerStatus(db),
    tab === "requests" ? listRequests(db) : Promise.resolve([]),
    tab === "packages" ? listPackages(db) : Promise.resolve([]),
  ]);
  const submitted = q.submitted === "1";

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <Eyebrow>EDITORIAL BOARD</Eyebrow>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[28px] leading-tight font-black text-navy-900">편집위원 데스크</h1>
        <p data-testid="worker-status" className={`rounded-full border px-3 py-1 text-[14px] font-bold ${worker.online ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-navy-200 bg-navy-50 text-navy-700"}`}>
          {worker.online ? `작업기 켜짐 · 마지막 확인 ${kst(worker.seenAt)}` : worker.seenAt ? `작업기 꺼짐 · 마지막 확인 ${kst(worker.seenAt)} — 요청은 대기로 남습니다` : "작업기 연결 전 — 요청은 대기로 남습니다"}
        </p>
      </div>
      <p className="mt-2 text-[15px] text-navy-600">주제와 소재를 넣으면 프로젝트 지침(v4)대로 기사·이미지·카드뉴스·쓰레드·유튜브 나레이션을 한 번에 만듭니다. 보통 30~90분 걸립니다.</p>

      <nav aria-label="편집위원 데스크" className="mt-6 flex flex-wrap gap-2">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <Link
            key={t}
            href={`/editorial?tab=${t}`}
            aria-current={tab === t ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-xl border px-4 text-[15px] font-bold ${tab === t ? "border-navy-900 bg-navy-900 text-white" : "border-navy-200 bg-white text-navy-800"}`}
          >
            {TABS[t]}
          </Link>
        ))}
      </nav>

      {submitted && (
        <p role="status" data-testid="desk-submitted" className="mt-6 rounded-xl border border-navy-100 bg-navy-50 px-4 py-3 text-[15px] font-bold text-navy-900">
          요청을 접수했습니다 — 작업기가 순서대로 만듭니다. 완료되면 결과물 보관함에 올라옵니다.
        </p>
      )}

      {tab === "new" && (
        <section className={`mt-6 ${card}`} aria-labelledby="new-title">
          <h2 id="new-title" className="text-[20px] font-black text-navy-900">새 제작 요청</h2>
          <RequestForm />
        </section>
      )}

      {tab === "requests" && (
        <section className="mt-6" aria-labelledby="req-title">
          <h2 id="req-title" className="sr-only">요청 현황</h2>
          {requests.length === 0 ? (
            <p className={`${card} text-[15px] text-navy-600`}>아직 요청이 없습니다 — ‘새 요청’에서 시작하세요.</p>
          ) : (
            <ul className="space-y-3">
              {requests.map((r) => (
                <li key={r.id} data-testid="desk-request" data-status={r.status} className={card}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2.5 py-0.5 text-[13px] font-bold ${STATUS_TONE[r.status] ?? STATUS_TONE.queued}`}>{REQUEST_STATUS_LABELS[r.status]}</span>
                    <p className="min-w-0 flex-1 text-[17px] font-bold text-navy-900 [overflow-wrap:anywhere]">{r.input.topic}</p>
                    {(r.status === "queued") && (viewer.isAdmin || r.requested_by === viewer.userId) && <CancelRequestButton id={r.id} />}
                  </div>
                  <p className="mt-1 text-[14px] text-navy-600">
                    {ARTICLE_TYPES[r.input.articleType]} · {r.input.section} · 파생물 {r.input.derivatives.length ? r.input.derivatives.map((d) => DERIVATIVES[d]).join("·") : "없음"} · 이미지 {r.input.imagesApproved ? "생성" : "계획만"}
                  </p>
                  <p className="mt-1 text-[13px] text-navy-500">
                    요청 {r.requester_label} · {kst(r.created_at)}
                    {r.started_at && ` · 시작 ${kst(r.started_at)}`}
                    {r.finished_at && ` · 끝 ${kst(r.finished_at)}`}
                  </p>
                  {r.attachments.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-2 text-[13px]">
                      {r.attachments.map((a) => (
                        <li key={a.path}>
                          <a className="text-navy-700 underline" href={`/api/editorial/files?request=${r.id}&path=${encodeURIComponent(a.path)}`}>
                            {a.name} ({formatBytes(a.size)})
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                  {r.progress && r.status === "running" && <p className="mt-2 text-[14px] text-navy-800">진행: {r.progress}</p>}
                  {r.error && <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[14px] text-rose-800">{r.error}</p>}
                  {r.package_id && (
                    <Link className="mt-2 inline-flex min-h-11 items-center text-[15px] font-bold text-navy-900 underline" href={`/editorial/packages/${r.package_id}`}>
                      결과물 보기
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "packages" && (
        <section className="mt-6" aria-labelledby="pkg-title">
          <h2 id="pkg-title" className="sr-only">결과물 보관함</h2>
          {packages.length === 0 ? (
            <p className={`${card} text-[15px] text-navy-600`}>아직 올라온 결과물이 없습니다 — 작업기가 지난 결과물(New_Article)을 올리면 여기에 보입니다.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {packages.map((p) => (
                <li key={p.id} data-testid="desk-package">
                  <Link href={`/editorial/packages/${p.id}`} className={`block h-full ${card} transition hover:border-navy-300`}>
                    <p className="text-[13px] font-bold text-navy-500">
                      {p.folder} · {p.source === "web" ? "웹 요청" : "코워크"} · 파일 {p.files.length}개
                    </p>
                    <p className="mt-1 text-[17px] font-bold text-navy-900 [overflow-wrap:anywhere]">{p.title}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
