"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, PrimaryButton, SelectField } from "@ltr/ui";
import type { Finding } from "@ltr/editorial";
import type { EditorView } from "@/lib/server/articles/editor-view";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import {
  editorPayload,
  editorStateFromArticle,
  fieldErrorsFromServer,
  qualitativeRecords,
  quantitativeGroups,
  validateEditor,
  type EditorArticle,
  type EditorState,
} from "@/lib/admin/editor-state";
import type { FieldErrors } from "@/lib/admin/form-utils";
import { focusField } from "@/lib/admin/meta-more";
import { suggestedFixReason } from "@/lib/admin/quick-fix";
import { UPDATE_KIND_LABELS, optionsOf } from "@/lib/admin/labels";
import type { EditorMedia } from "@/lib/admin/media-blocks";
import type { EvidenceRowView } from "@/lib/admin/records-form";
import { CheckPanel } from "./CheckPanel";
import { EvidencePanel } from "./EvidencePanel";
import { ErrorSummary, StatusNote, TextAreaField } from "./fields";
import { RegionalJudgePanel } from "./RegionalJudgePanel";
import { SourcesPanel } from "./SourcesPanel";
import { SubmitForReview } from "./SubmitForReview";
import { Panel, TEXT_LINK } from "./ui";
import { BlockEditor } from "./editor/BlockEditor";
import { ChecklistsEditor } from "./editor/ChecklistsEditor";
import { ClaimsEditor } from "./editor/ClaimsEditor";
import { MetaFields } from "./editor/MetaFields";
import { MethodGuide } from "./editor/MethodGuide";
import { SolvedCaseEditor } from "./editor/SolvedCaseEditor";
import { TaxLensEditor } from "./editor/TaxLensEditor";
import { refOptions, type EditorPermissions } from "./editor/types";
import { useHydrated } from "./useHydrated";

type Category = { id: number; section: string; name: string };
type Partner = { id: number; name: string; contract_to: string | null };
type Media = EditorMedia;

// 간편 발행 (2026-10-31 PO 결정) — 쓰는 칸은 기본 정보·본문·저장(발행)만, 나머지는 아래 '그 밖의 칸' 하나로 접는다
const MAIN_NAV = new Set(["meta", "blocks", "save"]);

const SECTIONS_NAV: [string, string][] = [
  ["meta", "기본 정보"],
  ["blocks", "본문"],
  ["claims", "핵심 주장"],
  ["sources", "출처"],
  ["evidence", "취재 근거"],
  ["checklists", "취재 확인"],
  ["taxlens", "지방세로 읽기"],
  ["save", "저장"],
];

/**
 * 기사 편집기 (ART-01 · ART-05 · OPT-03) — 간편 발행(2026-10-31 PO 결정): 기본 정보 → 본문 → 저장·[발행] 순서로 보이고,
 * 핵심 주장·출처·취재 근거·확인 목록·「지방세로 읽기」는 '그 밖의 칸'에, 점검 결과는 오른쪽 '점검 결과 보기'에 접어 둔다.
 * [발행]은 저장하지 않은 입력을 먼저 저장(PATCH)한 뒤 발행(POST publish)한다. 저장은 버전으로 동시 수정을 막는다.
 */
