import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FieldStore } from "@ltr/workflows/field-data";
import { openReviewItem, saveSnapshot } from "../pipelines/stores";

// 분야 데이터 수집의 저장소 구현 (W10-h h1 — PR-06 · LG-15 · DF-06). service_role 클라이언트로 DB에 쓴다.
//  · 후보는 검수 항목(종류 field_data)뿐이다 - 공개 표에는 쓰지 않는다 (공개 반영은 승인 뒤 DB 함수 field_publish)
//  · 검수 키 = field:{원천}:{항목}:{값 해시 앞 16}:{유형 또는 none} - 같은 값 재수집은 키 충돌로 후보 1건, 값이 바뀌면 새 후보
//  · 스냅샷은 (원천, 번호, 해시) 유일 - 같은 응답은 한 행

const fail = (what: string, e: { code?: string; message: string }) => new Error(`${what}: ${e.code ?? ""} ${e.message}`.trim());

export function supabaseFieldStore(db: SupabaseClient): FieldStore {
  return {
    async latest(sourceKey, sourceItemId) {
      const r = await db.from("review_items").select("payload").eq("kind", "field_data").eq("data_source_key", sourceKey).eq("payload->>source_item_id", sourceItemId).order("id", { ascending: false }).limit(1);
      if (r.error) throw fail("review_items 조회", r.error);
      const p = (r.data?.[0] as { payload?: { value_hash?: string; fields?: Record<string, unknown> } } | undefined)?.payload;
      return p?.value_hash ? { valueHash: p.value_hash, fields: p.fields ?? {} } : null;
    },

    async projectSlugFor(sourceKey, sourceItemId) {
      const l = await db.from("project_source_links").select("project_id").eq("source_key", sourceKey).eq("source_item_id", sourceItemId).limit(1);
      if (l.error) throw fail("project_source_links 조회", l.error);
      const projectId = (l.data?.[0] as { project_id: number } | undefined)?.project_id;
      if (projectId === undefined) return null;
      const p = await db.from("projects").select("slug").eq("id", projectId).limit(1);
      if (p.error) throw fail("projects 조회", p.error);
      return (p.data?.[0] as { slug: string } | undefined)?.slug ?? null;
    },

    async commitCandidate({ spec, snapshot, candidate, title }) {
      const snapshotId = await saveSnapshot(db, snapshot);
      const created = await openReviewItem(db, {
        kind: "field_data",
        sourceKey: `field:${spec.sourceKey}:${candidate.sourceItemId}:${candidate.valueHash.slice(0, 16)}:${candidate.koglType ?? "none"}`,
        title, dataSourceKey: spec.sourceKey, snapshotId, createdBy: "pipeline:field",
        payload: { target: candidate.target, source_item_id: candidate.sourceItemId, value_hash: candidate.valueHash, kogl_type: candidate.koglType, changed_fields: candidate.changedFields, fields: candidate.fields },
      });
      return { created };
    },

    async recordSourceFailure({ sourceKey, day, message }) {
      await openReviewItem(db, { kind: "pipeline_failure", sourceKey: `${sourceKey}:${day}`, title: `${sourceKey} 수집 실패`, dataSourceKey: sourceKey, snapshotId: null, createdBy: "pipeline:field", payload: { message: message.slice(0, 300) } });
    },
  };
}
