"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckboxField, DarkButton, SelectField, TextField } from "@ltr/ui";
import { LICENSE_TYPES, LICENSE_TYPE_LABELS } from "@ltr/editorial";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { errorsByField } from "@/lib/admin/project-rules";
import { ErrorSummary, StatusNote, TextAreaField } from "./fields";
import { useHydrated } from "./useHydrated";

// 프로젝트 관리 폼 (W4 14단계 — PRD-01B PR-02 · PR-03 · PR-05, /admin/projects). 값 검사는 서버(lib/admin/project-rules.ts + DB)가 하고,
// 오류 "칸: 문장"은 그 칸 옆에 보인다(칸 이름 = 요청 칸 = DB 칸). 고시 번호·날짜·기관·원문은 사람이 원문을 보고 넣는다(채워 넣는 기본값 0).
// 가격·분양가·분담금·수익률·시세 입력 요소는 두지 않는다(PR-05 — 시험이 이 화면의 입력 요소를 가격 사전으로 본다).

type Failure = { title: string; details: string[]; fields: Record<string, string[]> } | null;

function useSubmit() {
  const router = useRouter();
  const [error, setError] = useState<Failure>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function send(body: Record<string, unknown>, ok: (b: Record<string, unknown>) => string, after?: (b: Record<string, unknown>) => void) {
    setError(null);
    setDone(null);
    setPending(true);
    const r = await adminApi("POST", "/api/admin/projects", body);
    setPending(false);
    if (r.status === 200 || r.status === 201) {
      const b = (r.body ?? {}) as Record<string, unknown>;
      setDone(ok(b));
      if (after) after(b);
      else router.refresh();
    } else {
      const details = apiErrorDetails(r);
      setError({ title: apiErrorMessage(r), details, fields: errorsByField(details) });
    }
  }
  /** 그 칸의 오류 문장 (여러 개면 이어서) */
  const fieldError = (...names: string[]) => names.flatMap((n) => error?.fields[n] ?? []).join(" ") || undefined;
  return { error, done, pending, send, fieldError };
}

const LICENSE_OPTIONS = [{ value: "", label: "고르세요" }, ...LICENSE_TYPES.map((t) => ({ value: t, label: LICENSE_TYPE_LABELS[t] }))];

function Feedback({ id, s }: { id: string; s: ReturnType<typeof useSubmit> }) {
  return (
    <>
      {s.done && <StatusNote>{s.done}</StatusNote>}
      {s.error && <ErrorSummary id={`${id}-error`} title={s.error.title} messages={s.error.details} />}
    </>
  );
}

/** 프로젝트 만들기 — 초안으로 만든다 (공개는 단계 기록·데이터 출처·확인일 뒤) */
export function CreateProjectForm({ types }: { types: [string, string][] }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const s = useSubmit();
  const [f, setF] = useState({ slug: "", name: "", region_code: "", project_type: types[0]?.[0] ?? "", summary: "", source_name: "", landmark: false });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void s.send(
          { op: "create", ...f },
          () => "프로젝트를 만들었습니다 — 공개 전 초안입니다.",
          (b) => {
            const id = (b.project as { id?: number } | undefined)?.id;
            if (id) router.push(`/admin/projects/${id}`);
          },
        );
      }}
      aria-label="프로젝트 만들기"
      data-form="project-create"
      className="grid gap-4 sm:grid-cols-2"
    >
      <TextField id="pj-name" label="프로젝트 이름" value={f.name} onChange={set("name")} error={s.fieldError("name")} required />
      <TextField id="pj-slug" label="주소(slug)" hint="영문 소문자·숫자와 '-' (공개 주소 /realestate/projects/주소)" value={f.slug} onChange={set("slug")} error={s.fieldError("slug")} required />
      <TextField id="pj-region" label="지역 코드 (행정구역 10자리)" inputMode="numeric" value={f.region_code} onChange={set("region_code")} error={s.fieldError("region_code")} required />
      <SelectField id="pj-type" label="사업 유형" options={types.map(([value, label]) => ({ value, label }))} value={f.project_type} onChange={set("project_type")} error={s.fieldError("project_type")} required />
      <TextField id="pj-source" label="데이터 출처 (공개 전 필수)" value={f.source_name} onChange={set("source_name")} error={s.fieldError("source_name")} />
      <div className="sm:col-span-2">
        <TextAreaField id="pj-summary" label="요약" value={f.summary} onChange={set("summary")} error={s.fieldError("summary")} />
      </div>
      <div className="sm:col-span-2">
        <CheckboxField id="pj-landmark" label="지역 대표(랜드마크) 프로젝트" checked={f.landmark} onChange={(e) => setF({ ...f, landmark: e.target.checked })} error={s.fieldError("landmark")} />
      </div>
      <div className="space-y-3 sm:col-span-2">
        <Feedback id="pj-create" s={s} />
        <DarkButton type="submit" disabled={!hydrated || s.pending}>
          프로젝트 만들기
        </DarkButton>
      </div>
    </form>
  );
}

