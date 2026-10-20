import type { Metadata } from "next";
import Link from "next/link";
import { InquiryControls } from "@/components/admin/InquiryControls";
import { EmptyNote, PageTitle, Panel, ToneChip } from "@/components/admin/ui";
import { INQUIRY_READERS, check, readableInquiryKinds } from "@/lib/access";
import { INQUIRY_KIND_LABELS, INQUIRY_STATUS_LABELS, MAIL_STATUS_LABELS, isInquiryKind, isInquiryStatus, type InquiryStatus } from "@/lib/admin/inquiry-rules";
import { isoToKstDateTime } from "@/lib/admin/form-utils";
import { pageViewer, queryValue, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";

// 문의함 (/admin/inquiries, ADM-03) — 종류별 열람 역할만 그 종류를 본다. 거르개 = 종류 · 상태 · 내 담당. 연락처는 [연락처 보기]를 눌러야 보이고 누를 때마다 감사 로그가 남는다.
export const metadata: Metadata = { title: "문의함" };
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const chip = (on: boolean) => `inline-flex min-h-11 items-center rounded-xl border px-3 py-2 text-[14px] font-bold ${on ? "border-navy-900 bg-navy-900 text-white" : "border-navy-200 bg-white text-navy-800"}`;

export default async function InquiriesPage({ searchParams }: Props) {
  const viewer = await pageViewer();
  requirePage(viewer, "inquiry.read");
  const sp = await searchParams;
  const readable = readableInquiryKinds(viewer);
  const kindParam = queryValue(sp.kind);
  const kind = isInquiryKind(kindParam) && readable.includes(kindParam) ? kindParam : null;
  const statusParam = queryValue(sp.status);
  const status: InquiryStatus | null = isInquiryStatus(statusParam) ? statusParam : null;
  const mine = queryValue(sp.mine) === "1";
  const idParam = Number.parseInt(queryValue(sp.id), 10);
  const db = serviceDb();

  let q = db
    .from("inquiries")
    .select("id, ref_code, kind, status, assignee, mail_status, created_at")
    .in("kind", kind ? [kind] : readable)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);
  if (status) q = q.eq("status", status);
  if (mine) q = q.eq("assignee", viewer.userId);
  const { data } = await q;
  const rows = (data ?? []) as { id: number; ref_code: string; kind: string; status: string; assignee: string | null; mail_status: string; created_at: string }[];

  const href = (o: { kind?: string | null; status?: string | null; mine?: boolean; id?: number }) => {
    const p = new URLSearchParams();
    if (o.kind) p.set("kind", o.kind);
    if (o.status) p.set("status", o.status);
    if (o.mine) p.set("mine", "1");
    if (o.id) p.set("id", String(o.id));
    const s = p.toString();
    return s ? `/admin/inquiries?${s}` : "/admin/inquiries";
  };

  let detail: Awaited<ReturnType<typeof loadDetail>> = null;
  if (Number.isInteger(idParam) && idParam > 0) detail = await loadDetail(idParam, readable, viewer.isAdmin);

  return (
    <>
      <PageTitle title="문의함" description="종류별로 담당 역할만 볼 수 있습니다. 연락처는 [연락처 보기]를 눌러야 보이며 누를 때마다 감사 기록이 남습니다." />
      <nav aria-label="종류" className="mb-3 flex flex-wrap gap-2" data-testid="inquiry-kind-filter">
        <Link href={href({ status, mine })} className={chip(kind === null)} aria-current={kind === null ? "true" : undefined}>전체</Link>
        {readable.map((k) => (<Link key={k} href={href({ kind: k, status, mine })} className={chip(kind === k)} aria-current={kind === k ? "true" : undefined}>{INQUIRY_KIND_LABELS[k]}</Link>))}
      </nav>
      <nav aria-label="상태" className="mb-4 flex flex-wrap gap-2">
        <Link href={href({ kind })} className={chip(!status && !mine)}>모든 상태</Link>
        {(["received", "in_progress", "done"] as const).map((s) => (<Link key={s} href={href({ kind, status: s })} className={chip(status === s)}>{INQUIRY_STATUS_LABELS[s]}</Link>))}
        <Link href={href({ kind, status, mine: true })} className={chip(mine)}>내 담당</Link>
      </nav>
      {rows.length === 0 ? (
        <EmptyNote>문의가 없습니다.</EmptyNote>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[15px]" data-testid="inquiry-table">
            <thead>
              <tr className="border-b border-navy-200"><th className="py-2 pr-3">접수 번호</th><th className="pr-3">종류</th><th className="pr-3">상태</th><th className="pr-3">담당자</th><th className="pr-3">접수일</th><th>접수 메일</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-navy-100" data-inquiry-id={r.id}>
                  <td className="py-2 pr-3"><Link href={href({ kind, status, mine, id: r.id })} className="font-bold underline underline-offset-4">{r.ref_code}</Link></td>
                  <td className="pr-3">{isInquiryKind(r.kind) ? INQUIRY_KIND_LABELS[r.kind] : r.kind}</td>
                  <td className="pr-3"><ToneChip tone={r.status === "done" ? "emerald" : "navy"}>{isInquiryStatus(r.status) ? INQUIRY_STATUS_LABELS[r.status] : r.status}</ToneChip></td>
                  <td className="pr-3">{r.assignee ? "지정됨" : "-"}</td>
                  <td className="pr-3">{isoToKstDateTime(r.created_at)}</td>
                  <td>{MAIL_STATUS_LABELS[r.mail_status] ?? r.mail_status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {detail && isInquiryKind(detail.row.kind) && (
        <div className="mt-8">
          <Panel id={`inquiry-${detail.row.id}`} title={`${detail.row.ref_code} · ${INQUIRY_KIND_LABELS[detail.row.kind]}`} description={`접수 ${isoToKstDateTime(detail.row.created_at)} · 접수 메일 ${MAIL_STATUS_LABELS[detail.row.mail_status] ?? detail.row.mail_status}`}>
            {detail.row.title && <p className="mb-2 text-[16px] font-bold text-navy-900">{detail.row.title}</p>}
            <p className="mb-4 whitespace-pre-wrap text-[15px] text-navy-900" data-testid="inquiry-body">{detail.row.body}</p>
            {detail.row.request_type && <p className="mb-2 text-[15px]">구분: {detail.row.request_type === "rebuttal" ? "반론 요청" : "정정 요청"}</p>}
            {detail.row.related_article_id && (<p className="mb-2 text-[15px]">관련 기사: <Link href={`/admin/articles/${detail.row.related_article_id}`} className="font-bold underline underline-offset-4">기사 {detail.row.related_article_id}</Link>{detail.row.kind === "correction" && check(viewer, "correction.decide").allowed && " (정정 결정은 기사 화면에서)"}</p>)}
            {detail.row.attachments.length > 0 && (
              <ul className="mb-4 list-disc pl-5 text-[15px]" data-testid="inquiry-attachments">
                {detail.row.attachments.map((a, i) => (<li key={a.path}><a href={`/api/admin/inquiries/${detail!.row.id}/attachments/${i}`} download className="font-bold underline underline-offset-4">{a.name}</a> ({Math.ceil(a.bytes / 1024)}KB, 내려받기만 — 열기 전에 직접 검사하세요)</li>))}
              </ul>
            )}
            <InquiryControls
              id={detail.row.id}
              kind={detail.row.kind}
              status={detail.row.status}
              assignee={detail.row.assignee}
              memo={detail.row.memo ?? ""}
              resolution={detail.row.resolution}
              resolutionReason={detail.row.resolution_reason ?? ""}
              assignees={detail.assignees}
              canUpdate={check(viewer, "inquiry.update", { kind: "inquiry", inquiryKind: detail.row.kind }).allowed}
            />
          </Panel>
        </div>
      )}
    </>
  );

  async function loadDetail(id: number, kinds: readonly string[], isAdmin: boolean) {
    const r = await db
      .from("inquiries")
      .select("id, ref_code, kind, status, assignee, memo, title, body, request_type, related_article_id, attachments, resolution, resolution_reason, mail_status, created_at")
      .eq("id", id)
      .maybeSingle();
    const row = r.data as { id: number; ref_code: string; kind: string; status: string; assignee: string | null; memo: string | null; title: string | null; body: string; request_type: string | null; related_article_id: number | null; attachments: { path: string; name: string; bytes: number }[]; resolution: string | null; resolution_reason: string | null; mail_status: string; created_at: string } | null;
    if (!row || !kinds.includes(row.kind)) return null;
    const eligible = isInquiryKind(row.kind) ? (INQUIRY_READERS[row.kind] as readonly string[]) : [];
    const staff = await db.from("staff_roles").select("user_id, role").in("role", eligible as string[]);
    const assignees = [...new Map(((staff.data ?? []) as { user_id: string; role: string }[]).map((s) => [s.user_id, { userId: s.user_id, label: `${s.role} · ${s.user_id.slice(0, 8)}` }])).values()];
    void isAdmin;
    return { row, assignees };
  }
}
