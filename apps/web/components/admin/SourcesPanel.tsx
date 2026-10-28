"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, SelectField, TextField } from "@ltr/ui";
import { LICENSE_REQUIRED_KINDS, LICENSE_TYPE_LABELS } from "@ltr/editorial";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { blank, isoToKstDate, type FieldErrors } from "@/lib/admin/form-utils";
import { SOURCE_KIND_LABELS, labelOf, optionsOf } from "@/lib/admin/labels";
import { licenseBadge, sourceTypeLabel } from "@/lib/admin/official-source-rules";
import {
  EMPTY_SOURCE_FORM,
  sourceFormOf,
  sourcePayload,
  sourceRevisionPayload,
  validateSource,
  validateSourceRevision,
  type SourceForm,
} from "@/lib/admin/records-form";
import { ErrorSummary, StatusNote, TextAreaField } from "./fields";
import { SourceSuggest } from "./SourceSuggest";
import { EmptyNote, MONO, OUTLINE_BUTTON, ToneChip } from "./ui";
import { useHydrated } from "./useHydrated";

export interface SourceRowView {
  id: number;
  kind: string;
  title: string | null;
  source_url: string | null;
  source_name: string | null;
  last_verified_at: string | null;
  license_status: string | null;
  snapshot_id: number | null;
  /** W4 5단계 — 공공누리 유형(PR-07) · 자료 종류(REG1-07) · 발표일·기준일·지역 단위·수집일(REG1-09) · 새 버전 */
  license_type?: string | null;
  source_type?: string | null;
  published_on?: string | null;
  reference_date?: string | null;
  region_unit?: string | null;
  collected_at?: string | null;
  supersedes_id?: number | null;
  revision_reason?: string | null;
}

const OFFICIAL = new Set(["official_doc", "dataset"]);
const LICENSED = new Set<string>(LICENSE_REQUIRED_KINDS);

/** 발행에 필요한데 빈 칸 — 공식 자료(FND-04 · REG1-09 · PR-07), 보도자료·사진(PR-07). 편집 화면 칸 이름 */
export function missingSourceFields(s: SourceRowView): string[] {
  const out: string[] = [];
  if (OFFICIAL.has(s.kind)) {
    const need: [unknown, string][] = [
      [s.source_url, "원문 URL"],
      [s.source_name, "발표기관"],
      [s.last_verified_at, "확인일"],
      [s.license_status, "이용 조건"],
      [s.published_on, "발표일"],
      [s.reference_date, "기준일"],
      [s.region_unit, "지역 단위"],
      [s.collected_at, "수집일"],
    ];
    for (const [v, name] of need) if (typeof v !== "string" || blank(v)) out.push(name);
  }
  if (LICENSED.has(s.kind) && !licenseBadge(s.license_type)) out.push("공공누리 유형");
  return out;
}

/**
 * 공개 출처 (article_sources, NAV-03 · FND-04 · W4 5단계 REG1-07 · REG1-09 · PR-07)
 *  · 공식 문서·공공 데이터는 URL·발표기관·확인일·이용 조건 + 발표일·기준일·지역 단위·수집일 + 공공누리 유형 — 비면 이 자료를 쓴 기사는 발행되지 않는다
 *  · 보도자료·사진은 공공누리 유형이 필요하다. 자료 종류는 허용 목록(운영 설정)에서만 고른다 — 교통·관광·음식점·생활 안내는 넣지 않는다
 *  · 원자료를 고치면 덮어쓰지 않고 새 버전 + 수정 사유가 남는다 (옛 판은 그대로, 원문 스냅샷은 이어진다)
 */
