// 법령 변경 감지 (PIPE-01 · PIPE-06 · PIPE-07) — SM `agents/law-watch.ts`의 판정 규칙을 복사하고, 저장은 `LawStore`(웹 앱이 넘기는 서버 기능)로 바꾼 것.
// 하는 일: 현행 시행일자·공포번호를 조회해 지난 값과 비교하고, 달라졌으면 새 개정판 + 감지 기록 + 검수 항목(법령 변경) 1건을 만든다.
// 하지 않는 일: 룰셋·개정 트래커(amendment_events)를 건드리지 않는다 — 후보는 검수 큐에만 두고 승인할 때 다른 단위가 반영한다. AI도 쓰지 않는다.
// 실패한 실행은 공개 자료(개정판·조문)를 바꾸지 않는다 — 감시 상태에만 실패를 적는다 (PIPE-06).
import { redactCredentials, publicLawUrl } from "../credentials.ts";
import { LawApiError, type LawApi, type LawSnapshot } from "./law-api.ts";
import { parseLawArticles, type ParsedArticle } from "./articles.ts";

export interface PrevState {
  promulgationNo: string | null;
  effectiveOn: string | null;
  bodyHash: string | null;
  failCount: number;
}

export interface WatchedLaw {
  lawId: number;
  name: string;
  lawKey: string | null;
  /** null = 아직 한 번도 확인하지 않음 */
  prev: PrevState | null;
}

/**
 * 세 가지 차이 신호를 "개정인가 / 텍스트 정비인가"로 가른다 (SM 원본 그대로).
 * 2026-07-30 오탐 8건의 원인이 이 판정이었다 — 공포번호·시행일자가 그대로인 해시 차이는 개정이 아니다.
 */
export function classifyChange(signals: { readonly dateChanged: boolean; readonly promulgationChanged: boolean; readonly bodyChanged: boolean }): { readonly changed: boolean; readonly bodyOnly: boolean } {
  const changed = signals.dateChanged || signals.promulgationChanged;
  return { changed, bodyOnly: !changed && signals.bodyChanged };
}

export interface NewSnapshot {
  sourceKey: string;
  externalId: string;
  url: string;
  payload: string;
  contentHash: string;
  httpStatus: number;
}

export interface VersionInput {
  kind: "first_seen" | "revision";
  snapshot: NewSnapshot;
  snapshotPublicUrl: string;
  lawKey: string;
  lawSerial: string;
  promulgationNo: string;
  promulgatedOn: string;
  effectiveOn: string;
  revisionKind: string;
  bodyHash: string;
  articles: ParsedArticle[];
  articlesParsed: boolean;
  reasons: string[];
  before: { promulgationNo: string | null; effectiveOn: string | null } | null;
}

/** 웹 앱이 넘기는 저장 기능 — 멱등해야 한다(같은 개정판·사건·검수 키는 다시 넣어도 1건). 순서: 스냅샷 → 개정판 → 조문 → 감지 기록 → 검수 항목 → 감시 상태 */
export interface LawStore {
  listWatched(): Promise<WatchedLaw[]>;
  /** 확인했지만 변화 없음 — 감시 상태만 갱신 */
  recordUnchanged(law: WatchedLaw, checkedAt: Date, snapshot: LawSnapshot, bodyHash: string | null): Promise<void>;
  /** 공포번호·시행일자 그대로 본문 해시만 달라짐 — 스냅샷 + 기록(body_only)만, 개정판·검수 항목 없음 */
  recordBodyOnly(law: WatchedLaw, checkedAt: Date, snapshot: LawSnapshot, body: NewSnapshot): Promise<void>;
  /** 처음 본 법령(기준 개정판) 또는 개정 — 개정판 + 조문 + 감지 기록, 개정이면 검수 항목 1건 */
  recordVersion(law: WatchedLaw, checkedAt: Date, snapshot: LawSnapshot, input: VersionInput): Promise<{ reviewItemCreated: boolean }>;
  /** 조회 실패·검색 결과 없음 — 감시 상태 api_error만, 공개 자료는 그대로 */
  recordFailure(law: WatchedLaw, checkedAt: Date, message: string, notFound: boolean): Promise<void>;
}

export type LawOutcome =
  | { kind: "unchanged"; lawName: string }
  | { kind: "first_seen"; lawName: string; effectiveDate: string }
  | { kind: "changed"; lawName: string; from: string | null; to: string; reviewItemCreated: boolean }
  | { kind: "body_only"; lawName: string }
  | { kind: "not_found"; lawName: string }
  | { kind: "api_error"; lawName: string; message: string };

export interface LawCheckSummary {
  checkedAt: string;
  checked: number;
  unchanged: number;
  firstSeen: number;
  changed: number;
  bodyOnly: number;
  notFound: number;
  apiErrors: number;
}

