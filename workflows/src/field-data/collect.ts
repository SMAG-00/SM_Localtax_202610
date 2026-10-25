// 분야 데이터 수집기 틀 (W10-h h1 — PR-06 · LG-15 · DF-06). 흐름: 관문 → 목록 조회 → 칸 옮기기(허용 표만) → 값 해시 → 새 값이면 스냅샷 + 후보 1건.
// 하지 않는 일: 공개 반영(사람 승인 뒤 DB 함수 field_publish), AI 요약, 원문 가공. 실패는 공개 자료를 바꾸지 않는다.
// 응답 모양은 [확인 필요] — 원천마다 spec 의 칸을 채우고 PO 가 견본 계약 확인을 기록할 때까지 돌지 않는다.
import { redactCredentials } from "../pipelines/credentials.ts";
import { sha256 } from "../pipelines/law/law-api.ts";
import { fieldGate, type FieldSkipReason } from "./gate.ts";
import type { FieldCandidate, FieldCollectSummary, FieldFetch, FieldSnapshot, FieldSourceSpec, FieldStore, KoglType } from "./types.ts";

/** 키 순서와 상관없이 같은 글자가 되는 JSON — 값 해시의 입력 */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export const valueHash = (fields: Record<string, unknown>): Promise<string> => sha256(stableStringify(fields));

const text = (v: unknown): string | null => (typeof v === "string" || typeof v === "number" ? String(v).trim() || null : null);

