"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { DarkButton, SelectField, TextField } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { moveInOrder } from "@/lib/admin/category-rules";
import type { FieldErrors } from "@/lib/admin/form-utils";
import {
  CURATION_KIND_LABELS,
  CURATION_LIMITS,
  CURATION_STATUS_LABELS,
  curationFormToBody,
  periodErrors,
  type CurationForm,
  type CurationKind,
  type CurationStatus,
} from "@/lib/admin/home-curation-rules";
import { ErrorSummary, StatusNote } from "./fields";
import { MONO, OUTLINE_BUTTON, ToneChip, type Tone } from "./ui";
import { useHydrated } from "./useHydrated";

export interface CurationListItem {
  id: number;
  kind: CurationKind;
  targetId: number;
  sort: number;
  startsOn: string;
  endsOn: string | null;
  status: CurationStatus;
  target: { title: string; slug: string; detail: string; public: boolean } | null;
}

const STATUS_TONE: Record<CurationStatus, Tone> = { active: "emerald", upcoming: "amber", expired: "plain" };

const periodText = (startsOn: string, endsOn: string | null) => `${startsOn} ~ ${endsOn ?? "끝 없음"}`;

/** 기간 고치기 — 시작일·종료일(비우면 끝 없음). 종료일은 오늘 이후 */
function PeriodForm({ item, today }: { item: CurationListItem; today: string }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const base = `curation-${item.id}`;
  const [startsOn, setStartsOn] = useState(item.startsOn);
  const [endsOn, setEndsOn] = useState(item.endsOn ?? "");
  const [error, setError] = useState<{ title: string; details: string[] } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const period = { starts_on: startsOn, ends_on: endsOn.trim() === "" ? null : endsOn };
    const problems = periodErrors(period, today).map((p) => p.replace(/^curation\.endsOn: /, ""));
    if (problems.length) {
      setError({ title: problems[0]!, details: [] });
      return;
    }
    setPending(true);
    const r = await adminApi("PATCH", `/api/admin/home-curations/${item.id}`, { startsOn: period.starts_on, endsOn: period.ends_on });
    setPending(false);
    if (r.status === 200) {
      router.refresh();
      return;
    }
    setError({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  return (
    <form onSubmit={submit} noValidate className="mt-3 space-y-3" aria-label={`${item.target?.title ?? "카드"} 기간 고치기`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id={`${base}-starts`} label="시작일" type="date" required value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        <TextField id={`${base}-ends`} label="종료일" type="date" hint="비우면 끝 없음 — 이날까지 보입니다" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
      </div>
      {error && <ErrorSummary title={error.title} messages={error.details} />}
      <DarkButton type="submit" disabled={pending || !hydrated}>
        {pending ? "저장하는 중" : "기간 저장"}
      </DarkButton>
    </form>
  );
}

/** 한 종류의 배치 목록 — 노출 중·예정 카드는 위로·아래로(순서 저장), 모든 카드는 기간 고치기·빼기 */
export function CurationList({ kind, items, today }: { kind: CurationKind; items: readonly CurationListItem[]; today: string }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const live = items.filter((i) => i.status !== "expired");
  const liveIds = live.map((i) => i.id);

  async function move(id: number, direction: -1 | 1) {
    const next = moveInOrder(liveIds, id, direction);
    if (next.every((x, i) => x === liveIds[i])) return;
    setPending(true);
    setError("");
    setDone("");
    const r = await adminApi("POST", "/api/admin/home-curations/order", { kind, ids: next });
    setPending(false);
    if (r.status === 200) {
      setDone(`순서를 바꿨습니다 — ${direction < 0 ? "위로" : "아래로"}`);
      router.refresh();
      return;
    }
    setError(apiErrorMessage(r));
  }

  async function remove(item: CurationListItem) {
    setPending(true);
    setError("");
    setDone("");
    const r = await adminApi("DELETE", `/api/admin/home-curations/${item.id}`);
    setPending(false);
    if (r.status === 200) {
      setDone(`카드를 뺐습니다 — ${item.target?.title ?? item.targetId}`);
      router.refresh();
      return;
    }
    setError(apiErrorMessage(r));
  }

  return (
    <div className="space-y-3">
      <ol className="space-y-3" aria-label={`${CURATION_KIND_LABELS[kind]} 카드`}>
        {items.map((item) => {
          const at = liveIds.indexOf(item.id);
          return (
            <li key={item.id} data-testid={`curation-${item.id}`} className="rounded-xl border border-navy-100 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <ToneChip tone={STATUS_TONE[item.status]}>
                  <span data-testid="curation-status">{CURATION_STATUS_LABELS[item.status]}</span>
                </ToneChip>
                <span className="text-[17px] font-black text-navy-900 [overflow-wrap:anywhere]">{item.target?.title ?? `대상 ${item.targetId} (찾을 수 없음)`}</span>
                {item.target && !item.target.public && <ToneChip tone="rose">공개 전 — 홈에 보이지 않습니다</ToneChip>}
              </div>
              <p className="mt-1 text-[14px] text-navy-600">
                노출 기간 <span className={MONO}>{periodText(item.startsOn, item.endsOn)}</span>
                {item.target && <> · {item.target.detail}</>}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {at >= 0 && (
                  <>
                    <button type="button" className={OUTLINE_BUTTON} disabled={pending || !hydrated || at === 0} onClick={() => void move(item.id, -1)} aria-label={`${item.target?.title ?? item.id} 위로`}>
                      위로
                    </button>
                    <button
                      type="button"
                      className={OUTLINE_BUTTON}
                      disabled={pending || !hydrated || at === liveIds.length - 1}
                      onClick={() => void move(item.id, 1)}
                      aria-label={`${item.target?.title ?? item.id} 아래로`}
                    >
                      아래로
                    </button>
                  </>
                )}
                <button type="button" className={OUTLINE_BUTTON} disabled={pending || !hydrated} onClick={() => void remove(item)} aria-label={`${item.target?.title ?? item.id} 빼기`}>
                  빼기
                </button>
              </div>
              {item.status !== "expired" && (
                <details className="mt-2">
                  <summary className="min-h-11 cursor-pointer text-[15px] font-bold text-navy-800">기간 고치기</summary>
                  <PeriodForm item={item} today={today} />
                </details>
              )}
            </li>
          );
        })}
      </ol>
      {error && <ErrorSummary title={error} messages={[]} />}
      {done && <StatusNote>{done}</StatusNote>}
    </div>
  );
}

/**
 * 카드 더하기 — 대상 고르기·시작일·종료일. 고른 기간에 이미 상한만큼 보이는 날이 있으면 서버에 보내지 않고 사유를 보인다
 * (7장째 스토리 카드 지정 불가 — DB도 막는다). 오늘 상한만큼 보이면 단추를 막는다.
 */
export function CurationAddForm({
  kind,
  options,
  existing,
  today,
  fullNow,
}: {
  kind: CurationKind;
  options: readonly { value: string; label: string }[];
  existing: readonly CurationListItem[];
  today: string;
  fullNow: boolean;
}) {
  const hydrated = useHydrated();
  const router = useRouter();
  const base = `curation-new-${kind}`;
  const empty: CurationForm = { targetId: "", startsOn: today, endsOn: "" };
  const [form, setForm] = useState<CurationForm>(empty);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState("");
  const [pending, setPending] = useState(false);
  const set = (key: keyof CurationForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const periods = existing.map((c) => ({ id: c.id, starts_on: c.startsOn, ends_on: c.endsOn, targetId: c.targetId }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    setDone("");
    const v = curationFormToBody(kind, form, today, periods, base);
    if (!v.ok) {
      setErrors(v.errors);
      document.getElementById(Object.keys(v.errors)[0]!)?.focus();
      return;
    }
    setErrors({});
    setPending(true);
    const r = await adminApi("POST", "/api/admin/home-curations", v.body);
    setPending(false);
    if (r.status === 201) {
      setDone("카드를 더했습니다");
      setForm(empty);
      router.refresh();
      return;
    }
    setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label={`${CURATION_KIND_LABELS[kind]} 카드 더하기`}>
      {fullNow && (
        <p data-testid={`curation-full-${kind}`} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[15px] font-bold text-amber-800">
          오늘 {CURATION_KIND_LABELS[kind]} 카드가 {CURATION_LIMITS[kind]}장 보입니다 — {CURATION_LIMITS[kind] + 1}장째는 지정할 수 없습니다. 카드를 빼거나 기간을 줄인 뒤
          더하세요. 끝난 뒤 시작하는 기간이면 더할 수 있습니다.
        </p>
      )}
      <SelectField
        id={`${base}-target`}
        label={kind === "tracker" ? "개정 트래커" : "기사"}
        required
        options={[...options]}
        placeholder="골라 주세요"
        value={form.targetId}
        onChange={set("targetId")}
        error={errors[`${base}-target`]}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField id={`${base}-starts`} label="시작일" type="date" required value={form.startsOn} onChange={set("startsOn")} error={errors[`${base}-starts`]} />
        <TextField id={`${base}-ends`} label="종료일" type="date" hint="비우면 끝 없음 — 이날까지 보입니다" value={form.endsOn} onChange={set("endsOn")} error={errors[`${base}-ends`]} />
      </div>
      {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
      {done && <StatusNote>{done}</StatusNote>}
      <DarkButton type="submit" disabled={pending || !hydrated || options.length === 0}>
        {pending ? "더하는 중" : "카드 더하기"}
      </DarkButton>
    </form>
  );
}
