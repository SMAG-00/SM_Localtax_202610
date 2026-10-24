"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DarkButton } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { METRIC_KEYS, METRIC_LABELS, valueOf, type MetricKey } from "@/lib/readiness/monthly";
import type { RecordsBoard } from "@/lib/server/readiness/monthly";
import { ErrorSummary, StatusNote } from "./fields";
import { DataTable, EmptyNote, OUTLINE_BUTTON, Panel, TD, TEXT_LINK, ToneChip } from "./ui";
import { useHydrated } from "./useHydrated";

// 제휴 준비 월 마감·3개월 조합·부정평가·규정 판단 값 (W7 - NAV-16~20, docs/dev/W7_설계.md 5단계). '인정'·'예상 점수'·'선정 예정' 문구 없음.
const INPUT = "min-h-11 w-full rounded-lg border border-navy-200 bg-white px-3 text-[15px] text-navy-900";
const RECORDS_PATH = "/api/admin/news-readiness/records";

function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-[14px] font-bold text-navy-800">
      {children}
    </label>
  );
}

function useRecordOp() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState("");
  async function run(body: Record<string, unknown>, doneText: string): Promise<boolean> {
    setPending(true);
    setProblem(null);
    setDone("");
    const r = await adminApi("POST", RECORDS_PATH, body);
    setPending(false);
    if (r.status >= 200 && r.status < 300) {
      setDone(doneText);
      router.refresh();
      return true;
    }
    setProblem({ title: apiErrorMessage(r), details: apiErrorDetails(r) });
    return false;
  }
  return { run, pending, problem, done };
}

function Notes({ op }: { op: ReturnType<typeof useRecordOp> }) {
  return (
    <>
      {op.problem && <ErrorSummary title={op.problem.title} messages={op.problem.details} />}
      {op.done && <StatusNote>{op.done}</StatusNote>}
    </>
  );
}

/** 지표 값 글자 - 0이면 색이 아니라 글자로 '0 · 경고' */
function cell(metrics: RecordsBoard["monthly"]["months"][number]["metrics"], key: MetricKey): ReactNode {
  const m = metrics[key];
  if (!m) return "—";
  const v = valueOf(m);
  const text = m.denominator === null ? `${m.numerator}` : `${m.numerator}/${m.denominator}${v === null ? "" : ` (${Math.round(v * 1000) / 10}%)`}`;
  const warn = m.numerator === 0 && (m.denominator === null || m.denominator > 0) && key !== "similarity_judged" && key !== "column_share";
  return warn ? <strong data-zero-warning>{text} · 경고: 0</strong> : text;
}

function IntakeSection({ intake }: { intake: RecordsBoard["monthly"]["intake"] }) {
  return (
    <Panel id="readiness-intake" title="다음 접수 목표" description="다음 접수 공고를 확인한 뒤 설정 ‘다음 접수 목표’에 적습니다. 선정은 외부 결정입니다 (NAV-16).">
      <p className="text-[16px] text-navy-900" data-testid="next-intake">
        {intake ? `${intake.label ?? "접수 공고"}${intake.targetMonth ? ` · ${intake.targetMonth}` : ""}` : "목표 접수 미정"}
      </p>
      <p className="mt-2 text-[14px] text-navy-600">
        <Link href="/admin/settings" className={TEXT_LINK}>설정에서 고치기</Link> (관리자)
      </p>
    </Panel>
  );
}

function AlertsSection({ alerts }: { alerts: RecordsBoard["monthly"]["alerts"] }) {
  const op = useRecordOp();
  const hydrated = useHydrated();
  const open = alerts.filter((a) => !a.acknowledged);
  return (
    <Panel id="readiness-alerts" title="경고 알림" description="0인 지표·칼럼 비중·부정평가 누적이 기준에 이르면 월 마감 때 같은 사유로 한 건만 올라옵니다.">
      {open.length === 0 ? (
        <EmptyNote>확인할 경고가 없습니다.</EmptyNote>
      ) : (
        <ul className="space-y-2" data-testid="alerts-open">
          {open.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-navy-100 bg-white p-3">
              <ToneChip tone="amber">경고</ToneChip>
              <span className="flex-1 text-[15px] text-navy-900">
                {a.month} · {a.detail}
              </span>
              <button type="button" className={OUTLINE_BUTTON} disabled={op.pending || !hydrated} onClick={() => void op.run({ op: "alert_ack", id: a.id }, "확인했습니다")}>
                확인
              </button>
            </li>
          ))}
        </ul>
      )}
      <Notes op={op} />
    </Panel>
  );
}

