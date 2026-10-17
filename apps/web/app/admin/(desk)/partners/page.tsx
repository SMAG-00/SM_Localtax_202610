import type { Metadata } from "next";
import { Callout } from "@ltr/ui";
import { PartnerForm } from "@/components/admin/PartnerForm";
import { EmptyNote, MONO, PageTitle, Panel, ToneChip, type Tone } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { labelOf } from "@/lib/admin/labels";
import { PARTNER_KIND_LABELS, PARTNER_STATUS_LABELS, partnerStatus, type PartnerStatus } from "@/lib/admin/partner-rules";
import { listPartnerRows, partnerArticleCounts } from "@/lib/server/admin/backoffice";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { kstDate } from "@/lib/server/articles/gate";
import { nowIso, serviceDb } from "@/lib/server/articles/service";

// 제휴사 (/admin/partners, ART-10 · ADM-01 제휴사 관리) — 광고·협찬 담당·관리자는 등록·고치기, 편집 책임자는 읽기만(메뉴 없음 —
// 기사 편집기의 제휴사 고르기에서 들어온다). 계약 상태는 한국 날짜 기준: 종료일이 지나면 새 기사에 지정할 수 없다.
export const metadata: Metadata = { title: "제휴사" };

const STATUS_TONE: Record<PartnerStatus, Tone> = { active: "emerald", expired: "rose", upcoming: "amber" };

export default async function PartnersPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "partner.read");
  const canManage = can(viewer, "sponsored.manage");
  const db = serviceDb();
  const today = kstDate(nowIso());
  const [rows, counts] = await Promise.all([listPartnerRows(db), partnerArticleCounts(db)]);

  return (
    <>
      <PageTitle title="제휴사" description={`공동 기획 배지 ‘공동 기획 ○○’에 쓰는 제휴사입니다. 오늘(${today}) 기준 계약 상태를 보입니다.`} />
      {!canManage && (
        <Callout className="mb-6">편집 책임자는 제휴사를 읽기만 합니다. 등록·수정은 광고·협찬 담당이 합니다 — 광고주·제휴사는 기사 승인·정렬에 관여하지 않습니다 (NAV-06).</Callout>
      )}
      {canManage && (
        <Panel id="partner-new" title="제휴사 등록" className="mb-8">
          <details>
            <summary className="min-h-11 cursor-pointer text-[15px] font-bold text-navy-800">새 제휴사 적기</summary>
            <PartnerForm mode="create" />
          </details>
        </Panel>
      )}
      {rows.length === 0 && <EmptyNote>등록된 제휴사가 없습니다.</EmptyNote>}
      <ul className="space-y-4">
        {rows.map((p) => {
          const status = partnerStatus(p, today);
          return (
            <li key={p.id} data-testid={`partner-${p.id}`} className="rounded-2xl border border-navy-100 bg-white p-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[19px] font-black text-navy-900 [overflow-wrap:anywhere]">{p.name}</span>
                <ToneChip tone="plain">{labelOf(PARTNER_KIND_LABELS, p.kind)}</ToneChip>
                <ToneChip tone={STATUS_TONE[status]}>
                  <span data-testid="partner-status">{PARTNER_STATUS_LABELS[status]}</span>
                </ToneChip>
                <ToneChip tone={p.visible ? "emerald" : "plain"}>{p.visible ? "공개" : "비공개"}</ToneChip>
              </div>
              <dl className="mt-3 grid gap-x-6 gap-y-1 text-[15px] text-navy-800 sm:grid-cols-2">
                <div className="flex min-w-0 gap-2">
                  <dt className="shrink-0 font-bold text-navy-600">계약 기간</dt>
                  <dd className={MONO}>
                    {p.contract_from ?? "시작일 없음"} ~ {p.contract_to ?? "종료일 없음"}
                  </dd>
                </div>
                <div className="flex min-w-0 gap-2">
                  <dt className="shrink-0 font-bold text-navy-600">배지가 붙은 기사</dt>
                  <dd>{counts[p.id] ?? 0}건</dd>
                </div>
                <div className="flex min-w-0 gap-2 sm:col-span-2">
                  <dt className="shrink-0 font-bold text-navy-600">누리집</dt>
                  <dd className="min-w-0 [overflow-wrap:anywhere]">{p.url ?? "없음"}</dd>
                </div>
              </dl>
              {p.intro && <p className="mt-2 text-[15px] text-navy-700 [overflow-wrap:anywhere]">{p.intro}</p>}
              {status === "expired" && <p className="mt-2 text-[15px] font-bold text-rose-700">계약이 끝나 새 기사에 지정할 수 없습니다. 이미 지정된 기사의 배지는 남습니다.</p>}
              {canManage && (
                <details className="mt-3">
                  <summary className="min-h-11 cursor-pointer text-[15px] font-bold text-navy-800">고치기</summary>
                  <PartnerForm mode="patch" partner={p} />
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