/** 고시 6칸 — 고시 번호·고시일·고시 기관·원문 주소·원본 스냅샷(원문 글자 또는 번호)·공공누리 유형 (PR-03 · PR-07) */
function NoticeFields({ prefix, v, set, s }: { prefix: string; v: Record<string, string>; set: (k: string) => (e: { target: { value: string } }) => void; s: ReturnType<typeof useSubmit> }) {
  return (
    <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-2" data-part="notice-fields">
      <legend className="mb-2 text-[15px] font-bold text-navy-900">고시 원문 (6칸 모두 필수 — PR-03)</legend>
      <TextField id={`${prefix}-notice-no`} label="고시 번호" value={v.notice_no ?? ""} onChange={set("notice_no")} error={s.fieldError("notice_no")} required />
      <TextField id={`${prefix}-notice-date`} label="고시일 (YYYY-MM-DD)" value={v.notice_date ?? ""} onChange={set("notice_date")} error={s.fieldError("notice_date")} required />
      <TextField id={`${prefix}-issuer`} label="고시 기관" value={v.issuer ?? ""} onChange={set("issuer")} error={s.fieldError("issuer")} required />
      <TextField id={`${prefix}-source-url`} label="고시 원문 주소" type="url" value={v.source_url ?? ""} onChange={set("source_url")} error={s.fieldError("source_url")} required />
      <SelectField id={`${prefix}-license`} label="원문 공공누리 유형" options={LICENSE_OPTIONS} value={v.license_type ?? ""} onChange={set("license_type")} error={s.fieldError("license_type")} required />
      <TextField id={`${prefix}-snapshot-id`} label="원본 스냅샷 번호 (있으면 — 아니면 아래에 원문 붙여 넣기)" inputMode="numeric" value={v.snapshot_id ?? ""} onChange={set("snapshot_id")} error={s.fieldError("snapshot_id")} />
      <div className="sm:col-span-2">
        <TextAreaField
          id={`${prefix}-snapshot`}
          label="원본 스냅샷 (고시 원문 글자 붙여 넣기)"
          hint="원문 글자는 원본 스냅샷으로만 남고 공개 화면에는 링크만 보입니다"
          rows={4}
          value={v.snapshot_payload ?? ""}
          onChange={set("snapshot_payload")}
          error={s.fieldError("snapshot_payload")}
        />
      </div>
    </fieldset>
  );
}

const pick = (v: Record<string, string>, keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, (v[k] ?? "").trim()]));
const NOTICE_KEYS = ["notice_no", "notice_date", "issuer", "source_url", "license_type", "snapshot_id", "snapshot_payload"] as const;

