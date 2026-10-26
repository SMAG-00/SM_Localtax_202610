// 쟁점 태그·쟁점 연결 지도 관리 입력 규칙 (W11-d d5 - PRD-03 AIOPS-12 · LINK-01, docs/dev/W11-d_설계.md 5장).
// 순수 모듈 - DB 트리거·함수(마이그레이션 123·124)가 같은 규칙을 한 번 더 건다. 오류 문장은 "칸: 문장" 모양이다.
// 이 모듈에는 쟁점 이름도 조문 내용도 없다 - 붙여 넣은 값의 모양만 검사한다. AI는 쓰지 않는다.
import { detectPii } from "@ltr/editorial";
import { RELATIONS } from "./diagram";

export const GRAPH_OPS = ["create", "submit", "sign", "publish", "retire"] as const;
export const TAG_OPS = ["propose", "approve", "retire", "apply", "approve_case"] as const;
export const GRAPH_HUBS = ["trust", "redevelopment", "inheritance_gift"] as const;
export const TAG_HUBS = ["trust", "redevelopment", "inheritance_gift", "local_tax"] as const;
export const GRAPH_HUB_LABEL: Record<string, string> = { trust: "신탁", redevelopment: "정비", inheritance_gift: "상속·증여" };
export const TAG_HUB_LABEL: Record<string, string> = { ...GRAPH_HUB_LABEL, local_tax: "지방세" };
export const GRAPH_STATUS_LABEL: Record<string, string> = { draft: "초안", in_review: "검토 중", signed: "서명됨(공개 대기)", published: "공개", retired: "내려감" };
export const TAG_STATUS_LABEL: Record<string, string> = { proposed: "제안", approved: "승인", retired: "폐기" };

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };
const fail = (errors: string[]): { ok: false; errors: string[] } => ({ ok: false, errors });
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const posInt = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
};
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TAG_KEY = /^[a-z][a-z0-9_]{1,39}$/;
const NODE_ID = /^n[0-9]{1,3}$/;
const ANCHOR = /^[A-Za-z0-9가-힣_-]{1,60}$/;
const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

function jsonValue(v: unknown, field: string, errors: string[]): unknown {
  if (typeof v !== "string") return v;
  if (v.trim() === "") return undefined;
  try {
    return JSON.parse(v);
  } catch {
    errors.push(`${field}: JSON 모양이 아닙니다`);
    return undefined;
  }
}

export interface GraphNodeInput {
  node_id: string;
  kind: "law_article" | "case";
  ref_id: number;
}
export interface GraphEdgeInput {
  from: string;
  to: string;
  relation: (typeof RELATIONS)[number];
  note?: string;
}
export interface GraphDraftInput {
  slug: string;
  hub: (typeof GRAPH_HUBS)[number];
  title: string;
  summary: string | null;
  as_of: string | null;
  nodes: GraphNodeInput[];
  edges: GraphEdgeInput[];
  guide_refs: { slug: string; anchor?: string }[];
}

