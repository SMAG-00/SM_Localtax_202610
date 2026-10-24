"use client";

import { useEffect, useState } from "react";
import { DarkButton } from "@ltr/ui";
import { adminApi, apiErrorMessage } from "@/lib/admin/api-client";
import { CHECK_DEBOUNCE_MS, PANEL_COPY, PUBLISH_COPY, failedItemNames, panelView, publishButtonState, type CheckReport, type PanelItem } from "@/lib/admin/check-panel";
import { ErrorSummary, StatusNote } from "./fields";
import { MONO, OUTLINE_BUTTON, ToneChip } from "./ui";
import { useHydrated } from "./useHydrated";

/**
 * 최적화 점검 패널 (OPT-03) — 발행 판정 미리 보기(GET check, 저장하지 않음). 차단 항목(발행 불가)과 경고(발행 가능, 발행 기록에 남음)를
 * 위치·한국어 문장과 함께 보인다. 축별 점수는 내부 품질 지표이고, 점수 옆 고정 문구(서버의 SCORE_DISCLAIMER)를 그대로 쓴다.
 * 발행 버튼은 차단 항목이 남거나 발행 권한(editor)이 없으면 꺼진다. 발행 422면 실패 항목을 보인다.
 */
export function CheckPanel({
  articleId,
  status,
  canPublishRole,
  blockTypes,
  refreshKey,
  draft = null,
  onChanged,
}: {
  articleId: number;
  status: string;
  canPublishRole: boolean;
  blockTypes: readonly string[];
  /** 바뀌면 다시 점검한다 (버전·게재 상태·검토 기록 수) */
  refreshKey: string;
  /** 저장하지 않은 입력(저장 요청 본문과 같은 모양) — 있으면 입력이 멈춘 뒤 이 입력으로 다시 점검한다 (OPT-03). 저장본과 같으면 null */
  draft?: Record<string, unknown> | null;
  onChanged: () => void;
}) {
  const hydrated = useHydrated();
  const [report, setReport] = useState<CheckReport | null>(null);
  const [loadError, setLoadError] = useState("");
  const [nonce, setNonce] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState("");
  const [publishFailure, setPublishFailure] = useState<{ title: string; details: string[] } | null>(null);

  const draftJson = draft === null ? null : JSON.stringify(draft);
  useEffect(() => {
    let alive = true;
    // 저장 전 입력이 있으면 입력이 멈춘 뒤에 POST(같은 판정, 저장 없음). 늦게 온 응답은 버린다(alive)
    const timer = setTimeout(
      () => {
        const request = draftJson === null ? adminApi("GET", `/api/admin/articles/${articleId}/check`) : adminApi("POST", `/api/admin/articles/${articleId}/check`, JSON.parse(draftJson));
        request.then((r) => {
          if (!alive) return;
          if (r.status === 200) {
            setReport(r.body as unknown as CheckReport);
            setLoadError("");
          } else setLoadError(apiErrorMessage(r));
        });
      },
      draftJson === null ? 0 : CHECK_DEBOUNCE_MS,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [articleId, refreshKey, nonce, draftJson]);

  async function publish() {
    setPublishing(true);
    setPublished("");
    setPublishFailure(null);
    const r = await adminApi("POST", `/api/admin/articles/${articleId}/publish`);
    setPublishing(false);
    if (r.status === 200) {
      const warnings = Array.isArray(r.body.warnings) ? r.body.warnings.length : 0;
      setPublished(warnings > 0 ? PANEL_COPY.publishedWithWarnings(warnings) : PANEL_COPY.published);
      onChanged();
      return;
    }
    if (r.status === 422 && Array.isArray(r.body.failed)) {
      const fresh = r.body as unknown as CheckReport;
      setReport(fresh);
      setPublishFailure({ title: PANEL_COPY.publishFailed, details: failedItemNames(fresh) });
      return;
    }
    setPublishFailure({ title: apiErrorMessage(r), details: [] });
  }

  const view = report ? panelView(report, blockTypes) : null;
  const button = publishButtonState({ report, canPublishRole, status, unsaved: draft !== null });

  return (
    <section data-testid="check-panel" aria-labelledby="check-title" className="rounded-2xl border border-navy-100 bg-white p-6">
      <h2 id="check-title" className="text-[19px] font-black text-navy-900">
        {PANEL_COPY.title}
      </h2>
      <p className="mt-1 text-[14px] text-navy-600" data-testid="check-basis">
        {draft === null ? PANEL_COPY.basis : PANEL_COPY.draftBasis}
      </p>
      {loadError && <ErrorSummary title={loadError} messages={[]} />}
      {!report && !loadError && (
        <p role="status" className="mt-3 text-[15px] text-navy-600">
          {PUBLISH_COPY.loading}
        </p>
      )}
      {view && (
        <>
          <dl className="mt-3 grid grid-cols-4 gap-2" aria-label="축별 점수">
            {view.scores.map((s) => (
              <div key={s.label} className="rounded-xl border border-navy-100 bg-ivory px-1 py-2 text-center">
                <dt className="text-[13px] font-bold text-navy-600">{s.label}</dt>
                <dd className="mt-1 font-mono text-[17px] font-bold text-navy-900">{s.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-[13px] text-navy-600">{view.disclaimer}</p>
          <p className={`mt-1 text-navy-600 ${MONO}`}>규칙 {view.ruleVersion}</p>

          <h3 className="mt-4 text-[15px] font-black text-navy-900">
            {PANEL_COPY.blockers} <span data-testid="blocker-count">{view.blockers.length}</span>개
          </h3>
          <Items items={view.blockers} tone="rose" label="차단" testId="check-blockers" />

          <h3 className="mt-4 text-[15px] font-black text-navy-900">
            {PANEL_COPY.warnings} <span data-testid="warning-count">{view.warnings.length}</span>개
          </h3>
          <Items items={view.warnings} tone="amber" label="경고" testId="check-warnings" />

          {view.editorialWarnings.length > 0 && (
            <>
              <h3 className="mt-4 text-[15px] font-black text-navy-900">
                {PANEL_COPY.editorialWarnings} <span data-testid="editorial-warning-count">{view.editorialWarnings.length}</span>개
              </h3>
              <Items items={view.editorialWarnings} tone="amber" label="편집 경고" testId="check-editorial-warnings" />
            </>
          )}

          {view.taxReviewReasons.length > 0 && (
            <div className="mt-4">
              <h3 className="text-[15px] font-black text-navy-900">{PANEL_COPY.taxReasons}</h3>
              <ul className="mt-1 list-disc pl-5 text-[14px] text-navy-700">
                {view.taxReviewReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={OUTLINE_BUTTON} onClick={() => setNonce((n) => n + 1)}>
          {PANEL_COPY.recheck}
        </button>
        <DarkButton onClick={publish} disabled={button.disabled || publishing || !hydrated} aria-describedby={button.reason ? "publish-reason" : undefined}>
          {publishing ? PANEL_COPY.publishing : PANEL_COPY.publish}
        </DarkButton>
      </div>
      {button.reason && (
        <p id="publish-reason" data-testid="publish-reason" className="mt-2 text-[14px] font-bold text-navy-800">
          {button.reason}
        </p>
      )}
      {published && <div className="mt-3"><StatusNote>{published}</StatusNote></div>}
      {publishFailure && (
        <div className="mt-3">
          <ErrorSummary title={publishFailure.title} messages={publishFailure.details} />
        </div>
      )}
    </section>
  );
}

function Items({ items, tone, label, testId }: { items: readonly PanelItem[]; tone: "rose" | "amber"; label: string; testId: string }) {
  if (items.length === 0) return <p className="mt-1 text-[14px] text-navy-600">{PANEL_COPY.none}</p>;
  return (
    <ul data-testid={testId} className="mt-2 space-y-2">
      {items.map((it) => (
        <li key={it.key} data-rule={it.id} className="flex items-start gap-2 text-[14px] text-navy-800">
          <ToneChip tone={tone}>{label}</ToneChip>
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <span className="block font-bold text-navy-900">{it.title}</span>
            <span className="block">{it.message}</span>
            {it.where && <span className="block text-navy-600">위치: {it.where}</span>}
            <span className={`block text-navy-600 ${MONO}`}>
              {it.ruleRef} · {it.id}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