/** 단계 기록 — 단계(목록 안)·고시 6칸·메모·공개 기록. 해당 없는 단계는 사유만 */
export function StageEventForm({ projectId, stages }: { projectId: number; stages: { key: string; label: string }[] }) {
  const hydrated = useHydrated();
  const s = useSubmit();
  const [v, setV] = useState<Record<string, string>>({ stage: stages[0]?.key ?? "", kind: "stage" });
  const [isPublic, setPublic] = useState(true);
  const set = (k: string) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const skip = v.kind === "not_applicable";
  return (
    <form
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        const body = skip
          ? { op: "event", project_id: projectId, kind: "not_applicable", stage: v.stage, reason: (v.reason ?? "").trim(), note: (v.note ?? "").trim() }
          : { op: "event", project_id: projectId, kind: "stage", stage: v.stage, ...pick(v, NOTICE_KEYS), note: (v.note ?? "").trim(), public: isPublic };
        void s.send(body, (b) => {
          const w = Array.isArray(b.warnings) ? (b.warnings as string[]) : [];
          return w.length ? `단계를 기록했습니다 — 경고: ${w.join(" ")}` : "단계를 기록했습니다.";
        });
      }}
      aria-label="단계 기록"
      data-form="project-event"
      className="grid gap-4 sm:grid-cols-2"
    >
      <SelectField id="pe-stage" label="단계" options={stages.map((x) => ({ value: x.key, label: x.label }))} value={v.stage} onChange={set("stage")} error={s.fieldError("stage")} required />
      <SelectField
        id="pe-kind"
        label="기록 종류"
        options={[
          { value: "stage", label: "단계 기록 (고시 원문 있음)" },
          { value: "not_applicable", label: "이 프로젝트에 없는 단계 (사유)" },
        ]}
        value={v.kind}
        onChange={set("kind")}
        error={s.fieldError("kind")}
      />
      {skip ? (
        <div className="sm:col-span-2">
          <TextField id="pe-reason" label="이 단계가 없는 사유" value={v.reason ?? ""} onChange={set("reason")} error={s.fieldError("reason")} required />
        </div>
      ) : (
        <>
          <NoticeFields prefix="pe" v={v} set={set} s={s} />
          <div className="sm:col-span-2">
            <CheckboxField id="pe-public" label="공개 기록 (현재 단계·공개 타임라인에 쓴다 — 나중에 바꾸려면 정정)" checked={isPublic} onChange={(e) => setPublic(e.target.checked)} error={s.fieldError("public")} />
          </div>
        </>
      )}
      <div className="sm:col-span-2">
        <TextAreaField id="pe-note" label="편집 메모 (공개하지 않음)" hint="숫자 + 원·% 표현은 저장 경고가 납니다 — 가격 정보는 편집 승인을 거친 기사로만" value={v.note ?? ""} onChange={set("note")} error={s.fieldError("note")} />
      </div>
      <div className="space-y-3 sm:col-span-2">
        <Feedback id="pe" s={s} />
        <DarkButton type="submit" disabled={!hydrated || s.pending}>
          단계 기록
        </DarkButton>
      </div>
    </form>
  );
}

