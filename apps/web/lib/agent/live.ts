// 공식 원문 실시간 조회 견본 계약 + 허용 호스트 (W12-b b3, PRD-04 6.3 · ASK-16 · ASK-17, 4단계 설계 4.1).
// 바깥 호출 주소는 이 모듈의 허용 목록뿐이다. 응답 원본은 인용하기 전에 스냅샷 저장소에 먼저 저장하고, 저장에 실패하면 인용 0.
// 질문당 횟수·시간·발췌 상한은 ask_live_fetch_policy 설정 값이다. 서버 연결(스냅샷 저장)은 OC 등록 요건 확인 전까지 꺼 둔다(설계 5장 #17).
import { createHash } from "node:crypto";
import type { LivePolicy } from "./ask-limits";
import { approxTokens, type EvidenceDoc } from "./evidence";

/** 허용 호스트 - 국가법령정보·위택스·행정안전부·조세심판원·대법원 [확인 필요: 도메인 확정 - PRD-04 ASK-17] */
export const ALLOWED_LIVE_HOSTS: readonly string[] = ["www.law.go.kr", "open.law.go.kr", "www.wetax.go.kr", "www.mois.go.kr", "www.ttax.go.kr", "www.scourt.go.kr"];

export function hostAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ALLOWED_LIVE_HOSTS.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export class LiveHostError extends Error {
  constructor(readonly host: string) {
    super("허용 목록 밖 호스트");
    this.name = "LiveHostError";
  }
}

/** 허용 목록 밖 주소는 네트워크에 나가기 전에 던진다 */
export function guardedFetch(inner: typeof fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!hostAllowed(url)) throw new LiveHostError(safeHost(url));
    return inner(input, init);
  }) as typeof fetch;
}
const safeHost = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid";
  }
};

export type LiveTarget = "law" | "case" | "interpretation";
export interface LiveRequest {
  targetType: LiveTarget;
  /** 마스킹을 거친 질의 */
  query: string;
  asOf?: string;
}
export type LiveResult =
  | { ok: true; doc: EvidenceDoc; latencyMs: number; targetType: LiveTarget; snapshotId: number }
  | { ok: false; reason: "limit" | "timeout" | "host" | "http" | "snapshot" | "empty" | "disabled"; latencyMs: number; targetType: LiveTarget };

export interface SnapshotStore {
  /** 응답 원본을 raw_snapshots(origin live_fetch)에 저장하고 ID를 돌려준다. 실패하면 null */
  put(s: { url: string; payload: string; hash: string; origin: "live_fetch" | "web_search" }): Promise<number | null>;
}
export interface LiveFetcher {
  fetchOfficial(req: LiveRequest): Promise<LiveResult>;
  readonly callsMade: number;
}

export interface LiveFetcherOptions {
  fetchImpl: typeof fetch;
  /** 국가법령정보 OC - 주소 질의값으로만 쓰고 스냅샷 주소에는 남기지 않는다 */
  oc: string;
  store: SnapshotStore;
  policy: LivePolicy;
  now?: () => Date;
  /** 시험에서 주소 조립을 바꿔 허용 밖 호스트 거부를 확인할 때 */
  buildUrl?: (req: LiveRequest, oc: string) => string;
}

const TARGET_PARAM: Record<LiveTarget, string> = { law: "law", case: "prec", interpretation: "expc" };
export const defaultLiveUrl = (req: LiveRequest, oc: string): string =>
  `https://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(oc)}&target=${TARGET_PARAM[req.targetType]}&type=JSON&query=${encodeURIComponent(req.query)}`;

const stripOc = (url: string): string => {
  const u = new URL(url);
  u.searchParams.delete("OC");
  return u.href;
};

/** 질문 한 건당 하나를 만든다 - 호출 횟수는 이 객체가 센다 */
export function createLiveFetcher(o: LiveFetcherOptions): LiveFetcher {
  const now = o.now ?? (() => new Date());
  const build = o.buildUrl ?? defaultLiveUrl;
  const doFetch = guardedFetch(o.fetchImpl);
  let calls = 0;
  return {
    get callsMade() {
      return calls;
    },
    async fetchOfficial(req) {
      const started = Date.now();
      const fail = (reason: Extract<LiveResult, { ok: false }>["reason"]): LiveResult => ({ ok: false, reason, latencyMs: Date.now() - started, targetType: req.targetType });
      if (calls >= o.policy.maxCalls) return fail("limit");
      calls += 1;
      const url = build(req, o.oc);
      if (!hostAllowed(url)) return fail("host");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), o.policy.timeoutMs);
      let payload: string;
      try {
        const res = await doFetch(url, { signal: controller.signal });
        if (!res.ok) return fail("http");
        payload = await res.text();
      } catch (err) {
        if (err instanceof LiveHostError) return fail("host");
        return fail(controller.signal.aborted ? "timeout" : "http");
      } finally {
        clearTimeout(timer);
      }
      if (payload.trim() === "") return fail("empty");
      const hash = createHash("sha256").update(payload).digest("hex");
      const storedUrl = stripOc(url);
      const snapshotId = await o.store.put({ url: storedUrl, payload, hash, origin: "live_fetch" });
      if (snapshotId === null) return fail("snapshot");
      // 발췌 상한 - 문서당 excerptTokens (토큰 어림 글자/2)
      let excerpt = payload;
      while (approxTokens(excerpt) > o.policy.excerptTokens) excerpt = excerpt.slice(0, Math.max(1, Math.floor(excerpt.length * 0.9)));
      const doc: EvidenceDoc = {
        sourceId: `snap:${snapshotId}`,
        sourceType: "live_snapshot",
        docType: req.targetType === "law" ? "law" : req.targetType === "case" ? "tribunal" : "interpretation",
        path: `실시간 조회 > ${req.query}`,
        content: excerpt,
        taxItems: [],
        validFrom: (req.asOf ?? now().toISOString().slice(0, 10)).slice(0, 10),
        validTo: null,
        scope: "base",
        accessTier: "public",
        chunkId: null,
        snapshotId,
        isLive: true,
        snapshotOk: true,
        fetchedAt: now().toISOString(),
        mapVersion: null,
        reviewedOn: null,
        score: 0,
      };
      return { ok: true, doc, latencyMs: Date.now() - started, targetType: req.targetType, snapshotId };
    },
  };
}

/** 공식 도메인 검색(ASK-17) 결과 거르기 - 허용 호스트 밖 결과는 버리고, 본문을 스냅샷에 저장한 것만 문서로 만든다 */
export async function filterOfficialSearch(results: ReadonlyArray<{ url: string; title: string; text: string }>, store: SnapshotStore, now: () => Date = () => new Date()): Promise<EvidenceDoc[]> {
  const out: EvidenceDoc[] = [];
  for (const r of results) {
    if (!hostAllowed(r.url)) continue;
    const hash = createHash("sha256").update(r.text).digest("hex");
    const id = await store.put({ url: r.url, payload: r.text, hash, origin: "web_search" });
    if (id === null) continue;
    out.push({
      sourceId: `snap:${id}`, sourceType: "live_snapshot", docType: "interpretation", path: `공식 검색 > ${r.title}`, content: r.text, taxItems: [],
      validFrom: now().toISOString().slice(0, 10), validTo: null, scope: "base", accessTier: "public", chunkId: null, snapshotId: id, isLive: true, snapshotOk: true,
      fetchedAt: now().toISOString(), mapVersion: null, reviewedOn: null, score: 0,
    });
  }
  return out;
}
