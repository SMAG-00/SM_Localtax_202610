import Link from "next/link";
import type { ReactNode } from "react";
import { Callout } from "@ltr/ui";
import { isoToKstDate, isoToKstDateTime } from "@/lib/admin/form-utils";
import { EDITORIAL_STATUS_LABELS, REPORTING_METHOD_LABELS, TAX_REVIEW_STATUS_LABELS, labelOf } from "@/lib/admin/labels";
import { formatCount } from "@/lib/admin/metrics-view";
import {
  BASE_NOTE,
  CAPACITY_GUIDANCE,
  INTERNAL_TABLES,
  METRIC_LABELS,
  NOT_REVIEWED,
  OFFICIAL_NOTE,
  READINESS_PATH,
  REQUIREMENTS_PATH,
  SIMILARITY_NOTICE,
  UNDETERMINED,
  UNDETERMINED_NOTE,
  basisLabel,
  comparisonText,
  criterionText,
  filterText,
  officialCell,
  personKind,
  similarityLabel,
  tableDefinitions,
  windowLabel,
  type ReadinessDefinition,
} from "@/lib/admin/readiness-view";
import { PLATFORM_LABELS } from "@/lib/readiness/requirements";
import type { MonthWindow } from "@/lib/readiness/windows";
import type { PlatformSection, ReadinessDashboard } from "@/lib/server/readiness/dashboard";
import { MONO, Panel, TEXT_LINK, ToneChip } from "./ui";

// 기사 생산·제휴 준비 대시보드 화면 (/admin/news-readiness — NAV-13 · NAV-14, docs/dev/W2-c_설계.md 8.5).
// 공식 정의(확정된 규정 버전)와 내부 정의(편집국 집계)를 따로 보이고, 숫자마다 아래에 분자·분모·제외 조건을 쉬운 말로 적는다.
// 확정 버전이 없는 플랫폼은 '요건 미확정' 한 줄과 이유만 — 공식 숫자·기준 비교 0. 표는 표 안에서만 가로로 넘친다(360px 페이지 가로 스크롤 0).

const TH = "border-b border-navy-100 px-2 py-2 align-bottom text-[13px] font-bold text-navy-600 sm:px-3";
const TD = "border-b border-navy-100 px-2 py-2 align-top text-[15px] text-navy-900 sm:px-3";
const NUM = `${TD} text-right font-mono tabular-nums whitespace-nowrap`;

const windowKey = (w: Pick<MonthWindow, "months">) => `w${w.months}`;

