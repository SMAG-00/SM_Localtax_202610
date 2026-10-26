"use client";

import { useId, useState, type ReactNode } from "react";
import { calcGift, calcInheritance, type GiftResult, type InheritanceResult } from "@ltr/igt-engine";
import type { IgtRuleset } from "@ltr/igt-engine";
import {
  buildGiftInput,
  buildInheritanceInput,
  GIFT_FORM_EMPTY,
  INHERITANCE_FORM_EMPTY,
  type GiftForm,
  type InheritanceForm,
} from "@/lib/igt/form";

// 상속·증여세 계산기 (FAM-10·11) - 계산은 이 브라우저 안에서만 한다.
//  · 입력은 이 컴포넌트의 메모리(useState)에만 있다: 서버 전송·분석 이벤트·주소·브라우저 저장소·쿠키 0, 새로고침하면 사라진다.
//  · 세율·공제·한도는 서버가 내려 준 서명된 활성 룰셋 값이다 (이 파일에 세율 숫자 없음).
//  · 지방세 금액과 합치지 않는다 - 이 화면에는 지방세 금액이 없다.

const won = (n: number) => `${Math.trunc(n).toLocaleString("ko-KR")}원`;

function Field({ label, children, hint }: { label: string; children: (id: string) => ReactNode; hint?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[14px] font-bold text-navy-900">
        {label}
      </label>
      {children(id)}
      {hint ? <span className="text-[12px] text-navy-500">{hint}</span> : null}
    </div>
  );
}
const inputCls = "h-11 rounded-md border border-navy-200 px-3 text-[15px] text-navy-900";

