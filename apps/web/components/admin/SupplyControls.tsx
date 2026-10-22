"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckboxField, DarkButton, SelectField, TextField } from "@ltr/ui";
import { LICENSE_TYPES, LICENSE_TYPE_LABELS } from "@ltr/editorial";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { errorsByField } from "@/lib/admin/project-rules";
import { ErrorSummary, StatusNote } from "./fields";
import { useHydrated } from "./useHydrated";

// 분양 정보 관리 폼 (W4 17단계 — PRD-01B PR-04 · PR-05, /admin/supply). 값 검사는 서버(lib/admin/supply-rules.ts + DB)가 하고,
// 오류 "칸: 문장"은 그 칸 옆에 보인다(칸 이름 = 요청 칸 = DB 칸). 공고 내용은 사람이 공식 공고를 보고 넣는다(채워 넣는 기본값 0).
// 가격·분양가·분담금·수익률·시세 입력 요소는 두지 않는다(PR-05 — 시험이 이 화면의 입력 요소를 가격 사전으로 본다). 분양가는 공식 공고 링크로만(12장 #11).

type Failure = { title: string; details: string[]; fields: Record<string, string[]> } | null;

function useSubmit() {
  const router = useRouter();
  const [error, setError] = useState<Failure>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function send(body: Record<string, unknown>, ok: string) {
    setError(null);
    setDone(null);
    setPending(true);
    const r = await adminApi("POST", "/api/admin/supply", body);
    setPending(false);
    if (r.status === 200 || r.status === 201) {
      setDone(ok);
      router.refresh();
    } else {
      const details = apiErrorDetails(r);
      setError({ title: apiErrorMessage(r), details, fields: errorsByField(details) });
    }
  }
  const fieldError = (...names: string[]) => names.flatMap((n) => error?.fields[n] ?? []).join(" ") || undefined;
  return { error, done, pending, send, fieldError };
}

function Feedback({ id, s }: { id: string; s: ReturnType<typeof useSubmit> }) {
  return (
    <>
      {s.done && <StatusNote>{s.done}</StatusNote>}
      {s.error && <ErrorSummary id={`${id}-error`} title={s.error.title} messages={s.error.details} />}
    </>
  );
}

const LICENSE_OPTIONS = [{ value: "", label: "고르세요" }, ...LICENSE_TYPES.map((t) => ({ value: t, label: LICENSE_TYPE_LABELS[t] }))];

export interface SupplyFormValues {
  name: string;
  region_code: string;
  project_id: string;
  supply_scale: string;
  apply_start: string;
  apply_end: string;
  notice_date: string;
  notice_issuer: string;
  official_notice_url: string;
  license_type: string;
}
const EMPTY: SupplyFormValues = { name: "", region_code: "", project_id: "", supply_scale: "", apply_start: "", apply_end: "", notice_date: "", notice_issuer: "", official_notice_url: "", license_type: "" };

