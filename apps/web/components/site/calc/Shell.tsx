"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Chip, Eyebrow, PrimaryButton, SecondaryButton } from "@ltr/ui";
import { CALC_COPY } from "@/lib/calc/copy";
import { encodeHash, parseHash } from "@/lib/calc/hash";
import { applicable, flowProgress, isAnswerValid, pendingQuestion, type Question } from "@/lib/calc/shared";
import { QuestionField, needsNext } from "./fields";

// 계산기 껍데기 (CALC-11) - 질문형(한 화면 질문 하나, 진행 막대, 큰 선택지, 모르겠어요는 마지막, 이전)과 [한 화면에 모두 입력]을 한 상태로 오간다.
// 답은 이 컴포넌트의 메모리에만 있다: 브라우저 저장소·쿠키·서버 전송 0, 새로고침하면 사라진다. 두 방식이 같은 폼 상태 -> 같은 build 함수로 같은 엔진 입력을 만든다.
// URL 해시(#)는 서버로 가지 않는다: 기사에서 넘어온 값(GROW-02)은 질문마다 "기사에서 가져온 값"으로 보이고 바꿀 수 있으며, 결과 링크 복사(CALC-06)도 해시만 만든다.

type Rec = Record<string, unknown>;
const toSet = (s: ReadonlySet<string>, id: string, on: boolean): ReadonlySet<string> => {
  const next = new Set(s);
  if (on) next.add(id);
  else next.delete(id);
  return next;
};
const omit = (r: Rec, id: string): Rec => {
  const next = { ...r };
  delete next[id];
  return next;
};

export interface ShellProps<F extends object> {
  eyebrow: string;
  title: string;
  /** 해시의 도구 이름 (t=) */
  tool: string;
  /** 지금 적용 중인 룰셋 버전 - 공유 링크가 만들어질 때의 버전과 다르면 안내한다 */
  rulesetVersion: string | null;
  /** 장애 폴백 등 화면 위 안내 한 줄 (CALC-08) */
  notice?: string | null;
  /** 지역 코드 -> 허브 주소 (REG1-10) - 해시의 region으로 돌아가기 링크만 만든다. 엔진 입력에는 쓰지 않는다 */
  regionLinks?: Record<string, { name: string; href: string }>;
  questions: readonly Question<F>[];
  initial: F;
  /** 결과를 그릴 수 있나 (필수 값이 모두 있거나, 계산이 필요 없는 답) */
  ready: (form: F, unknown: ReadonlySet<string>) => boolean;
  /** 질문 흐름을 멈추고 대신 보일 것 (예: 아직 공개하지 않은 취득 원인) */
  blocked?: (form: F) => ReactNode | null;
  result: (form: F, unknown: ReadonlySet<string>) => ReactNode;
}

function FlowStep<F extends object>({ q, progress, prefilled, onAnswer, onUnknown, onPrev, canPrev }: { q: Question<F>; progress: { n: number; total: number }; prefilled: unknown; onAnswer: (v: unknown) => void; onUnknown: () => void; onPrev: () => void; canPrev: boolean }) {
  const [draft, setDraft] = useState<unknown>(prefilled);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    box.current?.querySelector<HTMLElement>("button, input")?.focus();
  }, [q.id]);
  const valid = isAnswerValid(q, draft);
  return (
    <div ref={box} data-part="flow-step" data-question={q.id}>
      <div className="flex items-center gap-3">
        <div role="progressbar" aria-valuemin={1} aria-valuemax={progress.total} aria-valuenow={progress.n} aria-label="진행" className="h-2 flex-1 rounded-full bg-navy-100">
          <div className="h-2 rounded-full bg-hermes-500" style={{ width: `${(progress.n / progress.total) * 100}%` }} />
        </div>
        <span data-part="progress-text" className="font-mono text-[13px] text-navy-600">
          {progress.n}/{progress.total}
        </span>
      </div>
      <h2 className="mt-6 text-[22px] font-black leading-tight text-navy-900">{q.text}</h2>
      {prefilled !== undefined && (
        <p className="mt-2" data-part="prefilled">
          <Chip>기사에서 가져온 값</Chip>
        </p>
      )}
      {q.help && <p className="mt-2 text-[15px] text-navy-700">{q.help}</p>}
      <div className="mt-5">
        <QuestionField q={q} value={needsNext(q) ? draft : prefilled} onChange={needsNext(q) ? setDraft : onAnswer} inputId={id} />
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {needsNext(q) && (
          <PrimaryButton type="button" disabled={!valid} onClick={() => onAnswer(draft)}>
            다음
          </PrimaryButton>
        )}
        {/* 모르겠어요는 항상 마지막 */}
        {q.canDontKnow && (
          <SecondaryButton type="button" onClick={onUnknown}>
            {CALC_COPY.dontKnow}
          </SecondaryButton>
        )}
        {canPrev && (
          <button type="button" onClick={onPrev} className="min-h-11 px-2 text-[15px] font-bold text-navy-700 underline underline-offset-4">
            {CALC_COPY.prev}
          </button>
        )}
      </div>
    </div>
  );
}

