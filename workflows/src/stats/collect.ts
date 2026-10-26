// 통계 수집기 틀 (W12-h h2 - DATA-01). 흐름: 관문 -> 목록 조회 -> 시계열 만들기(등록표의 필드만) -> DB 함수 stats_series_put(응답 원본 스냅샷 + 초안 1건).
// 하지 않는 일: 공개 반영(사람 승인 stats_series_approve), AI 요약·해석, 값 보정. 실패는 공개 자료를 바꾸지 않는다. AI 호출 0.
import { redactCredentials } from "../pipelines/credentials.ts";
import { sha256 } from "../pipelines/law/law-api.ts";
import { statsGate, type StatsSkipReason } from "./gate.ts";
import type { StatsCollectSummary, StatsFetch, StatsPut, StatsSeriesSpec, StatsSourceSpec, StatsStore } from "./types.ts";

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

const PERIOD = /^[0-9]{4}(-[0-9]{2})?$/;

/** 한 시계열의 점 만들기 - 시점 모양이 맞고 수치가 유한한 행만, 오름차순·중복 제거(먼저 나온 값 유지). 점이 없으면 null */
export function buildPoints(rows: readonly Record<string, unknown>[], spec: StatsSeriesSpec): { period: string; value: number }[] | null {
  const seen = new Map<string, number>();
  for (const r of rows) {
    if (spec.match && String(r[spec.match.field] ?? "").trim() !== spec.match.value) continue;
    const period = String(r[spec.periodField] ?? "").trim();
    const raw = r[spec.valueField];
    const value = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.replace(/,/g, "")) : Number.NaN;
    if (!PERIOD.test(period) || !Number.isFinite(value) || seen.has(period)) continue;
    seen.set(period, value);
  }
  if (seen.size === 0) return null;
  return [...seen.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([period, value]) => ({ period, value }));
}

/** 기준연도 = 가장 늦은 시점의 연도 */
export const baseYearOf = (points: readonly { period: string }[]): number => Number(points[points.length - 1].period.slice(0, 4));

/** 한국 날짜 (확인일) */
export const kstDate = (now: Date): string => new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

export function requestUrls(spec: StatsSourceSpec, key: string): { request: string; safe: string } {
  const safe = new URL(spec.baseUrl as string);
  for (const [k, v] of Object.entries(spec.params)) safe.searchParams.set(k, v);
  const request = new URL(safe.toString());
  request.searchParams.set(spec.keyParam, key);
  return { request: request.toString(), safe: safe.toString() };
}

export interface StatsCollectDeps {
  spec: StatsSourceSpec;
  fetch: StatsFetch;
  store: StatsStore;
  now: Date;
  /** 인증키 값 - 요청 주소에만 쓰고 저장·오류 글에는 가린다 */
  key: string;
}

type Summary = StatsCollectSummary & { errors: string[] };

export async function collectStats(deps: StatsCollectDeps): Promise<Summary> {
  const { spec, store } = deps;
  const summary: Summary = { sourceKey: spec.sourceKey, listed: 0, seriesBuilt: 0, created: 0, known: 0, rejected: 0, failed: 0, errors: [] };
  const fail = (e: unknown) => {
    summary.failed += 1;
    summary.errors.push(redactCredentials(e instanceof Error ? e.message : String(e), [deps.key]).slice(0, 300));
  };
  let rows: Record<string, unknown>[];
  let snapshot: StatsPut["snapshot"];
  try {
    const { request, safe } = requestUrls(spec, deps.key);
    const res = await deps.fetch(request);
    if (res.status < 200 || res.status >= 300) throw new Error(`원천 응답 상태 ${res.status}`);
    rows = findList(JSON.parse(res.text), spec.listRoot);
    snapshot = { url: safe, payload: res.text, content_hash: await sha256(res.text), http_status: res.status, external_id: spec.sourceKey };
  } catch (e) {
    fail(e);
    return summary; // 목록을 못 받으면 아무것도 저장하지 않는다
  }
  summary.listed = rows.length;
  for (const s of spec.series) {
    try {
      const points = buildPoints(rows, s);
      if (!points) { summary.rejected += 1; continue; }
      summary.seriesBuilt += 1;
      const r = await store.put({
        sourceKey: spec.sourceKey,
        snapshot: { ...snapshot, external_id: s.seriesKey },
        series: { series_key: s.seriesKey, title: s.title, tax_item: s.taxItem, region_code: s.regionCode, unit: s.unit, points, source_name: spec.sourceName, source_url: spec.sourceUrl, base_year: baseYearOf(points), checked_at: kstDate(deps.now) },
      });
      if (!r.ok) summary.rejected += 1;
      else if (r.created) summary.created += 1;
      else summary.known += 1;
    } catch (e) {
      fail(e); // 한 시계열의 오류가 나머지를 멈추지 않는다
    }
  }
  return summary;
}

/** 관문을 거쳐 수집 - 관문이 닫혀 있으면 fetch를 한 번도 부르지 않는다 */
export async function runStatsSource(deps: Omit<StatsCollectDeps, "key"> & { key: string | undefined; flagOn: boolean; sourceRunnable: boolean }): Promise<{ skipped: StatsSkipReason } | Summary> {
  const gate = statsGate({ flagOn: deps.flagOn, hasKey: !!deps.key, endpointSet: !!deps.spec.baseUrl && !!deps.spec.keyParam && deps.spec.series.length > 0, sourceRunnable: deps.sourceRunnable });
  if (!gate.run) return { skipped: gate.reason };
  return collectStats({ ...deps, key: deps.key as string });
}
