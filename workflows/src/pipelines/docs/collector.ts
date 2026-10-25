// 행정규칙·유권해석·조세심판 결정례 수집기 (PIPE-02 · PIPE-03 · PIPE-04, P1 PIPE-05·09는 같은 틀로 원천만 더한다)
// 흐름: 목록 조회 → 새 문서 판정 → 상세 원문 조회 → 스냅샷 → 후보 문서(권리 미확인 = 공개 아님) + 검수 항목(법적 문서) 1건.
// 하지 않는 일: 공개 전환(편집자가 권리·비실명을 확인), AI 요약, 본문 가공. 실패는 공개 자료를 바꾸지 않는다 (PIPE-06).
// 응답 모양(목록 경로·필드 이름)은 [확인 필요] — 원천마다 실응답 견본 계약 시험을 통과하고 PO가 `contract_verified`를 기록할 때까지 돌지 않는다(gate).
// 필드 이름 표(SPECS)는 지어낸 견본(시험용)과 같은 모양이며, 실응답이 다르면 이 표만 고친다.
import { redactCredentials } from "../credentials.ts";
import { LawApiError, sha256, type LawApi } from "../law/law-api.ts";
import type { NewSnapshot } from "../law/law-watch.ts";

export type NewRule = "serial" | "serial_or_date";

export interface DocSourceSpec {
  sourceKey: string;
  apiTarget: string;
  docType: "circular" | "interpretation" | "tribunal";
  /** 목록 JSON 안의 배열 위치 힌트(첫 키 아래) — 모양이 다르면 처음 찾은 배열을 쓴다 */
  listRoot: string;
  fields: { id: string; title: string; date: string; docNo?: string; issuer?: string; ministry?: string; decision?: string; sameAs?: string };
  /** 소관부처 필터(행정규칙) — 비우면 거르지 않는다 */
  ministryFilter?: string;
  newRule: NewRule;
  /** 같은 문서를 다른 원천도 줄 때 그 원천 키 — 두 원천을 함께 쓰기로 정한 뒤에만 채운다 [확인 필요] */
  sameAsSource?: string;
}

export const DOC_SPECS: Record<string, DocSourceSpec> = {
  admrul: {
    sourceKey: "admrul", apiTarget: "admrul", docType: "circular", listRoot: "AdmRulSearch",
    fields: { id: "행정규칙일련번호", title: "행정규칙명", date: "발령일자", docNo: "발령번호", issuer: "소관부처명", ministry: "소관부처명" },
    ministryFilter: "행정안전부", newRule: "serial_or_date",
  },
  mois_interpretation: {
    sourceKey: "mois_interpretation", apiTarget: "moisCgmExpc", docType: "interpretation", listRoot: "MoisCgmExpc",
    fields: { id: "법령해석일련번호", title: "안건명", date: "해석일자", docNo: "안건번호", issuer: "해석기관명" }, newRule: "serial",
  },
  tribunal_decision: {
    sourceKey: "tribunal_decision", apiTarget: "ttSpecialDecc", docType: "tribunal", listRoot: "TtSpecialDecc",
    fields: { id: "특별행정심판재결례일련번호", title: "사건명", date: "의결일자", docNo: "사건번호", issuer: "재결청", decision: "재결구분명" }, newRule: "serial_or_date",
  },
};

export interface DocItem {
  docId: string;
  title: string;
  docNo: string | null;
  issuer: string | null;
  decidedOn: string | null;
  decision: string | null;
  /** 다른 원천이 같은 문서를 가리키는 번호(있을 때) */
  sameAsDocId: string | null;
}

const text = (v: unknown): string | null => (typeof v === "string" || typeof v === "number" ? String(v).trim() || null : null);
const isoDate = (v: unknown): string | null => {
  const s = text(v)?.replace(/[.\-/]/g, "") ?? "";
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
};

function findList(json: unknown, rootHint: string): Record<string, unknown>[] {
  const root = (json as Record<string, unknown> | null)?.[rootHint] ?? json;
  const walk = (node: unknown, depth: number): Record<string, unknown>[] | null => {
    if (Array.isArray(node)) return node.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
    if (!node || typeof node !== "object" || depth > 2) return null;
    for (const v of Object.values(node as Record<string, unknown>)) {
      const found = walk(v, depth + 1);
      if (found) return found;
      if (v && typeof v === "object" && !Array.isArray(v) && depth > 0) return [v as Record<string, unknown>];
    }
    return null;
  };
  return walk(root, 0) ?? [];
}

/** 목록 응답 → 문서 항목. 번호 없는 항목은 버리고(수에 센다) 소관부처 필터를 적용한다 */
export function parseDocList(json: unknown, spec: DocSourceSpec): { items: DocItem[]; dropped: number } {
  const rows = findList(json, spec.listRoot);
  const items: DocItem[] = [];
  let dropped = 0;
  for (const row of rows) {
    const docId = text(row[spec.fields.id]);
    const title = text(row[spec.fields.title]);
    if (!docId || !title) { dropped += 1; continue; }
    if (spec.ministryFilter && text(row[spec.fields.ministry ?? ""]) !== spec.ministryFilter) { dropped += 1; continue; }
    items.push({
      docId, title,
      docNo: spec.fields.docNo ? text(row[spec.fields.docNo]) : null,
      issuer: spec.fields.issuer ? text(row[spec.fields.issuer]) : null,
      decidedOn: isoDate(row[spec.fields.date]),
      decision: spec.fields.decision ? text(row[spec.fields.decision]) : null,
      sameAsDocId: spec.fields.sameAs ? text(row[spec.fields.sameAs]) : null,
    });
  }
  return { items, dropped };
}