function MonthlySection({ monthly }: { monthly: RecordsBoard["monthly"] }) {
  const op = useRecordOp();
  const hydrated = useHydrated();
  const [month, setMonth] = useState(monthly.months.at(-1)?.month ?? "");
  const [reason, setReason] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void op.run({ op: "monthly_recalc", month, reason }, "새 version 행으로 재계산했습니다 (이전 행은 그대로)");
  };
  return (
    <Panel
      id="readiness-monthly"
      title="월별 지표와 임의 3개월 조합"
      description="월 마감 다음 날 그 달 행이 만들어지고 마감된 행은 바뀌지 않습니다. 자체 생산 분자에는 보도기사만 들어갑니다 - digest·정보 목록·칼럼·협찬은 넣지 않습니다 (NAV-17)."
    >
      {monthly.requirementUnconfirmed && (
        <p className="mb-3">
          <ToneChip tone="amber">요건 미확정</ToneChip> <span className="text-[14px] text-navy-700">확정된 규정 버전이 없어 내부 정의 지표만 보입니다.</span>
        </p>
      )}
      {monthly.months.length === 0 ? (
        <EmptyNote>마감된 달이 아직 없습니다. 월 마감 배치(readiness-monthly)가 돈 뒤에 보입니다.</EmptyNote>
      ) : (
        <div className="overflow-x-auto">
          <DataTable caption="월별 지표 - 분자/분모(비율)" head={["달", "version", ...METRIC_KEYS.map((k) => METRIC_LABELS[k])]}>
            {monthly.months.map((r) => (
              <tr key={r.month} data-month={r.month}>
                <td className={TD}>{r.month}</td>
                <td className={TD}>{r.version}</td>
                {METRIC_KEYS.map((k) => (
                  <td key={k} className={TD}>
                    {cell(r.metrics, k)}
                  </td>
                ))}
              </tr>
            ))}
          </DataTable>
        </div>
      )}
      <div className="mt-6" data-testid="combos">
        <h3 className="text-[16px] font-black text-navy-900">임의 3개월 조합</h3>
        {monthly.combos.kind === "insufficient" ? (
          <p className="mt-2 text-[15px] text-navy-800" data-testid="combos-insufficient">기간 부족 - 마감된 달이 {monthly.combos.months}개월입니다 (3개월 필요).</p>
        ) : (
          <>
            <p className="mt-2 text-[15px] text-navy-800" data-testid="combos-count">조합 {monthly.combos.count}개를 계산했습니다. 규정 원문이 조합 정의를 정하기 전에는 연속이 아닌 모든 조합을 봅니다.</p>
            <DataTable caption="지표마다 가장 낮은 조합" head={["지표", "값", "조합"]}>
              {monthly.combos.lowest.map((l) => (
                <tr key={l.key}>
                  <td className={TD}>{METRIC_LABELS[l.key]}</td>
                  <td className={TD}>{l.metric.denominator === null ? l.value : `${Math.round(l.value * 1000) / 10}%`}</td>
                  <td className={TD}>{l.months.join(" · ")}</td>
                </tr>
              ))}
            </DataTable>
          </>
        )}
      </div>
      {monthly.months.length > 0 && (
        <form onSubmit={submit} className="mt-6 grid gap-3 md:grid-cols-[10rem_1fr_auto] md:items-end">
          <div>
            <Label htmlFor="recalc-month">재계산할 달</Label>
            <select id="recalc-month" className={INPUT} value={month} onChange={(e) => setMonth(e.target.value)}>
              {monthly.months.map((r) => (
                <option key={r.month} value={r.month}>{r.month}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="recalc-reason">재계산 사유 (마감 행은 그대로 두고 새 version 행을 만듭니다)</Label>
            <input id="recalc-reason" className={INPUT} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DarkButton type="submit" disabled={op.pending || !hydrated}>재계산</DarkButton>
        </form>
      )}
      <Notes op={op} />
    </Panel>
  );
}

function PenaltySection({ penalty }: { penalty: RecordsBoard["monthly"]["penalty"] }) {
  const op = useRecordOp();
  const hydrated = useHydrated();
  const [item, setItem] = useState("");
  const [points, setPoints] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [evidence, setEvidence] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void op
      .run({ op: "penalty_add", item, points: Number(points), occurred_on: occurredOn, ...(evidence.trim() ? { evidence_ref: evidence.trim() } : {}) }, "기록했습니다")
      .then((ok) => {
        if (ok) {
          setItem("");
          setPoints("");
          setOccurredOn("");
          setEvidence("");
        }
      });
  };
  return (
    <Panel id="readiness-penalty" title="부정평가 방지" description="광고성 기사·광고 강요가 의심되는 사례를 기록하면 규정 버전의 기간 안 누적 점수를 보입니다. 기록은 추가만 가능하고 고칠 때는 새 기록이 이전 기록을 대체합니다 (NAV-20).">
      <p className="text-[15px] text-navy-900" data-testid="penalty-total">
        {penalty.rule
          ? `최근 ${penalty.rule.window_months}개월 누적 ${penalty.total ?? 0}점 (${penalty.asOf} 기준, 경고 기준 ${penalty.rule.warn_points}점 ${penalty.rule.comparator === "gt" ? "초과" : "이상"})${penalty.reached ? " - 기준에 이르렀습니다" : ""}`
          : "규정 값 없음 - 규정 버전의 부정평가 판단 값을 입력하면 누적을 계산합니다."}
      </p>
      {penalty.records.length > 0 && (
        <DataTable caption="부정평가 위험 기록" head={["일어난 날", "사례", "점수", "기록자"]}>
          {penalty.records.map((r) => (
            <tr key={r.id}>
              <td className={TD}>{r.occurredOn}</td>
              <td className={TD}>{r.item}</td>
              <td className={TD}>{r.points}</td>
              <td className={TD}>{r.checkedBy}</td>
            </tr>
          ))}
        </DataTable>
      )}
      <form onSubmit={submit} className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label htmlFor="penalty-item">위반 우려 사례 (이름·연락처 같은 식별 정보 없이)</Label>
          <input id="penalty-item" className={INPUT} value={item} maxLength={200} onChange={(e) => setItem(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="penalty-points">점수</Label>
          <input id="penalty-points" className={INPUT} inputMode="decimal" value={points} onChange={(e) => setPoints(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="penalty-date">일어난 날 (YYYY-MM-DD)</Label>
          <input id="penalty-date" className={INPUT} value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="penalty-evidence">근거 문서 위치 (있으면 ‘확인’, 없으면 ‘미확인’으로 기록)</Label>
          <input id="penalty-evidence" className={INPUT} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
        </div>
        <div>
          <DarkButton type="submit" disabled={op.pending || !hydrated}>기록 추가</DarkButton>
        </div>
      </form>
      <Notes op={op} />
    </Panel>
  );
}

type RuleRow = RecordsBoard["requirements"][number];

function RulesForm({ req }: { req: RuleRow }) {
  const op = useRecordOp();
  const hydrated = useHydrated();
  const sim = (req.rules?.similarity_rule ?? {}) as Record<string, unknown>;
  const pen = (req.rules?.penalty_rule ?? {}) as Record<string, unknown>;
  const con = (req.rules?.contributor_rule ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  const [simSentence, setSimSentence] = useState(str(sim.sentence_similarity));
  const [simSentenceCmp, setSimSentenceCmp] = useState(str(sim.sentence_comparator) || "gte");
  const [simRatio, setSimRatio] = useState(str(sim.article_ratio));
  const [simRatioCmp, setSimRatioCmp] = useState(str(sim.article_comparator) || "gt");
  const [penMonths, setPenMonths] = useState(str(pen.window_months));
  const [penPoints, setPenPoints] = useState(str(pen.warn_points));
  const [penCmp, setPenCmp] = useState(str(pen.comparator) || "gte");
  const [merge, setMerge] = useState(con.merge_external === true);
  const locked = req.status === "confirmed";
  const base = `rules-${req.id}`;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const hasSim = simSentence.trim() !== "" || simRatio.trim() !== "";
    const hasPen = penMonths.trim() !== "" || penPoints.trim() !== "";
    void op.run(
      {
        op: "rules_save",
        requirement_id: req.id,
        similarity_rule: hasSim ? { sentence_similarity: Number(simSentence), sentence_comparator: simSentenceCmp, article_ratio: Number(simRatio), article_comparator: simRatioCmp } : null,
        penalty_rule: hasPen ? { window_months: Number(penMonths), warn_points: Number(penPoints), comparator: penCmp } : null,
        contributor_rule: { merge_external: merge },
      },
      "저장했습니다",
    );
  };
  const cmp = (id: string, value: string, set: (v: string) => void) => (
    <select id={id} className={INPUT} value={value} disabled={locked} onChange={(e) => set(e.target.value)}>
      <option value="gte">이상</option>
      <option value="gt">초과</option>
    </select>
  );
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-navy-100 bg-white p-4" data-requirement-id={req.id}>
      <p className="text-[15px] font-bold text-navy-900">
        {req.platform === "naver" ? "네이버" : "카카오"} 규정 v{req.version} · {req.title} {locked ? <ToneChip tone="emerald">확정 - 고칠 수 없음</ToneChip> : <ToneChip tone="amber">작성 중</ToneChip>}
      </p>
      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <Label htmlFor={`${base}-s1`}>유사 문장 기준 (0~1)</Label>
          <input id={`${base}-s1`} className={INPUT} inputMode="decimal" value={simSentence} disabled={locked} onChange={(e) => setSimSentence(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`${base}-c1`}>문장 기준 비교</Label>
          {cmp(`${base}-c1`, simSentenceCmp, setSimSentenceCmp)}
        </div>
        <div>
          <Label htmlFor={`${base}-s2`}>유사 기사 비율 기준 (0~1)</Label>
          <input id={`${base}-s2`} className={INPUT} inputMode="decimal" value={simRatio} disabled={locked} onChange={(e) => setSimRatio(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`${base}-c2`}>비율 기준 비교</Label>
          {cmp(`${base}-c2`, simRatioCmp, setSimRatioCmp)}
        </div>
        <div>
          <Label htmlFor={`${base}-p1`}>부정평가 누적 기간 (개월)</Label>
          <input id={`${base}-p1`} className={INPUT} inputMode="numeric" value={penMonths} disabled={locked} onChange={(e) => setPenMonths(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`${base}-p2`}>경고 기준 점수</Label>
          <input id={`${base}-p2`} className={INPUT} inputMode="decimal" value={penPoints} disabled={locked} onChange={(e) => setPenPoints(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`${base}-p3`}>점수 비교</Label>
          {cmp(`${base}-p3`, penCmp, setPenCmp)}
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-[15px] text-navy-800">
            <input type="checkbox" checked={merge} disabled={locked} onChange={(e) => setMerge(e.target.checked)} /> 외부 기고자는 1명으로 합산
          </label>
        </div>
      </div>
      <p className="text-[13px] text-navy-600">숫자는 규정 원문을 확인한 담당자가 입력합니다. 비워 두면 유사도는 내부 기준, 부정평가는 ‘규정 값 없음’, 합산은 하지 않음입니다.</p>
      {!locked && <DarkButton type="submit" disabled={op.pending || !hydrated}>판단 값 저장</DarkButton>}
      <Notes op={op} />
    </form>
  );
}

function RulesSection({ requirements }: { requirements: RecordsBoard["requirements"] }) {
  return (
    <Panel id="readiness-rules" title="규정 판단 값" description="규정 버전마다 유사도 기준·부정평가 기간과 경고 점수·외부 기고자 합산 여부를 적습니다. 확정된 규정 버전은 고칠 수 없고, 바뀐 규정은 새 버전으로 적습니다 (NAV-16·18·19·20).">
      {requirements.length === 0 ? (
        <EmptyNote>등록한 규정 버전이 없습니다 - 규정 원문을 확인해 ‘제휴 규정 버전’에 먼저 적어 주세요.</EmptyNote>
      ) : (
        <div className="space-y-4">
          {requirements.map((r) => (
            <RulesForm key={r.id} req={r} />
          ))}
        </div>
      )}
    </Panel>
  );
}

export function ReadinessMonthlyView({ board }: { board: RecordsBoard }) {
  return (
    <div className="mt-10 space-y-8" data-part="monthly">
      <IntakeSection intake={board.monthly.intake} />
      <AlertsSection alerts={board.monthly.alerts} />
      <MonthlySection monthly={board.monthly} />
      <PenaltySection penalty={board.monthly.penalty} />
      <RulesSection requirements={board.requirements} />
    </div>
  );
}