/** 정정 — 사유 필수, 한 기록은 한 번만. 바꿔 적기(단계 + 고시 6칸) · 거두기(단계 없음 — 현재 단계에서 빠짐) */
export function CorrectionForm({ projectId, stages, targets }: { projectId: number; stages: { key: string; label: string }[]; targets: { id: number; label: string }[] }) {
  const hydrated = useHydrated();
  const s = useSubmit();
  const [v, setV] = useState<Record<string, string>>({ correction_of: targets[0] ? String(targets[0].id) : "", mode: "rewrite", stage: stages[0]?.key ?? "" });
  const [isPublic, setPublic] = useState(true);
  const set = (k: string) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const withdraw = v.mode === "withdraw";
  return (
    <form
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        const base = { op: "correct", project_id: projectId, correction_of: v.correction_of, reason: (v.reason ?? "").trim(), note: (v.note ?? "").trim() };
        const body = withdraw ? base : { ...base, stage: v.stage, ...pick(v, NOTICE_KEYS), public: isPublic };
        void s.send(body, () => "정정을 기록했습니다.");
      }}
      aria-label="단계 기록 정정"
      data-form="project-correct"
      className="grid gap-4 sm:grid-cols-2"
    >
      <SelectField id="pc-target" label="정정할 기록" options={targets.map((t) => ({ value: String(t.id), label: t.label }))} value={v.correction_of} onChange={set("correction_of")} error={s.fieldError("correction_of")} required />
      <SelectField
        id="pc-mode"
        label="정정 방식"
        options={[
          { value: "rewrite", label: "바꿔 적기 (단계·고시 원문을 고쳐 적음)" },
          { value: "withdraw", label: "거두기 (그 기록을 현재 단계에서 뺌)" },
        ]}
        value={v.mode}
        onChange={set("mode")}
      />
      <div className="sm:col-span-2">
        <TextField id="pc-reason" label="정정 사유" value={v.reason ?? ""} onChange={set("reason")} error={s.fieldError("reason")} required />
      </div>
      {!withdraw && (
        <>
          <SelectField id="pc-stage" label="바꿔 적을 단계" options={stages.map((x) => ({ value: x.key, label: x.label }))} value={v.stage} onChange={set("stage")} error={s.fieldError("stage")} required />
          <NoticeFields prefix="pc" v={v} set={set} s={s} />
          <div className="sm:col-span-2">
            <CheckboxField id="pc-public" label="공개 기록" checked={isPublic} onChange={(e) => setPublic(e.target.checked)} error={s.fieldError("public")} />
          </div>
        </>
      )}
      <div className="space-y-3 sm:col-span-2">
        <Feedback id="pc" s={s} />
        <DarkButton type="submit" disabled={!hydrated || s.pending}>
          정정 기록
        </DarkButton>
      </div>
    </form>
  );
}

/** 공개 전환 — 공개 단계 1건 + 데이터 출처 + 정보 확인일(지금 확인). 내리기 */
export function PublishForm({ projectId, status, sourceName }: { projectId: number; status: string; sourceName: string | null }) {
  const hydrated = useHydrated();
  const s = useSubmit();
  const [source, setSource] = useState(sourceName ?? "");
  const [verified, setVerified] = useState(false);
  return (
    <form
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void s.send({ op: "publish", project_id: projectId, status: "public", source_name: source.trim(), verified }, () => "공개했습니다.");
      }}
      aria-label="프로젝트 공개"
      data-form="project-publish"
      className="space-y-4"
    >
      <TextField id="pp-source" label="데이터 출처" value={source} onChange={(e) => setSource(e.target.value)} error={s.fieldError("source_name")} required />
      <CheckboxField
        id="pp-verified"
        label="지금 고시 원문과 대조해 확인했습니다 (정보 확인일 = 지금)"
        checked={verified}
        onChange={(e) => setVerified(e.target.checked)}
        error={s.fieldError("last_verified_at", "verified")}
      />
      {s.error?.fields.status && <p className="text-[14px] text-rose-700 [overflow-wrap:anywhere]">{s.error.fields.status.join(" ")}</p>}
      <Feedback id="pp" s={s} />
      <div className="flex flex-wrap gap-3">
        <DarkButton type="submit" disabled={!hydrated || s.pending}>
          {status === "public" ? "확인일 다시 적기" : "공개"}
        </DarkButton>
        {status === "public" && (
          <button
            type="button"
            className="min-h-11 rounded-xl border border-navy-300 px-4 text-[15px] font-bold text-navy-900"
            disabled={!hydrated || s.pending}
            onClick={() => void s.send({ op: "publish", project_id: projectId, status: "hidden" }, () => "내렸습니다.")}
          >
            내리기
          </button>
        )}
      </div>
    </form>
  );
}
