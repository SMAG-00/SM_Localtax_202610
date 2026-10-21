import type { Metadata } from "next";
import { LinkForm } from "@/components/admin/LinkControls";
import { EmptyNote, MONO, PageTitle, Panel, ToneChip } from "@/components/admin/ui";
import { isStale } from "@/lib/links/rules";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { dbError } from "@/lib/server/http";

// 바깥 연결 (/admin/links, TX-01·FAM-08 · W3 1·2단계) — 편집 책임자만(link.manage). SM 계산기 5종·외부 계산기·대체 안내의 주소·이용 조건 문구.
// 주소를 입력하기 전에는 /calc 카드가 숨는다. 점검은 배치(link-check)가 주 1회 자동으로 하고, 상대가 막는 곳만 수동으로 기록한다.
export const metadata: Metadata = { title: "바깥 연결" };
export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { sm_calculator: "SM 계산기", external_calculator: "외부 계산기", fallback: "대체 안내" };
const STATUS_LABEL: Record<string, string> = { ok: "정상", broken: "끊김", unchecked: "점검 전" };

interface Row {
  id: number;
  kind: string;
  key: string;
  label: string;
  url: string | null;
  terms_note: string | null;
  status: string;
  checked_at: string | null;
  check_method: string | null;
  active: boolean;
}

export default async function LinksPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "link.manage");
  const { data, error } = await serviceDb()
    .from("official_links")
    .select("id, kind, key, label, url, terms_note, status, checked_at, check_method, active")
    .order("sort")
    .order("id");
  if (error) throw dbError(error, "official_links 목록");
  const rows = (data ?? []) as Row[];
  const now = new Date(nowIso());
  const smReady = rows.filter((r) => r.kind === "sm_calculator" && r.active && r.url).length;
  const stale = rows.filter((r) => r.active && isStale(r, now)).length;
  return (
    <>
      <PageTitle title="바깥 연결" description="SM 부동산 세금 플랫폼 계산기와 외부 계산기·대체 안내의 주소입니다. 주소가 비어 있으면 화면에서 숨습니다." />
      <div className="space-y-8">
        {smReady < 5 && (
          <p data-part="warn-sm-count" role="status" className="rounded-xl border border-hermes-200 bg-hermes-50 p-4 text-[15px] text-navy-900">
            SM 계산기 카드가 {smReady}장만 보입니다 (5장 미만 — 주소를 입력하세요).
          </p>
        )}
        {stale > 0 && (
          <p data-part="warn-stale" role="status" className="rounded-xl border border-hermes-200 bg-hermes-50 p-4 text-[15px] text-navy-900">
            {/* 판정 = isStale(KST 날짜 기준 8일 이상 지남 또는 주소가 있는데 점검 전) — 7일 전 점검은 경고 0, 8일 전 점검은 경고 1 (TX-03) */}
            점검 기록이 없거나 점검한 지 8일 이상 지난 연결이 {stale}건 있습니다.
          </p>
        )}
        <Panel id="link-list" title="연결 목록">
          {rows.length === 0 ? (
            <EmptyNote>연결이 없습니다.</EmptyNote>
          ) : (
            <ul className="space-y-6" data-testid="link-admin-list">
              {rows.map((r) => (
                <li key={r.id} data-link-key={`${r.kind}:${r.key}`} className="rounded-xl border border-navy-100 p-4">
                  <p className="mb-3 text-[15px] font-bold text-navy-900">
                    {KIND_LABEL[r.kind] ?? r.kind} <span className={MONO}>{r.key}</span> <ToneChip>{STATUS_LABEL[r.status] ?? r.status}</ToneChip>
                    {r.checked_at && <span className={`${MONO} ml-2 text-navy-500`}>{r.checked_at.slice(0, 10)} · {r.check_method === "manual" ? "수동" : "자동"}</span>}
                  </p>
                  <LinkForm link={{ id: r.id, label: r.label, url: r.url, termsNote: r.terms_note, active: r.active }} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
