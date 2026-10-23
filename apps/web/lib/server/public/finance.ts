import "server-only";
import { publicDb, rowsOf } from "./db";
import {
  financeInterestLine,
  groupIndicators,
  groupRegulations,
  isDiagram,
  type DiagramData,
  type FinanceInterestRow,
  type IndicatorGroup,
  type IndicatorRow,
  type RegulationGroup,
  type RegulationRow,
} from "./finance-logic";
import { readPublicSettings } from "./reads";

// 개발금융 공개 읽기 (W5 — DF-01 · DF-02 · DF-03 · DF-04 · DF-09). 공개 뷰 public_finance_* 만 anon 키로 읽는다.
// 기능 키 finance가 꺼져 있으면 DB 뷰가 0행이므로 아무것도 그리지 않는다(여기서도 한 번 더 막는다).

export interface StructureCard {
  slug: string;
  type: string;
  title: string;
  summary: string | null;
}
export interface StructureView extends StructureCard {
  diagram: DiagramData;
  notes: string[];
  lens: { topics: string[]; points: string[]; links: { kind: string; label: string; url: string }[]; base_date: string } | null;
  lensOmitReason: string | null;
  taxSignedOn: string;
  legalCheckedOn: string;
}

interface StructureRow {
  slug: string;
  structure_type: string;
  title: string;
  summary: string | null;
  diagram: unknown;
  notes: unknown;
  lens: unknown;
  lens_omit_reason: string | null;
  tax_signed_at: string;
  legal_checked_at: string;
}

const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);

export async function financeOpen(): Promise<boolean> {
  return (await readPublicSettings()).features.finance;
}

export async function getStructureCards(): Promise<StructureCard[]> {
  if (!(await financeOpen())) return [];
  const rows = await rowsOf<StructureRow>(publicDb().from("public_finance_structures").select("slug, structure_type, title, summary, diagram, notes, lens, lens_omit_reason, tax_signed_at, legal_checked_at").order("slug"), "개발금융 구조 해설 목록");
  return rows.filter((r) => isDiagram(r.diagram)).map((r) => ({ slug: r.slug, type: r.structure_type, title: r.title, summary: r.summary }));
}

export async function getStructure(slug: string): Promise<StructureView | null> {
  if (!(await financeOpen())) return null;
  const [r] = await rowsOf<StructureRow>(
    publicDb().from("public_finance_structures").select("slug, structure_type, title, summary, diagram, notes, lens, lens_omit_reason, tax_signed_at, legal_checked_at").eq("slug", slug).limit(1),
    "개발금융 구조 해설",
  );
  if (!r || !isDiagram(r.diagram)) return null;
  return {
    slug: r.slug,
    type: r.structure_type,
    title: r.title,
    summary: r.summary,
    diagram: r.diagram,
    notes: Array.isArray(r.notes) ? r.notes.filter((n): n is string => typeof n === "string") : [],
    lens: r.lens && typeof r.lens === "object" ? (r.lens as StructureView["lens"]) : null,
    lensOmitReason: r.lens_omit_reason,
    taxSignedOn: kstDate(r.tax_signed_at),
    legalCheckedOn: r.legal_checked_at,
  };
}

export interface TrackerView {
  regulations: RegulationGroup[];
  indicators: IndicatorGroup[];
}

/** 트래커 — 규제·통계가 둘 다 없으면 null(블록을 그리지 않는다) */
export async function getTracker(): Promise<TrackerView | null> {
  if (!(await financeOpen())) return null;
  const db = publicDb();
  const [regs, inds] = await Promise.all([
    rowsOf<RegulationRow>(db.from("public_finance_regulations").select("id, reg_key, title, stage, effective_on, provider, source_url, is_latest, in_force"), "개발금융 규제 항목"),
    rowsOf<IndicatorRow>(db.from("public_finance_indicators").select("id, indicator_key, label, definition, value, unit, as_of, collected_on, provider, source_url, is_latest"), "개발금융 통계 지표"),
  ]);
  const regulations = groupRegulations(regs);
  const indicators = groupIndicators(inds);
  return regulations.length + indicators.length === 0 ? null : { regulations, indicators };
}

export interface CaseView {
  type: string;
  issues: string[];
  outcome: string | null;
  named: boolean;
  rebuttalStatus: string | null;
}

export async function getFinanceCase(articleId: number): Promise<CaseView | null> {
  if (!(await financeOpen())) return null;
  const [r] = await rowsOf<{ structure_type: string; issues: string[] | null; outcome: string | null; named_company: boolean; rebuttal_status: string | null }>(
    publicDb().from("public_finance_cases").select("structure_type, issues, outcome, named_company, rebuttal_status").eq("article_id", articleId).limit(1),
    "개발금융 사례 구조",
  );
  return r ? { type: r.structure_type, issues: r.issues ?? [], outcome: r.outcome, named: r.named_company, rebuttalStatus: r.rebuttal_status } : null;
}

/** 개발금융 칼럼 소속 줄 — 두 항목이 모두 있을 때만 */
export async function getFinanceInterestLine(articleId: number): Promise<string | null> {
  if (!(await financeOpen())) return null;
  const rows = await rowsOf<FinanceInterestRow>(publicDb().from("public_finance_column_interest_items").select("article_id, item, state, interest_text").eq("article_id", articleId), "개발금융 칼럼 소속 항목");
  return financeInterestLine(rows);
}