export function parseGraphDraft(body: Record<string, unknown>): Parsed<GraphDraftInput> {
  const errors: string[] = [];
  const slug = str(body.slug);
  if (!SLUG.test(slug) || slug.length > 100 || slug === "cases") errors.push("slug: 영문 소문자·숫자·'-' 100자 이하입니다 (cases는 목록 경로라 쓸 수 없습니다)");
  const hub = str(body.hub);
  if (!(GRAPH_HUBS as readonly string[]).includes(hub)) errors.push(`hub: ${GRAPH_HUBS.join("·")} 중 하나입니다`);
  const title = str(body.title);
  if (title.length < 1 || title.length > 200) errors.push("title: 1~200자입니다");
  const summary = str(body.summary);
  if (summary.length > 500) errors.push("summary: 500자 이하입니다");
  const asOf = str(body.as_of);
  if (asOf !== "" && !isDate(asOf)) errors.push("as_of: 실제 있는 날짜(YYYY-MM-DD)입니다");
  if (detectPii(`${title}\n${summary}`).length > 0) errors.push("title·summary: 개인정보로 보이는 글자가 있습니다");

  const nodes: GraphNodeInput[] = [];
  const rawNodes = jsonValue(body.nodes, "nodes", errors);
  if (rawNodes !== undefined) {
    if (!Array.isArray(rawNodes) || rawNodes.length > 40) errors.push("nodes: 노드 목록(최대 40개)입니다");
    else {
      const seen = new Set<string>();
      rawNodes.forEach((n, i) => {
        const o = n as Record<string, unknown> | null;
        if (!o || typeof o !== "object" || Object.keys(o).some((k) => k !== "node_id" && k !== "kind" && k !== "ref_id")) {
          errors.push(`nodes[${i}]: node_id·kind·ref_id만 받습니다 (번호만 저장하고 이름·날짜는 원문 DB에서 읽습니다)`);
          return;
        }
        const id = String(o.node_id ?? "");
        const ref = typeof o.ref_id === "number" ? posInt(o.ref_id) : null;
        if (!NODE_ID.test(id)) errors.push(`nodes[${i}].node_id: n1, n2처럼 n과 숫자입니다`);
        else if (seen.has(id)) errors.push(`nodes[${i}].node_id: ${id}가 겹칩니다`);
        else if (o.kind !== "law_article" && o.kind !== "case") errors.push(`nodes[${i}].kind: law_article·case 중 하나입니다`);
        else if (ref === null) errors.push(`nodes[${i}].ref_id: 1 이상의 정수 번호입니다`);
        else {
          seen.add(id);
          nodes.push({ node_id: id, kind: o.kind, ref_id: ref });
        }
      });
    }
  }
  const edges: GraphEdgeInput[] = [];
  const rawEdges = jsonValue(body.edges, "edges", errors);
  if (rawEdges !== undefined) {
    if (!Array.isArray(rawEdges) || rawEdges.length > 80) errors.push("edges: 연결선 목록(최대 80개)입니다");
    else {
      const kinds = new Map(nodes.map((n) => [n.node_id, n.kind]));
      const seen = new Set<string>();
      rawEdges.forEach((e, i) => {
        const o = e as Record<string, unknown> | null;
        if (!o || typeof o !== "object" || Object.keys(o).some((k) => !["from", "to", "relation", "note"].includes(k))) {
          errors.push(`edges[${i}]: from·to·relation·note만 받습니다`);
          return;
        }
        const from = String(o.from ?? "");
        const to = String(o.to ?? "");
        const rel = String(o.relation ?? "");
        const note = typeof o.note === "string" ? o.note.trim() : "";
        if (!kinds.has(from) || !kinds.has(to)) errors.push(`edges[${i}]: from·to는 위 nodes의 node_id입니다`);
        else if (from === to) errors.push(`edges[${i}]: 자기 자신을 잇지 못합니다`);
        else if (!(RELATIONS as readonly string[]).includes(rel)) errors.push(`edges[${i}].relation: ${RELATIONS.join("·")} 중 하나입니다`);
        else if ((rel === "precedent") === ((kinds.get(from) === "case") === (kinds.get(to) === "case"))) errors.push(`edges[${i}]: precedent는 조문과 결정례 사이, 나머지는 조문과 조문 사이에만 씁니다`);
        else if (note.length > 200) errors.push(`edges[${i}].note: 200자 이하입니다`);
        else if (note && detectPii(note).length > 0) errors.push(`edges[${i}].note: 개인정보로 보이는 글자가 있습니다`);
        else if (seen.has(`${from}>${to}>${rel}`)) errors.push(`edges[${i}]: 같은 연결선이 둘입니다`);
        else {
          seen.add(`${from}>${to}>${rel}`);
          edges.push({ from, to, relation: rel as GraphEdgeInput["relation"], ...(note ? { note } : {}) });
        }
      });
    }
  }
  const guideRefs: GraphDraftInput["guide_refs"] = [];
  const rawRefs = jsonValue(body.guide_refs, "guide_refs", errors);
  if (rawRefs !== undefined) {
    if (!Array.isArray(rawRefs) || rawRefs.length > 20) errors.push("guide_refs: 가이드 참조 목록(최대 20개)입니다");
    else {
      rawRefs.forEach((g, i) => {
        const o = g as Record<string, unknown> | null;
        const s = str(o?.slug);
        const a = str(o?.anchor);
        if (!o || Object.keys(o).some((k) => k !== "slug" && k !== "anchor") || !SLUG.test(s)) errors.push(`guide_refs[${i}]: slug(가이드 주소)와 선택 anchor만 받습니다`);
        else if (a !== "" && !ANCHOR.test(a)) errors.push(`guide_refs[${i}].anchor: 글자·숫자·_- 60자 이하입니다`);
        else guideRefs.push(a ? { slug: s, anchor: a } : { slug: s });
      });
    }
  }
  if (errors.length) return fail(errors);
  return { ok: true, value: { slug, hub: hub as GraphDraftInput["hub"], title, summary: summary === "" ? null : summary, as_of: asOf === "" ? null : asOf, nodes, edges, guide_refs: guideRefs } };
}

