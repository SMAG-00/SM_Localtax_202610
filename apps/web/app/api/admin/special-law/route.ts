import { can } from "@/lib/access";
import { actorOf, targetOf, writeAudit } from "@/lib/server/audit";
import { serviceDb } from "@/lib/server/articles/service";
import { authorize, requireViewer } from "@/lib/server/dal";
import { loadFact, loadFactVersions, loadMethod, latestOf } from "@/lib/server/dev-methods/board";
import { dbError, errorJson, handle, json, readJson } from "@/lib/server/http";
import { SPECIAL_LAW_COLUMNS, loadLatestLaw, loadSpecialLawBoard } from "@/lib/server/special-law";

// 특례법 확인 기록 (W4 20단계 — PRD-01B PR-13, docs/dev/W4_설계.md 1장 20단계 · 6장 · 12장 #14). 확인 기록은 관리자(PO)만(special_law.confirm), 그 밖의 역할은 403 + 거부 감사.
// 표시(special_law_basis) 켜기·끄기는 개발방법 입력 권한(dev_method.manage). 기록은 추가만이고 철회도 새 기록이다. 특례법 이름·요건은 이 코드에 없다.
//  · GET — 지금 확인됨인 공포 확인 · 최근 기록 · 표시된 행과 확인 여부
//  · POST op=law { status: enacted|withdrawn, promulgation_url?, promulgated_on?, reason } — 공포 확인(원문 주소·공포일 필수) 또는 철회. 감사 special_law.confirm / special_law.withdraw
//  · POST op=row { target: compare|fact, slug, item|fact_id, status, reason } — 표시된 한 행의 확인·철회(지금 판·지금 공포 확인 기준). 감사 같은 이름
//  · POST op=mark_compare { slug, item, on } — 비교 항목 표시 바꾸기(서명이 지워진다). op=mark_fact { slug, fact_key, on, reason } — 사실 행은 새 판으로(옛 판 그대로). 감사 special_law.mark
export const dynamic = "force-dynamic";

const invalid = (errors: string[]) => errorJson(422, "입력값을 확인하세요", { errors });
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = handle(async (request: Request) => {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  if (!can(viewer, "special_law.confirm") && !can(viewer, "dev_method.manage")) {
    const denied = await authorize(viewer, "special_law.confirm", "special_law:list");
    if (denied) return denied;
  }
  return json(await loadSpecialLawBoard(serviceDb()));
});

