import "server-only";
import { caseEntryCard, type CaseEntryCard, type CaseEntryRow } from "@/lib/field-data/case-view";
import { publicDb, rowsOf } from "./db";
import { financeOpen } from "./finance";
import { readPublicSettings } from "./reads";

// 금융 사례 DB 공개 읽기 (W10-h h4 - PRD-02 DF-07). 공개 뷰 public_finance_case_entries 만 anon 키로 읽는다.
// 기능 키 finance·field_data 중 하나라도 꺼져 있으면 DB 뷰가 0행이고, 여기서도 먼저 막는다. 사례 DB 항목은 기사가 아니므로 기사 집계에 들어가지 않는다.

const COLUMNS = "id, slug, title, structure_type, issues, outcome, as_of, sources, companies, rebuttal_requested_on, rebuttal_status, article_ids, license_type, source_name, checked_on";

export async function getFinanceCaseEntries(): Promise<CaseEntryCard[]> {
  if (!(await financeOpen())) return [];
  const settings = await readPublicSettings();
  if (!(settings.features as Record<string, boolean | undefined>).field_data) return [];
  const rows = await rowsOf<CaseEntryRow>(publicDb().from("public_finance_case_entries").select(COLUMNS).order("as_of", { ascending: false }).order("id", { ascending: false }).limit(500), "금융 사례 DB");
  return rows.map(caseEntryCard);
}
