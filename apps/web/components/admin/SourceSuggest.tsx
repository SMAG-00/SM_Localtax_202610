"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DarkButton } from "@ltr/ui";
import { LICENSE_TYPE_LABELS } from "@ltr/editorial";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { SOURCE_KIND_LABELS, labelOf } from "@/lib/admin/labels";
import { sourceTypeLabel } from "@/lib/admin/official-source-rules";
import { sourcePayload, type SourceForm } from "@/lib/admin/records-form";
import { addBlockers, candidateToForm, publishGaps, type SourceCandidate, type SourceCheck } from "@/lib/admin/source-suggest";
import { ErrorSummary, StatusNote } from "./fields";
import { OUTLINE_BUTTON, ToneChip } from "./ui";
import { useHydrated } from "./useHydrated";

interface Item {
  candidate: SourceCandidate;
  check: SourceCheck | null;
}

type CardState = "open" | "added" | "filled";

/** 칸 한 줄 — 값이 비면 '비어 있음'을 강조한다 */
function Row({ label, value, basis, testId }: { label: string; value: string; basis: string; testId: string }) {
  const empty = value.trim() === "";
  return (
    <div className="grid gap-0.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3" data-testid={testId} data-empty={empty ? "true" : "false"}>
      <dt className="text-[14px] font-bold text-navy-700">{label}</dt>
      <dd className="min-w-0 text-[14px] [overflow-wrap:anywhere]">
        {empty ? <span className="rounded bg-amber-100 px-1.5 py-0.5 font-bold text-amber-800">비어 있음{basis ? "" : " — 근거 글자 없음"}</span> : <span className="font-bold text-navy-900">{value}</span>}
        {basis && <span className="block text-[13px] text-navy-600">근거: {basis}</span>}
      </dd>
    </div>
  );
}

function checkChip(item: Item) {
  if (!item.check) return <ToneChip tone="plain">원문 페이지 확인 안 함</ToneChip>;
  if (item.check.ok) return <ToneChip tone="emerald">자동 확인: 주소 열림 {item.check.verified_on}</ToneChip>;
  return <ToneChip tone="amber">자동 확인 못 함</ToneChip>;
}

