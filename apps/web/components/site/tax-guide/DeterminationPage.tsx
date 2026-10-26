import { notFound } from "next/navigation";
import { DeterminationTool } from "./DeterminationTool";
import { CalcUnavailable } from "../calc/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { availableTypeIds, getDeterminationBundle } from "@/lib/server/public/tax-guide";
import { PROJECT_TAX_TYPES } from "@/lib/tax-guide/determination-run";
import type { ReactNode } from "react";

// 판정 화면 틀 (W11-c c4·c7·c8). 서명된(활성) 판정표가 없거나 기능 키가 꺼져 있으면 404 - 진입 버튼도 "준비 중"도 없다.
// 같은 판정 종류는 어느 화면에서 열어도 같은 판정표·같은 함수를 쓴다 (TRU-03 = PR-12 신탁 보유세).
const STAGE_RE = /^[a-z][a-z0-9_]{1,39}$/;

export async function DeterminationPage({
  title,
  intro,
  allowedTypeIds,
  type,
  stage,
  children,
}: {
  title: string;
  intro: string;
  allowedTypeIds: readonly string[];
  type?: string | undefined;
  stage?: string | undefined;
  children?: ReactNode;
}) {
  const kinds = [...new Set(PROJECT_TAX_TYPES.filter((t) => allowedTypeIds.includes(t.id)).map((t) => t.kind))];
  const bundle = await readPublic(title, () => getDeterminationBundle(kinds), () => UNAVAILABLE);
  if (isUnavailable(bundle)) return <CalcUnavailable />;
  const ids = availableTypeIds(bundle, allowedTypeIds);
  if (ids.length === 0) notFound();
  const types = PROJECT_TAX_TYPES.filter((t) => ids.includes(t.id)).map((t) => ({ id: t.id as string, label: t.label as string }));
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-10" data-ui="determination-page">
      <h1 className="text-[28px] font-black text-navy-900">{title}</h1>
      <p className="mt-3 max-w-2xl text-[16px] text-navy-700">{intro}</p>
      <p data-part="local-only" className="mt-2 max-w-2xl text-[14px] text-navy-600">
        입력한 내용은 이 화면 안에서만 쓰이고 저장하거나 보내지 않습니다. 세액은 계산하지 않습니다.
      </p>
      <div className="mt-6">
        <DeterminationTool
          types={types}
          tables={bundle.tables as Record<string, unknown>}
          fields={bundle.fields}
          {...(type && ids.includes(type) ? { initialType: type } : {})}
          {...(stage && STAGE_RE.test(stage) ? { initialStage: stage } : {})}
        />
      </div>
      {children}
    </div>
  );
}
