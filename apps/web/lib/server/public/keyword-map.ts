import "server-only";
import { buildKeywordMap, parseKeywordState, type KmDiagram, type KmEdge, type KmNode } from "@/lib/keyword-map/graph";
import { pageOf, publicDb, rowsOf } from "./db";
import { readPublicSettings } from "./reads";

// 키워드 맵 공개 데이터 (CASE-06 - docs/dev/W12-g_설계.md). 공개 뷰(public_keyword_map_*)만 읽는다 - 승인 전 태그·비공개 결정례·꺼진 기능은 뷰 안에서 0행이다.
// 기능 키(keyword_map)가 꺼져 있거나 정책이 비어(뷰 0행) 있으면 null -> 화면 404. 노드 건수와 목록은 같은 뷰(public_keyword_map_docs)를 센다. AI는 쓰지 않는다.
export const KEYWORD_PAGE_SIZE = 20;

export interface KeywordCaseItem {
  case_id: number;
  doc_type: string;
  issuer: string;
  doc_no: string;
  decided_on: string;
  tags: Array<{ tag_key: string; label: string }>;
}
export interface KeywordMapView {
  taxes: string[];
  tax: string | null;
  tags: string[];
  page: number;
  diagram: KmDiagram;
  items: KeywordCaseItem[];
  total: number;
  pages: number;
}

export async function getKeywordMap(sp: Record<string, string | string[] | undefined>): Promise<KeywordMapView | null> {
  if (!(await readPublicSettings()).features.keyword_map) return null;
  const db = publicDb();
  const nodeRows = await rowsOf<{ tax_kind: string; tag_key: string; label: string; n: number }>(
    db.from("public_keyword_map_nodes").select("tax_kind, tag_key, label, n").order("tax_kind").order("n", { ascending: false }),
    "키워드 맵 노드",
  );
  if (nodeRows.length === 0) return null;
  const taxes = [...new Set(nodeRows.map((r) => r.tax_kind))];
  const firstTax = parseKeywordState(sp, taxes, []).tax;
  const nodes: KmNode[] = nodeRows.filter((r) => r.tax_kind === firstTax).map((r) => ({ tag_key: r.tag_key, label: r.label, n: Number(r.n) }));
  const state = parseKeywordState(sp, taxes, nodes.map((n) => n.tag_key));
  const edgeRows = await rowsOf<{ tag_a: string; tag_b: string; n: number }>(
    db.from("public_keyword_map_edges").select("tag_a, tag_b, n").eq("tax_kind", state.tax as string),
    "키워드 맵 연결선",
  );
  const edges: KmEdge[] = edgeRows.map((r) => ({ tag_a: r.tag_a, tag_b: r.tag_b, n: Number(r.n) }));
  const from = (state.page - 1) * KEYWORD_PAGE_SIZE;
  let q = db
    .from("public_keyword_map_docs")
    .select("case_id, doc_type, issuer, doc_no, decided_on, tag_keys, labels", { count: "exact" })
    .eq("tax_kind", state.tax as string)
    .order("decided_on", { ascending: false })
    .order("case_id", { ascending: false })
    .range(from, from + KEYWORD_PAGE_SIZE - 1);
  if (state.tags.length > 0) q = q.contains("tag_keys", state.tags);
  const { rows, total } = await pageOf<{ case_id: number; doc_type: string; issuer: string; doc_no: string; decided_on: string; tag_keys: string[]; labels: string[] }>(q, "키워드 맵 목록");
  return {
    taxes,
    tax: state.tax,
    tags: state.tags,
    page: state.page,
    diagram: buildKeywordMap(state.tax, nodes, edges, state.tags),
    items: rows.map((r) => ({
      case_id: Number(r.case_id),
      doc_type: r.doc_type,
      issuer: r.issuer,
      doc_no: r.doc_no,
      decided_on: r.decided_on,
      tags: r.tag_keys.map((k, i) => ({ tag_key: k, label: r.labels[i] ?? k })),
    })),
    total,
    pages: Math.max(1, Math.ceil(total / KEYWORD_PAGE_SIZE)),
  };
}
