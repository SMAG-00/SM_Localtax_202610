"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PrimaryButton, SelectField } from "@ltr/ui";
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
import { UPDATE_KIND_LABELS, optionsOf } from "@/lib/admin/labels";
import type { EvidenceRowView } from "@/lib/admin/records-form";
import { CheckPanel } from "./CheckPanel";
import { EvidencePanel } from "./EvidencePanel";
import { ErrorSummary, StatusNote, TextAreaField } from "./fields";
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
type Media = { id: number; path: string; alt: string | null; rights_status: string };

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
 * 기사 편집기 (ART-01 · ART-05 · OPT-03) — 왼쪽은 원고(기본 정보·블록·핵심 주장·출처·취재 근거·확인 목록·「지방세로 읽기」·저장),
 * 오른쪽(1024px 이상, 그 아래는 원고 뒤)은 최적화 점검 패널과 검토 요청. 저장은 PATCH 한 번 — 버전으로 동시 수정을 막는다.
 */
export function ArticleWorkspace({
  view,
  categories,
  partners,
  media,
  perms,
}: {
  view: EditorView;
  categories: readonly Category[];
  partners: readonly Partner[];
  media: readonly Media[];
  perms: EditorPermissions;
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
  const [baseVersion, setBaseVersion] = useState(view.article.version);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<{ title: string; details: string[]; conflict: boolean } | null>(null);
  const [saved, setSaved] = useState<{ message: string; checks: Finding[] } | null>(null);
  const [saving, setSaving] = useState(false);

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
    setSaved(null);
    setFailure(null);
    const v = validateEditor(state, { published, canSkipTaxLens: perms.canSkipTaxLens, storedOmissionReason: view.article.taxLens?.skip_reason ?? null });
    setErrors(v);
    if (Object.keys(v).length > 0) {
      setFailure({ title: `고칠 칸이 ${Object.keys(v).length}개 있습니다`, details: Object.values(v), conflict: false });
      document.getElementById(Object.keys(v)[0]!)?.focus();
      return;
    }
    setSaving(true);
    const r = await adminApi("PATCH", `/api/admin/articles/${view.article.id}`, editorPayload(state, { published, version: baseVersion }));
    setSaving(false);
    if (r.status === 200) {
      const next = (r.body.article as { version?: number } | undefined)?.version ?? baseVersion;
      setBaseVersion(next);
      const checks = Array.isArray(r.body.checks) ? (r.body.checks as Finding[]) : [];
      setSaved({ message: r.body.unchanged ? "바뀐 내용이 없습니다" : `저장했습니다 — 버전 ${next}`, checks });
      if (published) update({ updateKind: "", reason: "" });
      refresh();
      return;
    }
    const fieldErrors = fieldErrorsFromServer(
      Array.isArray(r.body.errors) ? (r.body.errors as string[]) : undefined,
      Array.isArray(r.body.failed) ? (r.body.failed as string[]) : undefined,
      state.blocks.map((b) => b.key),
    );
    setErrors(fieldErrors);
    setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r), conflict: r.status === 409 && typeof r.body.version === "number" });
  }

  const quant = method === "quantitative" || method === "mixed";
  const qual = method === "qualitative" || method === "mixed";
  const interviewIds = view.evidence.filter((e) => e.interview !== null).map((e) => e.id);

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-8">
      <div className="min-w-0 space-y-6">
        <nav aria-label="편집 화면 칸" className="rounded-2xl border border-navy-100 bg-white px-4 py-2">
          <ul className="flex flex-wrap gap-x-4">
            {SECTIONS_NAV.filter(([id]) => id !== "save" || !readOnly).map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className={TEXT_LINK}>
                  {label}
                </a>
              </li>
            ))}
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
          />
        </Panel>

        <Panel id="blocks" title="본문 블록" description="블록을 더하고, 지우고, 위아래로 옮깁니다.">
          <BlockEditor state={state} update={update} errors={errors} readOnly={readOnly} refs={refs} media={media} makeKey={makeKey} />
        </Panel>

        <Panel id="claims" title="핵심 주장" description="결론 문장을 표시하고 근거(출처·취재 근거)를 잇습니다. 근거 없는 핵심 주장은 발행되지 않습니다.">
          <ClaimsEditor state={state} update={update} errors={errors} readOnly={readOnly} refs={refs} makeKey={makeKey} />
        </Panel>

        <Panel id="sources" title="출처 (공개)" description="독자에게 보이는 출처입니다.">
          <SourcesPanel articleId={view.article.id} sources={view.sources} readOnly={readOnly} />
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

        {!readOnly && (
          <Panel id="save" title="저장" description={published ? "발행된 기사입니다. 수정 종류와 사유를 남겨야 저장됩니다 (ART-05)." : "저장하면 새 버전이 되고, 편집 승인을 다시 받아야 합니다."}>
            <form onSubmit={save} noValidate className="space-y-4" aria-label="기사 저장">
              {published && (
                <>
                  <SelectField
                    id="save-update-kind"
                    label="수정 종류"
                    required
                    hint="오탈자는 실질 수정일을 바꾸지 않습니다. 정정은 정정 이력에 남습니다."
                    options={optionsOf(UPDATE_KIND_LABELS)}
                    placeholder="골라 주세요"
                    value={state.updateKind}
                    onChange={(e) => update({ updateKind: e.target.value })}
                    error={errors["save-update-kind"]}
                  />
                  <TextAreaField id="save-reason" label="수정 사유" required value={state.reason} onChange={(e) => update({ reason: e.target.value })} error={errors["save-reason"]} />
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
              <PrimaryButton type="submit" disabled={saving || !hydrated}>
                {saving ? "저장 중" : "저장"}
              </PrimaryButton>
            </form>
          </Panel>
        )}
      </div>

      <aside aria-label="점검·발행" className="mt-6 space-y-4 lg:sticky lg:top-4 lg:mt-0 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
        <CheckPanel
          articleId={view.article.id}
          status={view.article.status}
          canPublishRole={perms.canPublish}
          blockTypes={storedBlockTypes}
          refreshKey={`${view.article.version}-${view.article.status}-${view.reviews.length}-${view.sources.length}-${view.evidence.length}`}
          onChanged={refresh}
        />
        {perms.canSubmit && <SubmitForReview articleId={view.article.id} status={view.article.status} onChanged={refresh} />}
        {perms.canReview && (
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
