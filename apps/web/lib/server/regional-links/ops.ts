import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseConfirmLink, parseCreateLink, parseRemoveLink, parseSuggest, refKey, statusConflict, type LinkRef } from "@/lib/admin/regional-link-rules";
import { targetOf, writeAudit } from "../audit";
import { nowIso } from "../articles/service";
import { dbError, errorJson, json } from "../http";
import { loadLink } from "./board";

// 지역 연결 쓰기 작업 (W4 13단계 — PRD-01B REG1-10 · docs/dev/W4_설계.md 1장 13단계 · 12장 100번~) — 지역 연결 API(/api/admin/regional-links)와
// 프로젝트 관리 API(/api/admin/projects op=link — 14단계)가 같은 함수를 쓴다. 권한 판정(regional_link.confirm)은 부르는 쪽이 먼저 한다.
//  · suggest — 같은 지역 자동 후보 찾기(DB 함수 regional_link_suggest). 감사 regional_link.suggest(만든 수 > 0)
//  · create  — 편집자 연결(confirm=true면 이유 필수 + 바로 확인). 관광 항목 422 · 같은 쌍 409 · 없는 대상 422 · 비공개 목적지 확인 409(DB 문장)
//  · confirm — 후보 확인(이유 필수). remove — 지우기(이유 필수, 되살리기 0)
// from을 주면(프로젝트 화면) 출발은 그 대상으로 고정되고, 확인·지우기는 그 대상에서 나가는 연결만 받는다(다른 연결 번호 404).
export type LinkOp = "suggest" | "create" | "confirm" | "remove";

export async function runLinkOp(db: SupabaseClient, actor: string, op: string, body: Record<string, unknown>, from?: LinkRef): Promise<Response> {
  const input = from ? { ...body, fromType: from.type, fromId: from.id } : body;

  if (op === "suggest") {
    const parsed = parseSuggest(input);
    if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
    const ref = parsed.value;
    const { data, error } = await db.rpc("regional_link_suggest", { p_from_type: ref.type, p_from_id: ref.id, p_actor: actor });
    if (error) throw dbError(error, "regional_link_suggest");
    const created = Number(data ?? 0);
    if (created > 0) {
      await writeAudit(db, { actor, action: "regional_link.suggest", target: targetOf.regionalLinkFrom(ref.type, ref.id), before: null, after: { created }, reason: `같은 지역 자동 후보 ${created}건` });
    }
    return json({ created });
  }

  if (op === "create") {
    const parsed = parseCreateLink(input);
    if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
    const { from: start, to, relation, reason, confirm } = parsed.value;
    const now = nowIso();
    const row = {
      from_type: start.type,
      from_id: start.id,
      to_type: to.type,
      to_id: to.id,
      relation,
      reason,
      origin: "editor",
      status: confirm ? "confirmed" : "candidate",
      confirmed_by: confirm ? actor : null,
      confirmed_at: confirm ? now : null,
      created_by: actor,
    };
    const { data, error } = await db.from("regional_links").insert(row).select("id").single();
    if (error) {
      if (error.code === "23505") return errorJson(409, "같은 두 대상의 연결이 이미 있습니다 — 그 연결을 확인하거나 지운 뒤 새로 만드세요");
      if (error.code === "23503") return errorJson(422, "연결 대상이 없습니다 — 번호를 확인하세요", { errors: [`toId: ${error.message}`] });
      throw dbError(error, "regional_links 만들기");
    }
    const id = Number((data as { id: number }).id);
    await writeAudit(db, {
      actor,
      action: confirm ? "regional_link.confirm" : "regional_link.create",
      target: targetOf.regionalLink(id),
      before: null,
      after: { from: `${start.type}:${start.id}`, to: `${to.type}:${to.id}`, relation, status: row.status, origin: "editor" },
      reason: reason ?? "편집자 연결 후보",
    });
    return json({ link: await loadLink(db, id) }, 201);
  }

  if (op === "confirm" || op === "remove") {
    const parsed = op === "confirm" ? parseConfirmLink(input) : parseRemoveLink(input);
    if (!parsed.ok) return errorJson(422, "입력값을 확인하세요", { errors: parsed.errors });
    const { linkId, reason } = parsed.value;
    const before = await loadLink(db, linkId);
    if (!before) return errorJson(404, "연결이 없습니다");
    if (from && refKey({ type: before.from_type, id: before.from_id }) !== refKey(from)) return errorJson(404, `${refKey(from)}에서 나가는 연결이 아닙니다`);
    const next = op === "confirm" ? "confirmed" : "removed";
    const conflict = statusConflict(before.status, next);
    if (conflict) return errorJson(409, conflict);
    const relation = op === "confirm" && "relation" in parsed.value && parsed.value.relation ? parsed.value.relation : before.relation;
    const columns = op === "confirm" ? { status: "confirmed", confirmed_by: actor, confirmed_at: nowIso(), reason, relation } : { status: "removed" };
    const { data, error } = await db.from("regional_links").update(columns).eq("id", linkId).eq("status", before.status).select("id").maybeSingle();
    if (error) throw dbError(error, op === "confirm" ? "regional_links 확인" : "regional_links 지우기");
    if (!data) return errorJson(409, "다른 사람이 먼저 바꿨습니다 — 화면을 새로 고치세요");
    await writeAudit(db, {
      actor,
      action: op === "confirm" ? "regional_link.confirm" : "regional_link.remove",
      target: targetOf.regionalLink(linkId),
      before: { status: before.status, relation: before.relation, reason: before.reason, confirmedBy: before.confirmed_by },
      after: op === "confirm" ? { status: "confirmed", relation, reason, confirmedBy: actor } : { status: "removed" },
      reason,
    });
    return json({ link: await loadLink(db, linkId) });
  }

  return errorJson(422, "op는 suggest·create·confirm·remove 중 하나여야 합니다");
}