function Table({ caption, attrs, head, children }: { caption: string; attrs: Record<string, string>; head: readonly ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-navy-100 bg-white">
      <table {...attrs} className="w-full border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-ivory">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className={i === 0 ? TH : `${TH} text-right`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function WindowHead({ w }: { w: MonthWindow }) {
  const l = windowLabel(w);
  return (
    <>
      {l.title}
      <span className={`block font-normal ${MONO}`}>{l.range}</span>
    </>
  );
}

function Definition({ d, extra }: { d: Pick<ReadinessDefinition, "numerator" | "denominator" | "exclusions" | "note"> & { owner?: string; title?: string }; extra?: ReactNode }) {
  return (
    <dl data-part="definition" className="grid gap-x-3 gap-y-1 text-[14px] text-navy-700 sm:grid-cols-[6rem_minmax(0,1fr)]">
      {d.title && (
        <>
          <dt className="font-bold text-navy-900">지표</dt>
          <dd className="font-bold text-navy-900">{d.title}</dd>
        </>
      )}
      <dt className="font-bold text-navy-900">분자</dt>
      <dd>{d.numerator}</dd>
      <dt className="font-bold text-navy-900">분모</dt>
      <dd>{d.denominator}</dd>
      <dt className="font-bold text-navy-900">제외</dt>
      <dd>{d.exclusions}</dd>
      {extra}
      {d.owner && (
        <>
          <dt className="font-bold text-navy-900">소유</dt>
          <dd className={MONO}>{d.owner}</dd>
        </>
      )}
      {d.note && (
        <>
          <dt className="font-bold text-navy-900">참고</dt>
          <dd>{d.note}</dd>
        </>
      )}
    </dl>
  );
}

// ── 공식 정의 ────────────────────────────────────────────

function Undetermined({ s }: { s: Extract<PlatformSection, { state: "none" | "unconfirmed" }> }) {
  return (
    <div data-part="undetermined" className="space-y-2">
      <p className="flex flex-wrap items-center gap-2 text-[19px] font-black text-navy-900">
        <span data-cell="status">{UNDETERMINED}</span>
        {s.platform === "kakao" && s.state === "none" && <ToneChip tone="plain">{NOT_REVIEWED}</ToneChip>}
      </p>
      <p data-cell="reason" className="text-[15px] text-navy-700">
        {s.reason}
        {s.drafts > 0 ? ` (작성 중 ${s.drafts}개)` : ""}
      </p>
      <p className="text-[15px] text-navy-700">{UNDETERMINED_NOTE}</p>
      <Link href={REQUIREMENTS_PATH} className={TEXT_LINK}>
        규정 버전 적기·확정하기
      </Link>
    </div>
  );
}

function Confirmed({ s, windows }: { s: Extract<PlatformSection, { state: "confirmed" }>; windows: readonly MonthWindow[] }) {
  const v = s.version;
  const review = windowLabel(s.reviewWindow);
  return (
    <div data-part="official" className="space-y-4">
      <dl data-part="version" className="grid gap-x-3 gap-y-1 text-[15px] text-navy-800 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <dt className="font-bold text-navy-600">규정 버전</dt>
        <dd>
          <span data-cell="version" className="font-bold text-navy-900">
            {v.version}번
          </span>{" "}
          「{v.title}」 <ToneChip tone="emerald">확정</ToneChip>
        </dd>
        <dt className="font-bold text-navy-600">확정</dt>
        <dd>
          {s.approvedByName} · <span className={MONO}>{isoToKstDateTime(v.approved_at)}</span>
        </dd>
        <dt className="font-bold text-navy-600">원문</dt>
        <dd className="min-w-0 [overflow-wrap:anywhere]">
          <a href={v.source_url ?? undefined} target="_blank" rel="noopener noreferrer" className={TEXT_LINK}>
            {v.source_url}
          </a>
          {v.source_text_ref ? <span className="block text-[14px] text-navy-600">보관 위치 {v.source_text_ref}</span> : null}
        </dd>
        <dt className="font-bold text-navy-600">확인일</dt>
        <dd className={MONO}>{v.checked_at}</dd>
        <dt className="font-bold text-navy-600">등록 유형</dt>
        <dd data-cell="media-type">{v.media_type}</dd>
        <dt className="font-bold text-navy-600">적용 기간</dt>
        <dd className={MONO}>
          {v.effective_from} ~ {v.effective_to ?? "끝날 없음"}
        </dd>
        <dt className="font-bold text-navy-600">심사 대상 기간</dt>
        <dd>
          {s.reviewPeriod.text} — {s.reviewPeriod.months}개월, {basisLabel(s.reviewWindow)} ({review.range})
        </dd>
      </dl>
      <Table
        caption={`${PLATFORM_LABELS[s.platform]} 규정 ${v.version}번 요건 — 기간별 공식 정의 숫자·심사 기간 숫자·규정 기준·기준 대비`}
        attrs={{ "data-metric": "official" }}
        head={["요건", ...windows.map((w) => <WindowHead key={w.months} w={w} />), <WindowHead key="review" w={s.reviewWindow} />, "규정 기준", "기준 대비"]}
      >
        {s.rows.map((r) => (
          <tr key={r.item.key} data-row={r.item.key}>
            <th scope="row" className={`${TD} font-bold`}>
              {r.item.label}
              <span className="block text-[13px] font-normal text-navy-600">{METRIC_LABELS[r.item.metric]}</span>
            </th>
            {r.values.map((value, i) => (
              <td key={windows[i]!.months} data-cell={windowKey(windows[i]!)} className={NUM}>
                {officialCell(r.item, value)}
              </td>
            ))}
            <td data-cell="review" className={NUM}>
              {officialCell(r.item, r.review)}
            </td>
            <td data-cell="criterion" className={`${TD} text-right`}>
              {criterionText(r.item)}
            </td>
            <td data-cell="result" className={`${TD} text-right font-bold`}>
              {comparisonText(r.item, r.comparison)}
            </td>
          </tr>
        ))}
      </Table>
      <p className="text-[14px] text-navy-600">
        {OFFICIAL_NOTE} 심사 기간 칸 = {review.title} ({review.range}).
      </p>
      {s.capacityGuidance && (
        <Callout className="font-bold text-navy-900">
          <span data-part="capacity-guidance">{CAPACITY_GUIDANCE}</span>
        </Callout>
      )}
      <div className="space-y-3">
        {s.rows.map((r) => (
          <Definition
            key={r.item.key}
            d={{ title: r.item.label, numerator: r.item.numeratorText, denominator: r.item.denominatorText ?? "없음 (건수)", exclusions: r.item.exclusionsText }}
            extra={
              <>
                <dt className="font-bold text-navy-900">세는 기사</dt>
                <dd>
                  분자 {filterText(r.item.numerator)}
                  {r.item.denominator ? ` · 분모 ${filterText(r.item.denominator)}` : ""}
                </dd>
                {r.item.sourceRef && (
                  <>
                    <dt className="font-bold text-navy-900">원문 조항</dt>
                    <dd>{r.item.sourceRef}</dd>
                  </>
                )}
              </>
            }
          />
        ))}
      </div>
    </div>
  );
}

// ── 내부 정의 ────────────────────────────────────────────

function InternalPanels({ dash }: { dash: ReadinessDashboard }) {
  return (
    <>
      <p className="text-[15px] text-navy-700">{BASE_NOTE}</p>
      <ul data-part="excluded" className="space-y-1 text-[14px] text-navy-700">
        {dash.windows.map((w, i) => (
          <li key={w.months} data-row={windowKey(w)}>
            {windowLabel(w).title} ({windowLabel(w).range}) — 뺀 기사: 지금 보류·삭제 <span data-cell="not-published" className="font-mono font-bold text-navy-900">{formatCount(dash.internal[i]!.excluded.notPublished)}</span>건 · 이관{" "}
            <span data-cell="legacy" className="font-mono font-bold text-navy-900">
              {formatCount(dash.internal[i]!.excluded.legacy)}
            </span>
            건
          </li>
        ))}
      </ul>
      {INTERNAL_TABLES.map((t) => (
        <Panel key={t.id} id={`internal-${t.id}`} title={t.title}>
          {t.id === "similarity" && (
            <Callout>
              <span data-part="similarity-notice">{SIMILARITY_NOTICE}</span>
            </Callout>
          )}
          <Table caption={`${t.title} — 기간별 내부 정의 숫자`} attrs={{ "data-metric": t.id }} head={["지표", ...dash.windows.map((w) => <WindowHead key={w.months} w={w} />)]}>
            {t.rows.map((r) => (
              <tr key={r.id} data-row={r.id}>
                <th scope="row" className={`${TD} font-bold`}>
                  {r.label}
                </th>
                {dash.windows.map((w, i) => (
                  <td key={w.months} data-cell={windowKey(w)} className={NUM}>
                    {r.value(dash.internal[i]!)}
                  </td>
                ))}
              </tr>
            ))}
          </Table>
          <div className="space-y-3">
            {tableDefinitions(t).map((d) => (
              <Definition key={d.title} d={d} />
            ))}
          </div>
        </Panel>
      ))}
    </>
  );
}

function Reporters({ dash }: { dash: ReadinessDashboard }) {
  const last = dash.windows[dash.windows.length - 1]!;
  return (
    <Panel id="reporters" title="기자별 취재 부담" description="기간마다 쓴 기사(지금 공개 중)와 그 가운데 자체 취재 후보, 지금 맡은 기획(배정·취재·사실 확인·검토 중) 수입니다.">
      {dash.reporters.length === 0 ? (
        <p className="text-[15px] text-navy-600">이 기간에 기사를 쓰거나 기획을 맡은 사람이 없습니다.</p>
      ) : (
        <Table
          caption="기자별 취재 부담 — 기간별 발행·자체 취재 후보·진행 중 기획"
          attrs={{ "data-metric": "reporters" }}
          head={["이름", ...dash.windows.map((w) => <span key={w.months}>발행 {windowLabel(w).title}</span>), `자체 취재 후보 ${windowLabel(last).title}`, "진행 중 기획"]}
        >
          {dash.reporters.map((r) => (
            <tr key={r.personId} data-row={r.personId}>
              <th scope="row" className={`${TD} font-bold`}>
                {r.name}
                <span className="block text-[13px] font-normal text-navy-600">{personKind(r)}</span>
              </th>
              {dash.windows.map((w, i) => (
                <td key={w.months} data-cell={windowKey(w)} className={NUM}>
                  {formatCount(r.published[i]!)}
                </td>
              ))}
              <td data-cell="own" className={NUM}>
                {formatCount(r.own[r.own.length - 1]!)}
              </td>
              <td data-cell="open" className={NUM}>
                {formatCount(r.open)}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}

function Trace({ dash }: { dash: ReadinessDashboard }) {
  const t = dash.trace;
  return (
    <Panel id="trace" title="기사별 추적 — 근거 → 편집 → 정정" description="자체 취재 후보 기사마다 취재 근거·편집 승인·세무 감수·정정 기록을 이어 봅니다. 기사 이름을 누르면 기사 기록(근거·승인·정정)으로 갑니다.">
      <nav aria-label="추적 기간" className="flex flex-wrap gap-2">
        {dash.windows.map((w) => (
          <Link
            key={w.months}
            href={`${READINESS_PATH}?window=${w.months}#trace`}
            aria-current={w.months === t.window.months ? "page" : undefined}
            className={`${TEXT_LINK} rounded-lg px-2 aria-[current=page]:bg-navy-50`}
          >
            {windowLabel(w).title}
          </Link>
        ))}
      </nav>
      {t.problem && <p className="text-[14px] text-rose-700">{t.problem}</p>}
      <p data-part="trace-count" className="text-[14px] text-navy-700">
        {windowLabel(t.window).title} ({windowLabel(t.window).range}) 자체 취재 후보 {formatCount(t.total)}건
        {t.total > t.rows.length ? ` — 최근 ${t.rows.length}건만 보입니다` : ""}
      </p>
      {t.rows.length > 0 && (
        <Table caption="기사별 추적 — 발행일·취재 방식·근거·편집 승인·세무 감수·정정·유사도" attrs={{ "data-metric": "trace" }} head={["기사", "발행일", "취재 방식", "근거 (확인/전체)", "편집 승인", "세무 감수", "정정·반론 기록", "유사도 점검"]}>
          {t.rows.map((r) => (
            <tr key={r.id} data-row={r.id}>
              <th scope="row" className={`${TD} min-w-48 font-bold`}>
                <Link href={`/admin/articles/${r.id}`} className={`${TEXT_LINK} [overflow-wrap:anywhere]`}>
                  {r.title}
                </Link>
              </th>
              <td className={NUM}>{isoToKstDate(new Date(r.publishedAt).toISOString())}</td>
              <td className={`${TD} text-right`}>{r.reportingMethod ? labelOf(REPORTING_METHOD_LABELS, r.reportingMethod) : "없음"}</td>
              <td data-cell="evidence" className={NUM}>
                {formatCount(r.evidenceVerified)} / {formatCount(r.evidenceTotal)}
              </td>
              <td className={`${TD} text-right`}>{labelOf(EDITORIAL_STATUS_LABELS, r.editorialStatus)}</td>
              <td className={`${TD} text-right`}>{labelOf(TAX_REVIEW_STATUS_LABELS, r.taxReviewStatus)}</td>
              <td data-cell="corrections" className={NUM}>
                {formatCount(r.corrections)}
              </td>
              <td className={`${TD} text-right`}>{similarityLabel(r.lastSimilarity)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}

export function ReadinessView({ dash }: { dash: ReadinessDashboard }) {
  return (
    <div className="space-y-8">
      <p data-part="computed" className="text-[14px] text-navy-600">
        오늘 <span className={MONO}>{dash.today}</span> · 계산 <span className={MONO}>{isoToKstDateTime(dash.computedAt)}</span> (한국 시간) · 기간 {dash.windows.map((w) => windowLabel(w).title).join("·")}, {basisLabel(dash.windows[0]!)} (설정{" "}
        <span className={MONO}>news_readiness_windows {dash.windowsSetting.version}</span>)
      </p>
      {dash.windowsProblem && (
        <Callout>
          <span data-part="windows-problem">{dash.windowsProblem}</span>
        </Callout>
      )}

      <section data-section="official" aria-labelledby="official-title" className="space-y-4">
        <h2 id="official-title" className="text-[23px] font-black text-navy-900">
          공식 정의 — 확정된 규정 버전
        </h2>
        {dash.platforms.map((s) => (
          <section key={s.platform} data-platform={s.platform} data-state={s.state} aria-labelledby={`platform-${s.platform}`} className="rounded-2xl border border-navy-100 bg-white p-6">
            <h3 id={`platform-${s.platform}`} className="mb-3 text-[19px] font-black text-navy-900">
              {PLATFORM_LABELS[s.platform]}
            </h3>
            {s.state === "confirmed" ? <Confirmed s={s} windows={dash.windows} /> : <Undetermined s={s} />}
          </section>
        ))}
      </section>

      <section data-section="internal" aria-labelledby="internal-title" className="space-y-4">
        <h2 id="internal-title" className="text-[23px] font-black text-navy-900">
          내부 정의 — 편집국 집계
        </h2>
        <InternalPanels dash={dash} />
      </section>

      <section data-section="reporters">
        <Reporters dash={dash} />
      </section>
      <section data-section="trace">
        <Trace dash={dash} />
      </section>
    </div>
  );
}
