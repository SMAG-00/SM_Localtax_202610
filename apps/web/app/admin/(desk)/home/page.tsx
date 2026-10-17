import type { Metadata } from "next";
import { Callout } from "@ltr/ui";
import { CurationAddForm, CurationList } from "@/components/admin/HomeCurationControls";
import { EmptyNote, MONO, PageTitle, Panel, ToneChip } from "@/components/admin/ui";
import { CURATION_KINDS, CURATION_KIND_LABELS, CURATION_LIMITS, fullToday } from "@/lib/admin/home-curation-rules";
import { FORMAT_LABELS, labelOf } from "@/lib/admin/labels";
import { describeCurations, listCurationRows, storyTargets, trackerTargets } from "@/lib/server/admin/home-curations";
import { pageViewer, requirePage } from "@/lib/server/admin/pages";
import { kstDate } from "@/lib/server/articles/gate";
import { nowIso, serviceDb } from "@/lib/server/articles/service";
import { PublicDataError, getHomeAmendments, type AmendmentsSection } from "@/lib/server/public";

// 홈 배치 (/admin/home, HOME-03 · ADM-01 홈 큐레이션) — 편집 책임자만(article.home). 개정 트래커 하이라이트(같은 날 3장)·
// 해설 스토리(같은 날 6장 — 7장째 지정 불가)의 순서와 노출 기간(한국 날짜, 그날까지)을 정한다. 기간이 끝난 카드는 홈에서 자동으로 빠진다.
// 아래 '지금 홈에 보이는 모습'은 공개 데이터 함수(anon 키 — 방문자와 같은 권한)로 계산한다.
export const metadata: Metadata = { title: "홈 배치" };

const KIND_GUIDE = {
  tracker: "개정 트래커 1~3건 — 단계 배지·확정 아님 표시는 트래커 기록에서 옵니다. 지정이 0건이면 최근 단계가 바뀐 트래커 1건이 자동으로 보이고, 공개 트래커가 없으면 섹션이 숨습니다.",
  story: "해설 스토리 3~6장 — 지정이 3장보다 적으면 최신 해설로 3장까지 자동으로 채웁니다. 광고·금주 핫뉴스는 고를 수 없습니다.",
} as const;

function Preview({ section }: { section: AmendmentsSection | null }) {
  if (!section) return <EmptyNote>지금 홈에는 개정 트래커 하이라이트 섹션이 없습니다 — 공개 트래커가 없습니다.</EmptyNote>;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="text-[17px] font-black text-navy-900">트래커 {section.trackers.length}건</h3>
        <ol className="mt-2 space-y-2" data-testid="preview-trackers">
          {section.trackers.map((t) => (
            <li key={t.id} className="rounded-xl border border-navy-100 p-3 text-[15px]">
              <span className="font-bold text-navy-900">{t.title}</span> · 현재 단계 {t.stage.label}
              {!t.stage.confirmed && <> · 확정 아님</>}
              {!t.designated && <ToneChip className="ml-2">자동 채움</ToneChip>}
            </li>
          ))}
        </ol>
      </div>
      <div>
        <h3 className="text-[17px] font-black text-navy-900">해설 스토리 {section.stories.length}장</h3>
        {section.stories.length === 0 ? (
          <EmptyNote>스토리 카드가 없습니다 — 지정도 최신 해설도 없습니다.</EmptyNote>
        ) : (
          <ol className="mt-2 space-y-2" data-testid="preview-stories">
            {section.stories.map((s) => (
              <li key={s.id} className="rounded-xl border border-navy-100 p-3 text-[15px]">
                <span className="font-bold text-navy-900 [overflow-wrap:anywhere]">{s.title}</span>
                {s.format && <> · {labelOf(FORMAT_LABELS, s.format)}</>}
                {!s.designated && <ToneChip className="ml-2">자동 채움</ToneChip>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export default async function HomeCurationPage() {
  const viewer = await pageViewer();
  requirePage(viewer, "article.home");
  const db = serviceDb();
  const today = kstDate(nowIso());
  const [rows, trackers, stories] = await Promise.all([listCurationRows(db), trackerTargets(db), storyTargets(db)]);
  const items = await describeCurations(db, rows, today);
  let preview: AmendmentsSection | null = null;
  let previewFailed = false;
  try {
    preview = (await getHomeAmendments()).section;
  } catch (err) {
    if (!(err instanceof PublicDataError)) throw err;
    previewFailed = true;
  }
  const options = {
    tracker: trackers.map((t) => ({ value: String(t.id), label: `${t.title} (현재 단계 ${t.stageLabel})` })),
    story: stories.map((s) => ({ value: String(s.id), label: s.format === "general" ? s.title : `${s.title} (${labelOf(FORMAT_LABELS, s.format)})` })),
  };

  return (
    <>
      <PageTitle title="홈 배치" description={`홈의 개정 트래커 하이라이트와 해설 스토리 카드입니다. 오늘(${today}) 기준 — 노출 기간은 종료일 당일까지입니다.`} />
      <div className="space-y-8">
        {CURATION_KINDS.map((kind) => {
          const mine = items.filter((i) => i.kind === kind);
          const active = mine.filter((i) => i.status === "active").length;
          return (
            <Panel
              key={kind}
              id={`curation-${kind}`}
              title={CURATION_KIND_LABELS[kind]}
              description={
                <>
                  {KIND_GUIDE[kind]} <span className={MONO}>오늘 {active}/{CURATION_LIMITS[kind]}장</span>
                </>
              }
            >
              {mine.length === 0 ? <EmptyNote>지정한 카드가 없습니다.</EmptyNote> : <CurationList kind={kind} items={mine} today={today} />}
              <details className="rounded-xl border border-dashed border-navy-200 p-4" open={mine.length === 0}>
                <summary className="min-h-11 cursor-pointer text-[15px] font-bold text-navy-800">카드 더하기</summary>
                {options[kind].length === 0 ? (
                  <EmptyNote>{kind === "tracker" ? "공개된 개정 트래커가 없습니다." : "발행된 기사가 없습니다."}</EmptyNote>
                ) : (
                  <div className="mt-3">
                    <CurationAddForm
                      kind={kind}
                      options={options[kind]}
                      existing={mine}
                      today={today}
                      fullNow={fullToday(kind, mine.map((i) => ({ starts_on: i.startsOn, ends_on: i.endsOn })), today)}
                    />
                  </div>
                )}
              </details>
            </Panel>
          );
        })}
        <Panel id="home-preview" title="지금 홈에 보이는 모습" description="방문자와 같은 권한으로 계산합니다 — 공개 전 대상·끝난 카드는 빠지고, 지정이 모자라면 자동으로 채웁니다.">
          {previewFailed ? <Callout>공개 데이터를 읽지 못했습니다 — 서버 설정(공개 키)을 확인하세요.</Callout> : <Preview section={preview} />}
        </Panel>
      </div>
    </>
  );
}