function findList(json: unknown, rootHint: string): Record<string, unknown>[] {
  const root = (json as Record<string, unknown> | null)?.[rootHint] ?? json;
  const walk = (node: unknown, depth: number): Record<string, unknown>[] | null => {
    if (Array.isArray(node)) return node.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
    if (!node || typeof node !== "object" || depth > 2) return null;
    for (const v of Object.values(node as Record<string, unknown>)) {
      const found = walk(v, depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(root, 0) ?? [];
}

/** 한 행 → 후보 칸. 옮김 표(fieldMap)에 없는 원천 필드는 버린다 — 가격·분담금·수익률 같은 필드가 응답에 있어도 후보에 실리지 않는다 */
export function mapRow(row: Record<string, unknown>, spec: FieldSourceSpec): { sourceItemId: string; fields: FieldCandidate["fields"]; koglType: KoglType | null } | null {
  const sourceItemId = text(row[spec.idField]);
  if (!sourceItemId) return null;
  const fields: FieldCandidate["fields"] = {};
  for (const [from, to] of Object.entries(spec.fieldMap)) {
    const v = row[from];
    if (Array.isArray(v)) fields[to] = v.map((x) => (typeof x === "object" && x !== null ? (x as Record<string, unknown>) : String(x)));
    else if (typeof v === "boolean" || typeof v === "number") fields[to] = v;
    else if (typeof v === "string" && v.trim() !== "") fields[to] = v.trim();
  }
  for (const [k, v] of Object.entries(spec.fixedFields ?? {})) fields[k] = v;
  if (spec.target === "local_event") {
    if (!spec.imageRightsConfirmed) delete fields.image_url; // 권리 미확인 이미지는 후보에도 싣지 않는다 (LG-15)
    fields.image_rights = spec.imageRightsConfirmed ? "confirmed" : "unconfirmed";
  }
  const rawKogl = spec.koglField ? text(row[spec.koglField]) : null;
  const koglType = rawKogl && spec.koglMap ? (spec.koglMap[rawKogl] ?? null) : null;
  return { sourceItemId, fields, koglType };
}

const changedKeys = (before: Record<string, unknown> | null, after: Record<string, unknown>): string[] =>
  before === null ? [] : [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => stableStringify(before[k]) !== stableStringify(after[k])).sort();

export interface CollectDeps {
  spec: FieldSourceSpec;
  fetch: FieldFetch;
  store: FieldStore;
  now: Date;
  /** 인증키 값 — 요청 주소에만 쓰고 저장·오류 글에는 가린다 */
  key: string;
}

/** 요청 주소(인증키 포함)와 저장용 주소(키 변수 없음) */
export function requestUrls(spec: FieldSourceSpec, key: string): { request: string; safe: string } {
  const safe = new URL(spec.baseUrl as string);
  for (const [k, v] of Object.entries(spec.params)) safe.searchParams.set(k, v);
  const request = new URL(safe.toString());
  request.searchParams.set(spec.keyParam, key);
  return { request: request.toString(), safe: safe.toString() };
}

export async function collectField(deps: CollectDeps): Promise<FieldCollectSummary> {
  const { spec, store } = deps;
  const summary: FieldCollectSummary = { sourceKey: spec.sourceKey, listed: 0, dropped: 0, unmatched: 0, known: 0, candidates: 0, failed: 0 };
  const day = deps.now.toISOString().slice(0, 10);
  const fail = async (error: unknown) => {
    summary.failed += 1;
    await store.recordSourceFailure({ sourceKey: spec.sourceKey, day, message: redactCredentials(error instanceof Error ? error.message : String(error), [deps.key]).slice(0, 500) });
  };

  let snapshot: FieldSnapshot;
  let rows: Record<string, unknown>[];
  try {
    const { request, safe } = requestUrls(spec, deps.key);
    const res = await deps.fetch(request);
    if (res.status < 200 || res.status >= 300) throw new Error(`원천 응답 상태 ${res.status}`);
    rows = findList(JSON.parse(res.text), spec.listRoot);
    snapshot = { sourceKey: spec.sourceKey, externalId: "list", url: safe, payload: res.text, contentHash: await sha256(res.text), httpStatus: res.status };
  } catch (error) {
    await fail(error);
    return summary; // 목록을 못 받으면 아무것도 저장하지 않는다 — 공개 자료는 마지막 승인본 그대로
  }
  summary.listed = rows.length;

  for (const row of rows) {
    try {
      const mapped = mapRow(row, spec);
      if (!mapped) { summary.dropped += 1; continue; }
      const fields = { ...mapped.fields };
      if (spec.target === "project_stage") {
        const slug = await store.projectSlugFor(spec.sourceKey, mapped.sourceItemId);
        if (!slug) { summary.unmatched += 1; continue; } // 연결된 프로젝트가 없으면 후보를 만들지 않는다
        fields.project_slug = slug;
      }
      const hash = await valueHash(fields);
      const prev = await store.latest(spec.sourceKey, mapped.sourceItemId);
      if (prev && prev.valueHash === hash) { summary.known += 1; continue; }
      const candidate: FieldCandidate = { target: spec.target, sourceItemId: mapped.sourceItemId, valueHash: hash, koglType: mapped.koglType, changedFields: changedKeys(prev?.fields ?? null, fields), fields };
      const r = await store.commitCandidate({ spec, snapshot, candidate, title: `${spec.sourceKey} ${mapped.sourceItemId}${prev ? " (값 변경)" : ""}` });
      if (r.created) summary.candidates += 1; else summary.known += 1;
    } catch (error) {
      await fail(error); // 한 항목의 오류가 나머지를 멈추지 않는다
    }
  }
  return summary;
}

/** 관문을 거쳐 수집 — 관문이 닫혀 있으면 fetch 를 한 번도 부르지 않는다 */
export async function runFieldSource(deps: Omit<CollectDeps, "key"> & { key: string | undefined; flagOn: boolean; sourceRunnable: boolean }): Promise<{ skipped: FieldSkipReason } | FieldCollectSummary> {
  const gate = fieldGate({ flagOn: deps.flagOn, hasKey: !!deps.key, endpointSet: !!deps.spec.baseUrl && !!deps.spec.keyParam && !!deps.spec.idField, sourceRunnable: deps.sourceRunnable });
  if (!gate.run) return { skipped: gate.reason };
  return collectField({ ...deps, key: deps.key as string });
}