export const POST = handle(
  async (request: Request) => {
    const viewer = await requireViewer(request);
    if (viewer instanceof Response) return viewer;
    const body = await readJson(request);
    const op = String(body.op);
    const OPS = ["law", "row", "mark_compare", "mark_fact"];
    if (!OPS.includes(op)) return errorJson(422, `op는 ${OPS.join("·")} 중 하나입니다`, { errors: [`op: ${OPS.join("·")} 중 하나입니다`] });
    const mark = op.startsWith("mark_");
    const denied = await authorize(viewer, mark ? "dev_method.manage" : "special_law.confirm", `special_law:${op}:${str(body.slug).slice(0, 40)}`);
    if (denied) return denied;
    const db = serviceDb();
    const actor = actorOf(viewer);

    if (op === "law") {
      const status = str(body.status);
      const reason = str(body.reason);
      const errors: string[] = [];
      if (status !== "enacted" && status !== "withdrawn") errors.push("status: enacted·withdrawn 중 하나입니다");
      if (reason.length < 1 || reason.length > 200) errors.push("reason: 사유는 1~200자입니다");
      const url = str(body.promulgation_url);
      const on = str(body.promulgated_on);
      if (status === "enacted") {
        if (!/^https?:\/\/\S+$/i.test(url) || url.length > 500) errors.push("promulgation_url: 공포 원문 주소(http·https)가 필요합니다");
        if (!DATE.test(on)) errors.push("promulgated_on: 공포일(YYYY-MM-DD)이 필요합니다");
      }
      if (errors.length) return invalid(errors);
      const before = await loadLatestLaw(db);
      const { data, error } = await db
        .from("special_law_confirmations")
        .insert({ target_type: "law", status, promulgation_url: status === "enacted" ? url : null, promulgated_on: status === "enacted" ? on : null, confirmed_by: actor, reason })
        .select(SPECIAL_LAW_COLUMNS)
        .single();
      if (error || !data) {
        if (error?.code === "23514" || error?.code === "23502") return errorJson(409, error.message);
        throw dbError(error ?? {}, "special_law_confirmations 공포 확인");
      }
      await writeAudit(db, { actor, action: status === "enacted" ? "special_law.confirm" : "special_law.withdraw", target: targetOf.specialLaw("law"), before, after: data, reason });
      return json({ record: data }, 201);
    }

    if (op === "row") {
      const status = str(body.status);
      const reason = str(body.reason);
      const target = str(body.target);
      const errors: string[] = [];
      if (status !== "enacted" && status !== "withdrawn") errors.push("status: enacted·withdrawn 중 하나입니다");
      if (reason.length < 1 || reason.length > 200) errors.push("reason: 사유는 1~200자입니다");
      if (target !== "compare" && target !== "fact") errors.push("target: compare·fact 중 하나입니다");
      if (errors.length) return invalid(errors);
      const method = await loadMethod(db, str(body.slug));
      if (!method) return errorJson(404, "그런 개발방법이 없습니다");
      const law = await loadLatestLaw(db);
      let ref: string;
      let version: string;
      if (target === "compare") {
        const item = str(body.item);
        const { data, error } = await db.from("dev_method_compare").select("body, special_law_basis, drafted_at").eq("method_id", method.id).eq("item", item).maybeSingle();
        if (error) throw dbError(error, "dev_method_compare 하나");
        if (!data) return errorJson(404, "그 비교 항목에 저장된 글이 없습니다");
        const v = await db.rpc("special_law_compare_version", { p_body: data.body, p_basis: data.special_law_basis, p_drafted_at: data.drafted_at });
        if (v.error || typeof v.data !== "string") throw dbError(v.error ?? {}, "special_law_compare_version");
        ref = `${method.slug}:${item}`;
        version = v.data;
      } else {
        const fact = await loadFact(db, Number(body.fact_id));
        if (!fact || fact.method_id !== method.id) return errorJson(404, "그런 사실 행이 없습니다");
        ref = String(fact.id);
        version = String(fact.id);
      }
      const kind = target === "compare" ? "dev_method_compare" : "dev_method_fact";
      const { data, error } = await db
        .from("special_law_confirmations")
        .insert({ target_type: kind, target_ref: ref, target_version: version, law_confirmation_id: status === "enacted" ? (law?.id ?? null) : null, status, confirmed_by: actor, reason })
        .select(SPECIAL_LAW_COLUMNS)
        .single();
      if (error || !data) {
        if (error?.code === "23514" || error?.code === "23502") return errorJson(409, error.message);
        throw dbError(error ?? {}, "special_law_confirmations 행 확인");
      }
      await writeAudit(db, { actor, action: status === "enacted" ? "special_law.confirm" : "special_law.withdraw", target: targetOf.specialLaw(kind, ref), before: null, after: data, reason });
      return json({ record: data }, 201);
    }

    // 표시 바꾸기
    if (typeof body.on !== "boolean") return invalid(["on: true·false 입니다"]);
    const on = body.on;
    const method = await loadMethod(db, str(body.slug));
    if (!method) return errorJson(404, "그런 개발방법이 없습니다");
    if (op === "mark_compare") {
      const item = str(body.item);
      const { data: before, error: e1 } = await db.from("dev_method_compare").select("method_id, item, special_law_basis, review_status").eq("method_id", method.id).eq("item", item).maybeSingle();
      if (e1) throw dbError(e1, "dev_method_compare 하나");
      if (!before) return errorJson(404, "그 비교 항목에 저장된 글이 없습니다");
      if (before.special_law_basis === on) return json({ unchanged: true });
      const { data, error } = await db
        .from("dev_method_compare")
        .update({ special_law_basis: on })
        .eq("method_id", method.id)
        .eq("item", item)
        .select("method_id, item, special_law_basis, review_status")
        .single();
      if (error || !data) {
        if (error?.code === "23514") return errorJson(409, error.message);
        throw dbError(error ?? {}, "dev_method_compare 특례법 표시");
      }
      await writeAudit(db, { actor, action: "special_law.mark", target: targetOf.devMethodCompare(method.slug, item), before, after: data, reason: on ? "특례법 근거 표시 켬 — 감수 서명 지움" : "특례법 근거 표시 끔 — 감수 서명 지움" });
      return json({ compare: data });
    }
    const factKey = str(body.fact_key);
    const reason = str(body.reason);
    if (reason.length < 1 || reason.length > 200) return invalid(["reason: 새 판 사유는 1~200자입니다"]);
    const latest = latestOf(await loadFactVersions(db, method.id, factKey));
    if (!latest) return errorJson(404, "그런 숫자 요건이 없습니다");
    const { data: cur, error: e2 } = await db.from("dev_method_facts").select("special_law_basis").eq("id", latest.id).single();
    if (e2 || !cur) throw dbError(e2 ?? {}, "dev_method_facts 표시");
    if (cur.special_law_basis === on) return json({ unchanged: true });
    const row = {
      method_id: method.id,
      fact_key: latest.fact_key,
      label: latest.label,
      value: latest.value,
      unit: latest.unit,
      law_ref: latest.law_ref,
      reference_date: latest.reference_date,
      source_url: latest.source_url,
      snapshot_id: latest.snapshot_id,
      supersedes_id: latest.id,
      reason,
      recorded_by: actor,
      version: latest.version + 1,
      special_law_basis: on,
    };
    const { data, error } = await db.from("dev_method_facts").insert(row).select("id, method_id, fact_key, version, special_law_basis").single();
    if (error || !data) {
      if (error?.code === "23514" || error?.code === "23505") return errorJson(409, error.message);
      throw dbError(error ?? {}, "dev_method_facts 특례법 표시");
    }
    await writeAudit(db, { actor, action: "special_law.mark", target: targetOf.devMethodFact(data.id), before: { id: latest.id, special_law_basis: cur.special_law_basis }, after: data, reason: `특례법 근거 표시 ${on ? "켠" : "끈"} 새 판 — ${reason}` });
    return json({ fact: data }, 201);
  },
  { revalidatesPublic: true },
);
