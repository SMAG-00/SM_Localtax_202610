import type { Metadata } from "next";
import { DataTable, EmptyNote, MONO, PageTitle, Panel, TD, ToneChip } from "@/components/admin/ui";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";
import { dbError } from "@/lib/server/http";

// 기관 구독 (/admin/orgs, BIZ-07·PAY-04 · W11-f) - 스토어·구독 담당·관리자(org.manage). 읽기 보드입니다.
//  · 쓰기(기관·계약·개통·종료일·확인표 기록·좌석·수기 발행 기록·견적 상태)는 /api/admin/orgs (확인표 '승인' 기록은 관리자만)
//  · 계약서 위치·확인표 문서는 PO·법률이 입력하는 칸이고, 이 화면에는 문서 글자가 없습니다 (위치 기록 여부만 표시)
//  · 견적 요청은 담당 확인용 이름·기관만 보이고, 이메일·전화·문의 내용은 이 화면에 싣지 않습니다
export const metadata: Metadata = { title: "기관 구독" };
export const dynamic = "force-dynamic";

const ORG_TYPE: Record<string, string> = { local_government: "지자체", tax_firm: "세무법인", financial: "금융기관" };

export default async function OrgsPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "org.manage");
  const db = serviceDb();
  const [orgs, contracts, reviews, seats, taxes, inquiries] = await Promise.all([
    db.from("orgs").select("id, name, org_type, business_no, status").order("created_at", { ascending: false }).limit(200),
    db.from("org_contracts").select("id, org_id, seats, starts_on, ends_on, status, contract_ref").order("created_at", { ascending: false }).limit(200),
    db.from("org_security_reviews").select("id, org_id, status").order("id", { ascending: false }).limit(400),
    db.from("org_seats").select("contract_id, status").limit(5000),
    db.from("tax_invoice_requests").select("id, org_id, kind, status, requested_at, issued_on").order("requested_at", { ascending: false }).limit(100),
    db.from("institution_inquiries").select("id, receipt_no, org_type, org_name, seats_wanted, status, retention_until, purged_at").order("created_at", { ascending: false }).limit(100),
  ]);
  for (const [r, ctx] of [[orgs, "orgs"], [contracts, "org_contracts"], [reviews, "org_security_reviews"], [seats, "org_seats"], [taxes, "tax_invoice_requests"], [inquiries, "institution_inquiries"]] as const) if (r.error) throw dbError(r.error, ctx);
  const latestReview = new Map<string, string>();
  for (const r of (reviews.data ?? []) as Array<{ org_id: string; status: string }>) if (!latestReview.has(r.org_id)) latestReview.set(r.org_id, r.status);
  const used = new Map<string, number>();
  for (const s of (seats.data ?? []) as Array<{ contract_id: string; status: string }>) if (s.status !== "revoked") used.set(s.contract_id, (used.get(s.contract_id) ?? 0) + 1);
  const orgRows = (orgs.data ?? []) as Array<{ id: string; name: string; org_type: string; business_no: string | null; status: string }>;
  const contractRows = (contracts.data ?? []) as Array<{ id: string; org_id: string; seats: number; starts_on: string; ends_on: string; status: string; contract_ref: string | null }>;
  const nameOf = new Map(orgRows.map((o) => [o.id, o.name]));

  return (
    <div className="grid gap-8">
      <PageTitle title="기관 구독" description="기관·계약·좌석·보안 확인표 현황입니다. 쓰기는 /api/admin/orgs 로 합니다." />
      <Panel id="orgs" title="기관">
        {orgRows.length === 0 ? <EmptyNote>등록된 기관이 없습니다.</EmptyNote> : (
          <DataTable caption="기관 목록" head={["기관", "유형", "사업자 정보", "확인표(최신)"]}>
            {orgRows.map((o) => (
              <tr key={o.id}>
                <td className={TD}>{o.name} <span className={MONO}>{o.id.slice(0, 8)}</span></td>
                <td className={TD}>{ORG_TYPE[o.org_type] ?? o.org_type}</td>
                <td className={TD}>{o.business_no ? "있음" : "없음"}</td>
                <td className={TD}><ToneChip tone={latestReview.get(o.id) === "approved" ? "navy" : "plain"}>{latestReview.get(o.id) ?? "기록 없음"}</ToneChip></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
      <Panel id="contracts" title="계약·좌석">
        {contractRows.length === 0 ? <EmptyNote>등록된 계약이 없습니다.</EmptyNote> : (
          <DataTable caption="계약 목록" head={["기관", "상태", "기간(종료일 당일까지)", "좌석", "계약서 위치"]}>
            {contractRows.map((c) => (
              <tr key={c.id}>
                <td className={TD}>{nameOf.get(c.org_id) ?? c.org_id.slice(0, 8)}</td>
                <td className={TD}>{c.status}</td>
                <td className={TD}>{c.starts_on} ~ {c.ends_on}</td>
                <td className={TD}>{used.get(c.id) ?? 0} / {c.seats}</td>
                <td className={TD}>{c.contract_ref ? "기록됨" : "빈 칸"}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
      <Panel id="tax" title="세금계산서·영수증 요청">
        {(taxes.data ?? []).length === 0 ? <EmptyNote>요청이 없습니다.</EmptyNote> : (
          <DataTable caption="세금계산서 요청" head={["기관", "종류", "상태", "발행일"]}>
            {((taxes.data ?? []) as Array<{ id: string; org_id: string; kind: string; status: string; issued_on: string | null }>).map((t) => (
              <tr key={t.id}>
                <td className={TD}>{nameOf.get(t.org_id) ?? t.org_id.slice(0, 8)}</td>
                <td className={TD}>{t.kind === "tax_invoice" ? "세금계산서" : "영수증"}</td>
                <td className={TD}>{t.status === "requested" ? "발행 대기(수기 발행 기록 필요)" : t.status}</td>
                <td className={TD}>{t.issued_on ?? "-"}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
      <Panel id="inquiries" title="견적 요청" description="보존일이 지나면 개인 칸이 비워집니다(파기 작업).">
        {(inquiries.data ?? []).length === 0 ? <EmptyNote>견적 요청이 없습니다.</EmptyNote> : (
          <DataTable caption="견적 요청" head={["접수번호", "유형", "기관", "좌석", "상태", "보존일"]}>
            {((inquiries.data ?? []) as Array<{ id: string; receipt_no: string; org_type: string; org_name: string | null; seats_wanted: number; status: string; retention_until: string; purged_at: string | null }>).map((q) => (
              <tr key={q.id}>
                <td className={`${TD} ${MONO}`}>{q.receipt_no}</td>
                <td className={TD}>{ORG_TYPE[q.org_type] ?? q.org_type}</td>
                <td className={TD}>{q.org_name ?? "(파기됨)"}</td>
                <td className={TD}>{q.seats_wanted}</td>
                <td className={TD}>{q.status}</td>
                <td className={TD}>{q.retention_until}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