export function parseId(body: Record<string, unknown>, what: string): Parsed<{ id: number }> {
  const id = posInt(body.id);
  return id === null ? fail([`id: ${what} 번호(1 이상 정수)입니다`]) : { ok: true, value: { id } };
}

export function parseGraphSign(body: Record<string, unknown>): Parsed<{ id: number; sheetRef: string }> {
  const errors: string[] = [];
  const id = posInt(body.id);
  if (id === null) errors.push("id: 쟁점 지도 버전 번호(1 이상 정수)입니다");
  const sheetRef = str(body.sheet_ref);
  if (sheetRef.length < 1 || sheetRef.length > 200) errors.push("sheet_ref: 감수 시트 위치를 1~200자로 적습니다");
  return errors.length ? fail(errors) : { ok: true, value: { id: id as number, sheetRef } };
}

export interface TagProposeInput {
  tag_key: string;
  label: string;
  hub: (typeof TAG_HUBS)[number];
  synonyms: string[];
}

export function parseTagPropose(body: Record<string, unknown>): Parsed<TagProposeInput> {
  const errors: string[] = [];
  const tagKey = str(body.tag_key);
  if (!TAG_KEY.test(tagKey)) errors.push("tag_key: 영문 소문자로 시작하는 소문자·숫자·'_' 2~40자입니다");
  const label = str(body.label);
  if (label.length < 1 || label.length > 60) errors.push("label: 1~60자입니다");
  const hub = str(body.hub);
  if (!(TAG_HUBS as readonly string[]).includes(hub)) errors.push(`hub: ${TAG_HUBS.join("·")} 중 하나입니다`);
  const raw = Array.isArray(body.synonyms) ? body.synonyms.map(String) : str(body.synonyms).split(/[,\n]/);
  const synonyms = [...new Set(raw.map((s) => s.trim()).filter(Boolean))];
  if (synonyms.length > 20 || synonyms.some((s) => s.length > 40)) errors.push("synonyms: 동의어는 최대 20개, 각 40자 이하입니다");
  if (detectPii(`${label}\n${synonyms.join("\n")}`).length > 0) errors.push("label·synonyms: 개인정보로 보이는 글자가 있습니다");
  return errors.length ? fail(errors) : { ok: true, value: { tag_key: tagKey, label, hub: hub as TagProposeInput["hub"], synonyms } };
}

export function parseCaseTagApply(body: Record<string, unknown>): Parsed<{ caseId: number; issueTagId: number }> {
  const errors: string[] = [];
  const caseId = posInt(body.case_id);
  const tagId = posInt(body.issue_tag_id);
  if (caseId === null) errors.push("case_id: 결정례·해석 번호(1 이상 정수)입니다");
  if (tagId === null) errors.push("issue_tag_id: 쟁점 태그 번호(1 이상 정수)입니다");
  return errors.length ? fail(errors) : { ok: true, value: { caseId: caseId as number, issueTagId: tagId as number } };
}
