import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocStore, LawStore, NewSnapshot, WatchedLaw } from "@ltr/workflows/pipelines";
import { decisionKindOf } from "@ltr/workflows/pipelines";

// 수집 파이프라인의 저장소 구현 (W10-c — PIPE-01~04 · PIPE-06 · PIPE-07). service_role 클라이언트로 DB에 쓴다.
//  · 모든 쓰기는 멱등이다 — 같은 개정판·사건·검수 키·원천 번호는 다시 넣어도 1건(유일 제약 충돌은 '이미 있음'으로 본다)
//  · 순서: 스냅샷 → 개정판/문서 → 조문 → 감지 기록 → 검수 항목 → 감시 상태. 중간에 끊겨도 다음 실행이 같은 순서로 이어 채운다
//  · 인증키는 여기까지 오지 않는다(스냅샷 주소는 키 없는 주소, DB 제약 raw_snapshots_url_no_credential이 한 번 더 막는다)
//  · 이 파일은 review_items·agent_runs 밖의 공개 자료를 지우거나 덮어쓰지 않는다 (추가만)

const DUP = "23505";
type Db = SupabaseClient;
const fail = (what: string, e: { code?: string; message: string }) => new Error(`${what}: ${e.code ?? ""} ${e.message}`.trim());

/** 같은 (원천, 번호, 해시)의 스냅샷은 한 행 — 있으면 그 번호를 돌려준다 */
export async function saveSnapshot(db: Db, s: NewSnapshot): Promise<number> {
  const find = async () => {
    const r = await db.from("raw_snapshots").select("id").eq("source_key", s.sourceKey).eq("external_id", s.externalId).eq("content_hash", s.contentHash).limit(1);
    if (r.error) throw fail("raw_snapshots 조회", r.error);
    return (r.data?.[0] as { id: number } | undefined)?.id;
  };
  const existing = await find();
  if (existing !== undefined) return existing;
  const ins = await db.from("raw_snapshots").insert({ source: s.sourceKey, url: s.url, content_hash: s.contentHash, payload: s.payload, source_key: s.sourceKey, external_id: s.externalId, http_status: s.httpStatus }).select("id").single();
  if (ins.error) {
    if (ins.error.code === DUP) {
      const again = await find();
      if (again !== undefined) return again;
    }
    throw fail("raw_snapshots 저장", ins.error);
  }
  return (ins.data as { id: number }).id;
}

/** 검수 항목 1건 — (종류, 키)가 이미 있으면 만들지 않고 false */
export async function openReviewItem(db: Db, row: { kind: string; sourceKey: string; title: string; dataSourceKey: string | null; snapshotId: number | null; payload: Record<string, unknown>; createdBy: string; parts?: string[] }): Promise<boolean> {
  const ins = await db.from("review_items").insert({
    kind: row.kind, source_key: row.sourceKey, title: row.title.slice(0, 200), data_source_key: row.dataSourceKey,
    snapshot_id: row.snapshotId, payload: row.payload, parts: row.parts ?? [], created_by: row.createdBy,
  });
  if (ins.error) {
    if (ins.error.code === DUP) return false;
    throw fail("review_items 저장", ins.error);
  }
  return true;
}

async function insertIgnoreDup(db: Db, table: string, row: Record<string, unknown>): Promise<boolean> {
  const ins = await db.from(table).insert(row);
  if (ins.error) {
    if (ins.error.code === DUP) return false;
    throw fail(`${table} 저장`, ins.error);
  }
  return true;
}