/** 결정 구분 글자 → 분류 코드 (DB decision_kind 값 목록). 모르면 other */
export function decisionKindOf(label: string | null): "accepted" | "rejected" | "dismissed" | "remanded" | "other" | null {
  if (label === null) return null;
  if (/인용/.test(label)) return "accepted";
  if (/기각/.test(label)) return "rejected";
  if (/각하/.test(label)) return "dismissed";
  if (/재조사/.test(label)) return "remanded";
  return "other";
}

export interface KnownDoc {
  legalDocId: number;
  decidedOn: string | null;
}

export interface DocStore {
  /** 이 원천 번호(또는 별칭)로 이미 있는 문서 */
  findKnown(sourceKey: string, docId: string): Promise<KnownDoc | null>;
  /** 새 문서 — 스냅샷 + 후보 문서(rights unchecked) + 검수 항목 1건. 같은 원천 번호는 한 번만(멱등) */
  commitNewDoc(input: { spec: DocSourceSpec; item: DocItem; snapshot: NewSnapshot }): Promise<{ created: boolean }>;
  /** 같은 문서를 다른 원천이 줄 때 — 별칭만 추가(문서 행 새로 만들지 않음) */
  linkAlias(input: { legalDocId: number; sourceKey: string; docId: string; snapshot: NewSnapshot }): Promise<void>;
  /** 이미 있는 문서의 날짜가 달라짐 — 검수 항목 1건(문서 행은 바꾸지 않음) */
  commitDateChange(input: { spec: DocSourceSpec; item: DocItem; known: KnownDoc; snapshot: NewSnapshot }): Promise<{ created: boolean }>;
  /** 원천 조회 실패 — 같은 날 한 건의 pipeline_failure 검수 항목만, 공개 자료는 그대로 */
  recordSourceFailure(input: { sourceKey: string; day: string; message: string }): Promise<void>;
}

export interface DocCollectSummary {
  sourceKey: string;
  listed: number;
  dropped: number;
  newDocs: number;
  dateChanged: number;
  aliased: number;
  known: number;
  failed: number;
}

export async function collectDocs(deps: { spec: DocSourceSpec; api: LawApi; store: DocStore; now: Date; secrets?: readonly string[] }): Promise<DocCollectSummary> {
  const { spec, api, store } = deps;
  const summary: DocCollectSummary = { sourceKey: spec.sourceKey, listed: 0, dropped: 0, newDocs: 0, dateChanged: 0, aliased: 0, known: 0, failed: 0 };
  const day = deps.now.toISOString().slice(0, 10);
  const fail = async (error: unknown) => {
    summary.failed += 1;
    const message = redactCredentials(error instanceof LawApiError ? error.message : String(error), deps.secrets ?? []);
    await store.recordSourceFailure({ sourceKey: spec.sourceKey, day, message: message.slice(0, 500) });
  };

  let parsed: { items: DocItem[]; dropped: number };
  try {
    const list = await api.getJson("lawSearch.do", { target: spec.apiTarget, type: "JSON", display: "100", sort: "ddes" });
    parsed = parseDocList(list.json, spec);
  } catch (error) {
    await fail(error);
    return summary; // 목록을 못 받으면 아무것도 저장하지 않는다
  }
  summary.listed = parsed.items.length;
  summary.dropped = parsed.dropped;

  for (const item of parsed.items) {
    try {
      const known = await store.findKnown(spec.sourceKey, item.docId);
      if (known && !(spec.newRule === "serial_or_date" && item.decidedOn !== null && known.decidedOn !== null && item.decidedOn !== known.decidedOn)) {
        summary.known += 1;
        continue;
      }
      const detail = await api.getText("lawService.do", { target: spec.apiTarget, type: "JSON", ID: item.docId });
      const snapshot: NewSnapshot = { sourceKey: spec.sourceKey, externalId: item.docId, url: detail.safeUrl, payload: detail.text, contentHash: await sha256(detail.text), httpStatus: detail.status };
      if (known) {
        const r = await store.commitDateChange({ spec, item, known, snapshot });
        if (r.created) summary.dateChanged += 1;
        continue;
      }
      // 다른 원천이 같은 해석을 이미 줬다면 별칭으로만 잇는다 (중복 표시 0)
      const other = item.sameAsDocId && spec.sameAsSource ? await store.findKnown(spec.sameAsSource, item.sameAsDocId) : null;
      if (other) {
        await store.linkAlias({ legalDocId: other.legalDocId, sourceKey: spec.sourceKey, docId: item.docId, snapshot });
        summary.aliased += 1;
        continue;
      }
      const r = await store.commitNewDoc({ spec, item, snapshot });
      if (r.created) summary.newDocs += 1;
    } catch (error) {
      await fail(error); // 한 문서의 오류가 나머지를 멈추지 않는다
    }
  }
  return summary;
}
