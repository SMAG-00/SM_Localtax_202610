import { campaignCopyProblems } from "@/lib/campaigns/copy-check";
import { parseCampaignInput } from "@/lib/campaigns/input";
import { actorOf } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import type { SupabaseClient } from "@supabase/supabase-js";

// 캠페인 랜딩 관리 (/admin/campaigns, GROW-03·04). 상태는 DB 함수만 바꾼다(직접 UPDATE로 approved 불가).
//  create·update·submit = campaign.edit / review = campaign.review_record(관리자) / approve·withdraw = campaign.approve(관리자, 거부는 감사)
//  문구 검사(금지 표현·세액·AI 계산)는 여기서 하고, 통과하면 지금 문구 해시를 copy_check_hash에 적는다. 문구는 사람이 쓴다 - 대신 쓰지 않는다.
export const dynamic = "force-dynamic";

const SCOPES = ["표시광고법", "세무사 광고 기준", "자본시장법"];

async function forbiddenPhrases(db: SupabaseClient): Promise<string[]> {
  const { data } = await db.from("settings").select("value").eq("key", "forbidden_phrases").maybeSingle();
  const v = data?.value;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** 저장 직후 지금 문구 해시를 문구 검사 통과 해시로 적는다 */
async function stampCopyCheck(db: SupabaseClient, id: number) {
  const row = await db.from("campaign_landings").select("content_hash").eq("id", id).single();
  if (row.error || !row.data) throw dbError(row.error ?? {}, "campaign_landings 조회");
  const upd = await db.from("campaign_landings").update({ copy_check_hash: row.data.content_hash }).eq("id", id);
  if (upd.error) throw dbError(upd.error, "campaign_landings 문구 검사 기록");
}

const rpcResult = (r: { data: unknown; error: unknown }) => {
  if (r.error) throw dbError(r.error as { message?: string }, "캠페인 함수");
  const d = r.data as { ok: boolean; code: string; message: string };
  return d.ok ? json(d) : errorJson(409, d.message, { code: d.code });
};

export const POST = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const body = await readJson(request);
  const op = String(body.op);
  const need = op === "review" ? "campaign.review_record" : op === "approve" || op === "withdraw" ? "campaign.approve" : "campaign.edit";
  const denied = await authorize(viewer, need, `campaign:${op}`);
  if (denied) return denied;
  const db = serviceDb();
  const actor = actorOf(viewer);
  const id = Number(body.id);

  if (op === "create" || op === "update") {
    const p = parseCampaignInput(body);
    if (!p.ok) return errorJson(422, "입력값을 확인하세요", { errors: p.errors });
    const v = p.value;
    const problems = campaignCopyProblems(v.title, v.body, await forbiddenPhrases(db));
    if (problems.length) return errorJson(422, "문구를 고쳐 주세요", { errors: problems });
    const fields = {
      campaign_key: v.campaignKey,
      title: v.title,
      body: v.body,
      primary_target: v.primaryTarget,
      secondary_target: v.secondaryTarget,
      primary_tool: v.primaryTool,
      channel: v.channel,
      starts_at: v.startsAt,
      ends_at: v.endsAt,
      copy_check_hash: null,
    };
    if (op === "create") {
      const ins = await db.from("campaign_landings").insert({ ...fields, created_by: actor }).select("id").single();
      if (ins.error || !ins.data) return errorJson(409, "저장하지 못했습니다 (캠페인 키가 이미 있을 수 있습니다)");
      await stampCopyCheck(db, Number(ins.data.id));
      return json({ id: ins.data.id });
    }
    if (!Number.isSafeInteger(id) || id <= 0) return errorJson(422, "입력값을 확인하세요", { errors: ["id: 확인하세요"] });
    const upd = await db.from("campaign_landings").update(fields).eq("id", id).select("id").maybeSingle();
    if (upd.error) return errorJson(409, "저장하지 못했습니다 (철회된 캠페인은 고칠 수 없습니다)");
    if (!upd.data) return errorJson(404, "그런 캠페인이 없습니다");
    await stampCopyCheck(db, id);
    return json({ id });
  }

  if (!Number.isSafeInteger(id) || id <= 0) return errorJson(422, "입력값을 확인하세요", { errors: ["id: 확인하세요"] });
  if (op === "submit") return rpcResult(await db.rpc("submit_campaign_landing", { p_id: id, p_actor: actor }));
  if (op === "approve") return rpcResult(await db.rpc("approve_campaign_landing", { p_id: id, p_approver: actor }));
  if (op === "withdraw") return rpcResult(await db.rpc("withdraw_campaign_landing", { p_id: id, p_actor: actor }));
  if (op === "review") {
    const scope = Array.isArray(body.scope) ? body.scope.filter((s): s is string => typeof s === "string" && SCOPES.includes(s)) : [];
    return rpcResult(
      await db.rpc("record_campaign_ad_review", {
        p_id: id,
        p_reviewer: typeof body.reviewer === "string" ? body.reviewer : "",
        p_basis_ref: typeof body.basisRef === "string" ? body.basisRef : "",
        p_scope: scope,
        p_result: body.result,
        p_note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
      }),
    );
  }
  return errorJson(400, "알 수 없는 요청입니다");
});