export function ArticleWorkspace({
  view,
  categories,
  partners,
  media,
  perms,
  today,
  publishBlockers = [],
}: {
  view: EditorView;
  categories: readonly Category[];
  partners: readonly Partner[];
  media: readonly Media[];
  perms: EditorPermissions;
  /** 한국 날짜 YYYY-MM-DD (서버가 정한다 — 제휴사 계약 종료 판정) */
  today: string;
  /** 발행 전에 고칠 것 — 서버 판정(간편 발행 정책)의 남은 차단 문장. 저장본 기준 */
  publishBlockers?: readonly string[];
}) {
  const hydrated = useHydrated();
  const router = useRouter();
  // 블록·핵심 주장의 화면 key — 한 번 만든 번호 생성기를 계속 쓴다 (서버·브라우저 첫 렌더가 같은 key)
  const [makeKey] = useState(() => {
    let n = 0;
    return () => `k${++n}`;
  });
  const article = view.article as unknown as EditorArticle;
  const [state, setState] = useState<EditorState>(() => editorStateFromArticle(article, makeKey));
  // 마지막으로 불러오거나 저장한 상태 — 발행 기사 수정 사유를 바꾼 칸으로 자동으로 만든다
  const [loaded, setLoaded] = useState<EditorState>(state);
  const [baseVersion, setBaseVersion] = useState(view.article.version);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<{ title: string; details: string[]; conflict: boolean } | null>(null);
  const [saved, setSaved] = useState<{ message: string; checks: Finding[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishFailure, setPublishFailure] = useState<{ title: string; details: string[] } | null>(null);
  // 저장 전 입력 점검 (OPT-03) — 저장 요청과 같은 본문에서 버전·수정 사유 칸을 뺀 값이 저장해 둔 값과 다르면 패널이 이 입력으로 다시 점검한다
  const draftBody = (() => {
    const { expectedVersion: _version, ...body } = editorPayload(state, { published: false, version: 0 });
    return body;
  })();
  const draftJson = JSON.stringify(draftBody);
  const [savedJson, setSavedJson] = useState(draftJson);

  const published = view.article.firstPublishedAt !== null;
  const readOnly = !perms.canEdit || view.article.status === "deleted";
  const update = (patch: Partial<EditorState>) => setState((s) => ({ ...s, ...patch }));
  const refs = refOptions(view.sources, view.evidence);
  const evidence = view.evidence as unknown as EvidenceRowView[];
  const storedBlockTypes = view.article.body.blocks.map((b) => b.type);
  const method = state.contentType === "reported_news" ? state.reportingMethod : "";
  const refresh = () => router.refresh();

  async function save(e: FormEvent) {
    e.preventDefault();
    await persist();
  }

  /** 저장(PATCH) — 성공하면 true. 칸 오류·서버 거부는 저장 칸에 보인다 */
  async function persist(): Promise<boolean> {
    setSaved(null);
    setFailure(null);
    // 발행 기사 수정 사유를 비워 두면 바꾼 칸으로 만든 문장을 쓴다 (예: "요약 수정")
    const autoReason = published && state.reason.trim() === "" ? suggestedFixReason(loaded, state) : "";
    const submitted = autoReason ? { ...state, reason: autoReason } : state;
    const v = validateEditor(submitted, { published, canSkipTaxLens: perms.canSkipTaxLens, storedOmissionReason: view.article.taxLens?.skip_reason ?? null });
    setErrors(v);
    if (Object.keys(v).length > 0) {
      setFailure({ title: `고칠 칸이 ${Object.keys(v).length}개 있습니다`, details: Object.values(v), conflict: false });
      focusField(Object.keys(v)[0]!);
      return false;
    }
    setSaving(true);
    const submittedJson = draftJson;
    const r = await adminApi("PATCH", `/api/admin/articles/${view.article.id}`, editorPayload(submitted, { published, version: baseVersion }));
    setSaving(false);
    if (r.status === 200) {
      const next = (r.body.article as { version?: number } | undefined)?.version ?? baseVersion;
      setBaseVersion(next);
      setSavedJson(submittedJson);
      setLoaded({ ...submitted, updateKind: "", reason: "" });
      const checks = Array.isArray(r.body.checks) ? (r.body.checks as Finding[]) : [];
      setSaved({ message: r.body.unchanged ? "바뀐 내용이 없습니다" : `저장했습니다 — 버전 ${next}`, checks });
      if (published) update({ updateKind: "", reason: "" });
      refresh();
      return true;
    }
    const fieldErrors = fieldErrorsFromServer(
      Array.isArray(r.body.errors) ? (r.body.errors as string[]) : undefined,
      Array.isArray(r.body.failed) ? (r.body.failed as string[]) : undefined,
      state.blocks.map((b) => b.key),
    );
    setErrors(fieldErrors);
    setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r), conflict: r.status === 409 && typeof r.body.version === "number" });
    return false;
  }

  /** [발행] — 저장하지 않은 입력이 있으면 먼저 저장하고, 발행 API를 부른다 (간편 발행) */
  async function publishNow() {
    setPublishFailure(null);
    if (draftJson !== savedJson && !(await persist())) return;
    setPublishing(true);
    const r = await adminApi("POST", `/api/admin/articles/${view.article.id}/publish`);
    setPublishing(false);
    if (r.status === 200) {
      setSaved({ message: "발행했습니다 — 공개 화면에 올라갔습니다", checks: [] });
      refresh();
      return;
    }
    setPublishFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  const quant = method === "quantitative" || method === "mixed";
  const qual = method === "qualitative" || method === "mixed";
  const interviewIds = view.evidence.filter((e) => e.interview !== null).map((e) => e.id);
  const fixReason = published ? suggestedFixReason(loaded, state) : "";

  const regionalPanel = view.regional.state !== "not_regional" && (
    <Panel id="regional" title="지역 기사 판정" description="지역 태그 기사는 편집 분야·공익적 질문, 축제·명소·상권 소재는 관계 유형과 근거가 있어야 기사 후보가 됩니다 (REG1-17).">
      <RegionalJudgePanel
        articleId={view.article.id}
        regional={view.regional}
        judgement={view.article.editorialJudgement}
        judgedAt={view.article.judgedAt}
        canJudge={perms.canJudgeRegional === true}
      />
    </Panel>
  );
  const canPublishNow = !published && perms.canPublish && view.article.status !== "deleted";
  const savePanel = !readOnly && (
    <Panel
      id="save"
      title={canPublishNow ? "저장·발행" : "저장"}
      description={
        published
          ? "수정 종류만 고르면 저장됩니다. 사유는 바꾼 칸으로 자동으로 남깁니다 (ART-05)."
          : canPublishNow
            ? "[발행]을 누르면 저장하고 바로 공개합니다. 발행한 사람·시각과 빠진 확인 항목은 발행 기록에 남습니다."
            : "저장하면 새 버전이 됩니다."
      }
    >
      <form onSubmit={save} noValidate className="space-y-4" aria-label="기사 저장">
        {published && (
          <>
            <SelectField
              id="save-update-kind"
              label="수정 종류"
              required
              hint="오탈자 = 글자·문구만 다듬음(수정일 그대로) · 실질 수정 = 내용이 바뀜 · 정정 = 틀린 사실을 바로잡음(정정 이력에 남음)"
              options={optionsOf(UPDATE_KIND_LABELS)}
              placeholder="골라 주세요"
              value={state.updateKind}
              onChange={(e) => update({ updateKind: e.target.value })}
              error={errors["save-update-kind"]}
            />
            <TextAreaField
              id="save-reason"
              label="수정 사유 (비워 두면 자동)"
              hint={fixReason ? `비워 두면 "${fixReason}"(으)로 남깁니다` : "바꾼 칸이 생기면 사유를 자동으로 만듭니다"}
              value={state.reason}
              onChange={(e) => update({ reason: e.target.value })}
              error={errors["save-reason"]}
            />
          </>
        )}
        {failure && (
          <div className="space-y-2">
            <ErrorSummary id="save-failure" title={failure.title} messages={failure.details} />
            {failure.conflict && (
              <button type="button" className={TEXT_LINK} onClick={() => window.location.reload()}>
                새로 불러오기 (지금 고친 내용은 사라집니다)
              </button>
            )}
          </div>
        )}
        {saved && (
          <div className="space-y-2">
            <StatusNote>{saved.message}</StatusNote>
            {saved.checks.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-800">
                <p className="font-bold">저장 검사 — 확인할 문장 {saved.checks.length}개 (저장은 되었습니다)</p>
                <ul className="mt-1 list-disc pl-5">
                  {saved.checks.map((c, i) => (
                    <li key={`${c.id}-${i}`}>{c.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {canPublishNow && publishBlockers.length > 0 && (
          <div data-testid="publish-blockers" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[15px] text-rose-800">
            <p className="font-bold">발행 전에 고칠 것 {publishBlockers.length}개</p>
            <ul className="mt-1 list-disc pl-5">
              {publishBlockers.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}
        {publishFailure && <ErrorSummary id="publish-failure" title={publishFailure.title} messages={publishFailure.details} />}
        <div className="flex flex-wrap items-center gap-3">
          <PrimaryButton type="submit" disabled={saving || publishing || !hydrated}>
            {saving ? "저장 중" : "저장"}
          </PrimaryButton>
          {canPublishNow && (
            <DarkButton id="publish-now" type="button" onClick={publishNow} disabled={saving || publishing || !hydrated}>
              {publishing ? "발행 중" : "발행"}
            </DarkButton>
          )}
        </div>
      </form>
    </Panel>
  );

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-8" data-unsaved={!readOnly && draftJson !== savedJson ? "true" : undefined}>
      <div className="min-w-0 space-y-6">
        <nav aria-label="편집 화면 칸" className="rounded-2xl border border-navy-100 bg-white px-4 py-2">
          <ul className="flex flex-wrap gap-x-4">
            {SECTIONS_NAV.filter(([id]) => (id !== "save" || !readOnly) && MAIN_NAV.has(id)).map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className={TEXT_LINK}>
                  {label}
                </a>
              </li>
            ))}
            <li>
              <a href="#more-sections" className={TEXT_LINK}>
                그 밖의 칸
              </a>
            </li>
          </ul>
        </nav>
        {readOnly && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[15px] text-amber-800">
            {published ? "발행된 기사는 편집 책임자만 고칩니다. 고칠 내용은 아래 정정 요청으로 남겨 주세요." : "이 기사를 고칠 권한이 없습니다. 읽기만 할 수 있습니다."}
          </p>
        )}

        <Panel id="meta" title="기본 정보">
          <MetaFields
            state={state}
            update={update}
            errors={errors}
            readOnly={readOnly}
            published={published}
            categories={categories}
            partners={partners}
            media={media}
            contentTypes={perms.contentTypes}
            today={today}
            canReadPartners={perms.canReadPartners}
          />
        </Panel>

        <Panel id="blocks" title="본문 블록" description="블록을 더하고, 지우고, 위아래로 옮깁니다.">
          <BlockEditor state={state} update={update} errors={errors} readOnly={readOnly} refs={refs} media={media} makeKey={makeKey} />
        </Panel>

        {savePanel}

        <MoreSections>
          {regionalPanel}

          <Panel id="claims" title="핵심 주장" description="결론 문장을 표시하고 근거(출처·취재 근거)를 잇습니다. 근거 없는 핵심 주장은 발행되지 않습니다.">
            <ClaimsEditor state={state} update={update} errors={errors} readOnly={readOnly} refs={refs} makeKey={makeKey} />
          </Panel>

          <Panel id="sources" title="출처 (공개)" description="독자에게 보이는 출처입니다.">
            <SourcesPanel articleId={view.article.id} sources={view.sources} readOnly={readOnly} officialSourceTypes={view.officialSourceTypes} />
          </Panel>

          <Panel id="evidence" title="취재 근거 (비공개)" description="원자료 재현 정보와 인터뷰 기록을 남깁니다.">
            <EvidencePanel articleId={view.article.id} evidence={evidence} readOnly={readOnly} />
          </Panel>

          {(quant || qual) && (
            <Panel id="method-guide" title="필수 기록 안내" description="지금 화면에 적은 내용 기준입니다. 저장한 뒤 점검 패널이 최종 판정합니다.">
              {quant && <MethodGuide title="정량형 필수 7묶음 (NAV-10)" groups={quantitativeGroups(state, view.evidence.flatMap((e) => (e.dataset ? [e.dataset] : [])))} testId="quant-groups" />}
              {qual && <MethodGuide title="정성형 필수 기록 (NAV-11)" groups={qualitativeRecords(state, view.evidence, interviewIds)} testId="qual-records" />}
            </Panel>
          )}

          <Panel id="checklists" title="취재 확인 목록 (비공개)">
            <ChecklistsEditor state={state} update={update} readOnly={readOnly} refs={refs} />
          </Panel>

          <Panel id="taxlens" title="「지방세로 읽기」">
            <TaxLensEditor state={state} update={update} errors={errors} readOnly={readOnly} canSkip={perms.canSkipTaxLens} stored={view.article.taxLens} />
          </Panel>

          {state.subtype === "solved_case" && (
            <Panel id="solved-case" title="해결 사례 4칸">
              <SolvedCaseEditor state={state} update={update} errors={errors} readOnly={readOnly} />
            </Panel>
          )}
        </MoreSections>
      </div>

      <aside aria-label="점검·발행" className="mt-6 space-y-4 lg:sticky lg:top-4 lg:mt-0 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
        <CheckFold>
          <CheckPanel
            articleId={view.article.id}
            status={view.article.status}
            canPublishRole={perms.canPublish}
            blockTypes={storedBlockTypes}
            refreshKey={`${view.article.version}-${view.article.status}-${view.reviews.length}-${view.sources.length}-${view.evidence.length}`}
            draft={readOnly || draftJson === savedJson ? null : draftBody}
            onChanged={refresh}
          />
        </CheckFold>
        {/* 검토 요청·검토 화면 — 발행 권한이 없는 사람(예: 남의 기사를 고치는 기자)만 쓴다 */}
        {perms.canSubmit && !perms.canPublish && <SubmitForReview articleId={view.article.id} status={view.article.status} onChanged={refresh} />}
        {perms.canReview && !perms.canPublish && (
          <p className="rounded-2xl border border-navy-100 bg-white p-6 text-[15px]">
            <Link href={`/admin/reviews/${view.article.id}`} className={TEXT_LINK}>
              검토·발행 화면에서 승인하기
            </Link>
          </p>
        )}
      </aside>
    </div>
  );
}

/** 기본 정보·본문 밖의 칸(지역 판정·핵심 주장·출처·취재 근거·확인 목록·「지방세로 읽기」)을 하나로 접는다 — 칸 오류로 포커스가 가면 focusField가 연다 */
function MoreSections({ children }: { children: ReactNode }) {
  return (
    <details id="more-sections" className="scroll-mt-4 rounded-2xl border border-navy-100 bg-white">
      <summary className="cursor-pointer px-6 py-4 text-[17px] font-black text-navy-900">그 밖의 칸 — 핵심 주장·출처·취재 근거·확인 목록·「지방세로 읽기」 (바로잡을 때만 엽니다)</summary>
      <div className="space-y-6 p-2">{children}</div>
    </details>
  );
}

/** 점검 결과(경고·점수)는 접어 둔다 — 발행을 막는 항목은 저장·발행 칸에 따로 보인다 (간편 발행) */
function CheckFold({ children }: { children: ReactNode }) {
  return (
    <details id="check-fold" className="rounded-2xl border border-navy-100 bg-white">
      <summary className="cursor-pointer px-6 py-4 text-[15px] font-bold text-navy-900">점검 결과 보기 (경고·점수)</summary>
      {children}
    </details>
  );
}
