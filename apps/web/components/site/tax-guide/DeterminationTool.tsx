"use client";

import { useMemo, useState } from "react";
import { DeterminationResultCard } from "@ltr/ui";
import { parseTableByKind, type ConclusionTable } from "@ltr/tax-engine";
import { track } from "@/lib/analytics/client";
import { PROJECT_TAX_TYPES, projectTaxType, runDetermination, type DeterminationRun, type RawAnswer } from "@/lib/tax-guide/determination-run";

// 정비·신탁 세금 판정 화면 (W11-c c4·c7·c8 - TRU-03 · RDV-04 · PR-12). 판정은 이 브라우저 안에서만 한다:
//  · 입력은 이 컴포넌트의 상태에만 있고 서버·이벤트·주소·브라우저 저장소로 나가지 않는다 (fetch·storage·router 이동 없음).
//  · "모르겠어요"는 값을 빼는 것이라 결론 대신 "요건 확인 필요"와 빠진 항목이 나온다.
//  · 판정표 본문(질문 문장·결론)은 감수 입력이며 렌더 때 함께 내려온다. 금액·유리/불리 표현은 이 화면에 없다.

export interface ToolField {
  id: string;
  kind: "yesno" | "count" | "date" | "choice" | "text";
  options: string[];
}

export interface DeterminationToolProps {
  types: { id: string; label: string }[];
  /** 판정표 종류 → 본문 */
  tables: Record<string, unknown>;
  fields: Record<string, ToolField>;
  initialType?: string;
  /** 트래커 단계에서 들어온 단계 값 - 판정표가 stage 사실을 요구할 때만 미리 채운다 */
  initialStage?: string;
}

const UNKNOWN = "unknown";
const INPUT = "mt-1 block min-h-11 w-full rounded-lg border border-navy-200 bg-white px-3 text-[16px] text-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500";

function toFact(field: ToolField | undefined, raw: string): RawAnswer {
  if (raw === "" || raw === UNKNOWN) return undefined;
  switch (field?.kind) {
    case "yesno":
      return raw === "yes" ? true : raw === "no" ? false : undefined;
    case "count": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    default:
      return raw;
  }
}

export function DeterminationTool({ types, tables, fields, initialType, initialStage }: DeterminationToolProps) {
  const [typeId, setTypeId] = useState<string>(types.find((t) => t.id === initialType)?.id ?? types[0]?.id ?? "");
  const initialAnswers = (): Record<string, string> => (initialStage ? { stage: initialStage } : {});
  const [answers, setAnswers] = useState<Record<string, string>>(initialAnswers);
  const [run, setRun] = useState<DeterminationRun | null>(null);
  const [failed, setFailed] = useState(false);

  const type = projectTaxType(typeId);
  const table = useMemo<ConclusionTable | null>(() => {
    if (!type || tables[type.kind] === undefined) return null;
    try {
      return parseTableByKind(type.kind, tables[type.kind]) as ConclusionTable;
    } catch {
      return null;
    }
  }, [type, tables]);

  if (!type || !table) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const facts: Record<string, RawAnswer> = {};
      for (const q of table.required) facts[q.id] = toFact(fields[q.id], answers[q.id] ?? UNKNOWN);
      const done = runDetermination(type.id as (typeof PROJECT_TAX_TYPES)[number]["id"], tables[type.kind], facts);
      setRun(done);
      // 측정: 판정 종류만 보낸다 (입력값·결론 없음)
      void track("determination_completed", { section: "tax", props: { kind: done.kind } });
      setFailed(false);
    } catch {
      setRun(null);
      setFailed(true);
    }
  };

  return (
    <div data-ui="determination-tool" data-determination-kind={type.kind}>
      <form onSubmit={submit} aria-label="세금 판정 질문">
        {types.length > 1 && (
          <label className="block text-[15px] font-bold text-navy-900">
            판정 종류
            <select
              data-field="judgment-type"
              className={INPUT}
              value={typeId}
              onChange={(e) => {
                setTypeId(e.target.value);
                setRun(null);
                setAnswers(initialAnswers());
              }}
            >
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="mt-4 grid gap-4">
          {table.required.map((q) => {
            const f = fields[q.id];
            const value = answers[q.id] ?? UNKNOWN;
            const set = (v: string) => {
              setAnswers((a) => ({ ...a, [q.id]: v }));
              setRun(null);
            };
            return (
              <label key={q.id} className="block text-[15px] font-bold text-navy-900">
                {q.label}
                {f?.kind === "yesno" || f?.kind === "choice" ? (
                  <select data-field={q.id} className={INPUT} value={value} onChange={(e) => set(e.target.value)}>
                    <option value={UNKNOWN}>모르겠어요</option>
                    {f.kind === "yesno" ? (
                      <>
                        <option value="yes">예</option>
                        <option value="no">아니요</option>
                      </>
                    ) : (
                      f.options.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))
                    )}
                  </select>
                ) : (
                  <input
                    data-field={q.id}
                    className={INPUT}
                    type={f?.kind === "count" ? "number" : f?.kind === "date" ? "date" : "text"}
                    inputMode={f?.kind === "count" ? "numeric" : undefined}
                    autoComplete="off"
                    value={value === UNKNOWN ? "" : value}
                    placeholder="비워 두면 모르겠어요"
                    onChange={(e) => set(e.target.value === "" ? UNKNOWN : e.target.value)}
                  />
                )}
              </label>
            );
          })}
        </div>
        <button type="submit" data-action="determine" className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-navy-900 px-5 text-[16px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hermes-500">
          판정 보기
        </button>
      </form>
      {failed && (
        <p role="alert" className="mt-4 text-[15px] text-navy-700">
          판정표를 읽지 못했습니다. 잠시 뒤 다시 시도하세요.
        </p>
      )}
      {run && (
        <div className="mt-6" data-part="determination-result" aria-live="polite">
          <DeterminationResultCard
            title={type.label}
            tableVersion={run.outcome.tableVersion}
            status={run.outcome.status}
            conclusion={run.outcome.conclusion ? { text: run.outcome.conclusion.text, ...(run.outcome.conclusion.basis ? { basis: run.outcome.conclusion.basis } : {}) } : null}
            missing={run.outcome.missing}
            lawChips={run.outcome.conclusion?.basis ? [run.outcome.conclusion.basis] : []}
          />
        </div>
      )}
    </div>
  );
}