export function supabaseLawStore(db: Db): LawStore {
  const upsertState = async (lawId: number, patch: Record<string, unknown>) => {
    const r = await db.from("law_watch_state").upsert({ law_id: lawId, ...patch }, { onConflict: "law_id" });
    if (r.error) throw fail("law_watch_state 저장", r.error);
  };
  const setLawKey = async (law: WatchedLaw, lawKey: string) => {
    if (law.lawKey === lawKey) return;
    const r = await db.from("laws").update({ law_key: lawKey }).eq("id", law.lawId).is("law_key", null);
    if (r.error && r.error.code !== DUP) throw fail("laws 법령 번호", r.error);
  };

  return {
    async listWatched() {
      const laws = await db.from("laws").select("id, name, law_key").eq("watch", true).order("id");
      if (laws.error) throw fail("laws 조회", laws.error);
      const states = await db.from("law_watch_state").select("law_id, status, last_promulgation_no, last_effective_on, last_body_hash, fail_count");
      if (states.error) throw fail("law_watch_state 조회", states.error);
      const byLaw = new Map((states.data ?? []).map((s) => [Number((s as { law_id: number }).law_id), s as Record<string, unknown>]));
      const out: WatchedLaw[] = [];
      for (const l of (laws.data ?? []) as { id: number; name: string; law_key: string | null }[]) {
        const st = byLaw.get(Number(l.id));
        if (st?.status === "paused") continue;
        out.push({
          lawId: Number(l.id), name: l.name, lawKey: l.law_key,
          prev: st ? { promulgationNo: (st.last_promulgation_no as string | null) ?? null, effectiveOn: (st.last_effective_on as string | null) ?? null, bodyHash: (st.last_body_hash as string | null) ?? null, failCount: Number(st.fail_count ?? 0) } : null,
        });
      }
      return out;
    },

    async recordUnchanged(law, checkedAt, snapshot, bodyHash) {
      await setLawKey(law, snapshot.lawId);
      await upsertState(law.lawId, { status: "watching", last_checked_at: checkedAt.toISOString(), fail_count: 0, last_error: null, ...(bodyHash ? { last_body_hash: bodyHash } : {}) });
    },

    async recordBodyOnly(law, checkedAt, snapshot, body) {
      await setLawKey(law, snapshot.lawId);
      const snapshotId = await saveSnapshot(db, body);
      await insertIgnoreDup(db, "law_events", { law_id: law.lawId, kind: "body_only", event_key: body.contentHash, snapshot_id: snapshotId, summary: { note: "공포번호·시행일자 그대로 본문 해시만 달라짐 — 개정으로 보지 않음", promulgationNo: snapshot.promulgationNo, effectiveOn: snapshot.effectiveDate } });
      await upsertState(law.lawId, { status: "watching", last_checked_at: checkedAt.toISOString(), last_body_hash: body.contentHash, fail_count: 0, last_error: null });
    },

    async recordVersion(law, checkedAt, snapshot, input) {
      await setLawKey(law, input.lawKey);
      const snapshotId = await saveSnapshot(db, input.snapshot);
      const found = await db.from("law_versions").select("id").eq("law_id", law.lawId).eq("promulgation_no", input.promulgationNo).eq("effective_on", input.effectiveOn).limit(1);
      if (found.error) throw fail("law_versions 조회", found.error);
      let versionId = (found.data?.[0] as { id: number } | undefined)?.id;
      if (versionId === undefined) {
        const ins = await db.from("law_versions").insert({
          law_id: law.lawId, law_serial: input.lawSerial, promulgation_no: input.promulgationNo, promulgated_on: input.promulgatedOn,
          effective_on: input.effectiveOn, revision_kind: input.revisionKind || null, body_hash: input.bodyHash, snapshot_id: snapshotId,
        }).select("id").single();
        if (ins.error) throw fail("law_versions 저장", ins.error);
        versionId = (ins.data as { id: number }).id;
        for (let i = 0; i < input.articles.length; i += 200) {
          const chunk = input.articles.slice(i, i + 200).map((a) => ({ version_id: versionId, article_no: a.articleNo, branch_no: a.branchNo, title: a.title, body: a.body, effective_on: a.effectiveOn }));
          const arts = await db.from("law_articles").insert(chunk);
          if (arts.error) throw fail("law_articles 저장", arts.error);
        }
      }
      await insertIgnoreDup(db, "law_events", {
        law_id: law.lawId, kind: input.kind, event_key: `${input.promulgationNo}|${input.effectiveOn}`, version_id: versionId, snapshot_id: snapshotId,
        summary: { reasons: input.reasons, before: input.before, after: { promulgationNo: input.promulgationNo, effectiveOn: input.effectiveOn, revisionKind: input.revisionKind }, articleCount: input.articles.length, articlesParsed: input.articlesParsed },
      });
      let reviewItemCreated = false;
      if (input.kind === "revision") {
        reviewItemCreated = await openReviewItem(db, {
          kind: "law_change", sourceKey: `law:${law.lawId}:${input.promulgationNo}:${input.effectiveOn}`, title: `${law.name} 개정 감지`,
          dataSourceKey: "law_api", snapshotId, createdBy: "pipeline:law",
          payload: { lawId: law.lawId, lawName: law.name, versionId, promulgationNo: input.promulgationNo, promulgatedOn: input.promulgatedOn, effectiveOn: input.effectiveOn, revisionKind: input.revisionKind, before: input.before, reasons: input.reasons, articleCount: input.articles.length, articlesParsed: input.articlesParsed, publicUrl: input.snapshotPublicUrl },
        });
      }
      await upsertState(law.lawId, { status: "watching", last_checked_at: checkedAt.toISOString(), last_promulgation_no: input.promulgationNo, last_effective_on: input.effectiveOn, last_body_hash: input.bodyHash, fail_count: 0, last_error: null });
      return { reviewItemCreated };
    },

    async recordFailure(law, checkedAt, message, notFound) {
      const failCount = (law.prev?.failCount ?? 0) + 1;
      await upsertState(law.lawId, { status: "api_error", last_checked_at: checkedAt.toISOString(), fail_count: failCount, last_error: message.slice(0, 500) });
      // 연속 3번째 실패부터는 사람이 보게 같은 날 1건의 실패 검수 항목을 둔다 (PIPE-06 — 화면은 마지막 승인 자료 그대로)
      if (failCount >= 3) {
        await openReviewItem(db, { kind: "pipeline_failure", sourceKey: `law_api:${law.lawId}:${checkedAt.toISOString().slice(0, 10)}`, title: `${law.name} 조회 연속 실패`, dataSourceKey: "law_api", snapshotId: null, createdBy: "pipeline:law", payload: { lawId: law.lawId, failCount, notFound, message: message.slice(0, 300) } });
      }
    },
  };
}

