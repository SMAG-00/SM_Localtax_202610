"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Callout, DarkButton } from "@ltr/ui";
import { adminApi, apiErrorDetails, apiErrorMessage } from "@/lib/admin/api-client";
import { FRESHNESS_RESOLUTIONS, FRESHNESS_RESOLUTION_LABELS, type FreshnessResolution } from "@/lib/admin/seo-rules";
import { QUESTION_COUNT, type CitationTally } from "@/lib/seo/ai-citation";
import type { SeoOverview } from "@/lib/server/seo/admin";
import { ErrorSummary, StatusNote } from "./fields";
import { DataTable, EmptyNote, MONO, OUTLINE_BUTTON, Panel, TD, TEXT_LINK, ToneChip } from "./ui";
import { useHydrated } from "./useHydrated";

// 검색 최적화 화면 (W7 - OPT-01·07·08·09, docs/dev/W7_설계.md). 점수·순위 예측 문구 없음 - 색인 관문 상태, 신선도 검수, 사람이 입력하는 AI 검색 표본만.
const INPUT = "min-h-11 w-full rounded-lg border border-navy-200 bg-white px-3 text-[15px] text-navy-900";
const STAGE_LABELS: Record<string, string> = { promulgated: "공포", effective: "시행" };
const percent = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 1000) / 10}%`);
const when = (iso: string) => iso.slice(0, 16).replace("T", " ");

function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-[14px] font-bold text-navy-800">
      {children}
    </label>
  );
}

/** 쓰기 한 번 - 성공하면 화면을 다시 읽는다 */
function useOp() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<{ title: string; details: string[] } | null>(null);
  const [done, setDone] = useState("");
  async function run(body: Record<string, unknown>, doneText: string): Promise<boolean> {
    setPending(true);
    setProblem(null);
    setDone("");
    const r = await adminApi("POST", "/api/admin/seo", body);
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

function OpNotes({ op }: { op: ReturnType<typeof useOp> }) {
  return (
    <>
      {op.problem && <ErrorSummary title={op.problem.title} messages={op.problem.details} />}
      {op.done && <StatusNote>{op.done}</StatusNote>}
    </>
  );
}

function GateSection({ gate }: { gate: SeoOverview["gate"] }) {
  const rows: [string, string][] = [
    ["SITE_INDEXING", gate.siteIndexing ? "on" : "off"],
    ["사이트 주소", gate.site ?? "없음"],
    ["일반 검색 크롤러", `${gate.searchCrawlers}개 등록`],
    ["AI 학습 크롤러 정책", gate.aiDecided ? "정함" : "아직 정하지 않음"],
    ["IndexNow 전송", gate.indexnow ? "켜짐" : "꺼짐"],
  ];
  return (
    <Panel id="seo-gate" title="색인 전환 점검" description="SITE_INDEXING=on 전환 전 확인합니다. 아래 조건이 하나라도 빠지면 robots.txt는 전체 차단이고 사이트맵·RSS는 열리지 않습니다 (OPT-08 · SEO-04).">
      <p className="mb-3 flex items-center gap-2 text-[15px]">
        <ToneChip tone={gate.open ? "emerald" : "amber"}>{gate.open ? "열림" : "닫힘"}</ToneChip>
        <span data-testid="gate-state">{gate.open ? "사이트맵·RSS·robots.txt가 열려 있습니다" : "색인 관문이 닫혀 있습니다"}</span>
      </p>
      <DataTable caption="색인 관문 조건" head={["항목", "지금 값"]}>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td className={TD}>{k}</td>
            <td className={TD}>{v}</td>
          </tr>
        ))}
      </DataTable>
      {gate.problems.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-[14px] text-navy-700" data-testid="gate-problems">
          {gate.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[14px] text-navy-600">
        크롤러 정책·IndexNow는 <Link href="/admin/settings" className={TEXT_LINK}>설정</Link>(관리자)에서 바꿉니다. 소유 확인·사이트맵 제출 기록은 전환 체크리스트에서 사람이 확인합니다.
      </p>
    </Panel>
  );
}

function FreshnessRow({ item }: { item: SeoOverview["freshness"]["open"][number] }) {
  const op = useOp();
  const hydrated = useHydrated();
  const [resolution, setResolution] = useState<FreshnessResolution>("no_change");
  const [note, setNote] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void op.run({ op: "freshness_resolve", id: item.id, resolution, note }, "처리했습니다");
  };
  const base = `fresh-${item.id}`;
  return (
    <li className="rounded-xl border border-navy-100 bg-white p-4" data-freshness-id={item.id}>
      <p className="text-[15px] font-bold text-navy-900">
        {item.article ? <Link href={`/admin/articles/${item.article.id}`} className={TEXT_LINK}>{item.article.title}</Link> : "삭제된 기사"}
      </p>
      <p className="mt-1 text-[14px] text-navy-600">
        {item.amendmentTitle ?? "개정"} · {STAGE_LABELS[item.eventStage ?? ""] ?? item.eventStage} 기록 {item.occurredOn ?? ""} · 큐 등록 {when(item.createdAt)}
      </p>
      <form onSubmit={submit} className="mt-3 grid gap-3 md:grid-cols-[16rem_1fr_auto] md:items-end">
        <div>
          <Label htmlFor={`${base}-res`}>처리 결과</Label>
          <select id={`${base}-res`} className={INPUT} value={resolution} onChange={(e) => setResolution(e.target.value as FreshnessResolution)}>
            {FRESHNESS_RESOLUTIONS.map((r) => (
              <option key={r} value={r}>{FRESHNESS_RESOLUTION_LABELS[r]}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor={`${base}-note`}>처리 사유</Label>
          <input id={`${base}-note`} className={INPUT} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </div>
        <DarkButton type="submit" disabled={op.pending || !hydrated}>{op.pending ? "처리 중" : "처리"}</DarkButton>
      </form>
      <OpNotes op={op} />
    </li>
  );
}

function FreshnessSection({ freshness }: { freshness: SeoOverview["freshness"] }) {
  return (
    <Panel id="seo-freshness" title="신선도 검수" description="개정 트래커에 ‘공포’·‘시행’ 단계가 기록되면 그 개정을 단 공개 기사가 여기 올라오고 기사에 ‘검토 중’이 보입니다. ‘변경 없음’으로 처리하면 기사의 수정일은 그대로입니다 (OPT-07).">
      {freshness.open.length === 0 ? (
        <EmptyNote>검수할 기사가 없습니다.</EmptyNote>
      ) : (
        <ul className="space-y-3" data-testid="freshness-open">
          {freshness.open.map((i) => (
            <FreshnessRow key={i.id} item={i} />
          ))}
        </ul>
      )}
      {freshness.recent.length > 0 && (
        <div className="mt-6">
          <DataTable caption="최근 처리한 신선도 검수" head={["기사", "결과", "사유", "처리 시각"]}>
            {freshness.recent.map((i) => (
              <tr key={i.id}>
                <td className={TD}>{i.article?.title ?? "삭제된 기사"}</td>
                <td className={TD}>{i.resolution ? FRESHNESS_RESOLUTION_LABELS[i.resolution as FreshnessResolution] ?? i.resolution : ""}</td>
                <td className={TD}>{i.note}</td>
                <td className={TD}>{i.resolvedAt ? when(i.resolvedAt) : ""}</td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
    </Panel>
  );
}

function TallyLine({ tally }: { tally: CitationTally }) {
  return (
    <p className="text-[15px] text-navy-800" data-testid="citation-tally">
      인용률 <strong>{percent(tally.rate)}</strong> = 인용 {tally.yes} ÷ 확인한 칸 {tally.checked} (인용 아님 {tally.no}, 미확인 {tally.unknown} - 인용 0으로 세지 않음)
    </p>
  );
}

function SampleRow({ s }: { s: SeoOverview["ai"]["samples"][number] & { question: string } }) {
  const op = useOp();
  const hydrated = useHydrated();
  const [cited, setCited] = useState(s.cited);
  const [url, setUrl] = useState(s.citedUrl ?? "");
  const save = (e: FormEvent) => {
    e.preventDefault();
    void op.run({ op: "sample_set", id: s.id, cited, ...(url.trim() ? { cited_url: url.trim() } : {}), ...(s.expectedPage ? { expected_page: s.expectedPage } : {}) }, "저장했습니다");
  };
  const base = `sample-${s.id}`;
  return (
    <tr data-sample-id={s.id}>
      <td className={TD}>{s.questionNo}</td>
      <td className={TD}>{s.question}</td>
      <td className={TD}>{s.engine}</td>
      <td className={TD} colSpan={2}>
        <form onSubmit={save} className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor={`${base}-c`}>인용</Label>
            <select id={`${base}-c`} className={INPUT} value={cited} onChange={(e) => setCited(e.target.value)}>
              <option value="unknown">미확인</option>
              <option value="yes">인용됨</option>
              <option value="no">인용 안 됨</option>
            </select>
          </div>
          <div className="min-w-48 flex-1">
            <Label htmlFor={`${base}-u`}>인용된 주소</Label>
            <input id={`${base}-u`} className={INPUT} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </div>
          <button type="submit" className={OUTLINE_BUTTON} disabled={op.pending || !hydrated}>저장</button>
        </form>
        <OpNotes op={op} />
      </td>
    </tr>
  );
}

function AiSection({ ai }: { ai: SeoOverview["ai"] }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const save = useOp();
  const activate = useOp();
  const init = useOp();
  const [text, setText] = useState("");
  const [activateNow, setActivateNow] = useState(true);
  const [engines, setEngines] = useState("");
  const [month, setMonth] = useState(ai.month);
  const questionText = new Map(ai.questions.map((q) => [q.no, q.text]));
  return (
    <Panel
      id="seo-ai"
      title="AI 검색 표본"
      description={`핵심 질문 ${QUESTION_COUNT}개를 AI 답변 엔진에 직접 물어 우리 페이지가 인용되는지 사람이 확인해 넣습니다. 자동 조회는 없습니다 (OPT-09).`}
    >
      <h3 className="text-[16px] font-black text-navy-900">핵심 질문 목록</h3>
      {ai.sets.length === 0 ? (
        <EmptyNote>등록한 질문 목록이 없습니다. 아래에 {QUESTION_COUNT}문항을 한 줄에 하나씩 붙여 넣으세요.</EmptyNote>
      ) : (
        <DataTable caption="질문 목록 버전" head={["버전", "문항 수", "상태", ""]}>
          {ai.sets.map((s) => (
            <tr key={s.version}>
              <td className={TD}>{s.version}</td>
              <td className={TD}>{s.questions}</td>
              <td className={TD}>{s.activatedAt ? <ToneChip tone="emerald">활성화 {when(s.activatedAt)}</ToneChip> : <ToneChip tone="amber">작성 중</ToneChip>}</td>
              <td className={TD}>
                {!s.activatedAt && (
                  <button type="button" className={OUTLINE_BUTTON} disabled={activate.pending || !hydrated} onClick={() => void activate.run({ op: "questions_activate", version: s.version }, "활성화했습니다")}>
                    활성화
                  </button>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      )}
      <OpNotes op={activate} />
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run({ op: "questions_save", text, activate: activateNow }, "새 버전을 저장했습니다").then((ok) => ok && setText(""));
        }}
      >
        <div>
          <Label htmlFor="questions-text">새 질문 목록 (한 줄에 한 문항, 정확히 {QUESTION_COUNT}개)</Label>
          <textarea id="questions-text" className={`${INPUT} min-h-40 py-2`} rows={8} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-[15px] text-navy-800">
          <input type="checkbox" checked={activateNow} onChange={(e) => setActivateNow(e.target.checked)} /> 저장하면서 활성화 (활성화한 목록은 고칠 수 없고 새 버전으로만 바꿉니다)
        </label>
        <DarkButton type="submit" disabled={save.pending || !hydrated}>{save.pending ? "저장 중" : "질문 목록 저장"}</DarkButton>
        <OpNotes op={save} />
      </form>

      <h3 className="mt-8 text-[16px] font-black text-navy-900">월 표본</h3>
      {ai.activeVersion === null ? (
        <EmptyNote>활성화된 질문 목록이 있어야 표본을 만들 수 있습니다.</EmptyNote>
      ) : (
        <>
          <form
            className="mt-2 grid gap-3 md:grid-cols-[10rem_1fr_auto] md:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void init.run({ op: "samples_init", month, version: ai.activeVersion, engines }, "표본 칸을 만들었습니다 (이미 있는 칸은 그대로)");
            }}
          >
            <div>
              <Label htmlFor="sample-month">달 (YYYY-MM)</Label>
              <input id="sample-month" className={INPUT} value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="sample-engines">확인할 AI 답변 엔진 (쉼표로 구분)</Label>
              <input id="sample-engines" className={INPUT} value={engines} onChange={(e) => setEngines(e.target.value)} />
            </div>
            <DarkButton type="submit" disabled={init.pending || !hydrated}>표본 칸 만들기</DarkButton>
          </form>
          <OpNotes op={init} />
          <div className="mt-3 flex items-center gap-2">
            <button type="button" className={OUTLINE_BUTTON} onClick={() => router.push(`/admin/seo?month=${encodeURIComponent(month)}`)}>그 달 보기</button>
            <span className={`text-navy-600 ${MONO}`}>보는 달 {ai.month} · 질문 버전 {ai.activeVersion}</span>
          </div>
          {ai.samples.length === 0 ? (
            <EmptyNote>이 달 표본 칸이 없습니다.</EmptyNote>
          ) : (
            <div className="mt-4 space-y-3">
              <TallyLine tally={ai.tally} />
              <ul className="text-[14px] text-navy-700">
                {ai.byEngine.map((e) => (
                  <li key={e.engine}>{e.engine}: 인용률 {percent(e.tally.rate)} ({e.tally.yes} ÷ {e.tally.checked}, 미확인 {e.tally.unknown})</li>
                ))}
              </ul>
              <DataTable caption="월 표본" head={["번호", "질문", "엔진", "인용 확인", ""]}>
                {ai.samples.map((s) => (
                  <SampleRow key={s.id} s={{ ...s, question: questionText.get(s.questionNo) ?? "" }} />
                ))}
              </DataTable>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function RunsSection({ runs }: { runs: SeoOverview["runs"] }) {
  return (
    <Panel id="seo-runs" title="최근 배치 실행" description="서치 콘솔 수집·IndexNow 전송·월 마감. 설정이 없으면 ‘건너뜀’으로 끝납니다 (실패 아님).">
      {runs.length === 0 ? (
        <EmptyNote>아직 실행 기록이 없습니다.</EmptyNote>
      ) : (
        <DataTable caption="배치 실행 기록" head={["작업", "상태", "시작", "결과"]}>
          {runs.map((r, i) => (
            <tr key={`${r.job}-${r.startedAt}-${i}`}>
              <td className={TD}>{r.job}</td>
              <td className={TD}>{r.status}</td>
              <td className={TD}>{when(r.startedAt)}</td>
              <td className={TD}>{r.error ?? JSON.stringify(r.detail ?? {})}</td>
            </tr>
          ))}
        </DataTable>
      )}
    </Panel>
  );
}

export function SeoView({ data }: { data: SeoOverview }) {
  return (
    <div className="space-y-8">
      <Callout>
        <span data-part="notice">점수는 내부 품질 지표입니다. 이 화면의 숫자는 색인 준비 상태와 사람이 확인한 표본이며 검색 결과를 약속하지 않습니다.</span>
      </Callout>
      <GateSection gate={data.gate} />
      <FreshnessSection freshness={data.freshness} />
      <AiSection ai={data.ai} />
      <RunsSection runs={data.runs} />
    </div>
  );
}
