import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dbError } from "./http";

// 특례법 확인 기록 읽기 (W4 20단계 — PRD-01B PR-13, 마이그레이션 …53). 관리 API와 /admin/dev-methods가 같은 함수를 쓴다.
// 이 모듈은 특례법 이름·요건을 만들지 않는다 — 공포 원문 주소·공포일은 관리자(PO)가 실사 뒤 입력한 값 그대로다.

type Db = SupabaseClient;

export interface SpecialLawRecord {
  id: number;
  target_type: "law" | "dev_method_fact" | "dev_method_compare";
  target_ref: string | null;
  target_version: string | null;
  law_confirmation_id: number | null;
  status: "enacted" | "withdrawn";
  promulgation_url: string | null;
  promulgated_on: string | null;
  confirmed_by: string;
  confirmed_at: string;
  reason: string;
}
export const SPECIAL_LAW_COLUMNS = "id, target_type, target_ref, target_version, law_confirmation_id, status, promulgation_url, promulgated_on, confirmed_by, confirmed_at, reason";

export interface SpecialLawTarget {
  kind: "compare" | "fact";
  slug: string;
  method_name: string;
  /** 비교 항목 열쇠 또는 사실 행 열쇠 */
  key: string;
  label: string;
  /** 확인 기록의 대상(target_ref) */
  ref: string;
  /** 지금 판에 맞는 확인이 있어 공개되는가 */
  confirmed: boolean;
  fact_id?: number;
}
export interface SpecialLawBoard {
  /** 지금 확인됨인 공포 확인 (가장 최근 law 기록이 enacted일 때) */
  current: SpecialLawRecord | null;
  history: SpecialLawRecord[];
  targets: SpecialLawTarget[];
}

const num = (v: unknown) => Number(v);
const rec = (r: SpecialLawRecord): SpecialLawRecord => ({ ...r, id: num(r.id), law_confirmation_id: r.law_confirmation_id === null ? null : num(r.law_confirmation_id) });

export async function loadLatestLaw(db: Db): Promise<SpecialLawRecord | null> {
  const { data, error } = await db.from("special_law_confirmations").select(SPECIAL_LAW_COLUMNS).eq("target_type", "law").order("id", { ascending: false }).limit(1);
  if (error) throw dbError(error, "special_law_confirmations 최근 공포 확인");
  return data?.[0] ? rec(data[0] as SpecialLawRecord) : null;
}

export async function loadSpecialLawBoard(db: Db): Promise<SpecialLawBoard> {
  const [law, hist, methods, compare, facts, visible] = await Promise.all([
    loadLatestLaw(db),
    db.from("special_law_confirmations").select(SPECIAL_LAW_COLUMNS).order("id", { ascending: false }).limit(15),
    db.from("dev_methods").select("id, slug, name, sort").order("sort"),
    db.from("dev_method_compare").select("method_id, item, special_law_basis").eq("special_law_basis", true),
    db.from("dev_method_facts").select("id, method_id, fact_key, label, special_law_basis, supersedes_id").eq("special_law_basis", true),
    db.from("special_law_visible").select("target_type, target_ref"),
  ]);
  for (const [r, what] of [[hist, "history"], [methods, "dev_methods"], [compare, "dev_method_compare"], [facts, "dev_method_facts"], [visible, "special_law_visible"]] as const) {
    if (r.error) throw dbError(r.error, `특례법 ${what} 읽기`);
  }
  const shown = new Set(((visible.data ?? []) as { target_type: string; target_ref: string }[]).map((v) => `${v.target_type}:${v.target_ref}`));
  const bySlug = new Map(((methods.data ?? []) as { id: number; slug: string; name: string }[]).map((m) => [num(m.id), m]));
  const allFacts = (facts.data ?? []) as { id: number; method_id: number; fact_key: string; label: string; supersedes_id: number | null }[];
  const superseded = new Set(allFacts.flatMap((f) => (f.supersedes_id === null ? [] : [num(f.supersedes_id)])));
  const targets: SpecialLawTarget[] = [];
  for (const c of (compare.data ?? []) as { method_id: number; item: string }[]) {
    const m = bySlug.get(num(c.method_id));
    if (!m) continue;
    const ref = `${m.slug}:${c.item}`;
    targets.push({ kind: "compare", slug: m.slug, method_name: m.name, key: c.item, label: c.item, ref, confirmed: shown.has(`dev_method_compare:${ref}`) });
  }
  for (const f of allFacts) {
    const m = bySlug.get(num(f.method_id));
    if (!m || superseded.has(num(f.id))) continue;
    targets.push({ kind: "fact", slug: m.slug, method_name: m.name, key: f.fact_key, label: f.label, ref: String(f.id), confirmed: shown.has(`dev_method_fact:${f.id}`), fact_id: num(f.id) });
  }
  return { current: law && law.status === "enacted" ? law : null, history: ((hist.data ?? []) as SpecialLawRecord[]).map(rec), targets };
}
