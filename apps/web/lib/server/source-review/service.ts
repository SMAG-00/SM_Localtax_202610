import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchOriginal, snapshotHash, snapshotPayload, type Fetcher } from "@/lib/source-review/fetch";
import { runKeyOf, type RefetchInput } from "@/lib/source-review/rules";
import { HttpError } from "../http";

// 원문 검수 큐 서버 기능 (W4 6단계 — PRD-01B REG1-13, docs/dev/W4_설계.md 1장 6단계 · 4장). DB 판정은 마이그레이션 …42 함수가 한다.
//  · 원문 다시 받기(수동) — 편집 책임자가 누르면 출처의 원문 주소(source_url)를 한 번 받아(고정 User-Agent·쿠키·Referer 0·시간 제한·크기 한도)
//    해시를 낸다. 편집자가 원문을 붙여 넣으면 그 글자의 해시를 쓴다(주소가 내려받기를 막는 기관 — 처음 스냅샷을 붙여 넣은 출처와 같은 방식).
//    판정(같은 주소를 쓴 공식 자료마다 해시 비교 → 다르면 항목 1건)은 DB 함수 source_snapshot_refetched가 한 트랜잭션으로 한다.
//  · 시점 만료 배치(source-expiry) — 실행 키 = 한국 날짜. DB 함수 source_expiry_scan이 설정 official_source_expiry_days로 잰다.
//  · 원문 글자는 원본 스냅샷(raw_snapshots)에만 두고 어떤 화면에도 그리지 않는다(W4 12장 #19). 결과·감사에는 수와 해시만.
export interface RefetchResult {
  sourceId: number;
  method: "fetched" | "pasted";
  hash: string;
  snapshotId: number;
  targets: number;
  opened: number;
  unchanged: number;
  alreadyQueued: number;
  noSnapshot: number;
  /** 같은 원문 주소를 쓴 프로젝트 단계 기록 (W4 12단계 — 정정되지 않은 단계 기록) */
  projectTargets: number;
  projectOpened: number;
  /** 같은 원문 주소를 쓴 개발방법 사실 행 (W4 18단계 — 최신 판만) */
  methodTargets: number;
  methodOpened: number;
}

interface SourceRow {
  id: number;
  article_id: number;
  kind: string;
  source_url: string | null;
}

/** 원문 다시 받기 — 출처 하나를 골라 그 주소를 쓴 모든 공식 자료를 비교한다. 받지 못하면 502(항목 0) */
export async function refetchSource(db: SupabaseClient, input: RefetchInput, actor: string, opts: { fetcher?: Fetcher; timeoutMs?: number } = {}): Promise<RefetchResult> {
  const { data, error } = await db.from("article_sources").select("id, article_id, kind, source_url").eq("id", input.sourceId).limit(1);
  if (error) throw new HttpError(500, "출처를 읽지 못했습니다");
  const src = (data ?? [])[0] as SourceRow | undefined;
  if (!src) throw new HttpError(404, `출처 src:${input.sourceId}가 없습니다`);
  if (src.kind !== "official_doc" && src.kind !== "dataset") {
    throw new HttpError(422, "입력값을 확인하세요", { errors: [`sourceId: 원문 다시 받기는 공식 자료(official_doc·dataset) 출처만 합니다 (src:${src.id}는 ${src.kind})`] });
  }
  const url = (src.source_url ?? "").trim();
  if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new HttpError(422, "입력값을 확인하세요", { errors: [`sourceId: 출처 src:${src.id}에 http(s) 원문 주소가 없습니다`] });

  let bytes: Uint8Array;
  let method: RefetchResult["method"];
  if (input.text !== null) {
    bytes = new TextEncoder().encode(input.text);
    method = "pasted";
  } else {
    const got = await fetchOriginal(url, opts);
    if (!got.ok) throw new HttpError(502, `원문을 받지 못했습니다 — ${got.reason}. 검수 항목은 만들지 않았습니다`);
    bytes = got.bytes;
    method = "fetched";
  }
  const hash = snapshotHash(bytes);
  const rpc = await db.rpc("source_snapshot_refetched", {
    p_url: url,
    p_hash: hash,
    p_payload: method === "pasted" ? (input.text as string) : snapshotPayload(bytes),
    p_source: "공식 자료 다시 받기",
    p_actor: actor,
  });
  if (rpc.error) {
    console.error("[source-review] 다시 받기 기록 실패:", rpc.error.code, rpc.error.message);
    throw new HttpError(rpc.error.code === "23514" ? 422 : 500, rpc.error.code === "23514" ? rpc.error.message : "원문 다시 받기 기록을 남기지 못했습니다");
  }
  const r = rpc.data as Record<string, number>;
  return {
    sourceId: src.id,
    method,
    hash,
    snapshotId: Number(r.snapshotId),
    targets: Number(r.targets),
    opened: Number(r.opened),
    unchanged: Number(r.unchanged),
    alreadyQueued: Number(r.alreadyQueued),
    noSnapshot: Number(r.noSnapshot),
    projectTargets: Number(r.projectTargets ?? 0),
    projectOpened: Number(r.projectOpened ?? 0),
    methodTargets: Number(r.methodTargets ?? 0),
    methodOpened: Number(r.methodOpened ?? 0),
  };
}

/** 시점 만료 배치 (workflows source-expiry) — 실행 키 = 한국 날짜. 결과는 수뿐(주소·제목 0) */
export async function scanSourceExpiry(db: SupabaseClient, now: Date): Promise<Record<string, unknown>> {
  const { data, error } = await db.rpc("source_expiry_scan", { p_today: runKeyOf(now) });
  if (error) throw new Error(`시점 만료 배치 실패 (${error.code})`);
  return data as Record<string, unknown>;
}
