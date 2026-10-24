import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ForbiddenView } from "@/components/admin/ForbiddenView";
import { OpForm } from "@/components/admin/LocalNewsControls";
import { MONO, PageTitle, Panel, TEXT_LINK } from "@/components/admin/ui";
import { serviceDb } from "@/lib/server/articles/service";
import { pageId, pageViewer } from "@/lib/server/admin/pages";
import { openRequestDetail } from "@/lib/server/experts/board";

// 연락 요청 보안 화면 (/admin/experts/requests/[id] - W7c EXPL-16·17·19). 관리자(운영 책임자)만 열 수 있고, 열 때마다 열람이 감사 로그에 남는다.
// 파기된 요청은 이름·연락처·요약이 없고 상태·분야 통계만 보인다 (EXPL-21).
export const metadata: Metadata = { title: "연락 요청", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { received: "접수", contacted: "첫 연락", closed: "종결" };
const CLOSE_LABEL: Record<string, string> = { contract: "계약 진행", guidance_end: "안내 종료", unreachable: "연락 불가", withdrawn: "이용자 철회" };

export default async function ExpertRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await pageViewer();
  if (!viewer.isAdmin) return <ForbiddenView />;
  const id = pageId((await params).id);
  const d = await openRequestDetail(serviceDb(), id, viewer);
  if (!d) notFound();
  return (
    <>
      <PageTitle title={`연락 요청 ${d.receipt_no}`} description="이 화면의 내용은 목적 외로 쓰지 않습니다 - 기사·AI 학습·마케팅·전문가 홍보에 쓰지 않습니다.">
        <Link href="/admin/experts#ex-requests" className={TEXT_LINK}>
          목록으로
        </Link>
      </PageTitle>
      <div className="space-y-8">
        <Panel id="exr-body" title="요청 내용">
          {d.purged_at ? (
            <p data-testid="exr-purged" className="text-[15px] text-navy-800">
              보관 기간이 지났거나 철회되어 이름·연락처·요약을 파기했습니다.
            </p>
          ) : (
            <dl data-testid="exr-detail" className="grid gap-2 text-[15px] text-navy-800 sm:grid-cols-[10rem_1fr]">
              <dt className="font-bold">이름</dt>
              <dd>{d.name}</dd>
              <dt className="font-bold">이메일</dt>
              <dd>{d.email ?? "-"}</dd>
              <dt className="font-bold">전화</dt>
              <dd>{d.phone ?? "-"}</dd>
              <dt className="font-bold">희망 연락 시간</dt>
              <dd>{d.preferred_time ?? "-"}</dd>
              <dt className="font-bold">요약 ({d.summary_origin === "ai_draft" ? "AI 초안을 이용자가 확인" : "이용자 작성"})</dt>
              <dd className="[overflow-wrap:anywhere]">{d.summary}</dd>
              <dt className="font-bold">기한 임박 표시</dt>
              <dd>{d.deadline_urgent ? "예 - 연락을 기다리지 말고 직접 연락하라고 안내했습니다" : "아니오"}</dd>
            </dl>
          )}
          <p className={`${MONO} text-navy-600`}>
            분야 {d.category_code} · 진입 {d.source} · 동의 {d.consent_version} ({d.consented_at.slice(0, 10)}) · 보관 기한 {d.retention_until}
          </p>
        </Panel>
        <Panel id="exr-status" title={`상태 - ${STATUS_LABEL[d.status]}${d.close_reason ? ` (${CLOSE_LABEL[d.close_reason]})` : ""}`}>
          <ul className="space-y-1 text-[14px] text-navy-700" data-testid="exr-events">
            {d.events.map((e, i) => (
              <li key={i} className={MONO}>
                {e.at.slice(0, 16).replace("T", " ")} UTC · {e.from_status ?? "-"} → {e.to_status}
                {e.note ? ` · ${e.note}` : ""}
              </li>
            ))}
          </ul>
          {d.performing_entity && <p className="text-[15px] text-navy-800">수행 주체: {d.performing_entity}</p>}
          {d.status === "received" && !d.purged_at && (
            <OpForm
              id="exr-contact"
              op="request_status"
              label="첫 연락 기록"
              submit="첫 연락으로 기록"
              endpoint="/api/admin/experts"
              ctx={{ id: d.id, status: "contacted" }}
              fields={[
                { name: "performing_entity", label: "수행 주체 (상담·업무를 맡는 사무소·법인 이름과 자격)", required: true },
                { name: "scope_noted", label: "업무 범위·비용 기준·수행 주체를 이용자에게 먼저 안내했습니다", type: "check" },
              ]}
            />
          )}
          {d.status !== "closed" && !d.purged_at && (
            <OpForm
              id="exr-close"
              op="request_status"
              label="종결"
              submit="종결"
              endpoint="/api/admin/experts"
              ctx={{ id: d.id, status: "closed" }}
              fields={[
                {
                  name: "close_reason",
                  label: "종결 사유",
                  type: "select",
                  required: true,
                  options: [
                    { value: "", label: "고르세요" },
                    { value: "contract", label: "계약 진행 (계약 내용·금액은 기록하지 않습니다)" },
                    { value: "guidance_end", label: "안내 종료" },
                    { value: "unreachable", label: "연락 불가" },
                  ],
                },
              ]}
            />
          )}
        </Panel>
      </div>
    </>
  );
}