export function CalculatorShell<F extends object>({ eyebrow, title, tool, rulesetVersion, notice = null, regionLinks = {}, questions, initial, ready, blocked, result }: ShellProps<F>) {
  const [form, setForm] = useState<F>(initial);
  const [unknown, setUnknown] = useState<ReadonlySet<string>>(new Set());
  const [mode, setMode] = useState<"flow" | "all">("flow");
  const [submitted, setSubmitted] = useState(false);
  const [prefill, setPrefill] = useState<Rec>({});
  const [sharedVersion, setSharedVersion] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [region, setRegion] = useState<string | null>(null);
  const none: ReadonlySet<string> = new Set();

  // 주소의 해시(#)에서 넘어온 값 - 서버로 가지 않는다. 처음 한 번만 읽는다
  useEffect(() => {
    // 브라우저의 주소 해시는 서버 렌더에 없는 바깥 값이라 마운트 뒤에 한 번 읽는다
    const h = parseHash(window.location.hash, questions);
    /* eslint-disable react-hooks/set-state-in-effect */
    if (h.ids.length > 0) setPrefill(h.values);
    if (h.version) setSharedVersion(h.version);
    if (h.region) setRegion(h.region);
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const answer = (id: string, v: unknown) => {
    setForm((f) => ({ ...f, [id]: v }));
    setUnknown((u) => toSet(u, id, false));
    setPrefill((p) => omit(p, id));
  };
  const dontKnow = (id: string) => {
    setForm((f) => omit(f as Rec, id) as F);
    setUnknown((u) => toSet(u, id, true));
    setPrefill((p) => omit(p, id));
  };
  const resolvedIds = () => applicable(questions, form).filter((q) => unknown.has(q.id) || isAnswerValid(q, (form as Rec)[q.id])).map((q) => q.id);
  const goBack = () => {
    const last = resolvedIds().at(-1);
    if (!last) return;
    setForm((f) => omit(f as Rec, last) as F);
    setUnknown((u) => toSet(u, last, false));
  };
  const reset = () => {
    setForm(initial);
    setUnknown(new Set());
    setSubmitted(false);
    setPrefill({});
  };
  const toggleMode = () => {
    if (mode === "flow") {
      // 가져온 값은 전체 폼의 기본값이 된다(바꿀 수 있다)
      setForm((f) => ({ ...prefill, ...f }) as F);
      setPrefill({});
    }
    setMode(mode === "flow" ? "all" : "flow");
  };
  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}${encodeHash(tool, rulesetVersion, form as Rec, questions)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const stop = blocked?.(form) ?? null;
  const pending = pendingQuestion(questions, form, unknown, none);
  const canShow = !stop && ready(form, unknown);
  const showResult = canShow && (mode === "flow" ? !pending : submitted);
  const mismatch = sharedVersion !== null && rulesetVersion !== null && sharedVersion !== rulesetVersion;

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-8" data-ui="calculator" data-mode={mode}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="mt-2 text-[28px] font-black text-navy-900">{title}</h1>
      {notice && (
        <p data-part="calc-notice" role="status" className="mt-2 text-[14px] text-navy-700">
          {notice}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-3 print:hidden">
        <button type="button" data-part="mode-toggle" onClick={toggleMode} className="min-h-11 text-[15px] font-bold text-navy-700 underline underline-offset-4">
          {mode === "flow" ? CALC_COPY.modeAll : CALC_COPY.modeFlow}
        </button>
        {(Object.keys(form).length > 0 || unknown.size > 0) && (
          <button type="button" onClick={reset} className="min-h-11 text-[15px] font-bold text-navy-700 underline underline-offset-4">
            처음부터 다시
          </button>
        )}
      </div>

      <div className="mt-6 print:hidden">
        {mode === "flow" ? (
          stop ? (
            <>
              {stop}
              <button type="button" onClick={goBack} className="mt-4 min-h-11 px-2 text-[15px] font-bold text-navy-700 underline underline-offset-4">
                {CALC_COPY.prev}
              </button>
            </>
          ) : pending ? (
            <FlowStep key={pending.id} q={pending} progress={flowProgress(questions, form, unknown, none)} prefilled={prefill[pending.id]} onAnswer={(v) => answer(pending.id, v)} onUnknown={() => dontKnow(pending.id)} onPrev={goBack} canPrev={resolvedIds().length > 0} />
          ) : null
        ) : (
          <form
            data-part="full-form"
            onSubmit={(e) => {
              e.preventDefault();
              setSubmitted(true);
            }}
            className="space-y-6"
          >
            {applicable(questions, form).map((q) => (
              <div key={q.id} data-question={q.id}>
                <p className="text-[16px] font-bold text-navy-900">{q.text}</p>
                {q.help && <p className="mt-1 text-[14px] text-navy-700">{q.help}</p>}
                <div className="mt-2">
                  <QuestionField q={q} value={(form as Rec)[q.id]} onChange={(v) => answer(q.id, v)} inputId={`all-${q.id}`} />
                </div>
                {q.canDontKnow && (
                  <label className="mt-2 flex min-h-11 items-center gap-2 text-[15px] text-navy-700">
                    <input type="checkbox" checked={unknown.has(q.id)} onChange={(e) => (e.target.checked ? dontKnow(q.id) : setUnknown((u) => toSet(u, q.id, false)))} className="h-5 w-5" />
                    {CALC_COPY.dontKnow}
                  </label>
                )}
              </div>
            ))}
            {stop}
            <PrimaryButton type="submit">계산하기</PrimaryButton>
          </form>
        )}
      </div>

      {mismatch && (
        <p data-part="ruleset-mismatch" role="status" className="mt-6 text-[14px] font-bold text-navy-800">
          계산할 때와 룰셋이 달라요 · 지금 적용 룰셋은 {rulesetVersion}예요
        </p>
      )}
      {showResult && (
        <div className="mt-8">
          {result(form, unknown)}
          <div className="mt-6 flex flex-wrap items-center gap-3 print:hidden">
            <SecondaryButton type="button" data-part="share-copy" onClick={copyLink}>
              결과 링크 복사
            </SecondaryButton>
            <SecondaryButton type="button" data-part="print" onClick={() => window.print()}>
              인쇄하기
            </SecondaryButton>
            {copied && (
              <span role="status" className="text-[14px] text-navy-700">
                복사했어요 · 링크에는 입력한 값이 들어 있어요
              </span>
            )}
          </div>
        </div>
      )}
      {region && regionLinks[region] && (
        <p data-part="region-back" className="mt-6 print:hidden">
          <a href={regionLinks[region].href} className="inline-flex min-h-11 items-center font-bold text-navy-900 underline underline-offset-4">
            {regionLinks[region].name} 지자체 허브로 돌아가기
          </a>
        </p>
      )}
      <p data-part="never-saved" className="mt-8 text-[13px] text-navy-500 print:hidden">
        {CALC_COPY.neverSaved}
      </p>
    </div>
  );
}