export async function checkOneLaw(law: WatchedLaw, api: LawApi, store: LawStore, checkedAt: Date, secrets: readonly string[] = []): Promise<LawOutcome> {
  let snapshot: LawSnapshot | null;
  try {
    snapshot = await api.searchLaw(law.name);
  } catch (error) {
    const message = redactCredentials(error instanceof LawApiError ? error.message : String(error), secrets);
    await store.recordFailure(law, checkedAt, message, false);
    return { kind: "api_error", lawName: law.name, message };
  }
  if (!snapshot) {
    await store.recordFailure(law, checkedAt, "법령 검색 결과에 정확히 일치하는 현행 법령이 없습니다.", true);
    return { kind: "not_found", lawName: law.name };
  }

  const prev = law.prev;
  const firstSeen = prev === null || prev.effectiveOn === null;
  const dateChanged = !firstSeen && prev!.effectiveOn !== snapshot.effectiveDate;
  const promulgationChanged = !firstSeen && prev!.promulgationNo !== null && prev!.promulgationNo !== snapshot.promulgationNo;

  // 본문은 첫 확인·개정·해시 비교에 필요하다. 비교만 필요한 날(변화 신호 없음)에도 받아 해시를 본다.
  const body = await api.getLawBody(snapshot.lawId);
  const bodyChanged = !firstSeen && prev!.bodyHash !== null && body !== null && prev!.bodyHash !== body.hash;
  const { changed, bodyOnly } = classifyChange({ dateChanged, promulgationChanged, bodyChanged });

  if (!firstSeen && !changed && !bodyOnly) {
    await store.recordUnchanged(law, checkedAt, snapshot, body?.hash ?? null);
    return { kind: "unchanged", lawName: law.name };
  }

  if (body === null) {
    // 스냅샷 없이는 개정판·기록을 저장하지 않는다(PIPE-07). 다음 실행에서 다시 본다.
    const message = "법령 본문을 받지 못해 저장하지 않았습니다(스냅샷 없이 저장 안 함).";
    await store.recordFailure(law, checkedAt, message, false);
    return { kind: "api_error", lawName: law.name, message };
  }

  const newSnapshot: NewSnapshot = {
    sourceKey: "law_api",
    externalId: snapshot.lawId,
    url: body.safeUrl,
    payload: body.text,
    contentHash: body.hash,
    httpStatus: body.status,
  };

  if (bodyOnly) {
    await store.recordBodyOnly(law, checkedAt, snapshot, newSnapshot);
    return { kind: "body_only", lawName: law.name };
  }

  const parsed = parseLawArticles(body.text);
  const { reviewItemCreated } = await store.recordVersion(law, checkedAt, snapshot, {
    kind: firstSeen ? "first_seen" : "revision",
    snapshot: newSnapshot,
    snapshotPublicUrl: publicLawUrl(snapshot.lawName),
    lawKey: snapshot.lawId,
    lawSerial: snapshot.lawSerial,
    promulgationNo: snapshot.promulgationNo,
    promulgatedOn: snapshot.promulgationDate,
    effectiveOn: snapshot.effectiveDate,
    revisionKind: snapshot.revisionType,
    bodyHash: body.hash,
    articles: parsed.articles,
    articlesParsed: parsed.ok,
    reasons: [dateChanged ? "시행일자 변경" : null, promulgationChanged ? "공포번호 변경" : null, bodyChanged ? "조문 본문 해시 변경(동반)" : null].filter((r): r is string => r !== null),
    before: firstSeen ? null : { promulgationNo: prev!.promulgationNo, effectiveOn: prev!.effectiveOn },
  });
  if (firstSeen) return { kind: "first_seen", lawName: law.name, effectiveDate: snapshot.effectiveDate };
  return { kind: "changed", lawName: law.name, from: prev!.effectiveOn, to: snapshot.effectiveDate, reviewItemCreated };
}

/** 감시 대상 전체를 한 바퀴 — 한 법령의 오류가 나머지를 멈추지 않는다 */
export async function runLawCheck(deps: { api: LawApi; store: LawStore; now: Date; secrets?: readonly string[] }): Promise<{ summary: LawCheckSummary; outcomes: LawOutcome[] }> {
  const laws = await deps.store.listWatched();
  const outcomes: LawOutcome[] = [];
  for (const law of laws) outcomes.push(await checkOneLaw(law, deps.api, deps.store, deps.now, deps.secrets ?? []));
  const count = (k: LawOutcome["kind"]) => outcomes.filter((o) => o.kind === k).length;
  return {
    outcomes,
    summary: {
      checkedAt: deps.now.toISOString(),
      checked: outcomes.length,
      unchanged: count("unchanged"),
      firstSeen: count("first_seen"),
      changed: count("changed"),
      bodyOnly: count("body_only"),
      notFound: count("not_found"),
      apiErrors: count("api_error"),
    },
  };
}