export function SourcesPanel({
  articleId,
  sources,
  readOnly,
  officialSourceTypes,
}: {
  articleId: number;
  sources: readonly SourceRowView[];
  readOnly: boolean;
  officialSourceTypes: readonly string[];
}) {
  const [editing, setEditing] = useState<number | null>(null);
  // [고쳐서 추가] — 후보 값을 출처 더하기 폼에 채운다 (nonce가 바뀌면 폼을 새로 만든다)
  const [prefill, setPrefill] = useState<{ form: SourceForm | null; nonce: number }>({ form: null, nonce: 0 });
  return (
    <div className="space-y-4">
      {sources.length === 0 ? (
        <EmptyNote>출처가 없습니다. 보도기사는 출처가 있어야 발행됩니다.</EmptyNote>
      ) : (
        <ul data-testid="source-list" className="space-y-3">
          {sources.map((s) => {
            const missing = missingSourceFields(s);
            const badge = licenseBadge(s.license_type);
            return (
              <li key={s.id} data-source-id={s.id} className="rounded-xl border border-navy-100 p-4 text-[15px] text-navy-800">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={MONO}>src:{s.id}</span>
                  <ToneChip tone="plain">{labelOf(SOURCE_KIND_LABELS, s.kind)}</ToneChip>
                  {badge && <ToneChip tone="navy">{badge}</ToneChip>}
                  {s.source_type && <ToneChip tone="plain">자료 종류 {sourceTypeLabel(s.source_type)}</ToneChip>}
                  {missing.length > 0 && <ToneChip tone="amber">칸 빔</ToneChip>}
                  {s.snapshot_id !== null && <ToneChip tone="navy">원문 있음</ToneChip>}
                  {s.supersedes_id ? <ToneChip tone="emerald">새 버전 (src:{s.supersedes_id} 대체)</ToneChip> : null}
                </div>
                <p className="mt-1 font-bold text-navy-900 [overflow-wrap:anywhere]">{s.title ?? "제목 없음"}</p>
                <p className="text-[14px] text-navy-600 [overflow-wrap:anywhere]">
                  {[s.source_name, s.last_verified_at ? `확인 ${isoToKstDate(s.last_verified_at)}` : null, s.license_status, s.source_url].filter(Boolean).join(" · ")}
                </p>
                {OFFICIAL.has(s.kind) && (
                  <p className={`${MONO} text-[13px] text-navy-600`}>
                    {[
                      `발표 ${s.published_on ?? "—"}`,
                      `기준 ${s.reference_date ?? "—"}`,
                      `지역 단위 ${s.region_unit?.trim() || "—"}`,
                      `수집 ${s.collected_at ? isoToKstDate(s.collected_at) : "—"}`,
                    ].join(" · ")}
                  </p>
                )}
                {missing.length > 0 && (
                  <p data-testid="source-missing" className="text-[14px] font-bold text-amber-800">
                    빈 칸: {missing.join("·")} — 이 칸이 비면 이 출처를 쓴 기사를 발행할 수 없습니다
                  </p>
                )}
                {s.supersedes_id && s.revision_reason ? <p className="text-[14px] text-navy-600 [overflow-wrap:anywhere]">수정 사유: {s.revision_reason}</p> : null}
                {!readOnly && (
                  <button type="button" className={`${OUTLINE_BUTTON} mt-2`} aria-expanded={editing === s.id} onClick={() => setEditing(editing === s.id ? null : s.id)}>
                    {editing === s.id ? "고치기 닫기" : `src:${s.id} 원자료 고치기 (새 버전)`}
                  </button>
                )}
                {editing === s.id && <RevisionForm articleId={articleId} source={s} officialSourceTypes={officialSourceTypes} onDone={() => setEditing(null)} />}
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && <SourceSuggest articleId={articleId} onFill={(form) => setPrefill((p) => ({ form, nonce: p.nonce + 1 }))} />}
      {!readOnly && <AddSourceForm key={prefill.nonce} articleId={articleId} officialSourceTypes={officialSourceTypes} initial={prefill.form} />}
    </div>
  );
}

type Setter = (key: keyof SourceForm) => (e: { target: { value: string } }) => void;

/** 출처 칸 묶음 — 더하기(앞머리 src)·고치기(앞머리 rev-<번호>)가 같은 칸을 쓴다. 칸 id = `${prefix}-<칸>` (validateSource의 src-<칸>과 같은 꼬리) */
function SourceFields({
  prefix,
  form,
  set,
  errors,
  officialSourceTypes,
  withKind,
}: {
  prefix: string;
  form: SourceForm;
  set: Setter;
  errors: FieldErrors;
  officialSourceTypes: readonly string[];
  withKind: boolean;
}) {
  const official = OFFICIAL.has(form.kind);
  const licensed = LICENSED.has(form.kind);
  const id = (tail: string) => `${prefix}-${tail}`;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {withKind && (
          <SelectField id={id("kind")} label="출처 종류" required hint="법안 상태 기사의 공식 자료는 '공식 문서'를 고릅니다. 인터뷰·자체 자료는 해당 종류를 고릅니다" options={optionsOf(SOURCE_KIND_LABELS)} value={form.kind} onChange={set("kind")} error={errors[id("kind")]} />
        )}
        <TextField id={id("title")} label="출처 이름" required hint="독자에게 보이는 자료 이름 (예: 지방세법 일부개정법률안)" placeholder="예: 지방세법 일부개정법률안" value={form.title} onChange={set("title")} error={errors[id("title")]} />
        <TextField id={id("url")} label="원문 URL" required={official} hint="원문 페이지 주소 전체 (https://로 시작)" placeholder="https://" value={form.url} onChange={set("url")} error={errors[id("url")]} />
        <TextField id={id("source-name")} label="발표기관" required={official} hint="자료를 낸 기관 (예: 국회, 행정안전부)" placeholder="예: 국회" value={form.sourceName} onChange={set("sourceName")} error={errors[id("source-name")]} />
        <TextField id={id("verified")} label="확인일" type="date" required={official} hint="원문을 직접 연 날 (오늘 열었다면 오늘 날짜)" value={form.lastVerifiedDate} onChange={set("lastVerifiedDate")} error={errors[id("verified")]} />
        <TextField
          id={id("license")}
          label="이용 조건"
          required={official}
          hint="원문에 적힌 이용 조건 글자 (예: 공공누리 제1유형 출처표시)"
          value={form.licenseStatus}
          onChange={set("licenseStatus")}
          error={errors[id("license")]}
        />
        <SelectField
          id={id("license-type")}
          label="공공누리 유형"
          required={licensed}
          placeholder="고르세요"
          hint="자체 촬영·자체 제작은 '해당 없음'. 원문 본문은 유형과 상관없이 옮기지 않고 링크·요약만 씁니다 (PR-07)"
          options={optionsOf(LICENSE_TYPE_LABELS)}
          value={form.licenseType}
          onChange={set("licenseType")}
          error={errors[id("license-type")]}
        />
        {official && (
          <SelectField
            id={id("source-type")}
            label="자료 종류"
            placeholder="없음 (법령·기타)"
            hint="허용 목록(운영 설정)에서만 고릅니다. 법안 상태 기사는 '법률안·입법예고(bill)'를 고릅니다. 교통·관광·음식점·생활 안내는 공식 자료로 넣지 않습니다 (REG1-07)"
            options={officialSourceTypes.map((t) => ({ value: t, label: sourceTypeLabel(t) }))}
            value={form.sourceType}
            onChange={set("sourceType")}
            error={errors[id("source-type")]}
          />
        )}
      </div>
      {official && (
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-[14px] font-bold text-navy-900">공식 원자료 기록 (REG1-09 — 비면 이 자료를 쓴 기사를 발행할 수 없습니다)</legend>
          <TextField id={id("published")} label="발표일" type="date" required value={form.publishedOn} onChange={set("publishedOn")} error={errors[id("published")]} />
          <TextField id={id("reference")} label="기준일" type="date" required value={form.referenceDate} onChange={set("referenceDate")} error={errors[id("reference")]} />
          <TextField
            id={id("region-unit")}
            label="지역 단위"
            required
            hint="예: 시·군·구, 읍·면·동, 전국"
            value={form.regionUnit}
            onChange={set("regionUnit")}
            error={errors[id("region-unit")]}
          />
          <TextField id={id("collected")} label="수집일" type="date" required value={form.collectedDate} onChange={set("collectedDate")} error={errors[id("collected")]} />
        </fieldset>
      )}
    </>
  );
}

function useSourceForm(initial: SourceForm) {
  const [form, setForm] = useState<SourceForm>(initial);
  const set: Setter = (key) => (e) =>
    setForm((f) => {
      const next = { ...f, [key]: e.target.value };
      // 공식 자료가 아닌 종류로 바꾸면 자료 종류를 비운다 (숨은 칸 오류 0)
      if (key === "kind" && !OFFICIAL.has(next.kind)) next.sourceType = "";
      return next;
    });
  return { form, setForm, set };
}

function AddSourceForm({ articleId, officialSourceTypes, initial }: { articleId: number; officialSourceTypes: readonly string[]; initial: SourceForm | null }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const { form, setForm, set } = useSourceForm(initial ?? EMPTY_SOURCE_FORM);
  // 채워 온 폼은 빈 칸 안내를 바로 보여 주고 제목 칸으로 포커스를 옮긴다
  const [errors, setErrors] = useState<FieldErrors>(() => (initial ? validateSource(initial, officialSourceTypes) : {}));
  useEffect(() => {
    if (initial) document.getElementById("src-title")?.focus();
  }, [initial]);
  const [failure, setFailure] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setDone("");
    setFailure(null);
    const v = validateSource(form, officialSourceTypes);
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    setPending(true);
    const r = await adminApi("POST", `/api/admin/articles/${articleId}/sources`, sourcePayload(form));
    setPending(false);
    if (r.status === 201) {
      const ref = (r.body.source as { ref?: string } | undefined)?.ref ?? "";
      setDone(`출처를 더했습니다 — ${ref}`);
      setForm(EMPTY_SOURCE_FORM);
      router.refresh();
      return;
    }
    setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-xl border border-navy-100 p-4" aria-label="출처 더하기">
      <p className="text-[15px] font-black text-navy-900">출처 더하기</p>
      <SourceFields prefix="src" form={form} set={set} errors={errors} officialSourceTypes={officialSourceTypes} withKind />
      <TextAreaField
        id="src-snapshot"
        label="원문 글 (선택)"
        hint="보도자료 원문을 붙이면 유사도 비교에 씁니다 — 원문 문장을 그대로 옮긴 기사는 발행되지 않습니다"
        value={form.snapshotText}
        onChange={set("snapshotText")}
      />
      {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
      {done && <StatusNote>{done}</StatusNote>}
      <DarkButton type="submit" disabled={pending || !hydrated}>
        {pending ? "더하는 중" : "출처 더하기"}
      </DarkButton>
    </form>
  );
}

/** 원자료 고치기 — 새 버전 행 + 수정 사유 (PATCH …/sources/{번호}). 종류·원문 스냅샷은 그대로 잇는다 */
function RevisionForm({ articleId, source, officialSourceTypes, onDone }: { articleId: number; source: SourceRowView; officialSourceTypes: readonly string[]; onDone: () => void }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const before = sourceFormOf(source);
  const { form, set } = useSourceForm(before);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<{ title: string; details: string[] } | null>(null);
  const [pending, setPending] = useState(false);
  const prefix = `rev-${source.id}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    const v = validateSourceRevision(form, before, reason, prefix, officialSourceTypes);
    setErrors(v);
    if (Object.keys(v).length > 0) return;
    setPending(true);
    const r = await adminApi("PATCH", `/api/admin/articles/${articleId}/sources/${source.id}`, sourceRevisionPayload(form, before, reason));
    setPending(false);
    if (r.status === 201) {
      onDone();
      router.refresh();
      return;
    }
    setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-4 rounded-xl border border-navy-100 bg-navy-50 p-4" aria-label={`src:${source.id} 원자료 고치기`}>
      <p className="text-[14px] text-navy-700">
        고치면 이 행을 덮어쓰지 않고 새 버전이 생깁니다 — 옛 판 src:{source.id}과 원문 스냅샷은 그대로 남습니다 (REG1-09). 출처 종류: {labelOf(SOURCE_KIND_LABELS, source.kind)}
      </p>
      <SourceFields prefix={prefix} form={form} set={set} errors={errors} officialSourceTypes={officialSourceTypes} withKind={false} />
      <TextAreaField
        id={`${prefix}-reason`}
        label="수정 사유"
        required
        hint="무엇을 왜 고쳤는지 — 감사 기록과 새 버전 행에 남습니다"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        error={errors[`${prefix}-reason`]}
      />
      {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
      <DarkButton type="submit" disabled={pending || !hydrated}>
        {pending ? "저장 중" : "새 버전 저장"}
      </DarkButton>
    </form>
  );
}
