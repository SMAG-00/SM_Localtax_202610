import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEV_METHOD_ITEMS,
  DEV_METHOD_KIND_LABELS,
  FACT_COLUMNS,
  type DevMethodFactRow,
  type DevMethodItem,
  type DevMethodKind,
  type DevMethodReadiness,
  type DevMethodReviewStatus,
} from "@/lib/admin/dev-method-rules";
import type { StageLensContent } from "@/lib/admin/project-lens-rules";
import { dbError } from "../http";

// 개발방법 비교 관리 읽기 (W4 18단계 — PRD-01B PR-09·10, docs/dev/W4_설계.md 1장 18단계 · 4장 `/api/admin/dev-methods`) — service_role로 표를 읽는다.
// 관리 API(GET)와 19단계 관리 화면이 같은 함수를 쓴다. 공개 준비(방법 서명 + 비교 항목 6칸 서명)는 DB 뷰 dev_method_readiness가 판정한다(같은 조건을 두 번 적지 않는다).

type Db = SupabaseClient;

export const METHOD_COLUMNS = "id, slug, name, kind, sort, legal_basis_name, summary, steps, lens, drafted_by, drafted_at, reviewed_by, reviewed_at, review_status";
export const COMPARE_COLUMNS = "method_id, item, body, drafted_by, drafted_at, reviewed_by, reviewed_at, review_status";

export interface DevMethodRow {
  id: number;
  slug: string;
  name: string;
  kind: DevMethodKind;
  sort: number;
  legal_basis_name: string | null;
  summary: string | null;
  steps: string[] | null;
  lens: StageLensContent | null;
  drafted_by: string | null;
  drafted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_status: DevMethodReviewStatus;
}
export interface DevMethodCompareRow {
  method_id: number;
  item: DevMethodItem;
  body: string;
  drafted_by: string;
  drafted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_status: DevMethodReviewStatus;
}

export interface DevMethodFactGroup {
  fact_key: string;
  /** 최신 판 (공개 후보 — 서명·기준일이 있어야 공개) */
  latest: DevMethodFactRow;
  /** 모든 판 (옛 판부터) */
  versions: DevMethodFactRow[];
  /** 최신 판의 원문 검수 큐가 열려 있다 */
  under_review: boolean;
}

export interface DevMethodBoardItem extends DevMethodRow {
  kind_label: string;
  /** 비교 항목 6칸 — 2.1 순서, 없는 칸은 null */
  compare: { item: DevMethodItem; row: DevMethodCompareRow | null }[];
  facts: DevMethodFactGroup[];
  readiness: { ready: boolean; method_signed: boolean; compare_unsigned: string[] };
}

export interface DevMethodBoard {
  /** 기능 키 dev_methods (켜지면 공개 준비된 방법이 공개 화면에 나온다) */
  published: boolean;
  methods: DevMethodBoardItem[];
}

const num = (v: unknown) => Number(v);

export async function loadMethod(db: Db, slug: string): Promise<DevMethodRow | null> {
  const { data, error } = await db.from("dev_methods").select(METHOD_COLUMNS).eq("slug", slug).maybeSingle();
  if (error) throw dbError(error, "dev_methods 하나");
  return data ? ({ ...(data as DevMethodRow), id: num((data as DevMethodRow).id) } as DevMethodRow) : null;
}

export async function loadCompare(db: Db, methodId: number, item: string): Promise<DevMethodCompareRow | null> {
  const { data, error } = await db.from("dev_method_compare").select(COMPARE_COLUMNS).eq("method_id", methodId).eq("item", item).maybeSingle();
  if (error) throw dbError(error, "dev_method_compare 하나");
  return data ? ({ ...(data as DevMethodCompareRow), method_id: num((data as DevMethodCompareRow).method_id) } as DevMethodCompareRow) : null;
}

const toFact = (r: DevMethodFactRow): DevMethodFactRow => ({
  ...r,
  id: num(r.id),
  method_id: num(r.method_id),
  snapshot_id: num(r.snapshot_id),
  supersedes_id: r.supersedes_id === null ? null : num(r.supersedes_id),
});

/** 한 방법·한 열쇠의 모든 판 (옛 판부터) */
export async function loadFactVersions(db: Db, methodId: number, factKey: string): Promise<DevMethodFactRow[]> {
  const { data, error } = await db.from("dev_method_facts").select(FACT_COLUMNS).eq("method_id", methodId).eq("fact_key", factKey).order("version");
  if (error) throw dbError(error, "dev_method_facts 판");
  return ((data ?? []) as DevMethodFactRow[]).map(toFact);
}