export function supabaseDocStore(db: Db): DocStore {
  const docOf = async (sourceKey: string, docId: string) => {
    const r = await db.from("legal_docs").select("id, decided_on").eq("source_key", sourceKey).eq("source_doc_id", docId).limit(1);
    if (r.error) throw fail("legal_docs 조회", r.error);
    return (r.data?.[0] as { id: number; decided_on: string | null } | undefined) ?? null;
  };
  return {
    async findKnown(sourceKey, docId) {
      const own = await docOf(sourceKey, docId);
      if (own) return { legalDocId: Number(own.id), decidedOn: own.decided_on };
      const al = await db.from("legal_doc_aliases").select("legal_doc_id").eq("source_key", sourceKey).eq("source_doc_id", docId).limit(1);
      if (al.error) throw fail("legal_doc_aliases 조회", al.error);
      const aliasId = (al.data?.[0] as { legal_doc_id: number } | undefined)?.legal_doc_id;
      if (aliasId === undefined) return null;
      const d = await db.from("legal_docs").select("id, decided_on").eq("id", aliasId).limit(1);
      if (d.error) throw fail("legal_docs 조회", d.error);
      const row = d.data?.[0] as { id: number; decided_on: string | null } | undefined;
      return row ? { legalDocId: Number(row.id), decidedOn: row.decided_on } : null;
    },

    async commitNewDoc({ spec, item, snapshot }) {
      const snapshotId = await saveSnapshot(db, snapshot);
      // 검수 항목을 먼저 — 문서 저장 중 끊겨도 다음 실행이 문서를 채우고 항목은 그대로(키 충돌)
      const reviewed = await openReviewItem(db, {
        kind: "legal_doc", sourceKey: `${spec.sourceKey}:${item.docId}`, title: item.title, dataSourceKey: spec.sourceKey, snapshotId, createdBy: "pipeline:docs",
        payload: { sourceKey: spec.sourceKey, docId: item.docId, docType: spec.docType, docNo: item.docNo, issuer: item.issuer, decidedOn: item.decidedOn, decisionKind: decisionKindOf(item.decision) },
      });
      const ins = await db.from("legal_docs").insert({
        doc_type: spec.docType, origin: "pipeline", source_key: spec.sourceKey, source_doc_id: item.docId, issuer: item.issuer, doc_no: item.docNo,
        decided_on: item.decidedOn, decision_kind: decisionKindOf(item.decision), snapshot_id: snapshotId, content_hash: snapshot.contentHash,
      });
      if (ins.error && ins.error.code !== DUP) throw fail("legal_docs 저장", ins.error);
      return { created: reviewed || !ins.error };
    },

    async linkAlias({ legalDocId, sourceKey, docId, snapshot }) {
      const snapshotId = await saveSnapshot(db, snapshot);
      await insertIgnoreDup(db, "legal_doc_aliases", { legal_doc_id: legalDocId, source_key: sourceKey, source_doc_id: docId, snapshot_id: snapshotId });
    },

    async commitDateChange({ spec, item, known, snapshot }) {
      const snapshotId = await saveSnapshot(db, snapshot);
      const created = await openReviewItem(db, {
        kind: "legal_doc", sourceKey: `${spec.sourceKey}:${item.docId}:${item.decidedOn}`, title: `${item.title} (일자 변경)`, dataSourceKey: spec.sourceKey, snapshotId, createdBy: "pipeline:docs",
        payload: { change: "date_changed", legalDocId: known.legalDocId, sourceKey: spec.sourceKey, docId: item.docId, previousDecidedOn: known.decidedOn, decidedOn: item.decidedOn },
      });
      return { created };
    },

    async recordSourceFailure({ sourceKey, day, message }) {
      await openReviewItem(db, { kind: "pipeline_failure", sourceKey: `${sourceKey}:${day}`, title: `${sourceKey} 수집 실패`, dataSourceKey: sourceKey, snapshotId: null, createdBy: "pipeline:docs", payload: { message: message.slice(0, 300) } });
    },
  };
}
