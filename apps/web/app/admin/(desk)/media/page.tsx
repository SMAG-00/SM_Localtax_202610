import type { Metadata } from "next";
import { Callout } from "@ltr/ui";
import { LICENSE_TYPE_LABELS, type LicenseType } from "@ltr/editorial";
import { MediaRightsButtons, MediaUploadForm } from "@/components/admin/MediaControls";
import { EmptyNote, MONO, PageTitle, Panel, ToneChip, type Tone } from "@/components/admin/ui";
import { can } from "@/lib/access";
import { MEDIA_KIND_LABELS, MEDIA_RIGHTS_STATUS_LABELS } from "@/lib/admin/media-rules";
import { labelOf } from "@/lib/admin/labels";
import { listMediaRows, mediaView } from "@/lib/server/admin/media-store";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { serviceDb } from "@/lib/server/articles/service";

// 사진 보관함 (/admin/media, F1) — 기자·편집 책임자·관리자는 올리기·목록, 권리 확인·반려는 편집 책임자·관리자.
// 권리 확인된 사진만 공개 화면·발행 판정을 통과한다 (NAV-04). 기사 편집기의 이미지 고르기는 이 목록에서 읽는다.
export const metadata: Metadata = { title: "사진 보관함" };

const RIGHTS_TONE: Record<string, Tone> = { confirmed: "emerald", unconfirmed: "amber", rejected: "rose" };

export default async function MediaPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "media.edit");
  const canRights = can(viewer, "media.rights");
  const rows = (await listMediaRows(serviceDb())).map(mediaView);

  return (
    <>
      <PageTitle title="사진 보관함" description="기사에 쓸 사진을 올리고 권리를 확인합니다. 권리 확인된 사진만 독자 화면에 나옵니다." />
      {!canRights && <Callout className="mb-6">권리 확인·반려는 편집 책임자가 합니다. 올린 사진은 ‘권리 미확인’으로 들어갑니다.</Callout>}
      <Panel id="media-new" title="사진 올리기" className="mb-8">
        <MediaUploadForm />
      </Panel>
      {rows.length === 0 && <EmptyNote>올린 사진이 없습니다.</EmptyNote>}
      <ul className="grid gap-4 sm:grid-cols-2" data-testid="media-list">
        {rows.map((m) => {
          const name = m.alt || `사진 ${m.id}`;
          return (
            <li key={m.id} data-testid={`media-${m.id}`} data-rights={m.rights_status} className="min-w-0 rounded-2xl border border-navy-100 bg-white p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.url} alt={name} loading="lazy" decoding="async" className="block h-40 w-full rounded-xl border border-navy-100 bg-ivory object-contain" />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className={`text-navy-600 ${MONO}`}>번호 {m.id}</span>
                <ToneChip tone={RIGHTS_TONE[m.rights_status] ?? "plain"}>
                  <span data-testid="media-rights">{labelOf(MEDIA_RIGHTS_STATUS_LABELS, m.rights_status)}</span>
                </ToneChip>
                <ToneChip tone="plain">{labelOf(MEDIA_KIND_LABELS, m.kind)}</ToneChip>
              </div>
              <p className="mt-2 text-[16px] font-bold text-navy-900 [overflow-wrap:anywhere]">{name}</p>
              <dl className="mt-2 space-y-1 text-[14px] text-navy-800">
                <Row term="출처" value={m.credit} />
                <Row term="촬영자" value={m.photographer} />
                <Row term="이용 조건" value={m.license} />
                <Row term="공공누리" value={m.license_type ? (LICENSE_TYPE_LABELS[m.license_type as LicenseType] ?? m.license_type) : null} />
                <Row term="원본 주소" value={m.source_url} />
                <Row term="크기" value={m.width && m.height ? `${m.width}×${m.height}` : null} />
              </dl>
              {canRights && <div className="mt-3"><MediaRightsButtons id={m.id} status={m.rights_status} label={name} /></div>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Row({ term, value }: { term: string; value: string | null }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="shrink-0 font-bold text-navy-600">{term}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{value ?? "없음"}</dd>
    </div>
  );
}