function Card({
  item,
  state,
  busy,
  hydrated,
  error,
  onAdd,
  onFill,
  onDrop,
}: {
  item: Item;
  state: CardState;
  busy: boolean;
  hydrated: boolean;
  error: { title: string; details: string[] } | null;
  onAdd: () => void;
  onFill: () => void;
  onDrop: () => void;
}) {
  const { candidate: c, check } = item;
  const form = candidateToForm(c, check);
  const blockers = addBlockers(form);
  const gaps = publishGaps(form);
  const ok = check?.ok === true;
  return (
    <li data-testid="suggest-card" data-url={c.url} data-state={state} className="min-w-0 space-y-2 rounded-xl border border-navy-100 p-4 text-navy-800">
      <div className="flex flex-wrap items-center gap-2">
        <ToneChip tone="plain">{labelOf(SOURCE_KIND_LABELS, c.kind)}</ToneChip>
        {checkChip(item)}
        {state === "added" && <ToneChip tone="emerald">추가함</ToneChip>}
        {state === "filled" && <ToneChip tone="navy">폼에 채움</ToneChip>}
      </div>
      <dl className="space-y-1.5">
        <Row testId="suggest-kind" label="출처 종류" value={labelOf(SOURCE_KIND_LABELS, c.kind)} basis={c.basis.kind} />
        <Row testId="suggest-title" label="출처 이름" value={c.title} basis={c.basis.title} />
        <Row testId="suggest-url" label="원문 URL" value={c.url} basis={c.basis.url} />
        <Row testId="suggest-publisher" label="발표기관" value={c.publisher} basis={c.basis.publisher} />
        <Row testId="suggest-verified" label="확인일" value={ok ? (check?.verified_on ?? "") : ""} basis={ok ? "원문 주소가 열림 (서버가 오늘 직접 확인)" : (check?.reason ?? "")} />
        <Row testId="suggest-license" label="이용 조건" value={form.licenseStatus} basis={ok ? (check?.license_basis ?? "원문 페이지에서 공공누리 표시를 찾지 못함") : ""} />
        <Row
          testId="suggest-license-type"
          label="공공누리 유형"
          value={form.licenseType ? (LICENSE_TYPE_LABELS[form.licenseType as keyof typeof LICENSE_TYPE_LABELS] ?? form.licenseType) : ""}
          basis={ok && form.licenseType ? (check?.license_basis ?? "") : ""}
        />
        <Row testId="suggest-source-type" label="자료 종류" value={c.source_type ? sourceTypeLabel(c.source_type) : ""} basis={c.basis.source_type} />
        <Row testId="suggest-published" label="발표일" value={c.published_on} basis={c.basis.published_on} />
        <Row testId="suggest-reference" label="기준일" value={c.reference_date} basis={c.basis.reference_date} />
        <Row testId="suggest-region-unit" label="지역 단위" value={c.region_unit} basis={c.basis.region_unit} />
        <Row testId="suggest-collected" label="수집일" value={c.collected_on} basis={c.basis.collected_on} />
      </dl>
      {blockers.length > 0 && (
        <p data-testid="suggest-blocked" className="text-[14px] font-bold text-amber-800">
          이대로 추가할 수 없습니다 — 비어 있는 칸: {blockers.join("·")}. [고쳐서 추가]로 직접 채워 주세요.
        </p>
      )}
      {blockers.length === 0 && gaps.length > 0 && (
        <p className="text-[14px] text-amber-800">추가한 뒤 발행 전에 채울 칸: {gaps.join("·")}, 기준일·지역 단위 (원문에서 자동으로 알 수 없습니다 — REG1-09)</p>
      )}
      {error && <ErrorSummary title={error.title} messages={error.details} />}
      {state === "open" && (
        <div className="flex flex-wrap gap-2">
          <DarkButton type="button" data-testid="suggest-add" disabled={busy || !hydrated || blockers.length > 0} onClick={onAdd}>
            이대로 추가
          </DarkButton>
          <button type="button" data-testid="suggest-fill" className={OUTLINE_BUTTON} disabled={!hydrated} onClick={onFill}>
            고쳐서 추가(폼에 채움)
          </button>
          <button type="button" data-testid="suggest-drop" className={OUTLINE_BUTTON} disabled={busy} onClick={onDrop}>
            빼기
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * [본문에서 출처 자동 채우기] (F5) — 저장된 본문의 링크에서 출처 후보를 뽑고 공식 문서는 원문 페이지를 확인한다. 저장하지 않는다.
 * 추가는 기존 POST …/sources 그대로(DB 제약·감사 로그 그대로). 공식 문서 후보가 발표기관·확인일·이용 조건·공공누리 유형을 못 채우면 [이대로 추가]를 막는다.
 */
export function SourceSuggest({ articleId, onFill }: { articleId: number; onFill: (form: SourceForm) => void }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [states, setStates] = useState<Record<string, CardState>>({});
  const [errors, setErrors] = useState<Record<string, { title: string; details: string[] }>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ title: string; details: string[] } | null>(null);
  const [note, setNote] = useState("");
  const [already, setAlready] = useState(0);

  async function load() {
    setLoading(true);
    setFailure(null);
    setNote("");
    const r = await adminApi("POST", `/api/admin/articles/${articleId}/sources/suggest`);
    setLoading(false);
    if (r.status !== 200 || !Array.isArray(r.body.items)) {
      setFailure({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
      return;
    }
    setItems(r.body.items as Item[]);
    setAlready(typeof r.body.alreadyRegistered === "number" ? r.body.alreadyRegistered : 0);
    setStates({});
    setErrors({});
  }

  async function addOne(item: Item): Promise<boolean> {
    const url = item.candidate.url;
    const r = await adminApi("POST", `/api/admin/articles/${articleId}/sources`, sourcePayload(candidateToForm(item.candidate, item.check)));
    if (r.status === 201) {
      setStates((s) => ({ ...s, [url]: "added" }));
      setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== url)));
      return true;
    }
    setErrors((e) => ({ ...e, [url]: { title: apiErrorMessage(r), details: apiErrorDetails(r) } }));
    return false;
  }

  async function add(item: Item) {
    setBusy(true);
    setNote("");
    if (await addOne(item)) router.refresh();
    setBusy(false);
  }

  const open = (items ?? []).filter((i) => (states[i.candidate.url] ?? "open") === "open");
  const addable = open.filter((i) => addBlockers(candidateToForm(i.candidate, i.check)).length === 0);

  async function addAll() {
    setBusy(true);
    setNote("");
    let n = 0;
    for (const item of addable) if (await addOne(item)) n++;
    setBusy(false);
    if (n > 0) router.refresh();
    const left = addable.length - n;
    setNote(`${n}건을 추가했습니다${left > 0 ? ` — ${left}건은 추가하지 못했습니다(카드의 오류 문장 확인)` : ""}${open.length > addable.length ? ` · ${open.length - addable.length}건은 빈 칸이 있어 건너뛰었습니다` : ""}`);
  }

  function drop(url: string) {
    setItems((list) => (list ?? []).filter((i) => i.candidate.url !== url));
  }

  return (
    <section aria-label="본문에서 출처 자동 채우기" className="space-y-3 rounded-xl border border-navy-100 p-4">
      <div className="space-y-1">
        <p className="text-[15px] font-black text-navy-900">본문 링크에서 출처 자동 채우기</p>
        <p className="text-[14px] text-navy-600">저장된 본문의 링크와 “출처:” 줄 글자에서 후보를 만듭니다. 공식 문서는 원문 페이지를 서버가 열어 확인일·공공누리 유형을 읽습니다. 근거 글자가 없는 칸은 비워 둡니다. 눌러서 추가하기 전에는 아무것도 저장되지 않습니다.</p>
      </div>
      <button id="source-suggest-button" type="button" className={OUTLINE_BUTTON} disabled={loading || !hydrated} onClick={load}>
        {loading ? "본문과 원문 페이지를 확인하는 중" : "본문에서 출처 자동 채우기"}
      </button>
      {failure && <ErrorSummary title={failure.title} messages={failure.details} />}
      {items !== null && (
        <div className="space-y-3" data-testid="suggest-result">
          <p className="text-[14px] text-navy-700" data-testid="suggest-summary">
            후보 {items.length}건{already > 0 ? ` · 이미 등록된 출처 ${already}건은 뺐습니다` : ""}
          </p>
          {items.length === 0 && <p className="text-[14px] text-navy-700">본문에서 새로 뽑을 링크가 없습니다. 본문 문단에 [글](https://…) 링크를 넣고 저장한 뒤 다시 눌러 주세요.</p>}
          {addable.length > 0 && (
            <DarkButton type="button" data-testid="suggest-add-all" disabled={busy || !hydrated} onClick={addAll}>
              모두 추가 ({addable.length}건)
            </DarkButton>
          )}
          {note && <StatusNote>{note}</StatusNote>}
          <ul className="space-y-3">
            {items.map((item) => (
              <Card
                key={item.candidate.url}
                item={item}
                state={states[item.candidate.url] ?? "open"}
                busy={busy}
                hydrated={hydrated}
                error={errors[item.candidate.url] ?? null}
                onAdd={() => add(item)}
                onFill={() => {
                  setStates((s) => ({ ...s, [item.candidate.url]: "filled" }));
                  onFill(candidateToForm(item.candidate, item.check));
                }}
                onDrop={() => drop(item.candidate.url)}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
