"use client";

import { useId, useState, type ReactNode } from "react";
import { calcCorporateLocalIncome, calcEntityLocalTaxes, calcOligopolyByListing } from "@ltr/tax-engine/expert";
import type { ExpertPage } from "@/lib/server/public/expert-tools";
import {
  buildCorporate,
  buildEntity,
  buildOligopoly,
  CORPORATE_FORM_EMPTY,
  ENTITY_FORM_EMPTY,
  OLIGOPOLY_FORM_EMPTY,
  type CorporateForm,
  type EntityForm,
  type OligopolyForm,
} from "@/lib/calc/expert/form";
import { corporateView, entityView, oligopolyView, won, type ExpertView } from "@/lib/calc/expert/view";

// 전문가 계산기 (W13-f · CALC-17~19) - 계산은 이 브라우저 안에서만 한다.
//  · 입력은 이 컴포넌트의 메모리(useState)에만 있다: 서버 전송·분석 이벤트·주소·브라우저 저장소·쿠키 0, 새로고침하면 사라진다.
//  · 세율·구간·과세 범위는 서버가 내려 준 룰셋 값이고, 고정 안내 문구는 PO 감수 입력(notices)이다. 이 파일에 세율 숫자·세무 문구 없음.
//  · 결과가 입력 칸보다 먼저(위에) 나온다.

const inputCls = "h-11 rounded-md border border-navy-200 px-3 text-[15px] text-navy-900";

