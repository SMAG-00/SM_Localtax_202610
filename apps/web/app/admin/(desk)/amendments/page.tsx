import type { Metadata } from "next";
import { AmendmentForms } from "@/components/admin/AmendmentControls";
import { EmptyNote, MONO, PageTitle, Panel, ToneChip } from "@/components/admin/ui";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { dbError } from "@/lib/server/http";

// 개정 트래커 (/admin/amendments, TX-07·08 · W3 3·4단계) — 편집 책임자만(amendment.record_event). 개정안 만들기·단계 기록·정정·기사 연결.
// 공개 전환(status=public)은 PO(세무사)가 한다. 단계 기록은 추가만 — 잘못된 기록은 정정 기록으로 고친다.
export const metadata: Metadata = { title: "개정 트래커" };
export const dynamic = "force-dynamic";

const STAGE_LABELS: Record<string, string> = { announced: "발표", pre_notice: "입법예고", submitted: "국회 제출", passed: "의결", promulgated: "공포", effective: "시행" };

export default async function AmendmentsPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "amendment.record_event");
  const db = serviceDb();
  const [a, e] = await Promise.all([
    db.from("amendments").select("id, slug, title, status").order("id", { ascending: false }),
    db.from("amendment_events").select("id, amendment_id, stage, occurred_on, skipped, correction_of, reason").order("id"),
  ]);
  if (a.error) throw dbError(a.error, "amendments 목록");
  if (e.error) throw dbError(e.error, "amendment_events 목록");
  const amendments = (a.data ?? []) as { id: number; slug: string; title: string; status: string }[];
  const events = (e.data ?? []) as { id: number; amendment_id: number; stage: string; occurred_on: string | null; skipped: boolean; correction_of: number | null; reason: string | null }[];
  const corrected = new Set(events.flatMap((x) => (x.correction_of === null ? [] : [Number(x.correction_of)])));
  return (
    <>
      <PageTitle title="개정 트래커" description={`개정안과 단계 기록입니다 (${nowIso().slice(0, 10)} 기준). 단계 기록은 추가만 되고, 잘못된 기록은 사유를 적은 정정으로 고칩니다.`} />
      <div className="space-y-8">
        <Panel id="amendment-list" title="개정안" description="공개 전환은 PO가 합니다.">
          {amendments.length === 0 ? (
            <EmptyNote>개정안이 없습니다.</EmptyNote>
          ) : (
            <ul className="space-y-4" data-testid="amendment-admin-list">
              {amendments.map((m) => (
                <li key={m.id} data-amendment-id={m.id} className="rounded-xl border border-navy-100 p-4 text-[15px]">
                  <p className="font-bold text-navy-900">
                    {m.title} <span className={MONO}>#{m.id} · {m.slug}</span> <ToneChip>{m.status}</ToneChip>
                  </p>
                  <ul className="mt-2 space-y-1">
                    {events
                      .filter((x) => Number(x.amendment_id) === Number(m.id))
                      .map((x) => (
                        <li key={x.id} data-event-id={x.id} className={corrected.has(Number(x.id)) ? "text-navy-400 line-through" : ""}>
                          <span className={MONO}>기록 {x.id}</span> {STAGE_LABELS[x.stage] ?? x.stage} · {x.skipped ? "해당 없음" : x.occurred_on}
                          {x.correction_of !== null && <> · 기록 {x.correction_of} 정정 ({x.reason})</>}
                          {corrected.has(Number(x.id)) && <> · 정정됨</>}
                        </li>
                      ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel id="amendment-input" title="입력" description="개정안 만들기 · 단계 기록/정정 · 기사 연결">
          <AmendmentForms amendments={amendments.map((m) => ({ id: Number(m.id), title: m.title }))} />
        </Panel>
      </div>
    </>
  );
}