export async function loadFact(db: Db, id: number): Promise<DevMethodFactRow | null> {
  const { data, error } = await db.from("dev_method_facts").select(FACT_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw dbError(error, "dev_method_facts 하나");
  return data ? toFact(data as DevMethodFactRow) : null;
}

/** 최신 판 — 그 판을 고친 판이 없는 판 (판은 한 줄로 이어진다 — DB 고유 색인 dev_method_facts_supersedes_once) */
export const latestOf = (versions: readonly DevMethodFactRow[]): DevMethodFactRow | null => versions.find((v) => !versions.some((n) => n.supersedes_id === v.id)) ?? null;

/** 관리 보드 — 7개 방법(고정 순서) × 비교 항목 6칸 · 사실 행(열쇠마다 판) · 공개 준비 · 기능 키 */
export async function loadDevMethodBoard(db: Db): Promise<DevMethodBoard> {
  const [methods, compare, facts, readiness, queue, flags] = await Promise.all([
    db.from("dev_methods").select(METHOD_COLUMNS).order("sort"),
    db.from("dev_method_compare").select(COMPARE_COLUMNS),
    db.from("dev_method_facts").select(FACT_COLUMNS).order("method_id").order("fact_key").order("version"),
    db.from("dev_method_readiness").select("slug, sort, method_signed, compare_unsigned, ready"),
    db.from("source_review_queue").select("target_id").eq("target_type", "dev_method_fact").eq("status", "open"),
    db.from("settings").select("value").eq("key", "feature_flags").limit(1),
  ]);
  for (const [r, what] of [
    [methods, "dev_methods"],
    [compare, "dev_method_compare"],
    [facts, "dev_method_facts"],
    [readiness, "dev_method_readiness"],
    [queue, "source_review_queue"],
    [flags, "settings feature_flags"],
  ] as const) {
    if (r.error) throw dbError(r.error, `${what} 읽기`);
  }
  const compareRows = ((compare.data ?? []) as DevMethodCompareRow[]).map((c) => ({ ...c, method_id: num(c.method_id) }));
  const factRows = ((facts.data ?? []) as DevMethodFactRow[]).map(toFact);
  const open = new Set(((queue.data ?? []) as { target_id: number }[]).map((q) => num(q.target_id)));
  const ready = new Map(((readiness.data ?? []) as DevMethodReadiness[]).map((r) => [r.slug, r]));
  const flagValue = (flags.data?.[0] as { value?: unknown } | undefined)?.value;
  const published = typeof flagValue === "object" && flagValue !== null && (flagValue as Record<string, unknown>).dev_methods === true;

  const items = ((methods.data ?? []) as DevMethodRow[]).map((raw): DevMethodBoardItem => {
    const m = { ...raw, id: num(raw.id) };
    const mine = factRows.filter((f) => f.method_id === m.id);
    const keys = [...new Set(mine.map((f) => f.fact_key))];
    const groups = keys.map((k) => {
      const versions = mine.filter((f) => f.fact_key === k);
      const latest = latestOf(versions) ?? versions[versions.length - 1]!;
      return { fact_key: k, latest, versions, under_review: open.has(latest.id) };
    });
    const r = ready.get(m.slug);
    return {
      ...m,
      kind_label: DEV_METHOD_KIND_LABELS[m.kind],
      compare: DEV_METHOD_ITEMS.map((item) => ({ item, row: compareRows.find((c) => c.method_id === m.id && c.item === item) ?? null })),
      facts: groups,
      readiness: { ready: r?.ready === true, method_signed: r?.method_signed === true, compare_unsigned: r?.compare_unsigned ?? [...DEV_METHOD_ITEMS] },
    };
  });
  return { published, methods: items };
}

/** 공개 준비 줄 — 기능 키 켜기 검사(운영 설정)용 */
export async function loadReadiness(db: Db): Promise<DevMethodReadiness[]> {
  const { data, error } = await db.from("dev_method_readiness").select("slug, sort, method_signed, compare_unsigned, ready").order("sort");
  if (error) throw dbError(error, "dev_method_readiness 읽기");
  return (data ?? []) as DevMethodReadiness[];
}