function Field({ label, error, children }: { label: string; error?: string | undefined; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[14px] font-bold text-navy-900">
        {label}
      </label>
      {children(id)}
      {error ? (
        <span role="alert" className="text-[12px] text-red-700">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function Num({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string | undefined }) {
  return (
    <Field label={label} error={error}>
      {(id) => <input id={id} className={inputCls} inputMode="decimal" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

function ResultView({ view, note }: { view: ExpertView; note?: string | null }) {
  return (
    <section data-part="expert-result" aria-live="polite" className="rounded-lg border border-navy-200 p-5">
      <h2 className="text-[20px] font-black text-navy-900">계산 결과</h2>
      <div className={view.sideBySide ? "mt-4 grid gap-4 md:grid-cols-2" : "mt-4 grid gap-4"}>
        {view.scenarios.map((s) => (
          <div key={s.title} data-part="expert-scenario" className="rounded-md bg-navy-50 p-4">
            <h3 className="text-[16px] font-bold text-navy-900">{s.title}</h3>
            <p className="mt-2 text-[24px] font-black text-navy-900" data-part="expert-total">
              {won(s.total)}
            </p>
            <ul className="mt-3 flex flex-col gap-2 text-[14px] text-navy-900">
              {s.rows.map((r) => (
                <li key={r.code}>
                  <span className="font-bold">{r.label}</span> {won(r.amount)}
                  <span className="block text-[12px] text-navy-500">{r.law}</span>
                  {r.reasons.map((x) => (
                    <span key={x} className="block text-[12px] text-navy-500">
                      {x}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            {s.warnings.map((w) => (
              <p key={w} className="mt-2 text-[12px] text-navy-500">
                {w}
              </p>
            ))}
          </div>
        ))}
      </div>
      {note ? <p className="mt-4 text-[13px] text-navy-900">{note}</p> : null}
      <p className="mt-3 text-[12px] text-navy-500" data-part="expert-versions">
        적용 룰셋 버전 {view.versions.join(" · ")}
      </p>
    </section>
  );
}

export function ExpertCalculator({ page }: { page: ExpertPage }) {
  const [oli, setOli] = useState<OligopolyForm>(OLIGOPOLY_FORM_EMPTY);
  const [corp, setCorp] = useState<CorporateForm>(CORPORATE_FORM_EMPTY);
  const [ent, setEnt] = useState<EntityForm>(ENTITY_FORM_EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [view, setView] = useState<ExpertView | null>(null);

  const fail = (e: Record<string, string>) => {
    setErrors(e);
    setView(null);
  };

  function run() {
    setErrors({});
    if (page.kind === "oligopoly" && page.expert) {
      const b = buildOligopoly(oli);
      if (!b.ok) return fail(b.errors);
      setView(oligopolyView(calcOligopolyByListing(b.input.input, b.input.listing, page.ruleset, page.expert)));
    } else if (page.kind === "corporate_local_income" && page.expert) {
      const b = buildCorporate(corp);
      if (!b.ok) return fail(b.errors);
      setView(corporateView(calcCorporateLocalIncome(b.input, page.expert)));
    } else if (page.kind === "entity") {
      const b = buildEntity(ent);
      if (!b.ok) return fail(b.errors);
      setView(entityView(calcEntityLocalTaxes(b.input, page.ruleset)));
    }
  }

  const title = page.kind === "oligopoly" ? "과점주주 간주취득세" : page.kind === "entity" ? "개인 대 법인 지방세 비교" : "법인지방소득세";
  const note = page.kind === "entity" ? page.notices.entityNational : page.kind === "corporate_local_income" ? page.notices.corporateBase : null;

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 px-4 py-10">
      <h1 className="text-[28px] font-black text-navy-900">{title}</h1>
      {view ? <ResultView view={view} note={note} /> : note ? <p className="text-[13px] text-navy-900">{note}</p> : null}
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        {page.kind === "oligopoly" ? (
          <>
            <Field label="상장 여부" error={errors.listing}>
              {(id) => (
                <select id={id} className={inputCls} value={oli.listing} onChange={(e) => setOli({ ...oli, listing: e.target.value as OligopolyForm["listing"] })}>
                  <option value="">선택</option>
                  <option value="listed">상장법인</option>
                  <option value="unlisted">비상장법인</option>
                  <option value="unknown">모르겠어요</option>
                </select>
              )}
            </Field>
            <Num label="법인 부동산등 장부가액 (원)" value={oli.bookValue} onChange={(v) => setOli({ ...oli, bookValue: v })} error={errors.bookValue} />
            <Num label="취득 전 지분율 (%)" value={oli.beforePercent} onChange={(v) => setOli({ ...oli, beforePercent: v })} error={errors.beforePercent} />
            <Num label="취득 후 지분율 (%)" value={oli.afterPercent} onChange={(v) => setOli({ ...oli, afterPercent: v })} error={errors.afterPercent} />
          </>
        ) : null}
        {page.kind === "corporate_local_income" ? <Num label="법인세 과세표준 (원)" value={corp.taxBase} onChange={(v) => setCorp({ taxBase: v })} error={errors.taxBase} /> : null}
        {page.kind === "entity" ? (
          <>
            <Field label="물건 종류" error={errors.propertyKind}>
              {(id) => (
                <select id={id} className={inputCls} value={ent.propertyKind} onChange={(e) => setEnt({ ...ent, propertyKind: e.target.value as EntityForm["propertyKind"] })}>
                  <option value="">선택</option>
                  <option value="HOUSE">주택</option>
                  <option value="OFFICETEL">오피스텔</option>
                  <option value="COMMERCIAL">상가·업무용 건물</option>
                  <option value="LAND">토지</option>
                </select>
              )}
            </Field>
            <Num label="취득가액 (원)" value={ent.price} onChange={(v) => setEnt({ ...ent, price: v })} error={errors.price} />
            <Num label="공시가격 (원, 보유세를 같이 볼 때만)" value={ent.publishedPrice} onChange={(v) => setEnt({ ...ent, publishedPrice: v })} error={errors.publishedPrice} />
          </>
        ) : null}
        <button type="submit" className="h-12 w-fit rounded-md bg-navy-900 px-6 text-[15px] font-bold text-white">
          계산하기
        </button>
      </form>
      {page.sm ? (
        <a data-part="sm-card" href={page.sm.href} target="_blank" rel="noopener noreferrer" className="w-fit rounded-md border border-navy-200 px-4 py-3 text-[14px] font-bold text-navy-900">
          {page.sm.label} (새 창)
        </a>
      ) : null}
    </div>
  );
}