/** 분양 정보 만들기·고치기 — id가 있으면 고치기(op update), 없으면 초안 만들기(op create) */
export function SupplyForm({ id, initial }: { id?: number; initial?: SupplyFormValues }) {
  const hydrated = useHydrated();
  const s = useSubmit();
  const [f, setF] = useState<SupplyFormValues>(initial ?? EMPTY);
  const [verified, setVerified] = useState(false);
  const set = (k: keyof SupplyFormValues) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const p = id ? `sp-${id}` : "sp-new";
  return (
    <form
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        const body: Record<string, unknown> = { op: id ? "update" : "create", ...(id ? { id } : {}), ...f, project_id: f.project_id.trim() === "" ? null : f.project_id.trim(), verified };
        void s.send(body, id ? "분양 정보를 고쳤습니다." : "분양 정보를 만들었습니다 — 공개 전 초안입니다.");
      }}
      aria-label={id ? `분양 정보 ${id} 고치기` : "분양 정보 만들기"}
      data-form={id ? "supply-update" : "supply-create"}
      className="grid gap-4 sm:grid-cols-2"
    >
      <TextField id={`${p}-name`} label="사업명 (공식 공고의 이름)" value={f.name} onChange={set("name")} error={s.fieldError("name")} required />
      <TextField id={`${p}-region`} label="지역 코드 (행정구역 10자리)" inputMode="numeric" value={f.region_code} onChange={set("region_code")} error={s.fieldError("region_code")} required />
      <TextField id={`${p}-scale`} label="공급 규모 (공고의 세대 수 — 공개 전 필수)" value={f.supply_scale} onChange={set("supply_scale")} error={s.fieldError("supply_scale")} />
      <TextField id={`${p}-project`} label="연결 프로젝트 번호 (있으면)" inputMode="numeric" value={f.project_id} onChange={set("project_id")} error={s.fieldError("project_id")} />
      <TextField id={`${p}-start`} label="청약 시작일 (YYYY-MM-DD)" value={f.apply_start} onChange={set("apply_start")} error={s.fieldError("apply_start")} required />
      <TextField id={`${p}-end`} label="청약 마감일 (YYYY-MM-DD — 다음 날 00:00부터 목록에서 빠짐)" value={f.apply_end} onChange={set("apply_end")} error={s.fieldError("apply_end")} required />
      <TextField id={`${p}-notice-date`} label="모집공고일 (YYYY-MM-DD)" value={f.notice_date} onChange={set("notice_date")} error={s.fieldError("notice_date")} required />
      <TextField id={`${p}-issuer`} label="공고 기관" value={f.notice_issuer} onChange={set("notice_issuer")} error={s.fieldError("notice_issuer")} required />
      <TextField id={`${p}-url`} label="공식 공고 주소" type="url" value={f.official_notice_url} onChange={set("official_notice_url")} error={s.fieldError("official_notice_url")} required />
      <SelectField id={`${p}-license`} label="공고 공공누리 유형" options={LICENSE_OPTIONS} value={f.license_type} onChange={set("license_type")} error={s.fieldError("license_type")} required />
      <div className="sm:col-span-2">
        <CheckboxField id={`${p}-verified`} label="지금 공식 공고와 대조해 확인했습니다 (확인일을 오늘로 적습니다)" checked={verified} onChange={(e) => setVerified(e.target.checked)} error={s.fieldError("verified")} />
      </div>
      <div className="space-y-3 sm:col-span-2">
        <Feedback id={p} s={s} />
        <DarkButton type="submit" disabled={!hydrated || s.pending}>
          {id ? "고친 내용 저장" : "분양 정보 만들기"}
        </DarkButton>
      </div>
    </form>
  );
}

/** 공개·내리기 — 공개는 확인일 + 공급 규모 (미달 사유는 서버가 칸마다 알린다) */
export function SupplyPublishControls({ id, status }: { id: number; status: string }) {
  const hydrated = useHydrated();
  const s = useSubmit();
  const [verified, setVerified] = useState(false);
  return (
    <div className="space-y-3" data-form="supply-publish">
      <CheckboxField id={`sp-${id}-pub-verified`} label="지금 공식 공고와 대조해 확인했습니다" checked={verified} onChange={(e) => setVerified(e.target.checked)} error={s.fieldError("verified")} />
      <Feedback id={`sp-${id}-pub`} s={s} />
      <div className="flex flex-wrap gap-3">
        <DarkButton type="button" disabled={!hydrated || s.pending} onClick={() => void s.send({ op: "publish", id, status: "public", verified }, "공개했습니다 — 청약 마감일 다음 날 00:00부터 예정 목록에서 빠집니다.")}>
          {status === "public" ? "확인일 다시 적기" : "공개"}
        </DarkButton>
        {status === "public" && (
          <DarkButton type="button" disabled={!hydrated || s.pending} onClick={() => void s.send({ op: "publish", id, status: "hidden" }, "내렸습니다.")}>
            내리기
          </DarkButton>
        )}
      </div>
    </div>
  );
}
