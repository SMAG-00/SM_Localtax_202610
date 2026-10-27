import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { UiLink } from "@ltr/ui";
import { AgentEntry } from "@/components/site/AgentEntry";
import { MeasureView } from "@/components/site/Measure";
import { IssueMapEntry } from "@/components/site/tax-guide/TaxEntries";
import { SiteSection } from "@/components/site/SiteSection";
import { PlacedGuides } from "@/components/site/tax-guide/PlacedGuides";
import { DeterminationEntry, entryTypeFor } from "@/components/site/tax-guide/TaxEntries";
import { UnavailablePage } from "@/components/site/Unavailable";
import { isUnavailable, readPublic, UNAVAILABLE } from "@/lib/server/public";
import { getDevMethod } from "@/lib/server/public/dev-methods";
import { isMethodSlug, projectTypeKeys } from "@/lib/server/public/dev-methods-logic";
import { getStageEntries } from "@/lib/server/public/tax-guide";
import { PROJECT_TAX_TYPES } from "@/lib/tax-guide/determination-run";
import { pageTitle } from "@/lib/site/hub-view";

// 정비 단계 상세 (/realestate/development-methods/[method]/steps/[stage] — RDV-02·03 · PR-12 진입). 단계 값은 1단계 표준 단계 사전 그대로.
// 기능 키 redevelopment_tax가 꺼졌거나 서명된 단계 카드가 없으면 404. 분담금·사업성·예상 수익 표현 0 (RDV-09).
const STAGE_RE = /^[a-z][a-z0-9_]{1,39}$/;

const load = cache(async (method: string, stage: string) => {
  await connection();
  if (!isMethodSlug(method) || !STAGE_RE.test(stage)) return null;
  return readPublic(
    "정비 단계 상세",
    async () => {
      const view = await getDevMethod(method);
      if (!view) return null;
      const entries = await getStageEntries(projectTypeKeys(view.method));
      const entry = entries.find((e) => e.stage === stage);
      return entry ? { method: view.method, entry } : null;
    },
    () => UNAVAILABLE,
  );
});

type Props = { params: Promise<{ method: string; stage: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await params;
  const r = await load(p.method, p.stage);
  if (!r || isUnavailable(r)) return { title: pageTitle("정비 단계"), robots: { index: false, follow: false } };
  return { title: pageTitle(`${r.method.name} — ${r.entry.stageLabel}`) };
}

export default async function Page({ params }: Props) {
  const p = await params;
  const r = await load(p.method, p.stage);
  if (isUnavailable(r)) return <UnavailablePage />;
  if (!r) notFound();
  const { method, entry } = r;
  const kind = entry.determinationKind;
  const typeParam = kind ? entryTypeFor(kind) : null;
  const typeIds = kind ? PROJECT_TAX_TYPES.filter((t) => t.kind === kind).map((t) => t.id as string) : [];
  const href = `/calc/project-tax?${typeParam ? `type=${typeParam}&` : ""}stage=${entry.stage}`;
  return (
    <div data-ui="dev-method-step" data-stage={entry.stage}>
      <MeasureView name="step_viewed" section="realestate" props={{ stage: entry.stage }} />
      <SiteSection id="dev-method-step-head" tone="ivory" first data={{ "data-part": "step-head" }}>
        <nav aria-label="현재 위치" className="text-[15px]">
          <UiLink href={`/realestate/development-methods/${p.method}`} className="font-bold text-navy-900 underline-offset-4 hover:underline">
            {method.name}
          </UiLink>
        </nav>
        <h1 className="mt-3 text-[32px] leading-tight font-black tracking-tight text-navy-900 sm:text-[40px]">{entry.stageLabel}</h1>
        {entry.topics.length > 0 && <p className="mt-2 text-[14px] text-navy-600">{entry.topics.join(" · ")}</p>}
        {entry.points.length > 0 && (
          <ul className="mt-4 list-disc pl-5 text-[16px] text-navy-800">
            {entry.points.map((pt) => (
              <li key={pt}>{pt}</li>
            ))}
          </ul>
        )}
        <IssueMapEntry hub="redevelopment" />
        {kind && <DeterminationEntry href={href} label="이 단계의 세금 판정 보기" typeIds={typeIds} />}
      </SiteSection>
      <AgentEntry entry="step" entryId={entry.stage} label="이 단계에 대해 지방세봇에게 묻기" />
      <PlacedGuides surface="stage" targetKey={entry.stage} id="dev-method-step-guides" heading={{ eyebrow: "단계별 세금 가이드", title: `${entry.stageLabel} 단계의 세금` }} />
    </div>
  );
}
