"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { DeterminationResultCard } from "@ltr/ui";
import { track } from "@/lib/analytics/client";
import { setHandoff } from "@/lib/realestate/handoff";
import { HOUSE_COUNT_CAUSE_LABEL, judgeHouseCount, openCauses, parseFactText, pickHouseCountTable, questionsOf, type HouseCountCause } from "@/lib/realestate/house-count";

// 주택 수 판정 도우미 (/calc/house-count - RE-03·RE-04). 서명된 판정표가 렌더 때 함께 내려오고, 판정은 이 브라우저 안에서만 한다(판정 중 요청 0).
// 입력은 이 컴포넌트의 메모리에만 있다: 저장소·주소·서버 전송 0, 새로고침하면 사라진다. 모르는 칸은 비워 두면 결론 없이 빠진 항목을 보인다.

type Row = Record<string, string>;
const INPUT = "min-h-11 w-full rounded-lg border border-navy-200 px-3 text-[16px]";

export function HouseCountTool({ tables }: { tables: { kind: string; body: unknown }[] }) {
  const causes = useMemo(() => openCauses(tables), [tables]);
  const [cause, setCause] = useState<HouseCountCause>(causes[0]!);
  const [facts, setFacts] = useState<Row>({});
  const [listKnown, setListKnown] = useState(false);
  const [entries, setEntries] = useState<Row[]>([]);
  const table = pickHouseCountTable(tables, cause)!;
  const questions = questionsOf(table);

  const judgement = useMemo(() => {
    const parsed = (r: Row) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, parseFactText(v)]));
    const completeEntries = entries.map((e) => Object.fromEntries(questions.map((q) => [q.id, parseFactText(e[q.id] ?? "")])));
    return judgeHouseCount(table, { facts: parsed(facts), entries: table.kind === "house_count" && listKnown ? completeEntries : undefined });
  }, [table, facts, entries, listKnown, questions]);

  const pick = (c: HouseCountCause) => {
    setCause(c);
    setFacts({});
    setEntries([]);
    setListKnown(false);
  };
  const share = () => {
    if (judgement.count !== null) setHandoff({ houseCount: judgement.count, cause });
    // 판정을 마치고 다음 계산기로 넘어가는 클릭 때만 1건 - 판정 종류 이름뿐(입력값·개수·결론 글자 0)
    void track("determination_completed", { section: null, props: { kind: table.kind } });
  };

  return (
    <main id="main" data-ui="house-count" className="mx-auto w-full max-w-[760px] px-4 py-10">
      <h1 className="text-[28px] font-black text-navy-900">주택 수 판정 도우미</h1>
      <p className="mt-2 text-[15px] text-navy-700">입력한 내용은 이 화면에만 있고 저장하거나 보내지 않습니다. 모르는 칸은 비워 두세요.</p>
      <fieldset className="mt-5">
        <legend className="text-[16px] font-bold text-navy-900">어떻게 취득했나요?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {causes.map((c) => (
            <button key={c} type="button" data-cause={c} aria-pressed={c === cause} onClick={() => pick(c)} className={`min-h-11 rounded-full border px-5 font-bold ${c === cause ? "border-navy-900 bg-navy-900 text-ivory" : "border-navy-200 bg-white text-navy-900"}`}>
              {HOUSE_COUNT_CAUSE_LABEL[c]}
            </button>
          ))}
        </div>
      </fieldset>

      {table.kind === "house_count" ? (
        <section data-part="entries" className="mt-6 space-y-4">
          <label className="flex min-h-11 items-center gap-3 text-[15px] text-navy-800">
            <input type="checkbox" checked={listKnown} onChange={(e) => setListKnown(e.target.checked)} className="h-5 w-5" />
            <span>보유 목록을 입력할게요 (항목이 없으면 그대로 0개로 판정합니다)</span>
          </label>
          {listKnown &&
            entries.map((e, i) => (
              <div key={i} data-part="entry" className="space-y-2 rounded-2xl border border-navy-100 p-4">
                <p className="font-bold text-navy-900">{i + 1}번째 항목</p>
                {questions.map((q) => (
                  <label key={q.id} className="block text-[15px] text-navy-800">
                    {q.label}
                    <input className={INPUT} value={e[q.id] ?? ""} onChange={(ev) => setEntries(entries.map((x, j) => (j === i ? { ...x, [q.id]: ev.target.value } : x)))} />
                  </label>
                ))}
                <button type="button" onClick={() => setEntries(entries.filter((_, j) => j !== i))} className="min-h-11 font-bold text-navy-900 underline underline-offset-4">
                  이 항목 지우기
                </button>
              </div>
            ))}
          {listKnown && (
            <button type="button" data-part="add-entry" onClick={() => setEntries([...entries, {}])} className="min-h-11 rounded-full border border-navy-900 px-5 font-bold text-navy-900">
              항목 추가
            </button>
          )}
        </section>
      ) : (
        <section data-part="facts" className="mt-6 space-y-3">
          {questions.map((q) => (
            <label key={q.id} className="block text-[15px] text-navy-800">
              {q.label}
              <input className={INPUT} value={facts[q.id] ?? ""} onChange={(ev) => setFacts({ ...facts, [q.id]: ev.target.value })} />
            </label>
          ))}
        </section>
      )}

      <div className="mt-8" data-part="judgement" aria-live="polite">
        <DeterminationResultCard title={`${HOUSE_COUNT_CAUSE_LABEL[cause]} 주택 수 판정`} tableVersion={judgement.tableVersion} status={judgement.status} conclusion={judgement.conclusion} missing={judgement.missing} />
      </div>

      {judgement.count !== null && (
        <section data-part="handoff" className="mt-6 space-y-2">
          <p className="text-[15px] text-navy-800">이 주택 수를 다른 계산기에 채워서 이어갈 수 있습니다. 값은 주소에 붙지 않고 이 브라우저 안에서만 넘어갑니다.</p>
          <div className="flex flex-wrap gap-4">
            <Link href="/calc/acquisition" onClick={share} data-part="handoff-acquisition" className="inline-flex min-h-11 items-center font-bold text-navy-900 underline underline-offset-4">
              취득세 계산하기
            </Link>
            <Link href="/calc/total-cost" onClick={share} data-part="handoff-total-cost" className="inline-flex min-h-11 items-center font-bold text-navy-900 underline underline-offset-4">
              보유까지 총비용 보기
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