function Text({ label, value, onChange, hint, inputMode = "numeric" }: { label: string; value: string; onChange: (v: string) => void; hint?: string; inputMode?: "numeric" | "text" | "decimal" }) {
  return (
    <Field label={label} hint={hint}>
      {(id) => <input id={id} className={inputCls} inputMode={inputMode} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input id={id} type="checkbox" className="h-5 w-5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id} className="text-[14px] text-navy-900">
        {label}
      </label>
    </div>
  );
}

type AnyResult = GiftResult | InheritanceResult;

function ResultView({ result, kind, rulesetVersion, engineHash }: { result: AnyResult; kind: "gift" | "inheritance"; rulesetVersion: string; engineHash: string }) {
  const p = result.payment;
  const sched = p.annual_installment_schedule;
  return (
    <section data-part="igt-result" aria-live="polite" className="mt-8 rounded-lg border border-navy-200 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span data-part="national-badge" className="rounded-full bg-navy-100 px-3 py-1 text-[12px] font-bold text-navy-900">
          국세
        </span>
        <h2 className="text-[20px] font-black text-navy-900">{kind === "gift" ? "증여세" : "상속세"} 계산 결과</h2>
      </div>
      <p className="mt-3 text-[28px] font-black text-navy-900" data-part="igt-final">
        <span className="sr-only">자진납부세액 </span>
        {won(result.final_tax)}
      </p>
      <p className="text-[13px] text-navy-500">신고 기준 자진납부세액 · 신고기한 {result.filing_due} ({result.filing_due_basis})</p>
      <ol className="mt-5 flex flex-col gap-3" data-part="igt-steps">
        {result.steps.map(([name, amount, desc, basis], i) => (
          <li key={i} className="border-b border-navy-100 pb-3">
            <div className="flex justify-between gap-3 text-[15px] font-bold text-navy-900">
              <span>{name}</span>
              <span>{won(amount)}</span>
            </div>
            <div className="text-[13px] text-navy-500">{desc}</div>
            <div className="text-[12px] text-navy-400">{basis}</div>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-col gap-2 text-[14px] text-navy-900" data-part="igt-payment">
        <h3 className="font-bold">납부 방법 안내</h3>
        {p.installment ? <p>{p.installment}</p> : null}
        {p.annual_installment ? <p>{p.annual_installment}</p> : null}
        {p.payment_in_kind_hint ? <p>{p.payment_in_kind_hint}</p> : null}
        {p.payment_in_kind_detail ? <p>{p.payment_in_kind_detail}</p> : null}
        {!p.installment && !p.annual_installment && !p.payment_in_kind_hint ? <p>이 세액에는 분납·연부연납 안내 대상이 없습니다.</p> : null}
        {sched ? (
          <table className="mt-2 w-full text-left text-[13px]">
            <caption className="text-left font-bold">연부연납 스케줄 ({sched.years}년, {sched.installments}회)</caption>
            <thead>
              <tr>
                <th scope="col">회차</th>
                <th scope="col">납부기한</th>
                <th scope="col">본세</th>
                <th scope="col">가산금</th>
                <th scope="col">납부액</th>
              </tr>
            </thead>
            <tbody>
              {sched.rows.map((r) => (
                <tr key={r.no}>
                  <td>{r.no}</td>
                  <td>{r.due}</td>
                  <td>{won(r.principal)}</td>
                  <td>{won(r.surcharge)}</td>
                  <td>{won(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
      {result.warnings.length ? (
        <div className="mt-5" data-part="igt-warnings">
          <h3 className="text-[14px] font-bold text-navy-900">확인 필요·단순화 고지</h3>
          <ul className="mt-1 list-disc pl-5 text-[13px] text-navy-500">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-5 text-[12px] text-navy-500" data-part="igt-stamp">
        적용 룰셋 {rulesetVersion} · 계산 엔진 {engineHash.slice(0, 8)}
      </p>
    </section>
  );
}

function Notice() {
  return (
    <div className="mt-3 rounded-md bg-navy-50 p-4 text-[13px] text-navy-700" data-part="igt-notice">
      <p>참고용 계산입니다. 실제 신고·납부는 국세청 안내를 따르고, 개별 사안은 세무 전문가와 확인하세요. 이 금액은 지방세 금액과 합산하지 않습니다.</p>
      <p className="mt-1">입력한 값은 이 화면(브라우저)에만 있고 저장하거나 전송하지 않습니다. 새로고침하면 사라집니다.</p>
    </div>
  );
}

function Actions({ onCalc, onReset, errors }: { onCalc: () => void; onReset: () => void; errors: string[] }) {
  return (
    <div className="mt-6">
      {errors.length ? (
        <ul role="alert" className="mb-3 list-disc pl-5 text-[13px] text-navy-900" data-part="igt-errors">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-3">
        <button type="button" onClick={onCalc} className="h-11 rounded-md bg-navy-900 px-6 text-[15px] font-bold text-white">
          계산하기
        </button>
        <button type="button" onClick={onReset} className="h-11 rounded-md border border-navy-200 px-6 text-[15px] text-navy-900">
          입력 지우기
        </button>
      </div>
    </div>
  );
}

export interface IgtCalculatorProps {
  kind: "gift" | "inheritance";
  ruleset: IgtRuleset;
  rulesetVersion: string;
  engineHash: string;
}

export function IgtCalculator({ kind, ruleset, rulesetVersion, engineHash }: IgtCalculatorProps) {
  const [gift, setGift] = useState<GiftForm>(GIFT_FORM_EMPTY);
  const [inh, setInh] = useState<InheritanceForm>(INHERITANCE_FORM_EMPTY);
  const [result, setResult] = useState<AnyResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const run = () => {
    setResult(null);
    const built = kind === "gift" ? buildGiftInput(gift) : buildInheritanceInput(inh);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    try {
      setErrors([]);
      setResult(kind === "gift" ? calcGift(built.input, ruleset) : calcInheritance(built.input, ruleset));
    } catch (e) {
      setErrors([e instanceof Error && e.name === "IgtCalcError" ? e.message : "계산할 수 없는 입력입니다. 값을 다시 확인하세요."]);
    }
  };
  const reset = () => {
    setGift(GIFT_FORM_EMPTY);
    setInh(INHERITANCE_FORM_EMPTY);
    setResult(null);
    setErrors([]);
  };
  const g = (patch: Partial<GiftForm>) => setGift((s) => ({ ...s, ...patch }));
  const h = (patch: Partial<InheritanceForm>) => setInh((s) => ({ ...s, ...patch }));

  return (
    <div className="mx-auto w-full max-w-[860px] px-4 py-10" data-part="igt-calculator" data-kind={kind}>
      <p className="text-[13px] font-bold text-navy-500">국세 · 브라우저 계산</p>
      <h1 className="text-[28px] font-black text-navy-900">{kind === "gift" ? "증여세 계산" : "상속세 계산"}</h1>
      <Notice />
      <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()}>
        {kind === "gift" ? (
          <>
            <Field label="증여일">{(id) => <input id={id} type="date" className={inputCls} value={gift.giftDate} onChange={(e) => g({ giftDate: e.target.value })} />}</Field>
            <Field label="증여자와의 관계">
              {(id) => (
                <select id={id} className={inputCls} value={gift.relationship} onChange={(e) => g({ relationship: e.target.value })}>
                  <option value="lineal_ascendant">직계존속(부모·조부모 등)</option>
                  <option value="lineal_descendant">직계비속(자녀·손자녀 등)</option>
                  <option value="spouse">배우자</option>
                  <option value="other_relative">기타 친족</option>
                  <option value="unrelated">친족 아님</option>
                </select>
              )}
            </Field>
            <Text label="증여재산가액(원)" value={gift.giftValue} onChange={(v) => g({ giftValue: v })} />
            <Text label="10년 내 이미 쓴 증여재산공제(원)" value={gift.deductionUsed} onChange={(v) => g({ deductionUsed: v })} />
            <Text label="10년 내 같은 증여자에게 받은 증여 합계(원)" value={gift.priorValue} onChange={(v) => g({ priorValue: v })} />
            <Text label="그 증여로 이미 낸 산출세액(원)" value={gift.priorTax} onChange={(v) => g({ priorTax: v })} />
            <Text label="연부연납 희망 연수(선택)" value={gift.annualYears} onChange={(v) => g({ annualYears: v })} />
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Check label="받는 사람이 미성년자" checked={gift.minor} onChange={(v) => g({ minor: v })} />
              <Check label="받는 사람이 거주자" checked={gift.resident} onChange={(v) => g({ resident: v })} />
              <Check label="혼인·출산 증여재산공제를 적용받음" checked={gift.marriageBirth} onChange={(v) => g({ marriageBirth: v })} />
              {gift.marriageBirth ? <Text label="이미 쓴 혼인·출산 공제(원)" value={gift.marriageBirthUsed} onChange={(v) => g({ marriageBirthUsed: v })} /> : null}
              <Check label="세대를 건너뛴 증여(자녀가 아닌 직계비속)" checked={gift.generationSkip} onChange={(v) => g({ generationSkip: v })} />
              <Check label="기한 내에 신고함" checked={gift.filedOnTime} onChange={(v) => g({ filedOnTime: v })} />
            </div>
          </>
        ) : (
          <>
            <Field label="상속개시일(사망일)">{(id) => <input id={id} type="date" className={inputCls} value={inh.deathDate} onChange={(e) => h({ deathDate: e.target.value })} />}</Field>
            <Text label="부동산(원)" value={inh.realEstate} onChange={(v) => h({ realEstate: v })} />
            <Text label="금융재산(원)" value={inh.financial} onChange={(v) => h({ financial: v })} />
            <Text label="유가증권(원)" value={inh.securities} onChange={(v) => h({ securities: v })} />
            <Text label="그 밖의 재산(원)" value={inh.otherAssets} onChange={(v) => h({ otherAssets: v })} />
            <Text label="간주상속재산: 보험금·신탁·퇴직금(원)" value={inh.deemed} onChange={(v) => h({ deemed: v })} />
            <Text label="채무(원)" value={inh.debts} onChange={(v) => h({ debts: v })} />
            <Text label="공과금(원)" value={inh.charges} onChange={(v) => h({ charges: v })} />
            <Text label="장례비(원)" value={inh.funeral} onChange={(v) => h({ funeral: v })} />
            <Text label="자녀 수" value={inh.childrenCount} onChange={(v) => h({ childrenCount: v })} />
            <Text label="미성년 자녀 나이(쉼표로 구분)" value={inh.minorAges} onChange={(v) => h({ minorAges: v })} inputMode="text" />
            <Text label="65세 이상 상속인·동거가족 수" value={inh.elderlyCount} onChange={(v) => h({ elderlyCount: v })} />
            <Text label="배우자가 실제 상속받는 금액(원)" value={inh.spouseActual} onChange={(v) => h({ spouseActual: v })} />
            <Text label="순금융재산(원, 비우면 금융재산 사용)" value={inh.netFinancial} onChange={(v) => h({ netFinancial: v })} />
            <Text label="상속인 아닌 사람에게 유증한 재산(원)" value={inh.bequestsNonHeirs} onChange={(v) => h({ bequestsNonHeirs: v })} />
            <Text label="상속인에게 10년 내 증여한 재산(원)" value={inh.priorHeirsValue} onChange={(v) => h({ priorHeirsValue: v })} />
            <Text label="그 증여로 이미 낸 산출세액(원)" value={inh.priorHeirsTax} onChange={(v) => h({ priorHeirsTax: v })} />
            <Text label="상속인 아닌 사람에게 5년 내 증여한 재산(원)" value={inh.priorOthersValue} onChange={(v) => h({ priorOthersValue: v })} />
            <Text label="그 증여로 이미 낸 산출세액(원)" value={inh.priorOthersTax} onChange={(v) => h({ priorOthersTax: v })} />
            <Text label="동거주택 가액(담보채무 차감, 원)" value={inh.cohabitingValue} onChange={(v) => h({ cohabitingValue: v })} />
            <Text label="세대생략 할증 대상 재산 비율(0 초과 1 이하, 선택)" value={inh.skipShare} onChange={(v) => h({ skipShare: v })} inputMode="decimal" />
            <Text label="연부연납 희망 연수(선택)" value={inh.annualYears} onChange={(v) => h({ annualYears: v })} />
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Check label="피상속인이 거주자" checked={inh.resident} onChange={(v) => h({ resident: v })} />
              <Check label="배우자가 있음" checked={inh.spouseExists} onChange={(v) => h({ spouseExists: v })} />
              <Check label="동거주택 상속공제를 적용받음" checked={inh.cohabiting} onChange={(v) => h({ cohabiting: v })} />
              <Check label="가업상속공제를 적용받음(계산하지 않고 안내만)" checked={inh.familyBusiness} onChange={(v) => h({ familyBusiness: v })} />
              <Check label="할증 대상이 미성년 직계비속이면서 큰 재산" checked={inh.skipMinorOver} onChange={(v) => h({ skipMinorOver: v })} />
              <Check label="상속인이 외국에 주소를 둠" checked={inh.heirAbroad} onChange={(v) => h({ heirAbroad: v })} />
              <Check label="기한 내에 신고함" checked={inh.filedOnTime} onChange={(v) => h({ filedOnTime: v })} />
            </div>
          </>
        )}
      </form>
      <Actions onCalc={run} onReset={reset} errors={errors} />
      {result ? <ResultView result={result} kind={kind} rulesetVersion={rulesetVersion} engineHash={engineHash} /> : null}
    </div>
  );
}
